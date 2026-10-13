import { ServiceUnavailableError } from './app-error';

export class DatabaseUnavailableException extends ServiceUnavailableError {
  constructor() {
    super('Database is unavailable');
  }
}
