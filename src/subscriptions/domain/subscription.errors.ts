import { DomainError } from '../../shared/domain/domain-error';
import { SubscriptionStatus } from './bundle-tier';

export class SubscriptionNotFoundError extends DomainError {
  readonly code = 'SUBSCRIPTION_NOT_FOUND';
  readonly status = 404;

  constructor(subscriptionId: string) {
    super(`Subscription '${subscriptionId}' was not found.`, { subscriptionId });
  }
}

export class SubscriptionAccessDeniedError extends DomainError {
  readonly code = 'SUBSCRIPTION_ACCESS_DENIED';
  readonly status = 403;

  constructor(subscriptionId: string) {
    super(`Subscription '${subscriptionId}' does not belong to the current user.`, {
      subscriptionId,
    });
  }
}

export class InvalidSubscriptionStateError extends DomainError {
  readonly code = 'INVALID_SUBSCRIPTION_STATE';
  readonly status = 409;

  constructor(subscriptionId: string, currentStatus: SubscriptionStatus, attemptedAction: string) {
    super(`Cannot ${attemptedAction} a subscription in status ${currentStatus}.`, {
      subscriptionId,
      currentStatus,
      attemptedAction,
    });
  }
}
