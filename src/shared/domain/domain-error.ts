/**
 * Base class for every error raised by the domain or application layers.
 *
 * Domain code never imports from `@nestjs/common` — it throws `DomainError`s
 * carrying a stable machine-readable `code` plus an HTTP status hint. The
 * transport layer (`DomainExceptionFilter`) is the only place that knows how to
 * turn one of these into an HTTP response.
 */
export abstract class DomainError extends Error {
  /** Stable, machine-readable identifier, e.g. `QUOTA_EXCEEDED`. */
  abstract readonly code: string;

  /** HTTP status the transport layer should use for this error. */
  abstract readonly status: number;

  /** Optional structured payload describing the failure. */
  readonly details?: Readonly<Record<string, unknown>>;

  protected constructor(message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = new.target.name;
    this.details = details ? Object.freeze({ ...details }) : undefined;
    Error.captureStackTrace?.(this, new.target);
  }
}
