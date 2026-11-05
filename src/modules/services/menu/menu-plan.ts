import { ModelMessage } from 'ai';
import {
  MENU_PLAN_CANDIDATE_POOL_FACTOR,
  MENU_PLAN_CANDIDATE_PREFIX,
  MENU_PLAN_CANDIDATES_MAX,
  MENU_PLAN_CANDIDATES_SPARE,
  MENU_PLAN_PROMPT,
  MENU_PLAN_MAX_ATTEMPTS,
  MENU_PLAN_MEAL_KCAL_SHARE,
  MENU_PLAN_MEAL_TYPES,
  menuPlanMaxOutputTokens,
  menuPlanRetryMessage,
} from '../../../common/constants';
import { MenuPlan, MenuPlanSchema } from '../../../common/contracts';
import { MacroValues, MenuComposition, ProfileContext } from '../../../common/types';
import { ModelCallOptions } from '../../../providers/open-ai/open-ai.service';
import { toModelProfile } from '../profile-context/model-profile';
import { errorsOf } from './menu-rules';

export type MenuPlanMealType = (typeof MENU_PLAN_MEAL_TYPES)[number];

/** A recipe as the model sees it: the calories and macros of one serving, rounded. */
export interface MenuPlanCandidate {
  id: string;
  name: string;
  perServing: MacroValues;
  complete: boolean;
}

export type MenuPlanCandidates = Record<MenuPlanMealType, MenuPlanCandidate[]>;

/** The recipe id of every meal of a day. */
export type PlannedDay = Record<MenuPlanMealType, string>;

/** One planner call: the input, the schema of the answer and the options. */
export interface MenuPlanModelCall {
  input: ModelMessage[];
  schema: typeof MenuPlanSchema;
  options: ModelCallOptions;
}

/** How many recipes of each meal the model gets for a menu of `days` days. Pure. */
export const candidatesPerMeal = (days: number): number =>
  Math.min(days + MENU_PLAN_CANDIDATES_SPARE, MENU_PLAN_CANDIDATES_MAX);

/**
 * The candidates of one meal: the recipes are ranked by how close a serving is to the meal's
 * share of `dailyKcal` (kept in their order without it), the best `count` x
 * `MENU_PLAN_CANDIDATE_POOL_FACTOR` form a pool, and `count` of them are taken from the pool
 * starting at `rotation` and wrapping around, so another rotation offers other recipes. Pure.
 */
export function selectCandidates(
  candidates: MenuPlanCandidate[],
  mealType: MenuPlanMealType,
  dailyKcal: number | null,
  count: number,
  rotation: number,
): MenuPlanCandidate[] {
  const ranked =
    dailyKcal === null
      ? candidates
      : [...candidates].sort((a, b) => {
          const target = dailyKcal * MENU_PLAN_MEAL_KCAL_SHARE[mealType];
          return Math.abs(a.perServing.kcal - target) - Math.abs(b.perServing.kcal - target);
        });
  const pool = ranked.slice(0, count * MENU_PLAN_CANDIDATE_POOL_FACTOR);
  if (pool.length <= count) {
    return pool;
  }
  const start = Math.abs(Math.trunc(rotation)) % pool.length;
  return Array.from({ length: count }, (_, i) => pool[(start + i) % pool.length]);
}

export interface LabelledCandidates {
  /** What the model sees, each with its short id. */
  candidates: MenuPlanCandidates;
  /** The recipe id of every short id. */
  recipeIds: Map<string, string>;
}

/** Gives every candidate a short id (`MENU_PLAN_CANDIDATE_PREFIX` and its position). Pure. */
export function labelCandidates(candidates: MenuPlanCandidates): LabelledCandidates {
  const recipeIds = new Map<string, string>();
  const labelled = Object.fromEntries(
    MENU_PLAN_MEAL_TYPES.map((mealType) => [
      mealType,
      candidates[mealType].map((candidate, i) => {
        const id = `${MENU_PLAN_CANDIDATE_PREFIX[mealType]}${i + 1}`;
        recipeIds.set(id, candidate.id);
        return { ...candidate, id };
      }),
    ]),
  ) as MenuPlanCandidates;
  return { candidates: labelled, recipeIds };
}

/**
 * The planner call for the request, the number of days, the profile and the candidates of every
 * meal. The menu plan evals (`evals/suites/menu-plan`) run the same call.
 */
