import { NotFoundError } from './app-error';

export class ProfileNotFoundException extends NotFoundError {
  constructor() {
    super('Profile is not filled in yet');
  }
}

export class NutritionGoalNotFoundException extends NotFoundError {
  constructor() {
    super('No nutrition goal is set yet');
  }
}

export class DietaryPreferenceNotFoundException extends NotFoundError {
  constructor() {
    super('Dietary preference not found');
  }
}

export class FoodItemNotFoundException extends NotFoundError {
  constructor() {
    super('Food item not found');
  }
}

export class RecipeNotFoundException extends NotFoundError {
  constructor() {
    super('Recipe not found');
  }
}

export class RecipeIngredientNotFoundException extends NotFoundError {
  constructor() {
    super('Recipe ingredient not found');
  }
}

export class MenuNotFoundException extends NotFoundError {
  constructor() {
    super('Menu not found');
  }
}

export class MenuVersionNotFoundException extends NotFoundError {
  constructor() {
    super('Menu version not found');
  }
}

export class ConversationNotFoundException extends NotFoundError {
  constructor() {
    super('Conversation not found');
  }
}

export class MenuDraftNotFoundException extends NotFoundError {
  constructor() {
    super('This conversation has no menu to save yet: plan one first.');
  }
}

export class PreferenceChangeNotFoundException extends NotFoundError {
  constructor() {
    super('No preference change is waiting for confirmation in this conversation.');
  }
}
