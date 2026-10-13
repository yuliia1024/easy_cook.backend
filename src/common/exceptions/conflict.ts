import { ConflictError } from './app-error';

export class FoodItemSourceConflictException extends ConflictError {
  constructor() {
    super('A food item with this source and source id already exists');
  }
}

export class RecipeSourceConflictException extends ConflictError {
  constructor() {
    super('A recipe with this source and source id already exists');
  }
}

export class DietaryPreferenceExistsConflictException extends ConflictError {
  constructor() {
    super('This dietary preference is already saved');
  }
}

export class FoodStateInUseConflictException extends ConflictError {
  constructor() {
    super('The food is used in recipes; create a new food for another state');
  }
}
