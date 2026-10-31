/** The body of every error response (`AllExceptionsFilter`). */
export class ErrorResponseDto {
  statusCode: number;
  /** One message, or the validation messages. */
  message: string | string[];
  /** The HTTP status text, e.g. `Bad Request`. */
  error: string;
  path: string;
  timestamp: string;
}
