import { UnsupportedMediaTypeError } from './app-error';

/** An unsafe request with a body that is not JSON: a cross-site form cannot send JSON. */
export class JsonBodyRequiredUnsupportedMediaTypeException extends UnsupportedMediaTypeError {
  constructor() {
    super('Send the body as application/json');
  }
}
