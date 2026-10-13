import { Type } from 'class-transformer';
import { IsDate, IsNumber, IsOptional, Max, Min } from 'class-validator';

export class SetNutritionGoalDto {
  /** @example 2100 */
  @IsNumber({ maxDecimalPlaces: 1 })
  @Min(800)
  @Max(6000)
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

  /** Defaults to now. A future date schedules the goal. */
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  effectiveFrom?: Date;
}
