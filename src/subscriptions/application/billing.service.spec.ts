import { Test } from '@nestjs/testing';
import { Clock, FixedClock } from '../../shared/time/clock';
import {
  BillingCycle,
  BundleTier,
  SubscriptionStatus,
  tierDefinition,
} from '../domain/bundle-tier';
import { PaymentKind, PaymentStatus } from '../domain/payment.entity';
import { Subscription } from '../domain/subscription.entity';
import { PaymentRepository } from '../infrastructure/payment.repository';
import { SubscriptionRepository } from '../infrastructure/subscription.repository';
import { BillingService } from './billing.service';
import { PaymentGateway } from './payment-gateway.port';

const NOW = new Date('2026-09-01T00:05:00Z');

function dueBundle(overrides: Partial<Subscription> = {}): Subscription {
  return Object.assign(new Subscription(), {
    id: 'sub-1',
    userId: 'user-1',
    tier: BundleTier.PRO,
    billingCycle: BillingCycle.MONTHLY,
    status: SubscriptionStatus.ACTIVE,
    maxMessages: tierDefinition(BundleTier.PRO).maxMessages,
    messagesUsed: 87,
    priceCents: 2999,
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

describe('BillingService', () => {
  let service: BillingService;
  let subscriptions: jest.Mocked<SubscriptionRepository>;
  let payments: jest.Mocked<PaymentRepository>;
  let gateway: jest.Mocked<PaymentGateway>;

  beforeEach(async () => {
    subscriptions = {
      findDueForRenewal: jest.fn().mockResolvedValue([]),
      findLapsed: jest.fn().mockResolvedValue([]),
      markExpired: jest.fn().mockResolvedValue(0),
      save: jest.fn().mockImplementation((s: Subscription) => Promise.resolve(s)),
    } as unknown as jest.Mocked<SubscriptionRepository>;

    payments = {
      record: jest.fn().mockResolvedValue({}),
    } as unknown as jest.Mocked<PaymentRepository>;

    gateway = {
      charge: jest.fn().mockResolvedValue({ outcome: 'SUCCEEDED', reference: 'sim_1' }),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        BillingService,
        { provide: SubscriptionRepository, useValue: subscriptions },
        { provide: PaymentRepository, useValue: payments },
        { provide: PaymentGateway, useValue: gateway },
        { provide: Clock, useValue: new FixedClock(NOW) },
      ],
    }).compile();

    service = moduleRef.get(BillingService);
  });

  it('does nothing when no bundle is due', async () => {
    const report = await service.runBillingCycle();

    expect(report).toMatchObject({ processed: 0, renewed: 0, failed: 0, expired: 0 });
    expect(gateway.charge).not.toHaveBeenCalled();
  });

  describe('successful renewal', () => {
    it('rolls the period forward from the previous end date', async () => {
      const bundle = dueBundle();
      subscriptions.findDueForRenewal.mockResolvedValue([bundle]);

      await service.runBillingCycle();

      expect(bundle.startDate.toISOString()).toBe('2026-09-01T00:00:00.000Z');
      expect(bundle.endDate.toISOString()).toBe('2026-10-01T00:00:00.000Z');
      expect(bundle.renewalDate?.toISOString()).toBe('2026-10-01T00:00:00.000Z');
    });

    it('resets the period message counter and records the charge', async () => {
      const bundle = dueBundle({ messagesUsed: 87 });
      subscriptions.findDueForRenewal.mockResolvedValue([bundle]);

      const report = await service.runBillingCycle();

      expect(bundle.messagesUsed).toBe(0);
      expect(bundle.renewalCount).toBe(1);
      expect(bundle.status).toBe(SubscriptionStatus.ACTIVE);
      expect(payments.record).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: PaymentKind.RENEWAL,
          status: PaymentStatus.SUCCEEDED,
          amountCents: 2999,
        }),
      );
      expect(report).toMatchObject({ processed: 1, renewed: 1, failed: 0 });
    });

    it('advances a yearly bundle by a year', async () => {
      const bundle = dueBundle({
        billingCycle: BillingCycle.YEARLY,
        endDate: new Date('2026-09-01T00:00:00Z'),
      });
      subscriptions.findDueForRenewal.mockResolvedValue([bundle]);

      await service.runBillingCycle();

      expect(bundle.endDate.toISOString()).toBe('2027-09-01T00:00:00.000Z');
    });

    it('clears a previous failure reason', async () => {
      const bundle = dueBundle({ lastPaymentFailureReason: 'card_expired' });
      subscriptions.findDueForRenewal.mockResolvedValue([bundle]);

      await service.runBillingCycle();

      expect(bundle.lastPaymentFailureReason).toBeNull();
    });
  });

  describe('failed renewal', () => {
    beforeEach(() => {
      gateway.charge.mockResolvedValue({ outcome: 'FAILED', reason: 'insufficient_funds' });
    });

    it('marks the bundle inactive and disarms renewal', async () => {
      const bundle = dueBundle();
      subscriptions.findDueForRenewal.mockResolvedValue([bundle]);

      const report = await service.runBillingCycle();

      expect(bundle.status).toBe(SubscriptionStatus.INACTIVE);
      expect(bundle.renewalDate).toBeNull();
      expect(bundle.lastPaymentFailureReason).toBe('insufficient_funds');
      expect(report).toMatchObject({ processed: 1, renewed: 0, failed: 1 });
    });

    it('does not extend the period or reset usage', async () => {
      const bundle = dueBundle({ messagesUsed: 87 });
      subscriptions.findDueForRenewal.mockResolvedValue([bundle]);

      await service.runBillingCycle();

      expect(bundle.endDate.toISOString()).toBe('2026-09-01T00:00:00.000Z');
      expect(bundle.messagesUsed).toBe(87);
    });

    it('records the failed charge with its reason', async () => {
      subscriptions.findDueForRenewal.mockResolvedValue([dueBundle()]);

      await service.runBillingCycle();

      expect(payments.record).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: PaymentKind.RENEWAL,
          status: PaymentStatus.FAILED,
          failureReason: 'insufficient_funds',
        }),
      );
    });
  });

  it('processes every due bundle independently', async () => {
    gateway.charge
      .mockResolvedValueOnce({ outcome: 'SUCCEEDED', reference: 'sim_1' })
      .mockResolvedValueOnce({ outcome: 'FAILED', reason: 'card_expired' });
    subscriptions.findDueForRenewal.mockResolvedValue([
      dueBundle({ id: 'sub-1' }),
      dueBundle({ id: 'sub-2' }),
    ]);

    const report = await service.runBillingCycle();

    expect(report).toMatchObject({ processed: 2, renewed: 1, failed: 1 });
    expect(report.outcomes.map((o) => o.result)).toEqual(['RENEWED', 'PAYMENT_FAILED']);
  });

  it('expires bundles whose paid period has closed', async () => {
    subscriptions.findLapsed.mockResolvedValue([
      dueBundle({ id: 'lapsed-1', autoRenew: false, renewalDate: null }),
    ]);
    subscriptions.markExpired.mockResolvedValue(1);

    const report = await service.runBillingCycle();

    expect(subscriptions.markExpired).toHaveBeenCalledWith(['lapsed-1']);
    expect(report.expired).toBe(1);
  });
});
