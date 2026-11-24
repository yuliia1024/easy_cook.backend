import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import {
  CalculationMode,
  Goal,
  MENU_DAY_KCAL_TOLERANCE,
  MENU_MAX_DAYS,
  MENU_MIN_DAYS,
  MENU_PLAN_MEAL_TYPES,
  MENU_PLAN_PROMPT,
  MenuIssueCode,
} from '../../../src/common/constants';
import { MenuPlan } from '../../../src/common/contracts';
import { AssistantInvalidOutputException } from '../../../src/common/exceptions';
import {
  MenuComposition,
  ModelUsage,
  ProfileContext,
  RecipeSnapshot,
  ResolvedDay,
} from '../../../src/common/types';
import { MenuComposer } from '../../../src/modules/services/menu/menu-composer';
import { fitServings } from '../../../src/modules/services/menu/menu-composition';
import {
  bestAttempt,
  candidateProblems,
  candidatesPerMeal,
  daysProblem,
  labelCandidates,
  LabelledCandidates,
  MenuPlanCandidates,
  menuPlanErrors,
  menuPlanModelCall,
  menuPlanSoftProblems,
  planDays,
  PlannedDay,
  planWithRetries,
  selectCandidates,
  varietyProblems,
} from '../../../src/modules/services/menu/menu-plan';
import {
  dietTagsSatisfying,
  isDislikedFood,
  isForbiddenFood,
} from '../../../src/modules/services/menu/menu-rules';
import { ModelResult, LlmService } from '../../../src/providers/llm/llm.service';
import { EvalCaseSchema, EvalSuite, FieldScore, SuiteRun } from '../../lib/types';

const goal = (caloriesKcal: number): ProfileContext['nutritionGoal'] => ({
  goalId: 'eval-goal',
  caloriesKcal,
  proteinG: Math.round((caloriesKcal * 0.25) / 4),
  fatG: Math.round((caloriesKcal * 0.3) / 9),
  carbsG: Math.round((caloriesKcal * 0.45) / 4),
  calculationMode: CalculationMode.RuleBased,
  ruleVersion: null,
});

const NO_RULES: ProfileContext['rules'] = {
  diets: [],
  allergies: [],
  excludedIngredients: [],
  dislikedFoods: [],
};

/** Profiles a case can run with; `basic` when the case names none. */
export const MENU_PLAN_PROFILES: Record<string, ProfileContext> = {
  basic: {
    profileId: 'eval-profile',
    goal: Goal.Maintain,
    nutritionGoal: goal(2000),
    rules: NO_RULES,
  },
  vegetarian: {
    profileId: 'eval-profile',
    goal: Goal.LoseWeight,
    nutritionGoal: goal(1600),
    rules: { ...NO_RULES, diets: ['vegetarian'] },
  },
  vegan: {
    profileId: 'eval-profile',
    goal: Goal.Maintain,
    nutritionGoal: goal(1800),
    rules: { ...NO_RULES, diets: ['vegan'] },
  },
  allergy: {
    profileId: 'eval-profile',
    goal: Goal.Maintain,
    nutritionGoal: goal(2000),
    rules: { ...NO_RULES, allergies: ['peanut', 'egg'], dislikedFoods: ['mushroom'] },
  },
  low_kcal: {
    profileId: 'eval-profile',
    goal: Goal.LoseWeight,
    nutritionGoal: goal(1400),
    rules: { ...NO_RULES, dislikedFoods: ['salmon'] },
  },
};

/** Snapshots of the seed recipes with the nutrition of a serving (`recipes.json`). */
export const MENU_PLAN_RECIPES: RecipeSnapshot[] = (
  JSON.parse(readFileSync(join(__dirname, 'recipes.json'), 'utf8')) as {
    recipes: RecipeSnapshot[];
  }
).recipes;

export const RECIPES_BY_ID = new Map(MENU_PLAN_RECIPES.map((recipe) => [recipe.id, recipe]));

/**
 * The restated request (`describeMenuRequest`) with the number of days the planner gets.
 * `rotation` picks the candidates like the random offset of the app does.
 */
export const MenuPlanCaseSchema = EvalCaseSchema.extend({
  profile: z.enum(Object.keys(MENU_PLAN_PROFILES) as [string, ...string[]]).default('basic'),
  request: z.string().min(1),
  days: z.number().int().min(MENU_MIN_DAYS).max(MENU_MAX_DAYS),
  rotation: z.number().int().nonnegative().default(0),
});

