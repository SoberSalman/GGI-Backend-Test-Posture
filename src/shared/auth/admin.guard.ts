import { CanActivate, ExecutionContext, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';
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
 * The billing run charges every due bundle in the database and the quota reset
 * rewrites every counter, so `CurrentUserGuard` is the wrong control here: it
 * proves the caller is *a* user, not that they may act on everyone else's data.
 *
 * With `ADMIN_API_KEY` set, the caller must present it. Without it, these routes
 * stay open outside production so a reviewer can drive the billing simulation,
 * and are refused in production.
 */
@Injectable()
export class AdminGuard implements CanActivate {
  private readonly logger = new Logger(AdminGuard.name);
  private readonly configuredKey: string;
  private readonly isProduction: boolean;

  constructor(config: ConfigService) {
    this.configuredKey = config.get<string>('adminApiKey', '');
    this.isProduction = config.get<string>('env', 'development') === 'production';
  }

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const header = request.headers[ADMIN_KEY_HEADER];
    const provided = Array.isArray(header) ? header[0] : header;

    if (!this.configuredKey) {
      if (this.isProduction) {
        throw new AdminAccessDeniedError(
          'Administrative endpoints are disabled: ADMIN_API_KEY is not configured.',
        );
      }
      this.logger.warn(
        `${request.method} ${request.originalUrl} allowed without an admin key ` +
          '(ADMIN_API_KEY unset, non-production).',
      );
      return true;
    }

    if (provided !== this.configuredKey) {
      throw new AdminAccessDeniedError(`A valid '${ADMIN_KEY_HEADER}' header is required.`);
    }

    return true;
  }
}
