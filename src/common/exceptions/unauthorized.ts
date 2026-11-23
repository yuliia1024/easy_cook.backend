import { UnauthorizedError } from './app-error';

/** No session cookie, or the session ended (signed out, expired, user gone). */
export class SessionRequiredUnauthorizedException extends UnauthorizedError {
  constructor() {
    super('Sign in to continue');
  }
}

export class InvalidGoogleTokenUnauthorizedException extends UnauthorizedError {
  constructor() {
    super('The Google sign-in is invalid or expired; sign in again');
  }
}

/** The nonce of the sign-in is missing, used, expired or not the one of this browser. */
export class LoginNonceUnauthorizedException extends UnauthorizedError {
  constructor() {
    super('The sign-in expired; try again');
  }
}
