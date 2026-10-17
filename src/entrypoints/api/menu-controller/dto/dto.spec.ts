import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { RenameMenuDto } from './menu.dto';

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

  it('trims the title', () => {
    expect(plainToInstance(RenameMenuDto, { title: ' New ' }).title).toBe('New');
  });
});
