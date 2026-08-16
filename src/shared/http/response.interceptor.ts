import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Request } from 'express';
import { Observable, map } from 'rxjs';
import { ApiResponse } from './api-response';

/** Wraps successful returns in the standard envelope. */
@Injectable()
export class ResponseEnvelopeInterceptor<T> implements NestInterceptor<T, ApiResponse<T | null>> {
  intercept(context: ExecutionContext, next: CallHandler<T>): Observable<ApiResponse<T | null>> {
    const request = context.switchToHttp().getRequest<Request>();

    return next.handle().pipe(
      map((data) => ({
        success: true as const,
        data: data ?? null,
        error: null,
        meta: {
          timestamp: new Date().toISOString(),
          path: request.originalUrl,
        },
      })),
    );
  }
}