export function menuPlanModelCall(
  request: string,
  days: number,
  profile: ProfileContext,
  candidates: MenuPlanCandidates,
  abortSignal?: AbortSignal,
): MenuPlanModelCall {
  return {
    input: [
      {
        role: 'user',
        content: JSON.stringify({
          request,
          days,
          profile: toModelProfile(profile),
          recipes: candidates,
        }),
      },
    ],
    schema: MenuPlanSchema,
    options: {
      prompt: MENU_PLAN_PROMPT,
      maxOutputTokens: menuPlanMaxOutputTokens(days),
      abortSignal,
    },
  };
}

/** What is wrong with the days of the plan: not exactly `days` days, each `dayIndex` from 0 once. Pure. */
export function daysProblem(plan: MenuPlan, days: number): string | null {
  const indexes = plan.days.map(({ dayIndex }) => dayIndex).sort((a, b) => a - b);
  if (indexes.length === days && indexes.every((dayIndex, i) => dayIndex === i)) {
    return null;
  }
  return `Return exactly ${days} days with dayIndex 0 to ${days - 1}, each once; you returned dayIndex ${JSON.stringify(indexes)}.`;
}

/** Every meal of the plan that is not a candidate of that meal. Pure. */
export function candidateProblems(plan: MenuPlan, candidates: MenuPlanCandidates): string[] {
  return plan.days.flatMap((day) =>
    MENU_PLAN_MEAL_TYPES.filter(
      (mealType) => !candidates[mealType].some(({ id }) => id === day.meals[mealType]),
    ).map(
      (mealType) =>
        `dayIndex ${day.dayIndex}, ${mealType}: "${day.meals[mealType]}" is not an id from the ${mealType} recipes.`,
    ),
  );
}

/** What is wrong with the shape of the plan, as sentences the model can act on. Pure. */
export function planProblems(
  plan: MenuPlan,
  candidates: MenuPlanCandidates,
  days: number,
): string[] {
  const wrongDays = daysProblem(plan, days);
  return [...(wrongDays ? [wrongDays] : []), ...candidateProblems(plan, candidates)];
}

/** The meals of every day of a plan without `planProblems`, by `dayIndex`. Pure. */
export const planDays = (plan: MenuPlan): PlannedDay[] =>
  [...plan.days].sort((a, b) => a.dayIndex - b.dayIndex).map(({ meals }) => meals);

/**
 * Everything wrong with a plan, as sentences the model can act on: `planProblems`, then the errors
 * of the menu `compose` makes of its days. Pure when `compose` is.
 */
export function menuPlanErrors(
  plan: MenuPlan,
  candidates: MenuPlanCandidates,
  days: number,
  compose: (days: PlannedDay[]) => MenuComposition,
): string[] {
  const problems = planProblems(plan, candidates, days);
  if (problems.length > 0) {
    return problems;
  }
  return errorsOf(compose(planDays(plan)).issues).map(({ message }) => `${message}.`);
}

/** A plan the model returned and what was wrong with it. */
export interface MenuPlanAttempt<T = MenuPlan> {
  plan: T;
  problems: string[];
}

/**
 * Asks the model for a plan until one has no `problemsOf`, up to `maxAttempts` calls: a plan with
 * problems goes back to the model with them (`retryMessage`). Returns every attempt, the last one
 * without problems unless all of them had some. `MenuPlannerService` and the menu plan and menu
 * day evals run the same loop, for a whole menu and for one day.
 */
export async function planWithRetries<T = MenuPlan>(
  input: ModelMessage[],
  generate: (messages: ModelMessage[]) => Promise<T>,
  problemsOf: (plan: T) => string[],
  maxAttempts = MENU_PLAN_MAX_ATTEMPTS,
  retryMessage: (problems: string[]) => string = menuPlanRetryMessage,
): Promise<MenuPlanAttempt<T>[]> {
  const messages = [...input];
  const attempts: MenuPlanAttempt<T>[] = [];
  while (attempts.length < maxAttempts) {
    const plan = await generate([...messages]);
    const problems = problemsOf(plan);
    attempts.push({ plan, problems });
    if (problems.length === 0) {
      break;
    }
    messages.push(
      { role: 'assistant', content: JSON.stringify(plan) },
      { role: 'user', content: retryMessage(problems) },
    );
  }
  return attempts;
}
