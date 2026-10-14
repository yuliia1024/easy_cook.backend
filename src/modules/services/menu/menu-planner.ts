import { Injectable } from '@nestjs/common';
import {
  MAX_MENU_PLANNING_ATTEMPTS,
  MAX_PLANNING_CANDIDATES,
  MealType,
  MENU_MEAL_SERVINGS,
  MenuIssueCode,
  MenuIssueSeverity,
} from '../../../common/constants';
import {
  MenuMealNotFoundException,
  MenuPlanningFailedException,
  NoRecipeCandidatesException,
  NutritionGoalNotFoundException,
} from '../../../common/exceptions';
import { MenuDayDraft, MenuIssue, PreferenceRules } from '../../../common/types';
import { MenuVersionData } from '../../data-access/menu/menu.repository';
import { Assistant, RecipeCandidate } from '../assistant/assistant';
import { NutritionService } from '../nutrition/nutrition.service';
import { RecipeService } from '../recipe/recipe.service';
import { MenuComposer, MenuContext } from './menu-composer';
import { snapshotRecipe } from './menu-composition';
import { errorsOf, recipeIssues } from './menu-rules';

export interface PlanRequest {
  days: number;
  mealTypes: MealType[];
  /** Date of day 0; the days follow it. Null for an undated menu. */
  startDate: Date | null;
  instructions: string | null;
}

export interface PlannedMenu {
  title: string;
  version: MenuVersionData;
}

const DAY_MS = 24 * 60 * 60 * 1000;

const invalid = (message: string, dayIndex?: number): MenuIssue => ({
  severity: MenuIssueSeverity.Error,
  code: MenuIssueCode.InvalidProposal,
  message,
  ...(dayIndex !== undefined && { dayIndex }),
});

/**
 * Runs the assistant and treats its output as untrusted: every proposal is checked for shape,
 * rebuilt from the database and validated against the profile; a rejected one goes back to the
 * assistant with the errors, at most `MAX_MENU_PLANNING_ATTEMPTS` times.
 */
@Injectable()
export class MenuPlanner {
  constructor(
    private readonly assistant: Assistant,
    private readonly recipeService: RecipeService,
    private readonly nutritionService: NutritionService,
    private readonly menuComposer: MenuComposer,
  ) {}

  public async plan(request: PlanRequest, context: MenuContext): Promise<PlannedMenu> {
    if (!context.goal) {
      throw new NutritionGoalNotFoundException();
    }
    const candidates = await this.candidates(request.mealTypes, context.rules);
    const days = Array.from({ length: request.days }, (_, dayIndex) => ({
      dayIndex,
      date: request.startDate ? new Date(request.startDate.getTime() + dayIndex * DAY_MS) : null,
    }));

    let feedback: MenuIssue[] = [];
    for (let attempt = 0; attempt < MAX_MENU_PLANNING_ATTEMPTS; attempt++) {
      const proposal = await this.assistant.planMenu({
        days,
        mealTypes: request.mealTypes,
        goal: context.goal,
        rules: context.rules,
        candidates,
        feedback,
        instructions: request.instructions,
      });

      feedback = this.shapeIssues(proposal.days, request);
      if (feedback.length === 0) {
        const built = await this.menuComposer.build(proposal.days, context, {
          generatedBy: this.assistant.generatedBy,
          notes: proposal.notes,
        });
        feedback = errorsOf(built.issues);
        if (feedback.length === 0) {
          return { title: proposal.title, version: built.version! };
        }
      }
    }
    throw new MenuPlanningFailedException(
      MAX_MENU_PLANNING_ATTEMPTS,
      feedback.map((issue) => issue.message),
    );
  }

