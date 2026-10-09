import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { Diet, Gender } from '../../../../common/constants';
import { ChangeEmailDto, ChangePasswordDto, ConfirmEmailChangeDto } from './account.dto';
import { SaveProfileDto, UpdateProfileDto } from './profile.dto';

async function errorsOf<T extends object>(cls: new () => T, plain: object): Promise<string[]> {
  const errors = await validate(plainToInstance(cls, plain));
  return errors.map((e) => e.property);
}

describe('user DTOs', () => {
  describe('SaveProfileDto', () => {
    const valid = { firstName: 'Jane', gender: Gender.Female, diet: Diet.Vegetarian };

    it('accepts a full questionnaire and trims the name', async () => {
      const dto = plainToInstance(SaveProfileDto, { ...valid, firstName: '  Jane  ' });

      expect(await validate(dto)).toHaveLength(0);
      expect(dto.firstName).toBe('Jane');
    });

    it.each(Object.values(Diet))('accepts diet %s', async (diet) => {
      expect(await errorsOf(SaveProfileDto, { ...valid, diet })).toEqual([]);
    });

    it.each(Object.values(Gender))('accepts gender %s', async (gender) => {
      expect(await errorsOf(SaveProfileDto, { ...valid, gender })).toEqual([]);
    });

    it('requires every field', async () => {
      expect(await errorsOf(SaveProfileDto, {})).toEqual(['firstName', 'gender', 'diet']);
    });

    it.each([
      ['a blank name', { firstName: '   ' }, 'firstName'],
      ['a too long name', { firstName: 'x'.repeat(51) }, 'firstName'],
      ['an unknown gender', { gender: 'robot' }, 'gender'],
      ['an unknown diet', { diet: 'carnivore' }, 'diet'],
    ])('rejects %s', async (_case, patch, property) => {
      expect(await errorsOf(SaveProfileDto, { ...valid, ...patch })).toEqual([property]);
    });
  });

  describe('UpdateProfileDto', () => {
    it('accepts any subset of fields', async () => {
      expect(await errorsOf(UpdateProfileDto, {})).toEqual([]);
      expect(await errorsOf(UpdateProfileDto, { diet: Diet.Keto })).toEqual([]);
    });

    it('still validates the given fields', async () => {
      expect(await errorsOf(UpdateProfileDto, { diet: 'carnivore' })).toEqual(['diet']);
    });
  });

  it('ChangePasswordDto applies the policy only to the new password', async () => {
    expect(
      await errorsOf(ChangePasswordDto, { currentPassword: 'x', newPassword: 'NewSecret1' }),
    ).toEqual([]);
    expect(
      await errorsOf(ChangePasswordDto, { currentPassword: 'x', newPassword: 'weak' }),
    ).toEqual(['newPassword']);
  });

  it('ChangeEmailDto requires a valid new email and the password', async () => {
    const dto = plainToInstance(ChangeEmailDto, { newEmail: ' New@Example.com', password: 'p' });

    expect(await validate(dto)).toHaveLength(0);
    expect(dto.newEmail).toBe('new@example.com');
    expect(await errorsOf(ChangeEmailDto, { newEmail: 'nope' })).toEqual(['newEmail', 'password']);
  });

  it('ConfirmEmailChangeDto requires a numeric code', async () => {
    expect(await errorsOf(ConfirmEmailChangeDto, { code: '123456' })).toEqual([]);
    expect(await errorsOf(ConfirmEmailChangeDto, { code: 'abc' })).toEqual(['code']);
  });
});
