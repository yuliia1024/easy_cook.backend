import { Prisma } from '../../../../generated/prisma/client';
import { MealType, MenuGeneratedBy } from '../../../../common/constants';
import { toNumber } from '../../../../common/utils';
import {
  MenuSummary,
  MenuWithVersions,
} from '../../../../modules/data-access/menu/menu.repository';

type Version = MenuWithVersions['versions'][number];
type Day = Version['days'][number];
type Meal = Day['meals'][number];

export class MenuSummaryResponseDto {
  id: string;
  title: string;
  versionCount: number;
  createdAt: Date;
  updatedAt: Date;

  static from(menu: MenuSummary): MenuSummaryResponseDto {
    return {
      id: menu.id,
      title: menu.title,
      versionCount: menu._count.versions,
      createdAt: menu.createdAt,
      updatedAt: menu.updatedAt,
    };
  }
}

export class MenuMealResponseDto {
  id: string;
  mealType: MealType;
  position: number;
  /** Null once the recipe was deleted; the snapshot still describes it. */
  recipeId: string | null;
  servings: number;
  recipeSnapshot: Prisma.JsonValue;

  static from(meal: Meal): MenuMealResponseDto {
    return {
      id: meal.id,
      mealType: meal.mealType as MealType,
      position: meal.position,
      recipeId: meal.recipeId,
      servings: toNumber(meal.servings),
      recipeSnapshot: meal.recipeSnapshot,
    };
  }
}

export class MenuDayResponseDto {
  id: string;
  dayIndex: number;
  date: Date | null;
  meals: MenuMealResponseDto[];

  static from(day: Day): MenuDayResponseDto {
    return {
      id: day.id,
      dayIndex: day.dayIndex,
      date: day.date,
      meals: day.meals.map(MenuMealResponseDto.from),
    };
  }
}

export class MenuVersionResponseDto {
  id: string;
  versionNumber: number;
  generatedBy: MenuGeneratedBy;
  nutritionGoalsSnapshot: Prisma.JsonValue;
  compositionSnapshot: Prisma.JsonValue;
  notes: string | null;
  createdAt: Date;
  days: MenuDayResponseDto[];

  static from(version: Version): MenuVersionResponseDto {
    return {
      id: version.id,
      versionNumber: version.versionNumber,
      generatedBy: version.generatedBy as MenuGeneratedBy,
      nutritionGoalsSnapshot: version.nutritionGoalsSnapshot,
      compositionSnapshot: version.compositionSnapshot,
      notes: version.notes,
      createdAt: version.createdAt,
      days: version.days.map(MenuDayResponseDto.from),
    };
  }
}

export class MenuResponseDto {
  id: string;
  title: string;
  createdAt: Date;
  updatedAt: Date;
  /** Newest first. */
  versions: MenuVersionResponseDto[];

  static from(menu: MenuWithVersions): MenuResponseDto {
    return {
      id: menu.id,
      title: menu.title,
      createdAt: menu.createdAt,
      updatedAt: menu.updatedAt,
      versions: menu.versions.map(MenuVersionResponseDto.from),
    };
  }
}
