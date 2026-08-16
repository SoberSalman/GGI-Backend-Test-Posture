/** The three bundle tiers a user can subscribe to. */
export enum BundleTier {
  BASIC = 'BASIC',
  PRO = 'PRO',
  ENTERPRISE = 'ENTERPRISE',
}

export enum BillingCycle {
  MONTHLY = 'MONTHLY',
  YEARLY = 'YEARLY',
}

export enum SubscriptionStatus {
  /** Inside its billing window and able to serve messages. */
  ACTIVE = 'ACTIVE',
  /** A renewal charge failed — no longer serves messages, can be reactivated. */
  INACTIVE = 'INACTIVE',
  /** Cancelled by the user. Runs to the end of the paid period, then expires. */
  CANCELLED = 'CANCELLED',
  /** Ran past `endDate` without renewing. */
  EXPIRED = 'EXPIRED',
}

export interface TierDefinition {
  readonly tier: BundleTier;
  /** Responses included per billing period, or `null` for unlimited. */
  readonly maxMessages: number | null;
  /** Price in minor units (cents) per billing cycle — never floats for money. */
  readonly priceCents: Readonly<Record<BillingCycle, number>>;
}

/**
 * Price/quota catalogue.
 *
 * Yearly is priced at ten months of the monthly rate (two months free), which
 * is the conventional SaaS discount.
 */
export const TIER_CATALOG: Readonly<Record<BundleTier, TierDefinition>> = Object.freeze({
  [BundleTier.BASIC]: {
    tier: BundleTier.BASIC,
    maxMessages: 10,
    priceCents: { [BillingCycle.MONTHLY]: 999, [BillingCycle.YEARLY]: 9990 },
  },
  [BundleTier.PRO]: {
    tier: BundleTier.PRO,
    maxMessages: 100,
    priceCents: { [BillingCycle.MONTHLY]: 2999, [BillingCycle.YEARLY]: 29990 },
  },
  [BundleTier.ENTERPRISE]: {
    tier: BundleTier.ENTERPRISE,
    maxMessages: null,
    priceCents: { [BillingCycle.MONTHLY]: 9999, [BillingCycle.YEARLY]: 99990 },
  },
});

export function tierDefinition(tier: BundleTier): TierDefinition {
  return TIER_CATALOG[tier];
}

/** `true` when the tier serves an unbounded number of responses. */
export function isUnlimited(maxMessages: number | null): maxMessages is null {
  return maxMessages === null;
}
