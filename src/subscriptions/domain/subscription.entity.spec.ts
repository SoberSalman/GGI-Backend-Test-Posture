import { BillingCycle, BundleTier, SubscriptionStatus } from './bundle-tier';
import { Subscription } from './subscription.entity';

const PERIOD_END = new Date('2026-09-01T00:00:00Z');

function bundle(overrides: Partial<Subscription> = {}): Subscription {
  return Object.assign(new Subscription(), {
    id: 'sub-1',
    userId: 'user-1',
    tier: BundleTier.BASIC,
    billingCycle: BillingCycle.MONTHLY,
    status: SubscriptionStatus.ACTIVE,
    maxMessages: 10,
    messagesUsed: 0,
    priceCents: 999,
    autoRenew: true,
    startDate: new Date('2026-08-01T00:00:00Z'),
    endDate: PERIOD_END,
    renewalDate: PERIOD_END,
    cancelledAt: null,
    renewalCount: 0,
    lastPaymentFailureReason: null,
    ...overrides,
  } satisfies Partial<Subscription>);
}

describe('Subscription', () => {
  describe('isDueForRenewal', () => {
    it('is due at the exact instant the renewal date arrives', () => {
      // The boundary itself, not a second past it: flipping <= to < here would
      // delay every renewal by a full billing job cycle.
      expect(bundle().isDueForRenewal(PERIOD_END)).toBe(true);
    });

    it('is not due one millisecond early', () => {
      expect(bundle().isDueForRenewal(new Date(PERIOD_END.getTime() - 1))).toBe(false);
    });

    it('is not due without auto-renew', () => {
      expect(bundle({ autoRenew: false, renewalDate: null }).isDueForRenewal(PERIOD_END)).toBe(
        false,
      );
    });

    it('is not due once a payment has failed', () => {
      expect(bundle({ status: SubscriptionStatus.INACTIVE }).isDueForRenewal(PERIOD_END)).toBe(
        false,
      );
    });
  });

  describe('isWithinPeriod', () => {
    it('excludes the end instant, so the period is half-open', () => {
      const subscription = bundle();

      expect(subscription.isWithinPeriod(new Date(PERIOD_END.getTime() - 1))).toBe(true);
      expect(subscription.isWithinPeriod(PERIOD_END)).toBe(false);
    });

    it('includes the start instant', () => {
      expect(bundle().isWithinPeriod(new Date('2026-08-01T00:00:00Z'))).toBe(true);
    });
  });

  describe('canServe', () => {
    const midPeriod = new Date('2026-08-15T00:00:00Z');

    it('serves a cancelled bundle until its period closes', () => {
      const cancelled = bundle({ status: SubscriptionStatus.CANCELLED });

      expect(cancelled.canServe(midPeriod)).toBe(true);
      expect(cancelled.canServe(PERIOD_END)).toBe(false);
    });

    it('refuses an exhausted bundle', () => {
      expect(bundle({ messagesUsed: 10 }).canServe(midPeriod)).toBe(false);
    });

    it('serves an unlimited bundle regardless of usage', () => {
      const enterprise = bundle({ maxMessages: null, messagesUsed: 10_000 });

      expect(enterprise.canServe(midPeriod)).toBe(true);
      expect(enterprise.remainingMessages).toBe(Number.POSITIVE_INFINITY);
    });
  });
});
