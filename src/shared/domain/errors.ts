import { DomainError } from './domain-error';

export class UnauthenticatedError extends DomainError {
  readonly code = 'UNAUTHENTICATED';
  readonly status = 401;

  constructor(message = 'A valid x-user-id header is required.') {
    super(message);
  }
}
