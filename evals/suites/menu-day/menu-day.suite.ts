import { join } from 'node:path';
import { z } from 'zod';
import {
  MENU_DAY_KCAL_TOLERANCE,
  MENU_DAY_PROMPT,
  MENU_MAX_DAYS,
  MENU_MEAL_PROMPT,
  MENU_PLAN_MAX_ATTEMPTS,
  MENU_PLAN_MEAL_TYPES,
  MENU_PLAN_PROMPT,
  MealType,
  MenuIssueCode,
  MenuTargetScope,
  menuPlanRetryMessage,
} from '../../../src/common/constants';
import { MenuTarget } from '../../../src/common/contracts';
import { AssistantInvalidOutputException } from '../../../src/common/exceptions';
import {
  MenuComposition,
  ModelUsage,
  PreferenceRules,
  ProfileContext,
  ResolvedDay,
} from '../../../src/common/types';
import { MenuComposer } from '../../../src/modules/services/menu/menu-composer';
import { fitServings } from '../../../src/modules/services/menu/menu-composition';
import {
  changedSlots,
  outsideScope,
  violatingSlots,
  widenReplacement,
} from '../../../src/modules/services/menu/menu-diff';
import {
  candidateProblems,
  daysProblem,
  menuPlanErrors,
  menuPlanModelCall,
  planDays,
  PlannedDay,
  planWithRetries,
} from '../../../src/modules/services/menu/menu-plan';
import {
  ReplacementInput,
  ReplacementModelCall,
  replaceParts,
  replacedSlots,
} from '../../../src/modules/services/menu/menu-replacement';
import { errorsOf } from '../../../src/modules/services/menu/menu-rules';
import {
  MealSlot,
  MenuReplacement,
  resolveReplaceTarget,
} from '../../../src/modules/services/menu/menu-target';
import { ModelResult, LlmService } from '../../../src/providers/llm/llm.service';
import { EvalCaseSchema, EvalSuite, FieldScore, SuiteRun } from '../../lib/types';
import {
  addUsage,
  allowedRecipes,
  labelRecipes,
  MENU_PLAN_PROFILES,
  MENU_PLAN_RECIPES,
  RECIPES_BY_ID,
} from '../menu-plan/menu-plan.suite';

const RECIPES_BY_NAME = new Map(MENU_PLAN_RECIPES.map((recipe) => [recipe.name, recipe]));
const RECIPE_NAMES = new Map(MENU_PLAN_RECIPES.map(({ id, name }) => [id, name]));

/** A saved day by the names of its recipes (`menu-plan/recipes.json`). */
const DaySchema = z.object({
  breakfast: z.string().refine((name) => RECIPES_BY_NAME.has(name), 'unknown recipe'),
  lunch: z.string().refine((name) => RECIPES_BY_NAME.has(name), 'unknown recipe'),
  snack: z.string().refine((name) => RECIPES_BY_NAME.has(name), 'unknown recipe'),
  dinner: z.string().refine((name) => RECIPES_BY_NAME.has(name), 'unknown recipe'),
});

/** A part of the menu the request names: a whole day, or its `mealType` meal when set. */
const CaseTargetSchema = z.object({
  dayIndex: z.number().int().nonnegative(),
  mealType: z.enum(MealType).nullable().default(null),
});

/**
 * A menu the chat suggested (`previous`, at least two days) and the request that changes the
 * parts `targets` names, as the classifier restates it, with the `rules` it adds to those of the
 * profile ("redo Tuesday without beef"). The backend decides what is replaced
 * (`resolveReplaceTarget`, then `widenReplacement` with the meals breaking the rules): `expected`,
 * when set, is how many days and meals that must be; every day named or widened to plans the whole
 * menu again.
 * `rotation` picks the candidates like the random offset of the app does.
 */
