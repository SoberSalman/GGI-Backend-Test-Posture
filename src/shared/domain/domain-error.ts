/**
 * Base class for every error raised by the domain or application layers.
 *
 * Domain code never imports from `@nestjs/common`. It throws these instead,
 * and `DomainExceptionFilter` is the only place that turns one into a response.
 */
export abstract class DomainError extends Error {
  abstract readonly code: string;

  abstract readonly status: number;

  readonly details?: Readonly<Record<string, unknown>>;

  protected constructor(message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = new.target.name;
    this.details = details ? Object.freeze({ ...details }) : undefined;
    Error.captureStackTrace?.(this, new.target);
  }
}
