import { BadRequestError } from './app-error';

export class FoodItemsNotFoundBadRequestException extends BadRequestError {
  constructor(ids: string[]) {
    super(`Food items not found: ${ids.join(', ')}`);
  }
}

export class MacrosExceedWeightBadRequestException extends BadRequestError {
  constructor() {
    super('Protein, fat and carbs together cannot exceed 100 g per 100 g');
  }
}

export class UnknownDietBadRequestException extends BadRequestError {
  constructor(value: string) {
    super(`Unknown diet "${value}"`);
  }
}

export class CaloriesBelowMinimumBadRequestException extends BadRequestError {
  constructor(minKcal: number) {
    super(`Daily calories cannot be below ${minKcal} kcal for this profile`);
  }
}

export class MacrosCaloriesMismatchBadRequestException extends BadRequestError {
  constructor(macroKcal: number, goalKcal: number, tolerance: number) {
    super(
      `Protein, fat and carbs give ${Math.round(macroKcal)} kcal, more than ` +
        `${Math.round(tolerance * 100)} % away from the ${goalKcal} kcal goal`,
    );
  }
}

export class MacroShareBadRequestException extends BadRequestError {
  constructor(macro: string, share: number, limits: { min: number; max: number }) {
    const percent = (value: number): number => Math.round(value * 100);
    super(
      `${macro[0].toUpperCase()}${macro.slice(1)} must be ${percent(limits.min)}-` +
        `${percent(limits.max)} % of the calories (now ${percent(share)} %)`,
    );
  }
}

export class ImplausibleBmiBadRequestException extends BadRequestError {
  constructor(bmi: number) {
    super(`Weight and height give an implausible BMI (${bmi.toFixed(1)}); check the values`);
  }
}

export class WeightLossUnderweightBadRequestException extends BadRequestError {
  constructor(minBmi: number) {
    super(`Losing weight is not allowed with a BMI below ${minBmi}`);
  }
}

export class FoodKcalMismatchBadRequestException extends BadRequestError {
  constructor(kcal: number, estimate: number) {
    super(
      `${kcal} kcal does not match protein, fat and carbs (≈ ${Math.round(estimate)} kcal by 4/9/4)`,
    );
  }
}

export class TooManyIngredientsBadRequestException extends BadRequestError {
  constructor(max: number) {
    super(`A recipe can have at most ${max} ingredients`);
  }
}

export class ServingTooHeavyBadRequestException extends BadRequestError {
  constructor(grams: number, max: number) {
    super(`One serving would weigh ${Math.round(grams)} g; at most ${max} g`);
  }
}

export class ServingTooManyKcalBadRequestException extends BadRequestError {
  constructor(kcal: number, max: number) {
    super(`One serving would have ${Math.round(kcal)} kcal; at most ${max} kcal`);
  }
}

export class ConflictingDietsBadRequestException extends BadRequestError {
  constructor(diet: string, existing: string) {
    super(`Diet "${diet}" conflicts with "${existing}"`);
  }
}

export class TooManyPreferencesBadRequestException extends BadRequestError {
  constructor(max: number) {
    super(`A profile can have at most ${max} dietary preferences`);
  }
}

export class RecipesNotFoundBadRequestException extends BadRequestError {
  constructor(ids: string[]) {
    super(`Recipes not found: ${ids.join(', ')}`);
  }
}

export class MenuViolatesRulesBadRequestException extends BadRequestError {
  constructor(problems: string[]) {
    super(`The menu breaks the profile rules: ${problems.join('; ')}`);
  }
}

export class DuplicateMenuDayBadRequestException extends BadRequestError {
  constructor(dayIndex: number) {
    super(`Day ${dayIndex} is listed more than once`);
  }
}
