import { applyDecorators } from '@nestjs/common';
import { Transform } from 'class-transformer';
import { IsNumber, IsOptional, Max, Min, ValidateIf } from 'class-validator';

/** Trims strings, leaves anything else for the validators to reject. */
export const Trim = (): PropertyDecorator =>
  Transform(({ value }) => (typeof value === 'string' ? value.trim() : value));

/** `?tag=a&tag=b`, `?tag=a,b` and `?tag=a` all become `['a', 'b']` / `['a']`. */
export const ToArray = (): PropertyDecorator =>
  Transform(({ value }) => {
    if (value === undefined || value === null || value === '') {
      return undefined;
    }
    const values = Array.isArray(value) ? value : [value];
    return values
      .flatMap((v) => (typeof v === 'string' ? v.split(',') : [v]))
      .map((v) => (typeof v === 'string' ? v.trim() : v))
      .filter((v) => v !== '');
  });

/** Query string booleans: only `true` / `1` are true. */
export const ToBoolean = (): PropertyDecorator =>
  Transform(({ value }) => (typeof value === 'string' ? ['true', '1'].includes(value) : value));

/**
 * A nutrient amount per 100 g. Optional on input; `null` means "unknown" and is stored as such.
 */
export const IsNutrientValue = (max: number): PropertyDecorator =>
  applyDecorators(
    IsOptional(),
    ValidateIf((_, value) => value !== null),
    IsNumber({ allowNaN: false, allowInfinity: false, maxDecimalPlaces: 2 }),
    Min(0),
    Max(max),
  );