export const MenuDayCaseSchema = EvalCaseSchema.extend({
  profile: z.enum(Object.keys(MENU_PLAN_PROFILES) as [string, ...string[]]).default('basic'),
  request: z.string().min(1),
  rules: z
    .object({
      diets: z.array(z.string()),
      allergies: z.array(z.string()),
      excludedIngredients: z.array(z.string()),
      dislikedFoods: z.array(z.string()),
    })
    .partial()
    .optional(),
  previous: z.array(DaySchema).min(2).max(MENU_MAX_DAYS),
  targets: z.array(CaseTargetSchema).min(1),
  expected: z
    .object({ days: z.number().int().nonnegative(), meals: z.number().int().nonnegative() })
    .optional(),
  rotation: z.number().int().nonnegative().default(0),
}).refine(({ previous, targets }) => targets.every(({ dayIndex }) => dayIndex < previous.length), {
  message: 'every target must be a day of previous',
  path: ['targets'],
});

export type MenuDayCase = z.infer<typeof MenuDayCaseSchema>;

/**
 * The menu after every part was replaced, with the model's message of every part; without `days`
 * when a part came back with a recipe that is not a candidate (`unknown`).
 */
export interface MenuDayOutput {
  message: string;
  days: ResolvedDay[] | null;
  unknown: string[];
}

/** The profile of the case with the rules the request adds, as `requestRules` merges them. */
export function caseProfile(testCase: MenuDayCase): ProfileContext {
  const profile = MENU_PLAN_PROFILES[testCase.profile];
  const added = testCase.rules ?? {};
  const rules = Object.fromEntries(
    (Object.keys(profile.rules) as Array<keyof PreferenceRules>).map((key) => [
      key,
      [...new Set([...profile.rules[key], ...(added[key] ?? [])])],
    ]),
  ) as unknown as PreferenceRules;
  return { ...profile, rules };
}

const dailyKcalOf = (testCase: MenuDayCase): number | null =>
  MENU_PLAN_PROFILES[testCase.profile].nutritionGoal?.caloriesKcal ?? null;

/** The previous menu as the app saved it: the recipe snapshots, servings fitted to the goal. */
export function previousDays(testCase: MenuDayCase): ResolvedDay[] {
  const dailyKcal = dailyKcalOf(testCase);
  const days = testCase.previous.map((day, dayIndex) => ({
    dayIndex,
    date: null,
    meals: MENU_PLAN_MEAL_TYPES.map((mealType) => {
      const recipe = RECIPES_BY_NAME.get(day[mealType])!;
      return { mealType, servings: 1, recipeId: recipe.id, recipe };
    }),
  }));
  return dailyKcal === null ? days : fitServings(days, dailyKcal);
}

/** The targets of the case as the classifier gives them. */
const targetsOf = (testCase: MenuDayCase): MenuTarget[] =>
  testCase.targets.map(({ dayIndex, mealType }) => ({
    scope: mealType ? MenuTargetScope.Meal : MenuTargetScope.Day,
    dayIndex,
    mealType,
  }));

/** The menu with its issues against the profile of the case, the rules of the request included. */
export const composeMenu = (testCase: MenuDayCase, days: ResolvedDay[]): MenuComposition =>
  new MenuComposer().compose(days, caseProfile(testCase));

/**
 * What the app replaces for the case: the targets (`resolveReplaceTarget`) and the meals of the
 * previous menu that break the rules (`violatingSlots`, `widenReplacement`), as
 * `MenuPlannerService.replan` does; null plans the whole menu.
 */
export function caseReplacement(testCase: MenuDayCase): MenuReplacement | null {
  const previous = previousDays(testCase);
  const replacement = resolveReplaceTarget(targetsOf(testCase), previous);
  return (
    replacement &&
    widenReplacement(
      replacement,
      violatingSlots(composeMenu(testCase, previous).issues, previous),
      previous,
    )
  );
}

/** Every day of the previous menu, the scope of a case that plans the whole menu again. */
const wholeMenu = (testCase: MenuDayCase): MenuReplacement => ({
  days: testCase.previous.map((_, dayIndex) => dayIndex),
  meals: [],
});

