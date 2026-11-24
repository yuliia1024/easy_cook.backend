import { ForbiddenError } from './app-error';

export class EmailNotAllowedForbiddenException extends ForbiddenError {
  constructor() {
    super('This Google account has no access');
  }
}

export class UnverifiedEmailForbiddenException extends ForbiddenError {
  constructor() {
    super('The email of this Google account is not verified');
  }
}

/** The email belongs to a user who signs in with another Google account. */
export class GoogleAccountMismatchForbiddenException extends ForbiddenError {
  constructor() {
    super('This email is linked to another Google account');
  }
}

export class CsrfTokenForbiddenException extends ForbiddenError {
  constructor() {
    super('Missing or invalid CSRF token');
  }
}

export class OriginNotAllowedForbiddenException extends ForbiddenError {
  constructor() {
    super('Requests from this origin are not allowed');
  }
}
