import { PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsNumber, Max, Min } from 'class-validator';
import { ActivityLevel, Goal, PROFILE_LIMITS, Sex } from '../../../../common/constants';

export class SaveProfileDto {
  /** @example 30 */
  @Type(() => Number)
  @IsInt()
  @Min(PROFILE_LIMITS.age.min)
  @Max(PROFILE_LIMITS.age.max)
  age: number;

  /** @example 170 */
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 1 })
  @Min(PROFILE_LIMITS.heightCm.min)
  @Max(PROFILE_LIMITS.heightCm.max)
  heightCm: number;

  /** @example 65.5 */
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 1 })
  @Min(PROFILE_LIMITS.weightKg.min)
  @Max(PROFILE_LIMITS.weightKg.max)
  weightKg: number;

  /** Input for the energy formula. */
  @IsEnum(Sex)
  sex: Sex;

  @IsEnum(ActivityLevel)
  activityLevel: ActivityLevel;

  @IsEnum(Goal)
  goal: Goal;
}

export class UpdateProfileDto extends PartialType(SaveProfileDto) {}
