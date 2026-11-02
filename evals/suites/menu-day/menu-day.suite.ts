import { join } from 'node:path';
import { z } from 'zod';
import {
  MENU_DAY_KCAL_TOLERANCE,
  MENU_DAY_PROMPT,
  MENU_MAX_DAYS,
  MENU_PLAN_MEAL_TYPES,
  menuDayRetryMessage,
  MenuIssueCode,
  MENU_PLAN_MAX_ATTEMPTS,
} from '../../../src/common/constants';
import { MenuDayPlan } from '../../../src/common/contracts';
import { AssistantInvalidOutputException } from '../../../src/common/exceptions';
import { MenuComposition, ModelUsage, ResolvedDay } from '../../../src/common/types';
import { MenuComposer } from '../../../src/modules/services/menu/menu-composer';
import { fitServings } from '../../../src/modules/services/menu/menu-composition';
import {
  menuDayErrors,
  menuDayModelCall,
  otherDaysRecipeIds,
  replaceDay,
  withoutRecipes,
} from '../../../src/modules/services/menu/menu-day';
import {
  candidateProblems,
  LabelledCandidates,
  MenuPlanCandidates,
  PlannedDay,
  planWithRetries,
} from '../../../src/modules/services/menu/menu-plan';
import { errorsOf } from '../../../src/modules/services/menu/menu-rules';
import { ModelResult, OpenAiService } from '../../../src/providers/open-ai/open-ai.service';
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

/** A saved day by the names of its recipes (`menu-plan/recipes.json`). */
const DaySchema = z.object({
  breakfast: z.string().refine((name) => RECIPES_BY_NAME.has(name), 'unknown recipe'),
  lunch: z.string().refine((name) => RECIPES_BY_NAME.has(name), 'unknown recipe'),
  snack: z.string().refine((name) => RECIPES_BY_NAME.has(name), 'unknown recipe'),
  dinner: z.string().refine((name) => RECIPES_BY_NAME.has(name), 'unknown recipe'),
});

/**
 * A menu the chat suggested (`previous`, at least two days) and the request that redoes its day
 * `dayIndex`, as the classifier restates it. `rotation` picks the candidates like the random offset
 * of the app does.
 */
export const MenuDayCaseSchema = EvalCaseSchema.extend({
  profile: z.enum(Object.keys(MENU_PLAN_PROFILES) as [string, ...string[]]).default('basic'),
  request: z.string().min(1),
  previous: z.array(DaySchema).min(2).max(MENU_MAX_DAYS),
  dayIndex: z.number().int().nonnegative(),
  rotation: z.number().int().nonnegative().default(0),
}).refine(({ previous, dayIndex }) => dayIndex < previous.length, {
  message: 'dayIndex must be a day of previous',
  path: ['dayIndex'],
});

export type MenuDayCase = z.infer<typeof MenuDayCaseSchema>;

const fitTo = (testCase: MenuDayCase, days: ResolvedDay[]): ResolvedDay[] => {
  const dailyKcal = MENU_PLAN_PROFILES[testCase.profile].nutritionGoal?.caloriesKcal ?? null;
  return dailyKcal === null ? days : fitServings(days, dailyKcal);
};

/** The previous menu as the app saved it: the recipe snapshots, servings fitted to the goal. */
export function previousDays(testCase: MenuDayCase): ResolvedDay[] {
  return fitTo(
    testCase,
    testCase.previous.map((day, dayIndex) => ({
      dayIndex,
      date: null,
      meals: MENU_PLAN_MEAL_TYPES.map((mealType) => {
        const recipe = RECIPES_BY_NAME.get(day[mealType])!;
        return { mealType, servings: 1, recipeId: recipe.id, recipe };
      }),
    })),
  );
}

/**
 * The candidates the app offers for the day: the allowed recipes without those of the other days
 * (`withoutRecipes`), selected for one day and labelled by short ids.
 */
export function dayCandidates(testCase: MenuDayCase): LabelledCandidates {
  const profile = MENU_PLAN_PROFILES[testCase.profile];
  const recipes = withoutRecipes(
    allowedRecipes(profile),
    otherDaysRecipeIds(previousDays(testCase), testCase.dayIndex),
  );
  return labelRecipes(recipes, profile, 1, testCase.rotation);
}

/**
 * The whole menu with the planned day in place of the old one, as `MenuPlannerService.replanDay`
 * builds it: the other days copied, the new day's servings fitted to the goal. The meals must be
 * candidates.
 */
export function replacedDays(testCase: MenuDayCase, meals: PlannedDay): ResolvedDay[] {
  const { recipeIds } = dayCandidates(testCase);
  const day: ResolvedDay = {
    dayIndex: testCase.dayIndex,
    date: null,
    meals: MENU_PLAN_MEAL_TYPES.map((mealType) => {
      const recipe = RECIPES_BY_ID.get(recipeIds.get(meals[mealType]) as string)!;
      return { mealType, servings: 1, recipeId: recipe.id, recipe };
    }),
  };
  return replaceDay(previousDays(testCase), fitTo(testCase, [day])[0]);
}

/** The whole menu with the planned day, with its issues against the profile of the case. */
export const composeDay = (testCase: MenuDayCase, meals: PlannedDay): MenuComposition =>
  new MenuComposer().compose(replacedDays(testCase, meals), MENU_PLAN_PROFILES[testCase.profile]);

