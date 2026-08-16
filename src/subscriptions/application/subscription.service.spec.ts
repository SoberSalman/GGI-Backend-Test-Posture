import { Test } from '@nestjs/testing';
import { Clock, FixedClock } from '../../shared/time/clock';
import { BillingCycle, BundleTier, SubscriptionStatus } from '../domain/bundle-tier';
import { PaymentKind, PaymentStatus } from '../domain/payment.entity';
import { Subscription } from '../domain/subscription.entity';
import { PaymentRepository } from '../infrastructure/payment.repository';
import { SubscriptionRepository } from '../infrastructure/subscription.repository';
import { SubscriptionService } from './subscription.service';

const NOW = new Date('2026-08-16T12:00:00Z');

describe('SubscriptionService', () => {
  let service: SubscriptionService;
  let subscriptions: jest.Mocked<SubscriptionRepository>;
  let payments: jest.Mocked<PaymentRepository>;
  let stored: Subscription;

  beforeEach(async () => {
    stored = Object.assign(new Subscription(), {
      id: 'sub-1',
      userId: 'user-1',
      tier: BundleTier.BASIC,
      billingCycle: BillingCycle.MONTHLY,
      status: SubscriptionStatus.ACTIVE,
      maxMessages: 10,
      messagesUsed: 4,
      priceCents: 999,
      autoRenew: true,
      startDate: NOW,
      endDate: new Date('2026-09-16T12:00:00Z'),
      renewalDate: new Date('2026-09-16T12:00:00Z'),
      cancelledAt: null,
      renewalCount: 0,
      lastPaymentFailureReason: null,
    } satisfies Partial<Subscription>);

    subscriptions = {
      create: jest
        .fn()
        .mockImplementation((data: Partial<Subscription>) =>
          Object.assign(new Subscription(), data),
        ),
      save: jest
        .fn()
        .mockImplementation((s: Subscription) =>
          Promise.resolve(Object.assign(s, { id: 'sub-1' })),
        ),
      findById: jest.fn().mockResolvedValue(stored),
      findAllForUser: jest.fn().mockResolvedValue([stored]),
    } as unknown as jest.Mocked<SubscriptionRepository>;

    payments = {
      record: jest.fn().mockResolvedValue({}),
      findForSubscription: jest.fn().mockResolvedValue([]),
    } as unknown as jest.Mocked<PaymentRepository>;

    const moduleRef = await Test.createTestingModule({
      providers: [
        SubscriptionService,
        { provide: SubscriptionRepository, useValue: subscriptions },
        { provide: PaymentRepository, useValue: payments },
        { provide: Clock, useValue: new FixedClock(NOW) },
      ],
    }).compile();

    service = moduleRef.get(SubscriptionService);
  });

  describe('create', () => {
    it('applies the catalogue quota and price for a monthly Pro bundle', async () => {
      const created = await service.create({
        userId: 'user-1',
        tier: BundleTier.PRO,
        billingCycle: BillingCycle.MONTHLY,
        autoRenew: true,
      });

      expect(created).toMatchObject({
        tier: BundleTier.PRO,
        maxMessages: 100,
        priceCents: 2999,
        messagesUsed: 0,
        status: SubscriptionStatus.ACTIVE,
      });
      expect(created.endDate.toISOString()).toBe('2026-09-16T12:00:00.000Z');
      expect(created.renewalDate?.toISOString()).toBe('2026-09-16T12:00:00.000Z');
    });

    it('prices a yearly bundle at ten months of the monthly rate', async () => {
      const created = await service.create({
        userId: 'user-1',
        tier: BundleTier.BASIC,
        billingCycle: BillingCycle.YEARLY,
        autoRenew: true,
      });

      expect(created.priceCents).toBe(9990);
      expect(created.endDate.toISOString()).toBe('2027-08-16T12:00:00.000Z');
    });

    it('gives Enterprise unlimited quota', async () => {
      const created = await service.create({
        userId: 'user-1',
        tier: BundleTier.ENTERPRISE,
        billingCycle: BillingCycle.MONTHLY,
        autoRenew: true,
      });

      expect(created.maxMessages).toBeNull();
      expect(created.isUnlimited).toBe(true);
      expect(created.remainingMessages).toBe(Number.POSITIVE_INFINITY);
    });

    it('leaves the renewal date unset when auto-renew is off', async () => {
      const created = await service.create({
        userId: 'user-1',
        tier: BundleTier.BASIC,
        billingCycle: BillingCycle.MONTHLY,
        autoRenew: false,
      });

      expect(created.renewalDate).toBeNull();
    });

    it('records the initial charge', async () => {
      await service.create({
        userId: 'user-1',
        tier: BundleTier.BASIC,
        billingCycle: BillingCycle.MONTHLY,
        autoRenew: true,
      });

      expect(payments.record).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: PaymentKind.INITIAL,
          status: PaymentStatus.SUCCEEDED,
          amountCents: 999,
        }),
      );
    });
  });

  describe('getOwned', () => {
    it('rejects a bundle belonging to somebody else', async () => {
      await expect(service.getOwned('sub-1', 'someone-else')).rejects.toMatchObject({
        code: 'SUBSCRIPTION_ACCESS_DENIED',
        status: 403,
      });
    });

    it('reports an unknown id as not found', async () => {
      subscriptions.findById.mockResolvedValue(null);

      await expect(service.getOwned('missing', 'user-1')).rejects.toMatchObject({
        code: 'SUBSCRIPTION_NOT_FOUND',
        status: 404,
      });
    });
  });

  describe('cancel', () => {
    it('stops renewal but keeps the bundle usable until the period ends', async () => {
      const cancelled = await service.cancel('sub-1', 'user-1');

      expect(cancelled.status).toBe(SubscriptionStatus.CANCELLED);
      expect(cancelled.autoRenew).toBe(false);
      expect(cancelled.renewalDate).toBeNull();
      expect(cancelled.cancelledAt).toEqual(NOW);
      expect(cancelled.endDate.toISOString()).toBe('2026-09-16T12:00:00.000Z');
      expect(cancelled.canServe(NOW)).toBe(true);
    });

    it('preserves usage history', async () => {
      const cancelled = await service.cancel('sub-1', 'user-1');
      expect(cancelled.messagesUsed).toBe(4);
    });

    it('refuses to cancel twice', async () => {
      stored.status = SubscriptionStatus.CANCELLED;

      await expect(service.cancel('sub-1', 'user-1')).rejects.toMatchObject({
        code: 'INVALID_SUBSCRIPTION_STATE',
        status: 409,
      });
    });
  });

  describe('setAutoRenew', () => {
    it('clears the renewal date when switched off', async () => {
      const updated = await service.setAutoRenew('sub-1', 'user-1', false);

      expect(updated.autoRenew).toBe(false);
      expect(updated.renewalDate).toBeNull();
    });

    it('re-arms the renewal date to the end of the period when switched on', async () => {
      stored.autoRenew = false;
      stored.renewalDate = null;

      const updated = await service.setAutoRenew('sub-1', 'user-1', true);

      expect(updated.renewalDate?.toISOString()).toBe(stored.endDate.toISOString());
    });

    it('refuses on a bundle that is not active', async () => {
      stored.status = SubscriptionStatus.INACTIVE;

      await expect(service.setAutoRenew('sub-1', 'user-1', true)).rejects.toMatchObject({
        code: 'INVALID_SUBSCRIPTION_STATE',
      });
    });
  });
});
