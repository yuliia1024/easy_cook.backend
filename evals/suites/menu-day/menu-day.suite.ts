import { join } from 'node:path';
import { ModelMessage } from 'ai';
import { z, ZodType } from 'zod';
import {
  MENU_DAY_KCAL_TOLERANCE,
  MENU_DAY_PROMPT,
  MENU_MAX_DAYS,
  MENU_MEAL_PROMPT,
  MENU_PLAN_MEAL_TYPES,
  MealType,
  menuDayRetryMessage,
  MenuIssueCode,
  menuMealRetryMessage,
  MENU_PLAN_MAX_ATTEMPTS,
} from '../../../src/common/constants';
import { MenuDayPlan, MenuMealPlan } from '../../../src/common/contracts';
import { AssistantInvalidOutputException } from '../../../src/common/exceptions';
import {
  MenuComposition,
  ModelUsage,
  RecipeSnapshot,
  ResolvedDay,
} from '../../../src/common/types';
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
  fittingDayKcal,
  mealRecipes,
  mealServings,
  menuMealErrors,
  menuMealModelCall,
  menuRecipeIds,
  otherMealsKcal,
  replaceMeal,
} from '../../../src/modules/services/menu/menu-meal';
import {
  LabelledCandidates,
  MenuPlanCandidates,
  MenuPlanMealType,
  PlannedDay,
  planWithRetries,
} from '../../../src/modules/services/menu/menu-plan';
import { errorsOf } from '../../../src/modules/services/menu/menu-rules';
import {
  ModelCallOptions,
  ModelResult,
  OpenAiService,
} from '../../../src/providers/open-ai/open-ai.service';
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
 * `dayIndex`, or only the `mealType` meal of that day when set, as the classifier restates it.
 * `rotation` picks the candidates like the random offset of the app does.
 */
export const MenuDayCaseSchema = EvalCaseSchema.extend({
  profile: z.enum(Object.keys(MENU_PLAN_PROFILES) as [string, ...string[]]).default('basic'),
  request: z.string().min(1),
  previous: z.array(DaySchema).min(2).max(MENU_MAX_DAYS),
  dayIndex: z.number().int().nonnegative(),
  mealType: z.enum(MealType).nullable().default(null),
  rotation: z.number().int().nonnegative().default(0),
}).refine(({ previous, dayIndex }) => dayIndex < previous.length, {
  message: 'dayIndex must be a day of previous',
  path: ['dayIndex'],
});

export type MenuDayCase = z.infer<typeof MenuDayCaseSchema>;

/**
 * The new meals of a case: every meal of a day planned again (`MenuDayPlan`), or the one meal
 * replaced (`MenuMealPlan`) by its meal type.
 */
export interface MenuDayOutput {
  message: string;
  meals: Partial<PlannedDay>;
}

/** The meals a case plans again: the one meal, or every meal of the day. */
export const plannedMeals = (testCase: MenuDayCase): MenuPlanMealType[] =>
  testCase.mealType ? [testCase.mealType as MenuPlanMealType] : [...MENU_PLAN_MEAL_TYPES];

const dailyKcalOf = (testCase: MenuDayCase): number | null =>
  MENU_PLAN_PROFILES[testCase.profile].nutritionGoal?.caloriesKcal ?? null;