/** What `replaceParts` gets for the case, as `MenuPlannerService.replan` gives it. */
export function replacementInput(testCase: MenuDayCase): ReplacementInput {
  const profile = caseProfile(testCase);
  return {
    request: testCase.request,
    profile,
    previous: previousDays(testCase),
    recipes: allowedRecipes(profile),
    rejectedRecipeIds: new Set(),
    dailyKcal: dailyKcalOf(testCase),
    label: (recipes) => labelRecipes(recipes, profile, 1, testCase.rotation),
    compose: (days) => composeMenu(testCase, days),
  };
}

const sameSlot = (a: MealSlot, b: MealSlot): boolean =>
  a.dayIndex === b.dayIndex && a.mealType === b.mealType;

/**
 * The new recipes the menu serves elsewhere while their meal had another allowed recipe
 * (`withoutRecipes` and `mealRecipes` keep the others for a meal the menu uses up): for a whole
 * day, on another day or the day had it before; for a meal, anywhere else in the menu or in place
 * of itself. Another
 * recipe is one the new menu does not serve and the request did not replace on another day: a
 * meal the user replaced is no better than a repeat.
 */
function repeatedRecipes(
  testCase: MenuDayCase,
  replacement: MenuReplacement,
  days: ResolvedDay[],
): string[] {
  const previous = previousDays(testCase);
  const allowed = allowedRecipes(caseProfile(testCase));
  const served = days.flatMap(({ dayIndex, meals }) =>
    meals.map(({ mealType, recipeId }) => ({ dayIndex, mealType, recipeId })),
  );
  const servedIds = new Set(served.map(({ recipeId }) => recipeId));
  const slots = replacedSlots(replacement, days);
  const oldOf = (slot: MealSlot): string | null =>
    previous[slot.dayIndex].meals.find(({ mealType }) => mealType === slot.mealType)!.recipeId;
  return slots.flatMap((slot) => {
    const wholeDay = replacement.days.includes(slot.dayIndex);
    const { recipeId } = served.find((meal) => sameSlot(meal, slot))!;
    const old = oldOf(slot);
    const own = new Set(
      wholeDay ? previous[slot.dayIndex].meals.map((meal) => meal.recipeId) : [old],
    );
    const replacedElsewhere = new Set(
      slots.filter(({ dayIndex }) => dayIndex !== slot.dayIndex).map(oldOf),
    );
    const elsewhere = served.some(
      (meal) =>
        meal.recipeId === recipeId &&
        !sameSlot(meal, slot) &&
        (!wholeDay || meal.dayIndex !== slot.dayIndex),
    );
    const repeated = elsewhere || own.has(recipeId);
    const hadOther = allowed.some(
      ({ id, mealType }) =>
        mealType === slot.mealType &&
        !servedIds.has(id) &&
        !replacedElsewhere.has(id) &&
        !own.has(id),
    );
    return repeated && hadOther
      ? [`day ${slot.dayIndex + 1} ${slot.mealType}: ${RECIPE_NAMES.get(recipeId!)}`]
      : [];
  });
}

/**
 * The menu after the retries. `replacement`, for a case that expects it: the days and the meals
 * the app replaces, every day for the whole menu; `candidates`: every new meal a candidate of its
 * meal; `unchanged`: the diff of the versions (`changedSlots`) within the parts replaced, the rest
 * byte for byte as in the previous one; `exclusions`, but for the whole menu: no new recipe the
 * menu serves elsewhere while its meal had another (`repeatedRecipes`); `validation`: no error in
 * the whole new menu, the rules the request adds included; `calories`: every day with a new meal
 * within `MENU_DAY_KCAL_TOLERANCE` of the goal; `disliked`: no disliked food in the new meals. The
 * fields after `candidates` are scored only when the meals are candidates. Output that did not
 * match the schema (`null`) fails every field.
 */
