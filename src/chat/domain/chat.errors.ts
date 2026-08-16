import { DomainError } from '../../shared/domain/domain-error';

export interface QuotaExceededDetails {
  freeMessagesAllowance: number;
  freeMessagesUsed: number;
  freeMessagesRemaining: number;
  activeBundles: number;
  /** The 1st of next month, UTC. */
  freeQuotaResetsAt: string;
}

/**
 * Carries enough detail for a client to render "0 of 3 free messages left,
 * resets 1 Sep" and link to checkout without a second request.
 */
export class QuotaExceededError extends DomainError {
  readonly code = 'QUOTA_EXCEEDED';
  readonly status = 402; // Payment Required: a bundle is what unblocks the caller.

  constructor(details: QuotaExceededDetails) {
    super(
      details.activeBundles === 0
        ? `Free monthly quota exhausted (${details.freeMessagesUsed}/${details.freeMessagesAllowance} used). ` +
            'Purchase a subscription bundle to continue.'
        : 'Free monthly quota exhausted and every active bundle is out of responses.',
      { ...details },
    );
  }
}

/** The provider failed. The caller is responsible for refunding the reservation. */
export class AiProviderError extends DomainError {
  readonly code = 'AI_PROVIDER_ERROR';
  readonly status = 502;

  constructor(reason: string) {
    super(`The AI provider could not complete the request: ${reason}`, { reason });
  }
}