const fitTo = (testCase: MenuDayCase, days: ResolvedDay[]): ResolvedDay[] => {
  const dailyKcal = dailyKcalOf(testCase);
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
 * The candidates the app offers for the case, labelled by short ids: for a day, the allowed
 * recipes without those of the other days (`withoutRecipes`), selected for one day; for a meal,
 * the allowed recipes of that meal not in the menu yet (`mealRecipes`) that keep the day within
 * its calories (`fittingDayKcal`), selected the same way.
 */
export function dayCandidates(testCase: MenuDayCase): LabelledCandidates {
  const profile = MENU_PLAN_PROFILES[testCase.profile];
  const previous = previousDays(testCase);
  const { dayIndex, mealType } = testCase;
  if (!mealType) {
    const recipes = withoutRecipes(allowedRecipes(profile), otherDaysRecipeIds(previous, dayIndex));
    return labelRecipes(recipes, profile, 1, testCase.rotation);
  }
  const day = previous[dayIndex];
  const recipes = fittingDayKcal(
    mealRecipes(allowedRecipes(profile), previous, day, mealType),
    (recipe) => recipe.perServing.kcal,
    otherMealsKcal(day, mealType),
    dailyKcalOf(testCase),
  );
  return labelRecipes(recipes, profile, 1, testCase.rotation);
}

/**
 * The whole menu with the new meals in place of the old ones, as `MenuPlannerService` builds it:
 * for a day (`replanDay`) the other days copied and the new day's servings fitted to the goal, for
 * a meal (`replanMeal`) every other meal copied and the new meal's servings set to bring the day
 * closest to the goal. The meals must be candidates.
 */
export function replacedDays(testCase: MenuDayCase, meals: Partial<PlannedDay>): ResolvedDay[] {
  const { recipeIds } = dayCandidates(testCase);
  const previous = previousDays(testCase);
  const { dayIndex, mealType } = testCase;
  const recipeOf = (type: MenuPlanMealType): RecipeSnapshot =>
    RECIPES_BY_ID.get(recipeIds.get(meals[type]) as string)!;
  if (!mealType) {
    const day: ResolvedDay = {
      dayIndex,
      date: null,
      meals: MENU_PLAN_MEAL_TYPES.map((type) => {
        const recipe = recipeOf(type);
        return { mealType: type, servings: 1, recipeId: recipe.id, recipe };
      }),
    };
    return replaceDay(previous, fitTo(testCase, [day])[0]);
  }
  const old = previous[dayIndex];
  const recipe = recipeOf(mealType as MenuPlanMealType);
  const dailyKcal = dailyKcalOf(testCase);
  const servings =
    dailyKcal === null
      ? 1
      : mealServings(recipe.perServing.kcal, otherMealsKcal(old, mealType), dailyKcal);
  return replaceDay(
    previous,
    replaceMeal(old, { mealType, servings, recipeId: recipe.id, recipe }),
  );
}

/** The whole menu with the new meals, with its issues against the profile of the case. */
export const composeDay = (testCase: MenuDayCase, meals: Partial<PlannedDay>): MenuComposition =>
  new MenuComposer().compose(replacedDays(testCase, meals), MENU_PLAN_PROFILES[testCase.profile]);

/** The new meals that are not candidates of their meal, as the app names them. */
const unknownMeals = (
  testCase: MenuDayCase,
  output: MenuDayOutput,
  candidates: MenuPlanCandidates,
): string[] =>
  plannedMeals(testCase)
    .filter((mealType) => !candidates[mealType].some(({ id }) => id === output.meals[mealType]))
    .map(
      (mealType) =>
        `dayIndex ${testCase.dayIndex}, ${mealType}: "${output.meals[mealType]}" is not an id from the ${mealType} recipes.`,
    );

/**
 * The new meals after the retries. `candidates`: every new meal a candidate of its meal;
 * `unchanged`: everything else of the menu byte for byte as in the previous one (the other days,
 * and for a meal the other meals of its day); `exclusions`: no new recipe that the menu already
 * serves (for a day, on the other days) while its meal had a candidate that it does not
 * (`withoutRecipes` keeps them all for a meal the menu uses up); `validation`: no error in the
 * whole new menu; `calories`: the day within `MENU_DAY_KCAL_TOLERANCE` of the goal; `disliked`: no
 * disliked food in the new meals. The last five are scored only when the meals are candidates.
 * Output that did not match the schema (`null`) fails every field.
 */
export function scoreMenuDay(testCase: MenuDayCase, output: MenuDayOutput | null): FieldScore[] {
  const { dayIndex } = testCase;
  const planned = plannedMeals(testCase);
  const { candidates, recipeIds } = dayCandidates(testCase);
  const unknown = output === null ? null : unknownMeals(testCase, output, candidates);
  const valid = output !== null && unknown?.length === 0;
  const days = valid ? replacedDays(testCase, output.meals) : null;
  const menu = valid ? composeDay(testCase, output.meals) : null;
  const previous = previousDays(testCase);
  const isPlanned = (i: number, mealType: string): boolean =>
    i === dayIndex && planned.includes(mealType as MenuPlanMealType);
  const changed =
    days?.flatMap((day, i) =>
      i === dayIndex
        ? day.meals
            .filter(
              (meal, j) =>
                !isPlanned(i, meal.mealType) &&
                JSON.stringify(meal) !== JSON.stringify(previous[i].meals[j]),
            )
            .map(({ mealType }) => `day ${i + 1} ${mealType}`)
        : JSON.stringify(day) === JSON.stringify(previous[i])
          ? []
          : [`day ${i + 1}`],
    ) ?? null;
  const excluded = testCase.mealType
    ? menuRecipeIds(previous)
    : otherDaysRecipeIds(previous, dayIndex);
  const hadOther = (mealType: string): boolean =>
    candidates[mealType as MenuPlanMealType].some(({ id }) => !excluded.has(recipeIds.get(id)!));
  const newMeals = days?.[dayIndex].meals.filter(({ mealType }) => isPlanned(dayIndex, mealType));
  const repeated =
    newMeals?.filter(
      ({ mealType, recipeId }) => recipeId !== null && excluded.has(recipeId) && hadOther(mealType),
    ) ?? null;
  const positions = new Set(
    days?.[dayIndex].meals.flatMap(({ mealType }, j) => (isPlanned(dayIndex, mealType) ? [j] : [])),
  );
  const onDay = (code: MenuIssueCode): string[] | null =>
    menu?.issues
      .filter((issue) => issue.code === code && issue.dayIndex === dayIndex)
      .filter((issue) => issue.position === undefined || positions.has(issue.position))
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
      field: 'unchanged',
      pass: changed !== null && changed.length === 0,
      expected: 'the rest of the previous menu, unchanged',
      actual: changed,
    },
    {
      field: 'exclusions',
      pass: repeated !== null && repeated.length === 0,
      expected: 'no recipe the menu already serves',
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

/** One model call of the app: the input, the schema of the answer and the options. */
interface SuiteCall<T> {
  input: ModelMessage[];
  schema: ZodType<T>;
  options: ModelCallOptions;
}

/**
 * The call with its problems back to the model until it has none (`planWithRetries`), like the
 * app. The usage and latency are of every call; `repairs` is how many calls followed the first
 * one. Output that did not match the schema fails with the usage of every call so far.
 */
async function runWithRetries<T>(
  openAi: OpenAiService,
  { input, schema, options }: SuiteCall<T>,
  problemsOf: (plan: T) => string[],
  retryMessage: (problems: string[]) => string,
): Promise<SuiteRun<T>> {
  const calls: ModelResult<T>[] = [];
  const usage = (): ModelUsage =>
    calls.reduce((total, call) => addUsage(total, call.usage), {
      inputTokens: 0,
      cachedInputTokens: 0,
      outputTokens: 0,
    });
  try {
    const attempts = await planWithRetries<T>(
      input,
      async (messages) => {
        const call = await openAi.generateStructuredResult(messages, schema, options);
        calls.push(call);
        return call.output;
      },
      problemsOf,
      MENU_PLAN_MAX_ATTEMPTS,
      retryMessage,
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
 * Plans the case like `MenuPlannerService`: a day with the day call and `menuDayErrors`
 * (`replanDay`), a meal with the meal call and `menuMealErrors` (`replanMeal`), each with its
 * retries (`runWithRetries`). The output of a meal is its recipe by its meal type.
 */
export async function runMenuDay(
  testCase: MenuDayCase,
  openAi: OpenAiService,
): Promise<SuiteRun<MenuDayOutput>> {
  const { candidates } = dayCandidates(testCase);
  const { dayIndex, mealType } = testCase;
  const profile = MENU_PLAN_PROFILES[testCase.profile];
  if (!mealType) {
    return runWithRetries<MenuDayPlan>(
      openAi,
      menuDayModelCall(testCase.request, dayIndex, profile, candidates),
      (plan) => menuDayErrors(plan, candidates, dayIndex, (meals) => composeDay(testCase, meals)),
      menuDayRetryMessage,
    );
  }
  const day = previousDays(testCase)[dayIndex];
  const position = day.meals.findIndex((meal) => meal.mealType === mealType);
  const run = await runWithRetries<MenuMealPlan>(
    openAi,
    menuMealModelCall(testCase.request, day, mealType, profile, candidates[mealType]),
    (plan) =>
      menuMealErrors(plan, candidates[mealType], dayIndex, mealType, position, (recipe) =>
        composeDay(testCase, { [mealType]: recipe }),
      ),
    menuMealRetryMessage,
  );
  return {
    ...run,
    output: { message: run.output.message, meals: { [mealType]: run.output.recipe } },
  };
}

/**
 * EVAL-5: redoing one day (`MenuPlannerService.replanDay`) or one meal (`replanMeal`) of a
 * suggested menu with its retries: candidate ids, the rest of the menu unchanged, no recipe the
 * menu already serves, validation of the whole menu, the calories of the day and disliked foods
 * of the new meals, and the repairs it took.
 */
export const menuDaySuite: EvalSuite<MenuDayCase, MenuDayOutput> = {
  name: 'menu-day',
  casesFile: join(__dirname, 'cases.jsonl'),
  caseSchema: MenuDayCaseSchema,
  prompts: [MENU_DAY_PROMPT, MENU_MEAL_PROMPT],
  run: runMenuDay,
  score: scoreMenuDay,
};
