import { Test } from '@nestjs/testing';
import { DataSource, EntityManager } from 'typeorm';
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
      claimDueForRenewal: jest.fn().mockResolvedValue([]),
      findByIdLocked: jest.fn().mockResolvedValue(null),
      applyRenewal: jest.fn().mockResolvedValue(undefined),
      applyPaymentFailure: jest.fn().mockResolvedValue(undefined),
      findLapsed: jest.fn().mockResolvedValue([]),
      markExpired: jest.fn().mockResolvedValue(0),
    } as unknown as jest.Mocked<SubscriptionRepository>;

    payments = {
      record: jest.fn().mockResolvedValue({}),
    } as unknown as jest.Mocked<PaymentRepository>;

    gateway = { charge: jest.fn() };
    gateway.charge.mockResolvedValue({ outcome: 'SUCCEEDED', reference: 'sim_1' });

    const dataSource = {
      transaction: jest.fn((work: (manager: EntityManager) => Promise<unknown>) =>
        work({} as EntityManager),
      ),
    } as unknown as DataSource;

    const moduleRef = await Test.createTestingModule({
      providers: [
        BillingService,
        { provide: SubscriptionRepository, useValue: subscriptions },
        { provide: PaymentRepository, useValue: payments },
        { provide: PaymentGateway, useValue: gateway },
        { provide: DataSource, useValue: dataSource },
        { provide: Clock, useValue: new FixedClock(NOW) },
      ],
    }).compile();

    service = moduleRef.get(BillingService);
  });

  /** Claimed rows are re-read under a lock before being charged. */
  function queue(...bundles: Subscription[]): void {
    subscriptions.claimDueForRenewal.mockResolvedValue(bundles);
    subscriptions.findByIdLocked.mockImplementation((id: string) =>
      Promise.resolve(bundles.find((bundle) => bundle.id === id) ?? null),
    );
  }

  it('does nothing when no bundle is due', async () => {
    const report = await service.runBillingCycle();

    expect(report).toMatchObject({ processed: 0, renewed: 0, failed: 0, expired: 0 });
    expect(gateway.charge).not.toHaveBeenCalled();
  });

  describe('successful renewal', () => {
    it('rolls the period forward from the previous end date', async () => {
      queue(dueBundle());

      await service.runBillingCycle();

      expect(subscriptions.applyRenewal).toHaveBeenCalledWith(
        'sub-1',
        {
          startDate: new Date('2026-09-01T00:00:00Z'),
          endDate: new Date('2026-10-01T00:00:00Z'),
          renewalDate: new Date('2026-10-01T00:00:00Z'),
        },
        expect.anything(),
      );
    });

    it('records the charge and reports the renewal', async () => {
      queue(dueBundle());

      const report = await service.runBillingCycle();

      expect(payments.record).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: PaymentKind.RENEWAL,
          status: PaymentStatus.SUCCEEDED,
          amountCents: 2999,
        }),
        expect.anything(),
      );
      expect(report).toMatchObject({ processed: 1, renewed: 1, failed: 0 });
    });

    it('advances a yearly bundle by a year', async () => {
      queue(dueBundle({ billingCycle: BillingCycle.YEARLY }));

      await service.runBillingCycle();

      expect(subscriptions.applyRenewal).toHaveBeenCalledWith(
        'sub-1',
        expect.objectContaining({ endDate: new Date('2027-09-01T00:00:00Z') }),
        expect.anything(),
      );
    });

    it('writes the payment and the period advance in one transaction', async () => {
      queue(dueBundle());

      await service.runBillingCycle();

      // Both must share a manager. A payment committed without the matching
      // period advance leaves the bundle due, and the card gets charged again.
      const paymentManager = payments.record.mock.calls[0][1];
      const renewalManager = subscriptions.applyRenewal.mock.calls[0][2];
      expect(paymentManager).toBe(renewalManager);
    });
  });

  describe('failed renewal', () => {
    beforeEach(() => {
      gateway.charge.mockResolvedValue({ outcome: 'FAILED', reason: 'insufficient_funds' });
    });

    it('marks the bundle inactive with the decline reason', async () => {
      queue(dueBundle());

      const report = await service.runBillingCycle();

      expect(subscriptions.applyPaymentFailure).toHaveBeenCalledWith(
        'sub-1',
        'insufficient_funds',
        expect.anything(),
      );
      expect(subscriptions.applyRenewal).not.toHaveBeenCalled();
      expect(report).toMatchObject({ processed: 1, renewed: 0, failed: 1 });
    });

    it('records the failed charge with its reason', async () => {
      queue(dueBundle());

      await service.runBillingCycle();

      expect(payments.record).toHaveBeenCalledWith(
        expect.objectContaining({
          status: PaymentStatus.FAILED,
          failureReason: 'insufficient_funds',
        }),
        expect.anything(),
      );
    });
  });

  describe('overlapping runs', () => {
    it('skips a bundle another run already renewed', async () => {
      subscriptions.claimDueForRenewal.mockResolvedValue([dueBundle()]);
      // Re-read under the lock: the renewal date has already moved forward.
      subscriptions.findByIdLocked.mockResolvedValue(
        dueBundle({ renewalDate: new Date('2026-10-01T00:00:00Z') }),
      );

      const report = await service.runBillingCycle();

      expect(gateway.charge).not.toHaveBeenCalled();
      expect(payments.record).not.toHaveBeenCalled();
      expect(report.outcomes[0].result).toBe('SKIPPED');
      expect(report.renewed).toBe(0);
    });

    it('skips a bundle that vanished between claim and lock', async () => {
      subscriptions.claimDueForRenewal.mockResolvedValue([dueBundle()]);
      subscriptions.findByIdLocked.mockResolvedValue(null);

      const report = await service.runBillingCycle();

      expect(gateway.charge).not.toHaveBeenCalled();
      expect(report.outcomes[0].result).toBe('SKIPPED');
    });
  });

  describe('partial failure', () => {
    it('keeps processing after one bundle throws', async () => {
      queue(dueBundle({ id: 'sub-1' }), dueBundle({ id: 'sub-2' }));
      gateway.charge
        .mockRejectedValueOnce(new Error('connection reset'))
        .mockResolvedValueOnce({ outcome: 'SUCCEEDED', reference: 'sim_2' });

      const report = await service.runBillingCycle();

      expect(report).toMatchObject({ processed: 2, renewed: 1, errored: 1 });
      expect(report.outcomes.map((outcome) => outcome.result)).toEqual(['ERROR', 'RENEWED']);
    });

    it('still expires lapsed bundles when a renewal throws', async () => {
      queue(dueBundle());
      gateway.charge.mockRejectedValue(new Error('gateway unreachable'));
      subscriptions.findLapsed.mockResolvedValue([dueBundle({ id: 'lapsed-1' })]);
      subscriptions.markExpired.mockResolvedValue(1);

      const report = await service.runBillingCycle();

      expect(subscriptions.markExpired).toHaveBeenCalledWith(['lapsed-1'], NOW);
      expect(report.expired).toBe(1);
    });
  });

  it('expires bundles whose paid period has closed', async () => {
    subscriptions.findLapsed.mockResolvedValue([dueBundle({ id: 'lapsed-1' })]);
    subscriptions.markExpired.mockResolvedValue(1);

    const report = await service.runBillingCycle();

    expect(subscriptions.markExpired).toHaveBeenCalledWith(['lapsed-1'], NOW);
    expect(report.expired).toBe(1);
  });
});
