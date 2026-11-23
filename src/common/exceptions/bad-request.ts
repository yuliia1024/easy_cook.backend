import { BadRequestError } from './app-error';

export class FoodItemsNotFoundBadRequestException extends BadRequestError {
  constructor(ids: string[]) {
    super(`Food items not found: ${ids.join(', ')}`);
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

export class MenuViolatesRulesBadRequestException extends BadRequestError {
  constructor(problems: string[]) {
    super(`The menu breaks the profile rules: ${problems.join('; ')}`);
  }
}

export class AllergyRemovalInChatBadRequestException extends BadRequestError {
  constructor() {
    super('Removing an allergy is applied only with the confirm button of the proposal.');
  }
}
