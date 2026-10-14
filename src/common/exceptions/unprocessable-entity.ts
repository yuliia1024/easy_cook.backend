import { UnprocessableEntityError } from './app-error';

export class NoRecipeCandidatesException extends UnprocessableEntityError {
  constructor(mealType: string) {
    super(`No ${mealType} recipes match the dietary preferences`);
  }
}

export class MenuPlanningFailedException extends UnprocessableEntityError {
  constructor(attempts: number, problems: string[]) {
    super(
      `Could not plan a menu that follows the profile rules in ${attempts} attempts: ` +
        problems.join('; '),
    );
  }
}
