import { NotFoundError } from './app-error';

export class UserNotFoundException extends NotFoundError {
  constructor() {
    super('User not found');
  }
}

export class ProfileNotFoundException extends NotFoundError {
  constructor() {
    super('Profile is not filled in yet');
  }
}