export type MenuPlanCase = z.infer<typeof MenuPlanCaseSchema>;

/**
 * The recipes the app offers the profile (`RecipeService.getAllowed`: the diets, no allergen or
 * excluded ingredient).
 */
export function allowedRecipes(profile: ProfileContext): RecipeSnapshot[] {
  const { rules } = profile;
  return MENU_PLAN_RECIPES.filter(
    (recipe) =>
      rules.diets.every((diet) =>
        dietTagsSatisfying(diet).some((tag) => recipe.dietType.includes(tag)),
      ) &&
      !recipe.ingredients.some(({ foodName, foodNameEn }) =>
        isForbiddenFood(foodName, foodNameEn, rules),
      ),
  );
}

/**
 * `selectCandidates` of every meal among the recipes, for `days` planned days, labelled by short
 * ids, as `MenuPlannerService` offers them (recipes with a disliked food only for want of others
 * for the days).
 */
export function labelRecipes(
  recipes: RecipeSnapshot[],
  profile: ProfileContext,
  days: number,
  rotation: number,
): LabelledCandidates {
  const disliked = new Set(
    recipes
      .filter(({ ingredients }) =>
        ingredients.some(({ foodName, foodNameEn }) =>
          isDislikedFood(foodName, foodNameEn, profile.rules),
        ),
      )
      .map(({ id }) => id),
  );
  const selected = Object.fromEntries(
    MENU_PLAN_MEAL_TYPES.map((mealType) => [
      mealType,
      selectCandidates(
        recipes
          .filter((recipe) => recipe.mealType === mealType)
          .map(({ id, name, perServing, complete }) => ({ id, name, perServing, complete })),
        mealType,
        profile.nutritionGoal?.caloriesKcal ?? null,
        candidatesPerMeal(days),
        rotation,
        [],
        disliked,
        days,
      ),
    ]),
  ) as MenuPlanCandidates;
  return labelCandidates(selected, disliked);
}

/** The allowed recipes of the case's profile (`allowedRecipes`), labelled (`labelRecipes`). */
function labelledCandidates(testCase: MenuPlanCase): LabelledCandidates {
  const profile = MENU_PLAN_PROFILES[testCase.profile];
  return labelRecipes(allowedRecipes(profile), profile, testCase.days, testCase.rotation);
}

/** The candidates the app offers for the case, by short ids. */
export const caseCandidates = (testCase: MenuPlanCase): MenuPlanCandidates =>
  labelledCandidates(testCase).candidates;

/**
 * The menu of the planned days, the servings fitted to the calorie goal (`fitServings`), with its
 * issues against the profile of the case (`MenuComposer`), as the app composes it. The days must be
 * from the candidates.
 */
export function composeCase(testCase: MenuPlanCase, days: PlannedDay[]): MenuComposition {
  const { recipeIds } = labelledCandidates(testCase);
  const resolved = days.map((meals, dayIndex): ResolvedDay => ({
    dayIndex,
    date: null,
    meals: MENU_PLAN_MEAL_TYPES.map((mealType) => {
      const recipe = RECIPES_BY_ID.get(recipeIds.get(meals[mealType]) as string);
      return { mealType, servings: 1, recipeId: recipe!.id, recipe: recipe! };
    }),
  }));
  const profile = MENU_PLAN_PROFILES[testCase.profile];
  const dailyKcal = profile.nutritionGoal?.caloriesKcal ?? null;
  return new MenuComposer().compose(
    dailyKcal === null ? resolved : fitServings(resolved, dailyKcal),
    profile,
  );
}

/** Whether the plan varies the meals: no repeat the planner sends back (`varietyProblems`). */
export const isVaried = (
  plan: MenuPlan,
  candidates: MenuPlanCandidates,
  dislikedIds?: ReadonlySet<string>,
): boolean => varietyProblems(plan, candidates, dislikedIds).length === 0;

/**
 * The plan after the retries. `days`: exactly the days asked for, each `dayIndex` once;
 * `candidates`: every meal a candidate of that meal; `validation`: no problem a plan is
 * rejected for (`menuPlanErrors`); `calories`: every day within `MENU_DAY_KCAL_TOLERANCE` of the goal;
 * `disliked`: no disliked food; `variety`: `isVaried`. The last four are scored only when the days
 * and the candidates are right. Output that did not match the schema (`null`) fails every field.
 */
