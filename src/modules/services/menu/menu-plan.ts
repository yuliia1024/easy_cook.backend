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
  MENU_PLAN_WISHED_SHARE,
  menuPlanMaxOutputTokens,
  menuPlanRetryMessage,
} from '../../../common/constants';
import { MenuPlan, MenuPlanSchema } from '../../../common/contracts';
import { ServiceUnavailableError } from '../../../common/exceptions';
import { MacroValues, MenuComposition, ProfileContext } from '../../../common/types';
import { ModelCallOptions } from '../../../providers/llm/llm.service';
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
 * starting at `rotation` and wrapping around, so another rotation offers other recipes.
 * `wishedIds` (recipe ids the search found for the request's wishes, best first) come first, up
 * to `MENU_PLAN_WISHED_SHARE` of `count`, and the pool fills the rest. Recipes of `dislikedIds`
 * (with a disliked food) are left out while the others fill the candidates; when they do not, all
 * the others are taken, by calories, and the disliked ones closest to the calories fill up the
 * rest: a model offered a disliked recipe picks it now and then. Pure.
 */
export function selectCandidates(
  candidates: MenuPlanCandidate[],
  mealType: MenuPlanMealType,
  dailyKcal: number | null,
  count: number,
  rotation: number,
  wishedIds: readonly string[] = [],
  dislikedIds: ReadonlySet<string> = new Set(),
): MenuPlanCandidate[] {
  const byId = new Map(candidates.map((candidate) => [candidate.id, candidate]));
  const wished = [...new Set(wishedIds)]
    .map((id) => byId.get(id))
    .filter((candidate): candidate is MenuPlanCandidate => candidate !== undefined)
    .slice(0, Math.ceil(count * MENU_PLAN_WISHED_SHARE));
  const taken = new Set(wished.map(({ id }) => id));
  const rest = candidates.filter(({ id }) => !taken.has(id));
  const left = count - wished.length;
  const byCalories = (recipes: MenuPlanCandidate[]): MenuPlanCandidate[] =>
    dailyKcal === null
      ? recipes
      : [...recipes].sort((a, b) => {
          const target = dailyKcal * MENU_PLAN_MEAL_KCAL_SHARE[mealType];
          return Math.abs(a.perServing.kcal - target) - Math.abs(b.perServing.kcal - target);
        });
  const liked = rest.filter(({ id }) => !dislikedIds.has(id));
  if (liked.length < rest.length && liked.length < left) {
    const disliked = rest.filter(({ id }) => dislikedIds.has(id));
    return [...wished, ...byCalories(liked), ...byCalories(disliked).slice(0, left - liked.length)];
  }
  const pool = byCalories(liked).slice(0, left * MENU_PLAN_CANDIDATE_POOL_FACTOR);
  if (pool.length <= left) {
    return [...wished, ...pool];
  }
  const start = Math.abs(Math.trunc(rotation)) % pool.length;
  return [...wished, ...Array.from({ length: left }, (_, i) => pool[(start + i) % pool.length])];
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

/**
 * Every repeat of the plan that could be avoided: a recipe on two days in a row (but for a meal
 * with a single candidate), or one used again for a meal while its candidates have one not used
 * yet. Pure.
 */
export function varietyProblems(plan: MenuPlan, candidates: MenuPlanCandidates): string[] {
  const days = planDays(plan);
  return MENU_PLAN_MEAL_TYPES.flatMap((mealType) => {
    const ids = days.map((day) => day[mealType]);
    const unused = candidates[mealType].map(({ id }) => id).filter((id) => !ids.includes(id));
    const instead =
      unused.length > 0
        ? `not used yet: ${unused.join(', ')}`
        : `use another id from the ${mealType} recipes`;
    return ids.flatMap((id, i) => {
      const at = `dayIndex ${i}, ${mealType}: "${id}" is already on dayIndex`;
      if (i > 0 && id === ids[i - 1] && candidates[mealType].length > 1) {
        return [`${at} ${i - 1}, the day before; ${instead}.`];
      }
      const first = ids.indexOf(id);
      return first < i && unused.length > 0 ? [`${at} ${first}; ${instead}.`] : [];
    });
  });
}

/**
 * The `varietyProblems` of a plan without `planProblems`, none of another: the soft problems of a
 * menu plan (`planWithRetries`). Pure.
 */
export const menuPlanRepeats = (
  plan: MenuPlan,
  candidates: MenuPlanCandidates,
  days: number,
): string[] =>
  planProblems(plan, candidates, days).length > 0 ? [] : varietyProblems(plan, candidates);

/**
 * A plan the model returned, what was wrong with it and its soft problems: those worth another
 * attempt that do not make the plan unacceptable.
 */
export interface MenuPlanAttempt<T = MenuPlan> {
  plan: T;
  problems: string[];
  softProblems: string[];
}

const isAcceptable = <T>({ problems }: MenuPlanAttempt<T>): boolean => problems.length === 0;

/**
 * Asks the model for a plan until one has no `problemsOf` and no `softProblemsOf`, up to
 * `maxAttempts` calls: a plan with problems of either kind goes back to the model with them
 * (`retryMessage`). Returns every attempt; `bestAttempt` is the one to use. A call that fails
 * (no provider, invalid output) ends the loop when an attempt before it is acceptable, otherwise it
 * throws: a menu that only repeats a recipe is not lost to a retry. `MenuPlannerService` and the
 * menu plan and menu day evals run the same loop, for a whole menu and for one day.
 */
export async function planWithRetries<T = MenuPlan>(
  input: ModelMessage[],
  generate: (messages: ModelMessage[]) => Promise<T>,
  problemsOf: (plan: T) => string[],
  maxAttempts = MENU_PLAN_MAX_ATTEMPTS,
  retryMessage: (problems: string[]) => string = menuPlanRetryMessage,
  softProblemsOf: (plan: T) => string[] = () => [],
): Promise<MenuPlanAttempt<T>[]> {
  const messages = [...input];
  const attempts: MenuPlanAttempt<T>[] = [];
  while (attempts.length < maxAttempts) {
    let plan: T;
    try {
      plan = await generate([...messages]);
    } catch (error) {
      if (error instanceof ServiceUnavailableError && attempts.some(isAcceptable)) {
        break;
      }
      throw error;
    }
    const problems = problemsOf(plan);
    const softProblems = softProblemsOf(plan);
    attempts.push({ plan, problems, softProblems });
    if (problems.length === 0 && softProblems.length === 0) {
      break;
    }
    messages.push(
      { role: 'assistant', content: JSON.stringify(plan) },
      { role: 'user', content: retryMessage([...problems, ...softProblems]) },
    );
  }
  return attempts;
}

/**
 * The attempt to use of `planWithRetries`: the one with the fewest soft problems, the latest of
 * them, among those without problems; the last one when all have problems. Pure.
 */
export function bestAttempt<T>(attempts: MenuPlanAttempt<T>[]): MenuPlanAttempt<T> {
  const acceptable = attempts.filter(isAcceptable);
  return acceptable.length === 0
    ? attempts[attempts.length - 1]
    : acceptable.reduce((best, attempt) =>
        attempt.softProblems.length <= best.softProblems.length ? attempt : best,
      );
}