export function scoreMenuDay(testCase: MenuDayCase, output: MenuDayOutput | null): FieldScore[] {
  const partial = caseReplacement(testCase);
  const replacement = partial ?? wholeMenu(testCase);
  const previous = previousDays(testCase);
  const days = output?.unknown.length === 0 ? output.days : null;
  const menu = days ? composeMenu(testCase, days) : null;
  const slots = replacedSlots(replacement, previous);
  const isReplaced = (dayIndex: number, mealType: MealType): boolean =>
    slots.some((slot) => sameSlot(slot, { dayIndex, mealType }));
  const touched = new Set(slots.map(({ dayIndex }) => dayIndex));
  const changed = days
    ? outsideScope(changedSlots(previous, days), slots).map(
        ({ dayIndex, mealType }) => `day ${dayIndex + 1} ${mealType}`,
      )
    : null;
  const repeated = days ? repeatedRecipes(testCase, replacement, days) : null;
  const onReplaced = (code: MenuIssueCode): string[] | null =>
    menu?.issues
      .filter((issue) => issue.code === code && touched.has(issue.dayIndex))
      .filter(
        (issue) =>
          issue.position === undefined ||
          isReplaced(issue.dayIndex, days[issue.dayIndex].meals[issue.position].mealType),
      )
      .map(({ message }) => message) ?? null;
  const errors = menu ? errorsOf(menu.issues).map(({ message }) => message) : null;
  const offTarget = onReplaced(MenuIssueCode.CaloriesOffTarget);
  const disliked = onReplaced(MenuIssueCode.DislikedFood);
  const profile = caseProfile(testCase);
  const counts = { days: replacement.days.length, meals: replacement.meals.length };
  return [
    ...(testCase.expected
      ? [
          {
            field: 'replacement',
            pass:
              output !== null &&
              counts.days === testCase.expected.days &&
              counts.meals === testCase.expected.meals,
            expected: testCase.expected,
            actual: counts,
          },
        ]
      : []),
    {
      field: 'candidates',
      pass: days !== null,
      expected: 'ids from the candidates',
      actual: output?.unknown ?? null,
    },
    {
      field: 'unchanged',
      pass: changed !== null && changed.length === 0,
      expected: 'the rest of the previous menu, unchanged',
      actual: changed,
    },
    ...(partial
      ? [
          {
            field: 'exclusions',
            pass: repeated !== null && repeated.length === 0,
            expected: 'no recipe the menu already serves',
            actual: repeated,
          },
        ]
      : []),
    {
      field: 'validation',
      pass: errors !== null && errors.length === 0,
      expected: 'no errors in the whole menu',
      actual: errors,
    },
    {
      field: 'calories',
      pass: offTarget !== null && offTarget.length === 0,
      expected: `${profile.nutritionGoal?.caloriesKcal} kcal ± ${MENU_DAY_KCAL_TOLERANCE * 100} %`,
      actual:
        offTarget === null
          ? null
          : [...touched].map((dayIndex) => menu!.days[dayIndex].totals.kcal),
    },
    {
      field: 'disliked',
      pass: disliked !== null && disliked.length === 0,
      expected: profile.rules.dislikedFoods,
      actual: disliked,
    },
  ];
}

/**
 * Plans the whole menu of the case again like `MenuPlannerService.plan` does for a revision of
 * every day (`MENU_PLAN_PROMPT`): as many days as the previous menu, with its dates, the servings
 * fitted to the goal. Without `days` when the last plan has other days or ids that are not
 * candidates (`unknown`).
 */
