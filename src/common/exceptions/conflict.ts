import { ConflictError } from './app-error';

export class DietaryPreferenceExistsConflictException extends ConflictError {
  constructor() {
    super('This dietary preference is already saved');
  }
}

export class PreferenceChangeOutdatedConflictException extends ConflictError {
  constructor() {
    super('This is not the preference change waiting for confirmation; confirm the latest one.');
  }
}