  /**
   * The next version with one meal replaced. Only the new meal must pass the rules: the others
   * are kept as they are, with their issues, so meals can be fixed one by one.
   */
  public async replaceMeal(
    draft: MenuDayDraft[],
    target: { dayIndex: number; position: number; instructions: string | null },
    context: MenuContext,
  ): Promise<MenuVersionData> {
    const day = draft.find((d) => d.dayIndex === target.dayIndex);
    const meal = day?.meals[target.position];
    if (!day || !meal) {
      throw new MenuMealNotFoundException(target.dayIndex, target.position);
    }
    const candidates = await this.candidates([meal.mealType], context.rules);

    let feedback: MenuIssue[] = [];
    for (let attempt = 0; attempt < MAX_MENU_PLANNING_ATTEMPTS; attempt++) {
      const proposal = await this.assistant.replaceMeal({
        day,
        position: target.position,
        goal: context.goal,
        rules: context.rules,
        candidates,
        feedback,
        instructions: target.instructions,
      });

      feedback = this.servingsIssue(proposal.servings, target.dayIndex);
      if (feedback.length === 0) {
        const next = draft.map((d) =>
          d === day
            ? {
                ...d,
                meals: d.meals.map((m, position) =>
                  position === target.position
                    ? {
                        mealType: m.mealType,
                        recipeId: proposal.recipeId,
                        servings: proposal.servings,
                      }
                    : m,
                ),
              }
            : d,
        );
        const built = await this.menuComposer.build(next, context, {
          generatedBy: this.assistant.generatedBy,
          notes: proposal.notes,
        });
        feedback = errorsOf(built.issues).filter(
          (issue) =>
            issue.code === MenuIssueCode.RecipeNotFound ||
            (issue.dayIndex === target.dayIndex && issue.position === target.position),
        );
        if (feedback.length === 0) {
          return built.version!;
        }
      }
    }
    throw new MenuPlanningFailedException(
      MAX_MENU_PLANNING_ATTEMPTS,
      feedback.map((issue) => issue.message),
    );
  }

  /** Recipes of the meal types that break no hard rule of the profile. */
  private async candidates(
    mealTypes: MealType[],
    rules: PreferenceRules,
  ): Promise<RecipeCandidate[]> {
    const types = [...new Set(mealTypes)];
    const recipes = await this.recipeService.getCandidates(
      { mealTypes: types, dietTypes: rules.diets },
      MAX_PLANNING_CANDIDATES * types.length,
    );

    const candidates = recipes.flatMap((recipe): RecipeCandidate[] => {
      const snapshot = snapshotRecipe(recipe, this.nutritionService.calculateRecipe(recipe));
      if (errorsOf(recipeIssues(snapshot, rules)).length > 0) {
        return [];
      }
      return [
        {
          id: recipe.id,
          name: recipe.name,
          mealType: recipe.mealType as MealType,
          dietType: recipe.dietType,
          perServing: snapshot.perServing,
          complete: snapshot.complete,
        },
      ];
    });

    const empty = types.find((type) => !candidates.some((c) => c.mealType === type));
    if (empty) {
      throw new NoRecipeCandidatesException(empty);
    }
    return candidates;
  }

  /** The proposal must fill exactly the requested days with the requested meals. */
  private shapeIssues(days: MenuDayDraft[], request: PlanRequest): MenuIssue[] {
    const expected = Array.from({ length: request.days }, (_, i) => i);
    const given = days.map((day) => day.dayIndex).sort((a, b) => a - b);
    if (given.join() !== expected.join()) {
      return [invalid(`Expected days ${expected.join(', ')}, got ${given.join(', ') || 'none'}`)];
    }

    return days.flatMap((day) => {
      const mealTypes = day.meals.map((meal) => meal.mealType);
      if (mealTypes.join() !== request.mealTypes.join()) {
        return [
          invalid(
            `Day ${day.dayIndex + 1}: expected ${request.mealTypes.join(', ')}, ` +
              `got ${mealTypes.join(', ') || 'no meals'}`,
            day.dayIndex,
          ),
        ];
      }
      return day.meals.flatMap((meal) => this.servingsIssue(meal.servings, day.dayIndex));
    });
  }

  private servingsIssue(servings: number, dayIndex: number): MenuIssue[] {
    return Number.isFinite(servings) &&
      servings >= MENU_MEAL_SERVINGS.min &&
      servings <= MENU_MEAL_SERVINGS.max
      ? []
      : [
          invalid(
            `Day ${dayIndex + 1}: ${servings} servings is outside ` +
              `${MENU_MEAL_SERVINGS.min}-${MENU_MEAL_SERVINGS.max}`,
            dayIndex,
          ),
        ];
  }
}
