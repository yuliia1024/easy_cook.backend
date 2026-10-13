import { Transform, Type } from 'class-transformer';
import {
  IsDate,
  isISO8601,
  IsNumber,
  IsOptional,
  Max,
  MaxDate,
  Min,
  MinDate,
} from 'class-validator';
import {
  GOAL_EFFECTIVE_FROM_MAX_FUTURE_DAYS,
  GOAL_EFFECTIVE_FROM_MAX_PAST_HOURS,
  MAX_DAILY_CALORIES_KCAL,
  MIN_DAILY_CALORIES_KCAL,
} from '../../../../common/constants';

/** The lowest minimum of all sexes; the service checks the one for the profile. */
const MIN_CALORIES_KCAL = Math.min(...Object.values(MIN_DAILY_CALORIES_KCAL));

const HOUR_MS = 60 * 60 * 1000;
const earliestStart = (): Date =>
  new Date(Date.now() - GOAL_EFFECTIVE_FROM_MAX_PAST_HOURS * HOUR_MS);
const latestStart = (): Date =>
  new Date(Date.now() + GOAL_EFFECTIVE_FROM_MAX_FUTURE_DAYS * 24 * HOUR_MS);

/**
 * Protein, fat and carbs must give the calories (4/9/4, ±10 %) with 10-35 % protein, 20-35 % fat
 * and 45-65 % carbs; the service checks it.
 */
export class SetNutritionGoalDto {
  /** At least 1200 kcal for women and 1500 kcal for men. @example 2100 */
  @IsNumber({ maxDecimalPlaces: 1 })
  @Min(MIN_CALORIES_KCAL)
  @Max(MAX_DAILY_CALORIES_KCAL)
  caloriesKcal: number;

  /** @example 110 */
  @IsNumber({ maxDecimalPlaces: 1 })
  @Min(0)
  @Max(500)
  proteinG: number;

  /** @example 70 */
  @IsNumber({ maxDecimalPlaces: 1 })
  @Min(0)
  @Max(400)
  fatG: number;

  /** @example 250 */
  @IsNumber({ maxDecimalPlaces: 1 })
  @Min(0)
  @Max(1000)
  carbsG: number;

  /**
   * ISO 8601. Defaults to now. A future date (up to a year ahead) schedules the goal; at most a
   * day in the past, so "today" from a date picker is accepted.
   */
  @IsOptional()
  @Transform(({ value }) =>
    typeof value === 'string' && isISO8601(value, { strict: true }) ? new Date(value) : value,
  )
  @IsDate({ message: 'effectiveFrom must be an ISO 8601 date' })
  @MinDate(earliestStart, { message: 'effectiveFrom cannot be more than a day in the past' })
  @MaxDate(latestStart, { message: 'effectiveFrom cannot be more than a year ahead' })
  effectiveFrom?: Date;
}

export class PreviewNutritionGoalQueryDto {
  /**
   * Splits these calories into macros for the profile instead of calculating them.
   * At least 1200 kcal for women and 1500 kcal for men. @example 1500
   */
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 1 })
  @Min(MIN_CALORIES_KCAL)
  @Max(MAX_DAILY_CALORIES_KCAL)
  caloriesKcal?: number;
}
