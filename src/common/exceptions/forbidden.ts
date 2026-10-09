import { ForbiddenError } from './app-error';

export class EmailNotVerifiedForbiddenException extends ForbiddenError {
  constructor() {
    super('Email is not verified');
  }
}
