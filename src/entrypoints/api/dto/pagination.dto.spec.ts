import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { SortOrder } from '../../../common/constants';
import { PageResponseDto, PaginationQueryDto } from './pagination.dto';

describe('PaginationQueryDto', () => {
  const build = (plain: object): PaginationQueryDto => plainToInstance(PaginationQueryDto, plain);

  it('defaults to the first page of 20 in ascending order', async () => {
    const dto = build({});

    expect(await validate(dto)).toHaveLength(0);
    expect(PaginationQueryDto.toPageQuery(dto)).toEqual({
      page: 1,
      limit: 20,
      sortOrder: SortOrder.Asc,
    });
  });

  it('converts query strings to numbers', async () => {
    const dto = build({ page: '3', limit: '50', sortOrder: 'desc' });

    expect(await validate(dto)).toHaveLength(0);
    expect(PaginationQueryDto.toPageQuery(dto)).toEqual({
      page: 3,
      limit: 50,
      sortOrder: SortOrder.Desc,
    });
  });

  it.each([
    [{ page: '0' }, 'page'],
    [{ page: '1.5' }, 'page'],
    [{ page: '10001' }, 'page'],
    [{ page: '1e20' }, 'page'],
    [{ limit: '101' }, 'limit'],
    [{ limit: 'abc' }, 'limit'],
    [{ sortOrder: 'up' }, 'sortOrder'],
  ])('rejects %p', async (plain, property) => {
    expect((await validate(build(plain))).map((e) => e.property)).toEqual([property]);
  });
});

describe('PageResponseDto', () => {
  it('maps the items and echoes the page', () => {
    expect(
      PageResponseDto.from(
        { items: [1, 2], total: 12 },
        { page: 2, limit: 2, sortOrder: SortOrder.Asc },
        (n) => n * 10,
      ),
    ).toEqual({ items: [10, 20], total: 12, page: 2, limit: 2 });
  });
});
