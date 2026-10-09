import { BadRequestError } from './app-error';

export class WrongOtpBadRequestException extends BadRequestError {
  constructor() {
    super('Invalid or expired confirmation code');
  }
}

export class SamePasswordBadRequestException extends BadRequestError {
  constructor() {
    super('The new password must be different from the current one');
  }
}

export class WrongCurrentPasswordBadRequestException extends BadRequestError {
  constructor() {
    super('Current password is incorrect');
  }
}

export class SameEmailBadRequestException extends BadRequestError {
  constructor() {
    super('The new email must be different from the current one');
  }
}
