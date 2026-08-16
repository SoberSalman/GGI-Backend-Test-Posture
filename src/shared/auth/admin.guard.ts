import { CanActivate, ExecutionContext, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';
import { timingSafeEqual } from 'node:crypto';
import { DomainError } from '../domain/domain-error';

export const ADMIN_KEY_HEADER = 'x-admin-key';

export class AdminAccessDeniedError extends DomainError {
  readonly code = 'ADMIN_ACCESS_DENIED';
  readonly status = 403;

  constructor(message: string) {
    super(message);
  }
}

/**
 * Gate for operations that reach across every account.
 *
 * The billing run charges every due bundle and the quota reset rewrites every
 * counter, so `CurrentUserGuard` is the wrong control: it proves the caller is
 * *a* user, not that they may act on everyone else's data.
 *
 * Fails closed. An earlier version allowed the request whenever `NODE_ENV` was
 * not exactly 'production', which meant an unset or misspelled value opened
 * these routes to anyone. Opening them now takes a deliberate
 * `ALLOW_UNAUTHENTICATED_ADMIN=true`, which itself is refused in production.
 */
@Injectable()
export class AdminGuard implements CanActivate {
  private readonly logger = new Logger(AdminGuard.name);
  private readonly configuredKey: string;
  private readonly allowUnauthenticated: boolean;

  constructor(config: ConfigService) {
    this.configuredKey = config.get<string>('adminApiKey', '');
    this.allowUnauthenticated = config.get<boolean>('allowUnauthenticatedAdmin', false);
  }

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const header = request.headers[ADMIN_KEY_HEADER];
    const provided = Array.isArray(header) ? header[0] : header;

    if (!this.configuredKey) {
      if (!this.allowUnauthenticated) {
        throw new AdminAccessDeniedError(
          'Administrative endpoints are disabled: set ADMIN_API_KEY, or ' +
            'ALLOW_UNAUTHENTICATED_ADMIN=true outside production.',
        );
      }

      this.logger.warn(
        `${request.method} ${request.originalUrl} allowed without an admin key ` +
          '(ALLOW_UNAUTHENTICATED_ADMIN is on).',
      );
      return true;
    }

    if (!provided || !matches(provided, this.configuredKey)) {
      throw new AdminAccessDeniedError(`A valid '${ADMIN_KEY_HEADER}' header is required.`);
    }

    return true;
  }
}

/** Constant-time, so the key cannot be recovered a byte at a time. */
function matches(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