const unknownMeals = (
  plan: MenuDayPlan,
  candidates: MenuPlanCandidates,
  dayIndex: number,
): string[] =>
  candidateProblems({ message: plan.message, days: [{ dayIndex, meals: plan.meals }] }, candidates);

/**
 * The day after the retries. `candidates`: every meal a candidate of that meal; `otherDays`: every
 * other day byte for byte as in the previous menu; `exclusions`: no recipe of another day on the
 * new day while its meal had a candidate that is not (`withoutRecipes` keeps them all for a meal
 * the other days use up); `validation`: no error in the whole menu with the new day; `calories`: the new day
 * within `MENU_DAY_KCAL_TOLERANCE` of the goal; `disliked`: no disliked food on the new day. The
 * last five are scored only when the meals are candidates. Output that did not match the schema
 * (`null`) fails every field.
 */
export function scoreMenuDay(testCase: MenuDayCase, output: MenuDayPlan | null): FieldScore[] {
  const { dayIndex } = testCase;
  const { candidates, recipeIds } = dayCandidates(testCase);
  const unknown = output === null ? null : unknownMeals(output, candidates, dayIndex);
  const valid = output !== null && unknown?.length === 0;
  const days = valid ? replacedDays(testCase, output.meals) : null;
  const menu = valid ? composeDay(testCase, output.meals) : null;
  const previous = previousDays(testCase);
  const changedDays =
    days?.filter(
      (day, i) => day.dayIndex !== dayIndex && JSON.stringify(day) !== JSON.stringify(previous[i]),
    ) ?? null;
  const excluded = otherDaysRecipeIds(previous, dayIndex);
  const hadOther = (mealType: string): boolean =>
    candidates[mealType as keyof MenuPlanCandidates].some(
      ({ id }) => !excluded.has(recipeIds.get(id)!),
    );
  const repeated =
    days?.[dayIndex].meals.filter(
      ({ mealType, recipeId }) => recipeId !== null && excluded.has(recipeId) && hadOther(mealType),
    ) ?? null;
  const onDay = (code: MenuIssueCode): string[] | null =>
    menu?.issues
      .filter((issue) => issue.code === code && issue.dayIndex === dayIndex)
      .map(({ message }) => message) ?? null;
  const errors = menu ? errorsOf(menu.issues).map(({ message }) => message) : null;
  const offTarget = onDay(MenuIssueCode.CaloriesOffTarget);
  const disliked = onDay(MenuIssueCode.DislikedFood);
  const profile = MENU_PLAN_PROFILES[testCase.profile];
  return [
    {
      field: 'candidates',
      pass: valid,
      expected: 'ids from the candidates',
      actual: unknown,
    },
    {
      field: 'otherDays',
      pass: changedDays !== null && changedDays.length === 0,
      expected: 'the other days of the previous menu, unchanged',
      actual: changedDays?.map((day) => day.dayIndex) ?? null,
    },
    {
      field: 'exclusions',
      pass: repeated !== null && repeated.length === 0,
      expected: 'no recipe of another day',
      actual: repeated?.map(({ recipe }) => recipe.name) ?? null,
    },
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
      actual: offTarget === null ? null : menu!.days[dayIndex].totals.kcal,
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
 * Plans the day like `MenuPlannerService.replanDay`: the day call, and the day with its problems
 * back to the model until it has none (`planWithRetries`, `menuDayErrors`). The usage and latency
 * are of every call; `repairs` is how many calls followed the first one. Output that did not match
 * the schema fails with the usage of every call so far.
 */
export async function runMenuDay(
  testCase: MenuDayCase,
  openAi: OpenAiService,
): Promise<SuiteRun<MenuDayPlan>> {
  const { candidates } = dayCandidates(testCase);
  const { input, schema, options } = menuDayModelCall(
    testCase.request,
    testCase.dayIndex,
    MENU_PLAN_PROFILES[testCase.profile],
    candidates,
  );
  const calls: ModelResult<MenuDayPlan>[] = [];
  const usage = (): ModelUsage =>
    calls.reduce((total, call) => addUsage(total, call.usage), {
      inputTokens: 0,
      cachedInputTokens: 0,
      outputTokens: 0,
    });
  try {
    const attempts = await planWithRetries<MenuDayPlan>(
      input,
      async (messages) => {
        const call = await openAi.generateStructuredResult(messages, schema, options);
        calls.push(call);
        return call.output;
      },
      (plan) =>
        menuDayErrors(plan, candidates, testCase.dayIndex, (meals) => composeDay(testCase, meals)),
      MENU_PLAN_MAX_ATTEMPTS,
      menuDayRetryMessage,
    );
    return {
      output: attempts[attempts.length - 1].plan,
      modelId: calls[0].modelId,
      latencyMs: calls.reduce((total, call) => total + call.latencyMs, 0),
      usage: usage(),
      metrics: { repairs: attempts.length - 1 },
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
 * EVAL-5: redoing one day of a suggested menu (`MenuPlannerService.replanDay`) with its retries:
 * candidate ids, the other days unchanged, no recipe of another day, validation of the whole menu,
 * calories and disliked foods of the new day, and the repairs it took.
 */
export const menuDaySuite: EvalSuite<MenuDayCase, MenuDayPlan> = {
  name: 'menu-day',
  casesFile: join(__dirname, 'cases.jsonl'),
  caseSchema: MenuDayCaseSchema,
  prompts: [MENU_DAY_PROMPT],
  run: runMenuDay,
  score: scoreMenuDay,
};
