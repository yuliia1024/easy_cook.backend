import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import {
  MAX_MEALS_PER_DAY,
  MAX_MENU_DAYS,
  MealType,
  MENU_DATE_MAX_FUTURE_DAYS,
  MENU_MEAL_SERVINGS,
  MENU_NOTES_MAX_LENGTH,
  MENU_TITLE_MAX_LENGTH,
} from '../../../../common/constants';
import { IsUpcomingDate, Trim } from '../../dto/validators';

export class MenuMealDto {
  @IsEnum(MealType)
  mealType: MealType;

  @IsUUID()
  recipeId: string;

  /** Portions of the recipe eaten in this meal. @example 1.5 */
  @IsNumber({ allowNaN: false, allowInfinity: false, maxDecimalPlaces: 2 })
  @Min(MENU_MEAL_SERVINGS.min)
  @Max(MENU_MEAL_SERVINGS.max)
  servings: number;
}

export class MenuDayDto {
  /** 0-based, unique within the menu. @example 0 */
  @IsInt()
  @Min(0)
  @Max(MAX_MENU_DAYS - 1)
  dayIndex: number;

  /** `YYYY-MM-DD`, today up to a year ahead. @example 2026-10-20 */
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsUpcomingDate(MENU_DATE_MAX_FUTURE_DAYS)
  date?: string | null;

  /** In order of the day. */
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_MEALS_PER_DAY)
  @ValidateNested({ each: true })
  @Type(() => MenuMealDto)
  meals: MenuMealDto[];
}

/**
 * The whole content of a version. Every recipe must exist and follow the dietary preferences
 * (diets, allergies, excluded ingredients), otherwise 400.
 */
export class MenuVersionDto {
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @Trim()
  @IsString()
  @MaxLength(MENU_NOTES_MAX_LENGTH)
  notes?: string | null;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_MENU_DAYS)
  @ValidateNested({ each: true })
  @Type(() => MenuDayDto)
  days: MenuDayDto[];
}

export class CreateMenuDto extends MenuVersionDto {
  /** @example Week 42 */
  @Trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(MENU_TITLE_MAX_LENGTH)
  title: string;
}

export class RenameMenuDto {
  @Trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(MENU_TITLE_MAX_LENGTH)
  title: string;
}

export class GenerateMenuDto {
  /** Defaults to "Menu for N days". */
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @Trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(MENU_TITLE_MAX_LENGTH)
  title?: string | null;

  /** @example 3 */
  @IsInt()
  @Min(1)
  @Max(MAX_MENU_DAYS)
  days: number;

  /** Meals of every day, in order; breakfast, lunch and dinner by default. */
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_MEALS_PER_DAY)
  @IsEnum(MealType, { each: true })
  mealTypes?: MealType[] | null;

  /**
   * Date of the first day, `YYYY-MM-DD`, today up to a year ahead; the menu is undated without it.
   */
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsUpcomingDate(MENU_DATE_MAX_FUTURE_DAYS)
  startDate?: string | null;

  /** Wishes for the planner. The stub planner ignores them. @example quick breakfasts */
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @Trim()
  @IsString()
  @MaxLength(MENU_NOTES_MAX_LENGTH)
  instructions?: string | null;
}

export class ReplaceMealDto {
  /** The version to start from; the latest by default. */
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsUUID()
  versionId?: string | null;

  @IsInt()
  @Min(0)
  @Max(MAX_MENU_DAYS - 1)
  dayIndex: number;

  /** Position of the meal within the day. */
  @IsInt()
  @Min(0)
  @Max(MAX_MEALS_PER_DAY - 1)
  position: number;

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @Trim()
  @IsString()
  @MaxLength(MENU_NOTES_MAX_LENGTH)
  instructions?: string | null;
}
