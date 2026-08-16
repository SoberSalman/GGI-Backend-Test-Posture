import { BillingCycle, BundleTier, SubscriptionStatus } from './bundle-tier';
import { selectBundleToCharge } from './quota-selection.policy';
import { Subscription } from './subscription.entity';

const NOW = new Date('2026-08-16T12:00:00Z');

function bundle(overrides: Partial<Subscription>): Subscription {
  return Object.assign(new Subscription(), {
    id: '00000000-0000-0000-0000-000000000001',
    userId: 'user-1',
    tier: BundleTier.BASIC,
    billingCycle: BillingCycle.MONTHLY,
    status: SubscriptionStatus.ACTIVE,
    maxMessages: 10,
    messagesUsed: 0,
    priceCents: 999,
    autoRenew: true,
    startDate: new Date('2026-08-01T00:00:00Z'),
    endDate: new Date('2026-09-01T00:00:00Z'),
    renewalDate: new Date('2026-09-01T00:00:00Z'),
    cancelledAt: null,
    renewalCount: 0,
    lastPaymentFailureReason: null,
    ...overrides,
  } satisfies Partial<Subscription>);
}

describe('selectBundleToCharge', () => {
  it('returns null when the user holds no bundles', () => {
    expect(selectBundleToCharge([], NOW)).toBeNull();
  });

  it('picks the bundle with the most remaining quota', () => {
    // Arrange
    const nearlyEmpty = bundle({ id: 'a', maxMessages: 10, messagesUsed: 9 });
    const roomy = bundle({ id: 'b', tier: BundleTier.PRO, maxMessages: 100, messagesUsed: 40 });

    // Act
    const chosen = selectBundleToCharge([nearlyEmpty, roomy], NOW);

    // Assert
    expect(chosen?.id).toBe('b');
  });

  it('drains finite bundles before an unlimited one', () => {
    const enterprise = bundle({ id: 'unlimited', tier: BundleTier.ENTERPRISE, maxMessages: null });
    const basic = bundle({ id: 'basic', maxMessages: 10, messagesUsed: 9 });

    expect(selectBundleToCharge([enterprise, basic], NOW)?.id).toBe('basic');
  });

  it('falls back to the unlimited bundle once every finite one is spent', () => {
    const enterprise = bundle({ id: 'unlimited', tier: BundleTier.ENTERPRISE, maxMessages: null });
    const spent = bundle({ id: 'basic', maxMessages: 10, messagesUsed: 10 });

    expect(selectBundleToCharge([enterprise, spent], NOW)?.id).toBe('unlimited');
  });

  it('breaks ties on the soonest expiry', () => {
    const later = bundle({ id: 'later', endDate: new Date('2026-12-01T00:00:00Z') });
    const sooner = bundle({ id: 'sooner', endDate: new Date('2026-09-01T00:00:00Z') });

    expect(selectBundleToCharge([later, sooner], NOW)?.id).toBe('sooner');
  });

  it('skips exhausted bundles', () => {
    const exhausted = bundle({ id: 'exhausted', maxMessages: 10, messagesUsed: 10 });
    expect(selectBundleToCharge([exhausted], NOW)).toBeNull();
  });

  it('skips bundles marked inactive by a failed payment', () => {
    const inactive = bundle({ id: 'inactive', status: SubscriptionStatus.INACTIVE });
    expect(selectBundleToCharge([inactive], NOW)).toBeNull();
  });

  it('skips expired bundles', () => {
    const expired = bundle({ id: 'expired', status: SubscriptionStatus.EXPIRED });
    expect(selectBundleToCharge([expired], NOW)).toBeNull();
  });

  it('still serves a cancelled bundle until its paid period ends', () => {
    const cancelled = bundle({
      id: 'cancelled',
      status: SubscriptionStatus.CANCELLED,
      cancelledAt: new Date('2026-08-10T00:00:00Z'),
      autoRenew: false,
      renewalDate: null,
    });

    expect(selectBundleToCharge([cancelled], NOW)?.id).toBe('cancelled');
  });

  it('stops serving a cancelled bundle after its period closes', () => {
    const cancelled = bundle({
      id: 'cancelled',
      status: SubscriptionStatus.CANCELLED,
      endDate: new Date('2026-08-15T00:00:00Z'),
    });

    expect(selectBundleToCharge([cancelled], NOW)).toBeNull();
  });

  it('skips bundles whose period has not started yet', () => {
    const future = bundle({
      id: 'future',
      startDate: new Date('2026-09-01T00:00:00Z'),
      endDate: new Date('2026-10-01T00:00:00Z'),
    });

    expect(selectBundleToCharge([future], NOW)).toBeNull();
  });

  it('is deterministic for otherwise identical bundles', () => {
    const first = bundle({ id: 'aaa' });
    const second = bundle({ id: 'bbb' });

    expect(selectBundleToCharge([second, first], NOW)?.id).toBe('aaa');
    expect(selectBundleToCharge([first, second], NOW)?.id).toBe('aaa');
  });
});
