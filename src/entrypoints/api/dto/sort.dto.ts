import { IsEnum, IsOptional } from 'class-validator';
import { SortOrder } from '../../../common/constants';

export class SortQueryDto {
  /** Each list documents its sort field and default order. */
  @IsOptional()
  @IsEnum(SortOrder)
  sortOrder?: SortOrder;
}
