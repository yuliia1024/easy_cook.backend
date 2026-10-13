import { UserProfile } from '../../../../generated/prisma/client';
import {
  ActivityLevel,
  DietTag,
  FoodState,
  Goal,
  MealType,
  PreferenceType,
  Sex,
} from '../../../../common/constants';
import { toNumber } from '../../../../common/utils';

export class ProfileResponseDto {
  id: string;
  age: number;
  heightCm: number;
  weightKg: number;
  sex: Sex;
  activityLevel: ActivityLevel;
  goal: Goal;
  createdAt: Date;
  updatedAt: Date;

  static from(profile: UserProfile): ProfileResponseDto {
    return {
      id: profile.id,
      age: profile.age,
      heightCm: toNumber(profile.heightCm),
      weightKg: toNumber(profile.weightKg),
      sex: profile.sex as Sex,
      activityLevel: profile.activityLevel as ActivityLevel,
      goal: profile.goal as Goal,
      createdAt: profile.createdAt,
      updatedAt: profile.updatedAt,
    };
  }
}

/** Every value the API accepts for enum-like fields, for the web app's selects. */
export class OptionsResponseDto {
  sexes: Sex[];
  activityLevels: ActivityLevel[];
  goals: Goal[];
  preferenceTypes: PreferenceType[];
  dietTags: DietTag[];
  mealTypes: MealType[];
  foodStates: FoodState[];
}
