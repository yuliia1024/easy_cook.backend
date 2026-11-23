import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { FOOD_NAME_MAX_LENGTH, FoodSource, FoodState } from '../../../../common/constants';
import { PaginationQueryDto } from '../../dto/pagination.dto';
import { Trim } from '../../dto/validators';

export class FoodItemQueryDto extends PaginationQueryDto {
  /** Part of `name` or `nameEn`, any case. @example rice */
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
