import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import {
  CalculationMode,
  Goal,
  MENU_MAX_DAYS,
  MENU_MIN_DAYS,
  MENU_PLAN_MEAL_TYPES,
} from '../../../src/common/constants';
import { MenuPlan } from '../../../src/common/contracts';
import { ProfileContext } from '../../../src/common/types';
import {
  candidateProblems,
  candidatesPerMeal,
  daysProblem,
  labelCandidates,
  MenuPlanCandidate,
  MenuPlanCandidates,
  menuPlanModelCall,
  planDays,
  selectCandidates,
} from '../../../src/modules/services/menu/menu-plan';
import { dietTagsSatisfying } from '../../../src/modules/services/menu/menu-rules';
import { ModelResult, OpenAiService } from '../../../src/providers/open-ai/open-ai.service';
import { EvalCaseSchema, EvalSuite, FieldScore } from '../../lib/types';

const goal = (caloriesKcal: number): ProfileContext['nutritionGoal'] => ({
  goalId: 'eval-goal',
  caloriesKcal,
  proteinG: Math.round((caloriesKcal * 0.25) / 4),
  fatG: Math.round((caloriesKcal * 0.3) / 9),
  carbsG: Math.round((caloriesKcal * 0.45) / 4),
  calculationMode: CalculationMode.RuleBased,
  ruleVersion: null,
});

/** Profiles a case can run with; `basic` when the case names none. */
export const MENU_PLAN_PROFILES: Record<string, ProfileContext> = {
  basic: {
    profileId: 'eval-profile',
    goal: Goal.Maintain,
    nutritionGoal: goal(2000),
    rules: { diets: [], allergies: [], excludedIngredients: [], dislikedFoods: [] },
  },
  vegetarian: {
    profileId: 'eval-profile',
    goal: Goal.LoseWeight,
    nutritionGoal: goal(1600),
    rules: { diets: ['vegetarian'], allergies: [], excludedIngredients: [], dislikedFoods: [] },
  },
};

interface EvalRecipe extends MenuPlanCandidate {
  mealType: string;
  dietType: string[];
}

/** The seed recipes with the nutrition of a serving (`recipes.json`). */
export const MENU_PLAN_RECIPES: EvalRecipe[] = (
  JSON.parse(readFileSync(join(__dirname, 'recipes.json'), 'utf8')) as { recipes: EvalRecipe[] }
).recipes;

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
 * The candidates the app offers for the case: allowed by the diets, then `selectCandidates`, by
 * short ids.
 */
export function caseCandidates(testCase: MenuPlanCase): MenuPlanCandidates {
  const { rules, nutritionGoal } = MENU_PLAN_PROFILES[testCase.profile];
  const allowed = MENU_PLAN_RECIPES.filter((recipe) =>
    rules.diets.every((diet) =>
      dietTagsSatisfying(diet).some((tag) => recipe.dietType.includes(tag)),
    ),
  );
  const selected = Object.fromEntries(
    MENU_PLAN_MEAL_TYPES.map((mealType) => [
      mealType,
      selectCandidates(
        allowed
          .filter((recipe) => recipe.mealType === mealType)
          .map(({ id, name, perServing, complete }) => ({ id, name, perServing, complete })),
        mealType,
        nutritionGoal?.caloriesKcal ?? null,
        candidatesPerMeal(testCase.days),
        testCase.rotation,
      ),
    ]),
  ) as MenuPlanCandidates;
  return labelCandidates(selected).candidates;
}

/**
 * Whether the plan varies the meals: no recipe on two days in a row and no recipe twice for a
 * meal while its candidates had one not used yet.
 */
export function isVaried(plan: MenuPlan, candidates: MenuPlanCandidates): boolean {
  const days = planDays(plan);
  return MENU_PLAN_MEAL_TYPES.every((mealType) => {
    const ids = days.map((day) => day[mealType]);
    const distinct = new Set(ids).size;
    return (
      ids.every((id, i) => i === 0 || id !== ids[i - 1]) &&
      distinct >= Math.min(ids.length, candidates[mealType].length)
    );
  });
}

/**
 * `days`: exactly the days asked for, each `dayIndex` once; `candidates`: every meal a candidate
 * of that meal; `variety`: `isVaried`, scored only when the days are right. Output that did not
 * match the schema (`null`) fails every field.
 */
export function scoreMenuPlan(testCase: MenuPlanCase, output: MenuPlan | null): FieldScore[] {
  const candidates = caseCandidates(testCase);
  const daysRight = output !== null && daysProblem(output, testCase.days) === null;
  const unknown = output === null ? null : candidateProblems(output, candidates);
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
      field: 'variety',
      pass: output !== null && daysRight && isVaried(output, candidates),
      expected: 'no repeats while candidates are left, none on consecutive days',
      actual: output === null ? null : planDays(output),
    },
  ];
}

/** The menu planner (`MenuPlannerService`), first attempt: days, candidate ids and variety. */
export const menuPlanSuite: EvalSuite<MenuPlanCase, MenuPlan> = {
  name: 'menu-plan',
  casesFile: join(__dirname, 'cases.jsonl'),
  caseSchema: MenuPlanCaseSchema,
  run: async (testCase: MenuPlanCase, openAi: OpenAiService): Promise<ModelResult<MenuPlan>> => {
    const { input, schema, options } = menuPlanModelCall(
      testCase.request,
      testCase.days,
      MENU_PLAN_PROFILES[testCase.profile],
      caseCandidates(testCase),
    );
    return openAi.generateStructuredResult(input, schema, options);
  },
  score: scoreMenuPlan,
};
