import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { DEFAULT_PAGE_LIMIT, MAX_PAGE_LIMIT } from '../../../common/constants';
import { Page, PageQuery } from '../../../common/types';

export class PaginationQueryDto {
  /** 1-based. @example 1 */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  /** @example 20 */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_PAGE_LIMIT)
  limit?: number = DEFAULT_PAGE_LIMIT;

  public static toPageQuery(dto: PaginationQueryDto): PageQuery {
    return { page: dto.page ?? 1, limit: dto.limit ?? DEFAULT_PAGE_LIMIT };
  }
}

export class PageResponseDto<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;

  static from<S, T>(page: Page<S>, query: PageQuery, map: (item: S) => T): PageResponseDto<T> {
    return { items: page.items.map(map), total: page.total, page: query.page, limit: query.limit };
  }
}
