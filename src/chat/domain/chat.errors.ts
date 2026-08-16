import { DomainError } from '../../shared/domain/domain-error';

export interface QuotaExceededDetails {
  freeMessagesAllowance: number;
  freeMessagesUsed: number;
  freeMessagesRemaining: number;
  activeBundles: number;
  /** When the free allowance refills — the 1st of next month, UTC. */
  freeQuotaResetsAt: string;
}

/**
 * The caller has no free messages left and no bundle able to serve one.
 *
 * Structured on purpose: a client can render "0 of 3 free messages left, resets
 * on 1 Sep" and deep-link to checkout straight from `details`.
 */
export class QuotaExceededError extends DomainError {
  readonly code = 'QUOTA_EXCEEDED';
  readonly status = 402; // Payment Required — a bundle is what unblocks the caller.

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

/** The mocked provider failed. Any reserved quota has already been returned. */
export class AiProviderError extends DomainError {
  readonly code = 'AI_PROVIDER_ERROR';
  readonly status = 502;

  constructor(reason: string) {
    super(`The AI provider could not complete the request: ${reason}`, { reason });
  }
}
