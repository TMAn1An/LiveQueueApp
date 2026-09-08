export class AppError extends Error {
  readonly statusCode: number;
  readonly code: string;
  /**
   * Machine-readable context for the client, serialized alongside the error.
   *
   * Only ever safe, non-identifying values — a restriction period, for
   * instance. Never another customer's data, and never anything the caller
   * is not already entitled to see.
   */
  readonly details?: Record<string, string | number | boolean>;

  constructor(
    statusCode: number,
    code: string,
    message: string,
    details?: Record<string, string | number | boolean>,
  ) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}
