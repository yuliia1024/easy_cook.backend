import { IsBoolean, IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { DietTag, MealType, RECIPE_NAME_MAX_LENGTH } from '../../../../common/constants';
import { PaginationQueryDto } from '../../dto/pagination.dto';
import { ToArray, ToBoolean, Trim } from '../../dto/validators';

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
