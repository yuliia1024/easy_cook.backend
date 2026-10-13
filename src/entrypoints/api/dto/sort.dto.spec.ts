import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { SortOrder } from '../../../common/constants';
import { SortQueryDto } from './sort.dto';

describe('SortQueryDto', () => {
  const build = (plain: object): SortQueryDto => plainToInstance(SortQueryDto, plain);

  it.each([{}, { sortOrder: 'asc' }, { sortOrder: 'desc' }])('accepts %p', async (plain) => {
    expect(await validate(build(plain))).toHaveLength(0);
  });

  it('keeps the order as given', () => {
    expect(build({ sortOrder: 'desc' }).sortOrder).toBe(SortOrder.Desc);
  });

  it.each(['ASC', 'up', ''])('rejects %p', async (sortOrder) => {
    expect((await validate(build({ sortOrder }))).map((e) => e.property)).toEqual(['sortOrder']);
  });
});
