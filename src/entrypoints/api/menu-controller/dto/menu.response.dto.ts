import {
  CalculationMode,
  MealType,
  MenuGeneratedBy,
  MenuIssueCode,
  MenuIssueSeverity,
} from '../../../../common/constants';
import {
  MenuComposition,
  MenuIssue,
  NutritionGoalSnapshot,
  RecipeSnapshot,
} from '../../../../common/types';
import { toNumber } from '../../../../common/utils';
import {
  MenuSummary,
  MenuVersionWithDays,
  MenuWithVersions,
} from '../../../../modules/data-access/menu/menu.repository';
import { toIsoDate } from '../../../../modules/services/menu/menu-composition';
import { MacrosResponseDto } from '../../recipe-controller/dto/recipe.response.dto';

type Day = MenuVersionWithDays['days'][number];
type Meal = Day['meals'][number];

export class MenuSummaryResponseDto {
  id: string;
  title: string;
  versionCount: number;
  /** Null until a version is confirmed. */
  confirmedVersionId: string | null;
  confirmedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;

  static from(menu: MenuSummary): MenuSummaryResponseDto {
    return {
      id: menu.id,
      title: menu.title,
      versionCount: menu._count.versions,
      confirmedVersionId: menu.confirmedVersionId,
      confirmedAt: menu.confirmedAt,
      createdAt: menu.createdAt,
      updatedAt: menu.updatedAt,
    };
  }
}

export class NutritionGoalSnapshotResponseDto implements NutritionGoalSnapshot {
  goalId: string;
  caloriesKcal: number;
  proteinG: number;
  fatG: number;
  carbsG: number;
  calculationMode: CalculationMode;
  ruleVersion: string | null;
}

export class MenuIssueResponseDto implements MenuIssue {
  severity: MenuIssueSeverity;
  code: MenuIssueCode;
  message: string;
  dayIndex?: number;
  position?: number;
  recipeId?: string | null;
}

export class RecipeSnapshotIngredientResponseDto {
  foodItemId: string;
  foodName: string;
  foodNameEn: string | null;
  state: string;
  quantityG: number;
  isOptional: boolean;
}

/** The recipe as it was when the version was built. */
export class RecipeSnapshotResponseDto implements RecipeSnapshot {
  id: string;
  name: string;
  mealType: string;
  dietType: string[];
  servings: number;
  prepTimeMinutes: number | null;
  perServing: MacrosResponseDto;
  complete: boolean;
  ingredients: RecipeSnapshotIngredientResponseDto[];
}

export class MenuMealResponseDto {
  id: string;
  mealType: MealType;
  position: number;
  /** Null once the recipe was deleted; `recipe` still describes it. */
  recipeId: string | null;
  /** Portions of the recipe eaten. */
  servings: number;
  /** Per serving times `servings`, from the snapshot. */
  nutrition: MacrosResponseDto;
  /** False when an ingredient has an unknown nutrient value. */
  complete: boolean;
  recipe: RecipeSnapshotResponseDto;

  static from(meal: Meal, composition: MenuComposition['days'][number]): MenuMealResponseDto {
    const composed = composition.meals[meal.position];
    return {
      id: meal.id,
      mealType: meal.mealType as MealType,
      position: meal.position,
      recipeId: meal.recipeId,
      servings: toNumber(meal.servings),
      nutrition: composed.nutrition,
      complete: composed.complete,
      recipe: meal.recipeSnapshot as unknown as RecipeSnapshot,
    };
  }
}

export class MenuDayResponseDto {
  id: string;
  dayIndex: number;
  /** `YYYY-MM-DD`. */
  date: string | null;
  totals: MacrosResponseDto;
  complete: boolean;
  meals: MenuMealResponseDto[];

  static from(day: Day, composition: MenuComposition): MenuDayResponseDto {
    const composed = composition.days.find((d) => d.dayIndex === day.dayIndex);
    return {
      id: day.id,
      dayIndex: day.dayIndex,
      date: toIsoDate(day.date),
      totals: composed.totals,
      complete: composed.complete,
      meals: day.meals.map((meal) => MenuMealResponseDto.from(meal, composed)),
    };
  }
}

export class MenuVersionResponseDto {
  id: string;
  versionNumber: number;
  generatedBy: MenuGeneratedBy;
  notes: string | null;
  createdAt: Date;
  /** Whether this is the version the user confirmed. */
  isConfirmed: boolean;
  /** The goal the version was built for; null when there was none. */
  nutritionGoal: NutritionGoalSnapshotResponseDto | null;
  dailyAverage: MacrosResponseDto;
  /**
   * Found when the version was built: warnings, and errors of meals carried over from an earlier
   * version. A version with errors cannot be confirmed.
   */
  issues: MenuIssueResponseDto[];
  days: MenuDayResponseDto[];

  static from(
    version: MenuVersionWithDays,
    confirmedVersionId: string | null,
  ): MenuVersionResponseDto {
    const composition = version.compositionSnapshot as unknown as MenuComposition;
    return {
      id: version.id,
      versionNumber: version.versionNumber,
      generatedBy: version.generatedBy as MenuGeneratedBy,
      notes: version.notes,
      createdAt: version.createdAt,
      isConfirmed: version.id === confirmedVersionId,
      nutritionGoal: version.nutritionGoalsSnapshot as unknown as NutritionGoalSnapshot | null,
      dailyAverage: composition.dailyAverage,
      issues: composition.issues,
      days: version.days.map((day) => MenuDayResponseDto.from(day, composition)),
    };
  }
}

export class MenuResponseDto {
  id: string;
  title: string;
  confirmedVersionId: string | null;
  confirmedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  /** Newest first. */
  versions: MenuVersionResponseDto[];

  static from(menu: MenuWithVersions): MenuResponseDto {
    return {
      id: menu.id,
      title: menu.title,
      confirmedVersionId: menu.confirmedVersionId,
      confirmedAt: menu.confirmedAt,
      createdAt: menu.createdAt,
      updatedAt: menu.updatedAt,
      versions: menu.versions.map((version) =>
        MenuVersionResponseDto.from(version, menu.confirmedVersionId),
      ),
    };
  }
}
