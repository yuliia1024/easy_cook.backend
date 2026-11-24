import { HttpStatus } from '@nestjs/common';
import * as badRequest from './bad-request';
import * as conflict from './conflict';
import * as forbidden from './forbidden';
import * as notFound from './not-found';
import * as serviceUnavailable from './service-unavailable';
import * as unauthorized from './unauthorized';
import * as unsupportedMediaType from './unsupported-media-type';
import { AppError } from './app-error';

/** Constructor arguments for the exceptions that need them. */
const ARGS: Record<string, unknown[]> = {
  FoodItemsNotFoundBadRequestException: [['a', 'b']],
  UnknownDietBadRequestException: ['carnivore'],
  CaloriesBelowMinimumBadRequestException: [1200],
  MacrosCaloriesMismatchBadRequestException: [1500, 2000, 0.1],
  MacroShareBadRequestException: ['protein', 0.42, { min: 0.1, max: 0.35 }],
  ImplausibleBmiBadRequestException: [75],
  WeightLossUnderweightBadRequestException: [18.5],
  FoodKcalMismatchBadRequestException: [130, 200],
  TooManyIngredientsBadRequestException: [100],
  ServingTooHeavyBadRequestException: [2500, 2000],
  ServingTooManyKcalBadRequestException: [3000, 2500],
  ConflictingDietsBadRequestException: ['pescatarian', 'vegan'],
  TooManyPreferencesBadRequestException: [50],
  MenuViolatesRulesBadRequestException: [['day 0: contains peanut']],
  EmbeddingDimensionsMismatchException: [1024, 768],
};

/**
 * Every exception must extend the base matching the file it lives in, otherwise the filter
 * would answer with the wrong status (or a 500 for a bare `Error`).
 */
describe('exception taxonomy', () => {
  const groups: Array<[string, Record<string, unknown>, HttpStatus]> = [
    ['bad-request', badRequest, HttpStatus.BAD_REQUEST],
    ['unauthorized', unauthorized, HttpStatus.UNAUTHORIZED],
    ['forbidden', forbidden, HttpStatus.FORBIDDEN],
    ['not-found', notFound, HttpStatus.NOT_FOUND],
    ['conflict', conflict, HttpStatus.CONFLICT],
    ['unsupported-media-type', unsupportedMediaType, HttpStatus.UNSUPPORTED_MEDIA_TYPE],
    ['service-unavailable', serviceUnavailable, HttpStatus.SERVICE_UNAVAILABLE],
  ];

  const cases = groups.flatMap(([file, exports, status]) =>
    Object.entries(exports).map(([name, ctor]) => [file, name, ctor, status] as const),
  );

  it.each(cases)('%s: %s', (_file, name, ctor, status) => {
    const error = new (ctor as new (...args: unknown[]) => AppError)(...(ARGS[name] ?? []));

    expect(error).toBeInstanceOf(AppError);
    expect(error.status).toBe(status);
    expect(error.message).toBeTruthy();
  });

  it('lists the missing food ids', () => {
    expect(new badRequest.FoodItemsNotFoundBadRequestException(['x', 'y']).message).toBe(
      'Food items not found: x, y',
    );
  });

  it('names the unknown diet', () => {
    expect(new badRequest.UnknownDietBadRequestException('carnivore').message).toContain(
      'carnivore',
    );
  });

  it('names the calorie minimum', () => {
    expect(new badRequest.CaloriesBelowMinimumBadRequestException(1200).message).toContain(
      '1200 kcal',
    );
  });

  it.each([
    [
      new badRequest.MacrosCaloriesMismatchBadRequestException(1499.6, 2000, 0.1),
      'Protein, fat and carbs give 1500 kcal, more than 10 % away from the 2000 kcal goal',
    ],
    [
      new badRequest.MacroShareBadRequestException('protein', 0.416, { min: 0.1, max: 0.35 }),
      'Protein must be 10-35 % of the calories (now 42 %)',
    ],
    [
      new badRequest.ImplausibleBmiBadRequestException(75.04),
      'Weight and height give an implausible BMI (75.0); check the values',
    ],
    [
      new badRequest.ConflictingDietsBadRequestException('pescatarian', 'vegan'),
      'Diet "pescatarian" conflicts with "vegan"',
    ],
    [
      new badRequest.MenuViolatesRulesBadRequestException(['a', 'b']),
      'The menu breaks the profile rules: a; b',
    ],
  ])('formats %p', (error, message) => {
    expect(error.message).toBe(message);
  });
});
