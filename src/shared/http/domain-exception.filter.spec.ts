import { ArgumentsHost, BadRequestException, NotFoundException } from '@nestjs/common';
import { ApiResponse } from './api-response';
import { DomainError } from '../domain/domain-error';
import { BusinessRuleViolationError, UnauthenticatedError } from '../domain/errors';
import { DomainExceptionFilter } from './domain-exception.filter';

class TestQuotaError extends DomainError {
  readonly code = 'QUOTA_EXCEEDED';
  readonly status = 402;

  constructor() {
    super('Out of quota.', { remaining: 0 });
  }
}

type EnvelopeMock = jest.Mock<void, [ApiResponse<never>]>;

function hostFor(): { host: ArgumentsHost; status: jest.Mock; json: EnvelopeMock } {
  const json: EnvelopeMock = jest.fn();
  const status = jest.fn().mockReturnValue({ json });

  const host = {
    switchToHttp: () => ({
      getResponse: () => ({ status }),
      getRequest: () => ({ method: 'POST', originalUrl: '/api/v1/chat' }),
    }),
  } as unknown as ArgumentsHost;

  return { host, status, json };
}

describe('DomainExceptionFilter', () => {
  let filter: DomainExceptionFilter;

  beforeEach(() => {
    filter = new DomainExceptionFilter();
  });

  it('maps a domain error to its own status, code and details', () => {
    const { host, status, json } = hostFor();

    filter.catch(new TestQuotaError(), host);

    expect(status).toHaveBeenCalledWith(402);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        data: null,
        error: {
          code: 'QUOTA_EXCEEDED',
          message: 'Out of quota.',
          details: { remaining: 0 },
        },
      }),
    );
  });

  it('always includes the request path and a timestamp', () => {
    const { host, json } = hostFor();

    filter.catch(new UnauthenticatedError(), host);

    expect(json.mock.calls[0][0].meta).toEqual({
      path: '/api/v1/chat',
      timestamp: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
    });
  });

  it('flattens class-validator failures into VALIDATION_FAILED', () => {
    const { host, status, json } = hostFor();
    const violations = ['question should not be empty'];

    filter.catch(new BadRequestException({ message: violations, error: 'Bad Request' }), host);

    expect(status).toHaveBeenCalledWith(400);
    expect(json.mock.calls[0][0].error).toEqual({
      code: 'VALIDATION_FAILED',
      message: 'Request validation failed.',
      details: { violations },
    });
  });

  it('maps a plain Nest HttpException by status', () => {
    const { host, status, json } = hostFor();

    filter.catch(new NotFoundException('Nothing here'), host);

    expect(status).toHaveBeenCalledWith(404);
    expect(json.mock.calls[0][0].error?.code).toBe('RESOURCE_NOT_FOUND');
  });

  it('never leaks details of an unexpected error', () => {
    const { host, status, json } = hostFor();

    filter.catch(new Error('connection string: postgres://user:hunter2@db'), host);

    expect(status).toHaveBeenCalledWith(500);
    expect(json.mock.calls[0][0].error).toEqual({
      code: 'INTERNAL_SERVER_ERROR',
      message: 'An unexpected error occurred.',
    });
  });

  it('handles a business rule violation as a 409', () => {
    const { host, status } = hostFor();

    filter.catch(new BusinessRuleViolationError('Nope'), host);

    expect(status).toHaveBeenCalledWith(409);
  });
});
