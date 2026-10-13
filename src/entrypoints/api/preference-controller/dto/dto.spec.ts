import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { PreferenceType } from '../../../../common/constants';
import { buildPreference } from '../../../../test/fixtures';
import { CreatePreferenceDto } from './preference.dto';
import { PreferenceResponseDto } from './preference.response.dto';

describe('preference DTOs', () => {
  const errorsOf = async (plain: object): Promise<string[]> =>
    (await validate(plainToInstance(CreatePreferenceDto, plain))).map((e) => e.property);

  it('accepts a type and a value', async () => {
    expect(await errorsOf({ preferenceType: PreferenceType.Allergy, value: 'peanut' })).toEqual([]);
  });

  it.each([
    [{ preferenceType: 'religion', value: 'x' }, 'preferenceType'],
    [{ preferenceType: PreferenceType.Allergy, value: '   ' }, 'value'],
    [{ preferenceType: PreferenceType.Allergy, value: 'x'.repeat(121) }, 'value'],
  ])('rejects %p', async (plain, property) => {
    expect(await errorsOf(plain)).toEqual([property]);
  });

  it('maps the response without the profile id', () => {
    const preference = buildPreference();

    expect(PreferenceResponseDto.from(preference)).toEqual({
      id: preference.id,
      preferenceType: 'allergy',
      value: 'peanut',
    });
  });
});
