import { PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
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
  DietTag,
  INGREDIENT_MAX_QUANTITY_G,
  INGREDIENT_NOTES_MAX_LENGTH,
  MAX_RECIPE_INGREDIENTS,
  MealType,
  RECIPE_DESCRIPTION_MAX_LENGTH,
  RECIPE_INSTRUCTIONS_MAX_LENGTH,
  RECIPE_NAME_MAX_LENGTH,
  SOURCE_ID_MAX_LENGTH,
} from '../../../../common/constants';
import { PaginationQueryDto } from '../../dto/pagination.dto';
import { IsOptionalNotNull, ToArray, ToBoolean, Trim } from '../../dto/validators';

export class RecipeIngredientDto {
  @IsUUID()
  foodItemId: string;

  /**
   * For the whole recipe, in the state of the food item: 100 g of dry rice is not 100 g of
   * boiled rice - pick the food item that matches what is weighed. @example 150
   */
  @IsNumber({ allowNaN: false, allowInfinity: false, maxDecimalPlaces: 2 })
  @Min(0.01)
  @Max(INGREDIENT_MAX_QUANTITY_G)
  quantityG: number;

  /** Optional ingredients are left out of the nutrition totals by default. */
  @IsOptionalNotNull()
  @IsBoolean()
  isOptional?: boolean;

  /** @example finely chop */
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @Trim()
  @IsString()
  @MaxLength(INGREDIENT_NOTES_MAX_LENGTH)
  notes?: string | null;
}

export class UpdateRecipeIngredientDto extends PartialType(RecipeIngredientDto, {
  skipNullProperties: false,
}) {}

/**
 * One serving (all ingredients, optional ones too, divided by `servings`) may weigh at most 2000 g
 * and have at most 2500 kcal; the service checks it.
 */

export class CreateRecipeDto {
  /** @example Chicken with buckwheat and broccoli */
  @Trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(RECIPE_NAME_MAX_LENGTH)
  name: string;

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @Trim()
  @IsString()
  @MaxLength(RECIPE_DESCRIPTION_MAX_LENGTH)
  description?: string | null;

  @Trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(RECIPE_INSTRUCTIONS_MAX_LENGTH)
  instructions: string;

  @IsEnum(MealType)
  mealType: MealType;

  @IsOptionalNotNull()
  @IsArray()
  @ArrayUnique()
  @IsEnum(DietTag, { each: true })
  dietType?: DietTag[];

  /** @example 2 */
  @IsInt()
  @Min(1)
  @Max(100)
  servings: number;

  /** @example 30 */
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsInt()
  @Min(0)
  @Max(24 * 60)
  prepTimeMinutes?: number | null;

  /** Id in the source (always `manual` through the API); unique per source. */
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @Trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(SOURCE_ID_MAX_LENGTH)
  sourceId?: string | null;

  /** In display order. */
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_RECIPE_INGREDIENTS)
  @ValidateNested({ each: true })
  @Type(() => RecipeIngredientDto)
  ingredients: RecipeIngredientDto[];
}

/** `ingredients`, when given, replace the whole list. `null` is rejected for NOT NULL fields. */
export class UpdateRecipeDto extends PartialType(CreateRecipeDto, { skipNullProperties: false }) {}

export class RecipeQueryDto extends PaginationQueryDto {
  /** Part of the name, any case. @example soup */
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(RECIPE_NAME_MAX_LENGTH)
  search?: string;

  @IsOptional()
  @IsEnum(MealType)
  mealType?: MealType;

  /** Recipes having every given tag: `?dietType=vegan&dietType=gluten_free` or `vegan,gluten_free`. */
  @IsOptional()
  @ToArray()
  @IsEnum(DietTag, { each: true })
  dietType?: DietTag[];
}

export class RecipeNutritionQueryDto {
  /** Count optional ingredients too. */
  @IsOptional()
  @ToBoolean()
  @IsBoolean()
  includeOptional?: boolean;
}
