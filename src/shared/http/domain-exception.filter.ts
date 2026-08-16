import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import { Request, Response } from 'express';
import { DomainError } from '../domain/domain-error';
import { ApiError, ApiResponse } from './api-response';

/**
 * Single exit point for every error leaving the application.
 *
 * `DomainError`s carry their own code and status. Nest's `HttpException`s
 * (validation failures, 404s from the router) are translated into the same
 * envelope. Anything else is logged in full and reported as a generic 500 so
 * internal details never leak to the caller.
 */
@Catch()
export class DomainExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(DomainExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const { status, error } = this.toApiError(exception);

    if (status >= 500) {
      this.logger.error(
        `${request.method} ${request.originalUrl} -> ${status} ${error.code}`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    } else {
      this.logger.warn(`${request.method} ${request.originalUrl} -> ${status} ${error.code}`);
    }

    const body: ApiResponse<never> = {
      success: false,
      data: null,
      error,
      meta: { timestamp: new Date().toISOString(), path: request.originalUrl },
    };

    response.status(status).json(body);
  }

  private toApiError(exception: unknown): { status: number; error: ApiError } {
    if (exception instanceof DomainError) {
      return {
        status: exception.status,
        error: { code: exception.code, message: exception.message, details: exception.details },
      };
    }

    if (exception instanceof HttpException) {
      return { status: exception.getStatus(), error: this.fromHttpException(exception) };
    }

    return {
      status: 500,
      error: { code: 'INTERNAL_SERVER_ERROR', message: 'An unexpected error occurred.' },
    };
  }

  private fromHttpException(exception: HttpException): ApiError {
    const payload = exception.getResponse();

    if (typeof payload === 'string') {
      return { code: this.codeFromStatus(exception.getStatus()), message: payload };
    }

    const { message, error } = payload as { message?: string | string[]; error?: string };
    const isValidationFailure = Array.isArray(message);

    return {
      code: isValidationFailure ? 'VALIDATION_FAILED' : this.codeFromStatus(exception.getStatus()),
      message: isValidationFailure
        ? 'Request validation failed.'
        : (message ?? error ?? exception.message),
      details: isValidationFailure ? { violations: message } : undefined,
    };
  }

  private codeFromStatus(status: number): string {
    const byStatus: Record<number, string> = {
      400: 'BAD_REQUEST',
      401: 'UNAUTHENTICATED',
      403: 'FORBIDDEN',
      404: 'RESOURCE_NOT_FOUND',
      409: 'CONFLICT',
      422: 'UNPROCESSABLE_ENTITY',
      429: 'TOO_MANY_REQUESTS',
    };
    return byStatus[status] ?? 'INTERNAL_SERVER_ERROR';
  }
}
