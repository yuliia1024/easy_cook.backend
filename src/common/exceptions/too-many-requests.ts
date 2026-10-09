import { TooManyRequestsError } from './app-error';

export class OtpCooldownTooManyRequestsException extends TooManyRequestsError {
  constructor(retryAfterSec: number) {
    super(`A code was sent recently. Try again in ${retryAfterSec} seconds`);
  }
}

export class OtpAttemptsExceededTooManyRequestsException extends TooManyRequestsError {
  constructor() {
    super('Too many wrong attempts. Request a new code');
  }
}
