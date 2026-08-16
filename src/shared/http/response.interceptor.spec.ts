import { CallHandler, ExecutionContext } from '@nestjs/common';
import { firstValueFrom, of } from 'rxjs';
import { ResponseEnvelopeInterceptor } from './response.interceptor';

function contextFor(url = '/api/v1/chat'): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ originalUrl: url }) }),
  } as unknown as ExecutionContext;
}

function handlerReturning<T>(value: T): CallHandler<T> {
  return { handle: () => of(value) };
}

describe('ResponseEnvelopeInterceptor', () => {
  const interceptor = new ResponseEnvelopeInterceptor();

  it('wraps the handler result in the success envelope', async () => {
    const result = await firstValueFrom(
      interceptor.intercept(contextFor(), handlerReturning({ id: 'msg-1' })),
    );

    expect(result).toMatchObject({
      success: true,
      data: { id: 'msg-1' },
      error: null,
      meta: { path: '/api/v1/chat' },
    });
  });

  it('normalises an undefined handler result to null', async () => {
    const result = await firstValueFrom(
      interceptor.intercept(contextFor(), handlerReturning(undefined)),
    );

    expect(result.data).toBeNull();
  });

  it('stamps an ISO timestamp', async () => {
    const result = await firstValueFrom(interceptor.intercept(contextFor(), handlerReturning([])));

    expect(Number.isNaN(Date.parse(result.meta.timestamp))).toBe(false);
  });
});
