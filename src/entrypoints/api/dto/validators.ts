import { applyDecorators } from '@nestjs/common';
import { Transform } from 'class-transformer';
import {
  IsNumber,
  IsOptional,
  isISO8601,
  Max,
  Min,
  registerDecorator,
  ValidateIf,
  ValidationArguments,
} from 'class-validator';
import { toDate } from '../../../common/utils';

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Optional, but `null` is validated (and rejected) instead of skipped like with `IsOptional`:
 * for NOT NULL columns, where a `null` would otherwise reach the database.
 */
export const IsOptionalNotNull = (): PropertyDecorator =>
  ValidateIf((_, value) => value !== undefined);

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

/**
 * A `YYYY-MM-DD` day from today up to `maxDaysAhead` days ahead. "Today" is the client's: a day
 * of slack on both sides covers every time zone against the UTC date of the server.
 */
export const IsUpcomingDate =
  (maxDaysAhead: number): PropertyDecorator =>
  (target, propertyName) =>
    registerDecorator({
      name: 'isUpcomingDate',
      target: target.constructor,
      propertyName: propertyName as string,
      validator: {
        validate: (value: unknown): boolean => upcomingDateError(value, maxDaysAhead) === null,
        defaultMessage: ({ property, value }: ValidationArguments): string =>
          `${property} ${upcomingDateError(value, maxDaysAhead)}`,
      },
    });

function upcomingDateError(value: unknown, maxDaysAhead: number): string | null {
  if (typeof value !== 'string' || !DATE_ONLY.test(value) || !isISO8601(value, { strict: true })) {
    return 'must be YYYY-MM-DD';
  }
  const day = toDate(value)!.getTime();
  const today = toDate(new Date().toISOString().slice(0, 10))!.getTime();
  if (day < today - DAY_MS) {
    return 'cannot be in the past';
  }
  if (day > today + (maxDaysAhead + 1) * DAY_MS) {
    return `cannot be more than ${maxDaysAhead} days ahead`;
  }
  return null;
}
