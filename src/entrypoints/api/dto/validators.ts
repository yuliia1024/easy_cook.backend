import { Transform } from 'class-transformer';
import { ValidateIf } from 'class-validator';

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