export async function planWholeMenu(
  testCase: MenuDayCase,
  ask: <T>(
    call: ReplacementModelCall<T>,
    problemsOf: (plan: T) => string[],
    retryMessage: (problems: string[]) => string,
  ) => Promise<T>,
): Promise<MenuDayOutput> {
  const profile = caseProfile(testCase);
  const previous = previousDays(testCase);
  const dailyKcal = dailyKcalOf(testCase);
  const { candidates, recipeIds } = labelRecipes(
    allowedRecipes(profile),
    profile,
    previous.length,
    testCase.rotation,
  );
  const resolve = (planned: PlannedDay[]): ResolvedDay[] => {
    const days = planned.map((meals, dayIndex): ResolvedDay => ({
      dayIndex,
      date: previous[dayIndex]?.date ?? null,
      meals: MENU_PLAN_MEAL_TYPES.map((mealType) => {
        const recipe = RECIPES_BY_ID.get(recipeIds.get(meals[mealType]) as string)!;
        return { mealType, servings: 1, recipeId: recipe.id, recipe };
      }),
    }));
    return dailyKcal === null ? days : fitServings(days, dailyKcal);
  };
  const plan = await ask(
    menuPlanModelCall(testCase.request, previous.length, profile, candidates),
    (planned) =>
      menuPlanErrors(planned, candidates, previous.length, (days) =>
        composeMenu(testCase, resolve(days)),
      ),
    menuPlanRetryMessage,
  );
  const wrongDays = daysProblem(plan, previous.length);
  const unknown = [...(wrongDays ? [wrongDays] : []), ...candidateProblems(plan, candidates)];
  return {
    message: plan.message,
    days: unknown.length === 0 ? resolve(planDays(plan)) : null,
    unknown,
  };
}

/**
 * Replaces the parts of the case like `MenuPlannerService.replan`: `replaceParts` with a model
 * that sends every part's problems back until it has none (`planWithRetries`) and returns the last
 * answer to score it. The usage and latency are of every call; `repairs` is how many calls
 * followed the first one of a part. Output that did not match the schema fails with the usage of
 * every call so far.
 */
export async function runMenuDay(
  testCase: MenuDayCase,
  llm: LlmService,
): Promise<SuiteRun<MenuDayOutput>> {
  const replacement = caseReplacement(testCase);
  const calls: ModelResult<unknown>[] = [];
  let repairs = 0;
  const usage = (): ModelUsage =>
    calls.reduce((total, call) => addUsage(total, call.usage), {
      inputTokens: 0,
      cachedInputTokens: 0,
      outputTokens: 0,
    });
  const ask = async <T>(
    { input, schema, options }: ReplacementModelCall<T>,
    problemsOf: (plan: T) => string[],
    retryMessage: (problems: string[]) => string,
  ): Promise<T> => {
    const attempts = await planWithRetries<T>(
      input,
      async (messages) => {
        const call = await llm.generateStructuredResult(messages, schema, options);
        calls.push(call);
        return call.output;
      },
      problemsOf,
      MENU_PLAN_MAX_ATTEMPTS,
      retryMessage,
    );
    repairs += attempts.length - 1;
    return attempts[attempts.length - 1].plan;
  };
  try {
    let output: MenuDayOutput;
    if (replacement) {
      const replaced = await replaceParts(replacement, replacementInput(testCase), ask);
      output = {
        message: replaced.messages.join(' '),
        days: replaced.days,
        unknown: replaced.unknown,
      };
    } else {
      output = await planWholeMenu(testCase, ask);
    }
    return {
      output,
      modelId: calls[0].modelId,
      latencyMs: calls.reduce((total, call) => total + call.latencyMs, 0),
      usage: usage(),
      metrics: { repairs },
    };
  } catch (error) {
    if (error instanceof AssistantInvalidOutputException && error.call && calls.length > 0) {
      throw new AssistantInvalidOutputException({
        modelId: error.call.modelId,
        usage: addUsage(usage(), error.call.usage),
      });
    }
    throw error;
  }
}

/**
 * EVAL-5: revising a suggested menu (`MenuPlannerService.replan`) with the retries: a day, a meal,
 * several parts, a constraint the request adds and the whole menu. What the backend makes of the
 * targets and the meals breaking the rules, candidate ids, the diff of the versions within the
 * scope, no recipe the menu already serves, validation of the whole menu, the calories of every day
 * changed and disliked foods of the new meals, and the repairs it took.
 */
export const menuDaySuite: EvalSuite<MenuDayCase, MenuDayOutput> = {
  name: 'menu-day',
  casesFile: join(__dirname, 'cases.jsonl'),
  caseSchema: MenuDayCaseSchema,
  prompts: [MENU_DAY_PROMPT, MENU_MEAL_PROMPT, MENU_PLAN_PROMPT],
  run: runMenuDay,
  score: scoreMenuDay,
};
