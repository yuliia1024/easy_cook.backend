import { ConflictError } from './app-error';

export class EmailExistConflictException extends ConflictError {
  constructor() {
    super('Email is already registered');
  }
}

export class EmailAlreadyVerifiedConflictException extends ConflictError {
  constructor() {
    super('Email is already verified');
  }
}