export function scoreMenuPlan(testCase: MenuPlanCase, output: MenuPlan | null): FieldScore[] {
  const { candidates, dislikedIds } = labelledCandidates(testCase);
  const daysRight = output !== null && daysProblem(output, testCase.days) === null;
  const unknown = output === null ? null : candidateProblems(output, candidates);
  const menu =
    output !== null && daysRight && unknown?.length === 0
      ? composeCase(testCase, planDays(output))
      : null;
  const issues = (code: MenuIssueCode): string[] | null =>
    menu?.issues.filter((issue) => issue.code === code).map(({ message }) => message) ?? null;
  const errors =
    output === null
      ? null
      : menuPlanErrors(output, candidates, testCase.days, (days) => composeCase(testCase, days));
  const offTarget = issues(MenuIssueCode.CaloriesOffTarget);
  const disliked = issues(MenuIssueCode.DislikedFood);
  const goalKcal = MENU_PLAN_PROFILES[testCase.profile].nutritionGoal?.caloriesKcal;
  return [
    {
      field: 'days',
      pass: daysRight,
      expected: testCase.days,
      actual: output?.days.map(({ dayIndex }) => dayIndex) ?? null,
    },
    {
      field: 'candidates',
      pass: unknown !== null && unknown.length === 0,
      expected: 'ids from the candidates',
      actual: unknown,
    },
    {
      field: 'validation',
      pass: errors !== null && errors.length === 0,
      expected: 'no errors',
      actual: errors,
    },
    {
      field: 'calories',
      pass: offTarget !== null && offTarget.length === 0,
      expected: `${goalKcal} kcal ± ${MENU_DAY_KCAL_TOLERANCE * 100} % a day`,
      actual: offTarget === null ? null : menu!.days.map(({ totals }) => totals.kcal),
    },
    {
      field: 'disliked',
      pass: disliked !== null && disliked.length === 0,
      expected: MENU_PLAN_PROFILES[testCase.profile].rules.dislikedFoods,
      actual: disliked,
    },
    {
      field: 'variety',
      pass: menu !== null && isVaried(output!, candidates, dislikedIds),
      expected: 'no repeats while candidates are left, none on consecutive days',
      actual: output === null ? null : planDays(output),
    },
  ];
}

export const addUsage = (a: ModelUsage, b: ModelUsage): ModelUsage => ({
  inputTokens: a.inputTokens + b.inputTokens,
  cachedInputTokens: a.cachedInputTokens + b.cachedInputTokens,
  outputTokens: a.outputTokens + b.outputTokens,
});

/**
 * Plans the case like `MenuPlannerService`: the planner call, and the plan with its problems back
 * to the model until it has none (`planWithRetries`, `bestAttempt`). The usage and latency are of
 * every call answered; `repairs` is how many calls followed the first one. Output that did not match the schema fails
 * with the usage of every call so far.
 */
export async function runMenuPlan(
  testCase: MenuPlanCase,
  llm: LlmService,
): Promise<SuiteRun<MenuPlan>> {
  const labelled = labelledCandidates(testCase);
  const { candidates } = labelled;
  const { input, schema, options } = menuPlanModelCall(
    testCase.request,
    testCase.days,
    MENU_PLAN_PROFILES[testCase.profile],
    candidates,
  );
  const calls: ModelResult<MenuPlan>[] = [];
  const usage = (): ModelUsage =>
    calls.reduce((total, call) => addUsage(total, call.usage), {
      inputTokens: 0,
      cachedInputTokens: 0,
      outputTokens: 0,
    });
  try {
    const attempts = await planWithRetries(
      input,
      async (messages) => {
        const call = await llm.generateStructuredResult(messages, schema, options);
        calls.push(call);
        return call.output;
      },
      (plan) =>
        menuPlanErrors(plan, candidates, testCase.days, (days) => composeCase(testCase, days)),
      undefined,
      undefined,
      (plan) => menuPlanSoftProblems(plan, labelled, testCase.days),
    );
    return {
      output: bestAttempt(attempts).plan,
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
 * The menu planner (`MenuPlannerService`) with its retries: days, candidate ids, validation,
 * calories, disliked foods and variety of the plan used, and the repairs it took.
 */
export const menuPlanSuite: EvalSuite<MenuPlanCase, MenuPlan> = {
  name: 'menu-plan',
  casesFile: join(__dirname, 'cases.jsonl'),
  caseSchema: MenuPlanCaseSchema,
  prompts: [MENU_PLAN_PROMPT],
  run: runMenuPlan,
  score: scoreMenuPlan,
};
