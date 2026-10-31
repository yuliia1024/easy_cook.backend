import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { MenuStatus } from '../../../../common/constants';
import { MenuListQueryDto, RenameMenuDto } from './menu.dto';

async function errorsOf(plain: object): Promise<string[]> {
  return (await validate(plainToInstance(RenameMenuDto, plain))).map((e) => e.property);
}

describe('menu DTOs', () => {
  it('validates a rename', async () => {
    expect(await errorsOf({ title: 'New' })).toEqual([]);
    expect(await errorsOf({ title: null })).toEqual(['title']);
    expect(await errorsOf({ title: '   ' })).toEqual(['title']);
    expect(await errorsOf({ title: 'x'.repeat(256) })).toEqual(['title']);
  });

  it.each([[{}], [{ status: MenuStatus.Draft }], [{ status: MenuStatus.All }]])(
    'accepts the list query %p',
    async (query) => {
      expect(await validate(plainToInstance(MenuListQueryDto, query))).toEqual([]);
    },
  );

  it('rejects an unknown status', async () => {
    const errors = await validate(plainToInstance(MenuListQueryDto, { status: 'pending' }));

    expect(errors.map((e) => e.property)).toEqual(['status']);
  });

  it('trims the title', () => {
    expect(plainToInstance(RenameMenuDto, { title: ' New ' }).title).toBe('New');
  });
});
