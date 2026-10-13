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
