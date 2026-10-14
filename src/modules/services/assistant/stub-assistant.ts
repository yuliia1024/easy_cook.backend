import { Injectable } from '@nestjs/common';
import {
  MAX_MENU_DAYS,
  MEAL_CALORIE_SHARE,
  MealType,
  MENU_MEAL_SERVINGS,
  MenuGeneratedBy,
  MenuIssueSeverity,
  MessageRole,
} from '../../../common/constants';
import { NoRecipeCandidatesException } from '../../../common/exceptions';
import { MenuIssue, NutritionGoalSnapshot } from '../../../common/types';
import {
  Assistant,
  ChatReply,
  ChatRequest,
  MealReplacementProposal,
  MealReplacementRequest,
  MenuPlanProposal,
  MenuPlanRequest,
  RecipeCandidate,
} from './assistant';

/** Score added per earlier use of a recipe, so the menu rotates recipes. */
const REPEAT_PENALTY = 0.25;
/** The stub plans whole and half portions within this range. */
const STUB_SERVINGS = { min: 0.5, max: 3 } as const;
const DEFAULT_PLAN_DAYS = 7;

const PLAN_REQUEST = /\b(menu|plan)\b/i;
const DAYS_IN_REQUEST = /(\d+)\s*-?\s*days?\b/i;

interface Pick {
  candidate: RecipeCandidate;
  servings: number;
}

/**
 * Deterministic stand-in for the LLM. Plans by arithmetic: for every meal it takes the candidate
 * whose calories, scaled to whole or half portions, come closest to the meal's share of the daily
 * goal, and avoids repeating recipes. Ignores free-text instructions; in the chat it only
 * recognises "plan a menu (for N days)".
 */
@Injectable()
export class StubAssistant extends Assistant {
  public readonly generatedBy = MenuGeneratedBy.Stub;

  public async planMenu({
    days,
    mealTypes,
    goal,
    candidates,
    feedback,
  }: MenuPlanRequest): Promise<MenuPlanProposal> {
    const rejected = this.rejectedRecipes(feedback);
    const used = new Map<string, number>();

    const planned = days.map(({ dayIndex, date }) => ({
      dayIndex,
      date,
      meals: mealTypes.map((mealType, position) => {
        const target = goal.caloriesKcal * this.share(mealTypes, position);
        const pick = this.pick(this.pool(candidates, mealType, rejected), mealType, target, used);
        used.set(pick.candidate.id, (used.get(pick.candidate.id) ?? 0) + 1);
        return { mealType, recipeId: pick.candidate.id, servings: pick.servings };
      }),
    }));

    return {
      title: `Menu for ${days.length} ${days.length === 1 ? 'day' : 'days'}`,
      notes: 'Planned by the stub planner: calories closest to the goal, recipes rotated.',
      days: planned,
    };
  }

  public async replaceMeal({
    day,
    position,
    goal,
    candidates,
    feedback,
  }: MealReplacementRequest): Promise<MealReplacementProposal> {
    const current = day.meals[position];
    const rejected = this.rejectedRecipes(feedback);
    if (current.recipeId) {
      rejected.add(current.recipeId);
    }

    const used = new Map<string, number>();
    for (const meal of day.meals) {
      if (meal.recipeId) {
        used.set(meal.recipeId, (used.get(meal.recipeId) ?? 0) + 1);
      }
    }

    // Without a goal there is no calorie target: keep the portions, only rotate the recipe.
    const target = goal
      ? goal.caloriesKcal *
        this.share(
          day.meals.map((meal) => meal.mealType),
          position,
        )
      : 0;
    const pick = this.pick(
      this.pool(candidates, current.mealType, rejected),
      current.mealType,
      target,
      used,
    );

    return {
      recipeId: pick.candidate.id,
      servings: goal ? pick.servings : current.servings,
      notes: `Replaced by the stub planner with ${pick.candidate.name}.`,
    };
  }

  public async reply({ messages, goal, rules }: ChatRequest): Promise<ChatReply> {
    const last = [...messages].reverse().find((m) => m.role === MessageRole.User)?.content ?? '';

    if (PLAN_REQUEST.test(last)) {
      const requested = Number(DAYS_IN_REQUEST.exec(last)?.[1] ?? DEFAULT_PLAN_DAYS);
      const days = Math.min(Math.max(requested, 1), MAX_MENU_DAYS);
      return {
        content:
          `Planning a ${days}-day menu` +
          (goal ? ` around ${goal.caloriesKcal} kcal a day.` : '.') +
          (requested !== days ? ` (A menu has 1 to ${MAX_MENU_DAYS} days.)` : ''),
        action: { type: 'plan_menu', days, mealTypes: null, instructions: last },
      };
    }

    const preferences = [
      ...rules.diets,
      ...rules.allergies.map((value) => `no ${value}`),
      ...rules.excludedIngredients.map((value) => `no ${value}`),
    ];
    return {
      content: [
        'I am a placeholder assistant; real answers come with the LLM stage.',
        this.describeGoal(goal),
        preferences.length > 0 ? `I follow your preferences: ${preferences.join(', ')}.` : null,
        'Try: "plan a menu for 3 days".',
      ]
        .filter(Boolean)
        .join(' '),
      action: null,
    };
  }

  private describeGoal(goal: NutritionGoalSnapshot | null): string {
    return goal
      ? `Your daily goal is ${goal.caloriesKcal} kcal (protein ${goal.proteinG} g, ` +
          `fat ${goal.fatG} g, carbs ${goal.carbsG} g).`
      : 'Set a daily nutrition goal on the profile page before planning menus.';
  }

  /** Recipes an earlier proposal was rejected for. */
  private rejectedRecipes(feedback: MenuIssue[]): Set<string> {
    return new Set(
      feedback
        .filter((issue) => issue.severity === MenuIssueSeverity.Error && issue.recipeId)
        .map((issue) => issue.recipeId!),
    );
  }

  /** Share of the daily calories for the meal at `position`, normalised over the day. */
  private share(mealTypes: MealType[], position: number): number {
    const total = mealTypes.reduce((sum, type) => sum + MEAL_CALORIE_SHARE[type], 0);
    return MEAL_CALORIE_SHARE[mealTypes[position]] / total;
  }

  private pool(
    candidates: RecipeCandidate[],
    mealType: MealType,
    rejected: Set<string>,
  ): RecipeCandidate[] {
    return candidates.filter((c) => c.mealType === mealType && !rejected.has(c.id));
  }

  /** Lowest score wins; ties keep the order of the candidates. */
  private pick(
    pool: RecipeCandidate[],
    mealType: MealType,
    targetKcal: number,
    used: Map<string, number>,
  ): Pick {
    let best: (Pick & { score: number }) | null = null;

    for (const candidate of pool) {
      const kcal = candidate.perServing.kcal;
      const servings =
        kcal > 0 && targetKcal > 0
          ? Math.min(
              Math.max(Math.round((targetKcal / kcal) * 2) / 2, STUB_SERVINGS.min),
              Math.min(STUB_SERVINGS.max, MENU_MEAL_SERVINGS.max),
            )
          : 1;
      const miss = targetKcal > 0 ? Math.abs(servings * kcal - targetKcal) / targetKcal : 0;
      const score = miss + REPEAT_PENALTY * (used.get(candidate.id) ?? 0);

      if (!best || score < best.score) {
        best = { candidate, servings, score };
      }
    }

    if (!best) {
      throw new NoRecipeCandidatesException(mealType);
    }
    return { candidate: best.candidate, servings: best.servings };
  }
}
