import { BillingCycle, BundleTier, SubscriptionStatus } from '../domain/bundle-tier';
import { Payment, PaymentKind, PaymentStatus } from '../domain/payment.entity';
import { Subscription } from '../domain/subscription.entity';
import {
  SubscriptionView,
  formatCents,
  toPaymentView,
  toSubscriptionView,
} from './subscription.presenter';

function bundle(overrides: Partial<Subscription> = {}): Subscription {
  return Object.assign(new Subscription(), {
    id: 'sub-1',
    userId: 'user-1',
    tier: BundleTier.BASIC,
    billingCycle: BillingCycle.MONTHLY,
    status: SubscriptionStatus.ACTIVE,
    maxMessages: 10,
    messagesUsed: 4,
    priceCents: 999,
    autoRenew: true,
    startDate: new Date('2026-08-01T00:00:00Z'),
    endDate: new Date('2026-09-01T00:00:00Z'),
    renewalDate: new Date('2026-09-01T00:00:00Z'),
    cancelledAt: null,
    renewalCount: 0,
    lastPaymentFailureReason: null,
    createdAt: new Date('2026-08-01T00:00:00Z'),
    ...overrides,
  } satisfies Partial<Subscription>);
}

describe('subscription presenter', () => {
  it('formats cents as a decimal string and keeps the raw value', () => {
    const view = toSubscriptionView(bundle());

    expect(view.price).toBe('9.99');
    expect(view.priceCents).toBe(999);
  });

  it('reports remaining quota for a finite bundle', () => {
    expect(toSubscriptionView(bundle()).remainingMessages).toBe(6);
  });

  it('serialises unlimited quota as null, never Infinity', () => {
    const view = toSubscriptionView(bundle({ maxMessages: null, messagesUsed: 900 }));

    expect(view.remainingMessages).toBeNull();
    expect(view.unlimited).toBe(true);
    // Infinity is not representable in JSON, it would serialise as null anyway
    // but only after passing through a value no client could reason about.
    const roundTripped = JSON.parse(JSON.stringify(view)) as SubscriptionView;
    expect(roundTripped.remainingMessages).toBeNull();
  });

  it('serialises nullable dates as null rather than dropping them', () => {
    const view = toSubscriptionView(bundle({ renewalDate: null, cancelledAt: null }));

    expect(view.renewalDate).toBeNull();
    expect(view.cancelledAt).toBeNull();
  });

  it('renders a cancelled bundle with its cancellation timestamp', () => {
    const view = toSubscriptionView(
      bundle({
        status: SubscriptionStatus.CANCELLED,
        cancelledAt: new Date('2026-08-16T12:00:00Z'),
      }),
    );

    expect(view.status).toBe('CANCELLED');
    expect(view.cancelledAt).toBe('2026-08-16T12:00:00.000Z');
  });

  it('formats a payment record', () => {
    const payment = Object.assign(new Payment(), {
      id: 'pay-1',
      subscriptionId: 'sub-1',
      userId: 'user-1',
      kind: PaymentKind.RENEWAL,
      status: PaymentStatus.FAILED,
      amountCents: 2999,
      failureReason: 'card_expired',
      createdAt: new Date('2026-09-01T00:05:00Z'),
    } satisfies Partial<Payment>);

    expect(toPaymentView(payment)).toEqual({
      id: 'pay-1',
      subscriptionId: 'sub-1',
      kind: 'RENEWAL',
      status: 'FAILED',
      amount: '29.99',
      amountCents: 2999,
      failureReason: 'card_expired',
      createdAt: '2026-09-01T00:05:00.000Z',
    });
  });

  it('formats whole and fractional amounts consistently', () => {
    expect(formatCents(0)).toBe('0.00');
    expect(formatCents(5)).toBe('0.05');
    expect(formatCents(99990)).toBe('999.90');
  });
});
