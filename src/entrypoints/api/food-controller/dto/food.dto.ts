import { PartialType } from '@nestjs/swagger';
import { IsEnum, IsNotEmpty, IsOptional, IsString, MaxLength, ValidateIf } from 'class-validator';
import {
  FOOD_NAME_MAX_LENGTH,
  FoodSource,
  FoodState,
  MAX_KCAL_PER_100G,
  SOURCE_ID_MAX_LENGTH,
} from '../../../../common/constants';
import { PaginationQueryDto } from '../../dto/pagination.dto';
import { IsNutrientValue, Trim } from '../../dto/validators';

export class CreateFoodItemDto {
  /** @example Гречка суха */
  @Trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(FOOD_NAME_MAX_LENGTH)
  name: string;

  /** @example Buckwheat groats, dry */
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @Trim()
  @IsString()
  @MaxLength(FOOD_NAME_MAX_LENGTH)
  nameEn?: string | null;

  /** Per 100 g. Null or missing = unknown. @example 343 */
  @IsNutrientValue(MAX_KCAL_PER_100G)
  kcalPer100g?: number | null;

  /** Grams per 100 g. @example 13.3 */
  @IsNutrientValue(100)
  proteinG?: number | null;

  /** @example 3.4 */
  @IsNutrientValue(100)
  fatG?: number | null;

  /** @example 71.5 */
  @IsNutrientValue(100)
  carbsG?: number | null;

  /** The state the values describe: 100 g dry and 100 g boiled are different foods. */
  @IsEnum(FoodState)
  state: FoodState;

  /** Defaults to `manual`. */
  @IsOptional()
  @IsEnum(FoodSource)
  source?: FoodSource;

  /** Id in the source; unique per source. */
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @Trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(SOURCE_ID_MAX_LENGTH)
  sourceId?: string | null;
}

export class UpdateFoodItemDto extends PartialType(CreateFoodItemDto) {}

export class FoodItemQueryDto extends PaginationQueryDto {
  /** Part of the Ukrainian or English name, any case. @example рис */
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(FOOD_NAME_MAX_LENGTH)
  search?: string;

  @IsOptional()
  @IsEnum(FoodState)
  state?: FoodState;

  @IsOptional()
  @IsEnum(FoodSource)
  source?: FoodSource;
}
