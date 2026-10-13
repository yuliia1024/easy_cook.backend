import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ActivityLevel, Goal, Sex } from '../../../../common/constants';
import { buildProfile } from '../../../../test/fixtures';
import { SaveProfileDto, UpdateProfileDto } from './profile.dto';
import { ProfileResponseDto } from './profile.response.dto';

async function errorsOf<T extends object>(cls: new () => T, plain: object): Promise<string[]> {
  const errors = await validate(plainToInstance(cls, plain));
  return errors.map((e) => e.property);
}

describe('profile DTOs', () => {
  const valid = {
    age: 30,
    heightCm: 170,
    weightKg: 65.5,
    sex: Sex.Female,
    activityLevel: ActivityLevel.Moderate,
    goal: Goal.Maintain,
  };

  describe('SaveProfileDto', () => {
    it('accepts a full profile', async () => {
      expect(await errorsOf(SaveProfileDto, valid)).toEqual([]);
    });

    it('requires every field', async () => {
      expect(await errorsOf(SaveProfileDto, {})).toEqual([
        'age',
        'heightCm',
        'weightKg',
        'sex',
        'activityLevel',
        'goal',
      ]);
    });

    it.each([
      ['a child', { age: 10 }, 'age'],
      ['a fractional age', { age: 30.5 }, 'age'],
      ['an impossible height', { heightCm: 300 }, 'heightCm'],
      ['an impossible weight', { weightKg: 10 }, 'weightKg'],
      ['too many decimals', { weightKg: 65.55 }, 'weightKg'],
      ['an unknown sex', { sex: 'other' }, 'sex'],
      ['an unknown activity', { activityLevel: 'extreme' }, 'activityLevel'],
      ['an unknown goal', { goal: 'bulk' }, 'goal'],
    ])('rejects %s', async (_case, patch, property) => {
      expect(await errorsOf(SaveProfileDto, { ...valid, ...patch })).toEqual([property]);
    });
  });

  it('UpdateProfileDto accepts any subset but validates it', async () => {
    expect(await errorsOf(UpdateProfileDto, {})).toEqual([]);
    expect(await errorsOf(UpdateProfileDto, { weightKg: 60 })).toEqual([]);
    expect(await errorsOf(UpdateProfileDto, { goal: 'bulk' })).toEqual(['goal']);
  });

  it('ProfileResponseDto turns decimals into numbers', () => {
    const profile = buildProfile();

    expect(ProfileResponseDto.from(profile)).toEqual({
      id: profile.id,
      age: 30,
      heightCm: 170,
      weightKg: 65,
      sex: 'female',
      activityLevel: 'moderate',
      goal: 'maintain',
      createdAt: profile.createdAt,
      updatedAt: profile.updatedAt,
    });
  });
});
