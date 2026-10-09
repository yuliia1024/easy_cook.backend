import { UnauthorizedError } from './app-error';

export class UnauthorizedException extends UnauthorizedError {
  constructor() {
    super('Unauthorized');
  }
}

export class InvalidCredentialsUnauthorizedException extends UnauthorizedError {
  constructor() {
    super('Invalid email or password');
  }
}
