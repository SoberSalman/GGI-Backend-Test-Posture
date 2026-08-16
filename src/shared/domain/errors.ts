import { DomainError } from './domain-error';

export class ResourceNotFoundError extends DomainError {
  readonly code = 'RESOURCE_NOT_FOUND';
  readonly status = 404;

  constructor(resource: string, id: string) {
    super(`${resource} '${id}' was not found.`, { resource, id });
  }
}

export class UnauthenticatedError extends DomainError {
  readonly code = 'UNAUTHENTICATED';
  readonly status = 401;

  constructor(message = 'A valid x-user-id header is required.') {
    super(message);
  }
}

export class BusinessRuleViolationError extends DomainError {
  readonly code = 'BUSINESS_RULE_VIOLATION';
  readonly status = 409;

  constructor(message: string, details?: Record<string, unknown>) {
    super(message, details);
  }
}
