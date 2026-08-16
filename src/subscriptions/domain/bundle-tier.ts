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
  /** A renewal charge failed; stops serving immediately. */
  INACTIVE = 'INACTIVE',
  /** Cancelled by the user. Runs to the end of the paid period, then expires. */
  CANCELLED = 'CANCELLED',
  EXPIRED = 'EXPIRED',
}

export interface TierDefinition {
  readonly tier: BundleTier;
  /** Responses included per billing period, or `null` for unlimited. */
  readonly maxMessages: number | null;
  /** Cents per billing cycle. Never floats for money. */
  readonly priceCents: Readonly<Record<BillingCycle, number>>;
}

/** Yearly is ten months of the monthly rate, i.e. two months free. */
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

export function isUnlimited(maxMessages: number | null): maxMessages is null {
  return maxMessages === null;
}
