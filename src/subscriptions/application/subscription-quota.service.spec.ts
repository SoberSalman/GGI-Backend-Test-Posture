import { EntityManager } from 'typeorm';
import { BillingCycle, BundleTier, SubscriptionStatus } from '../domain/bundle-tier';
import { Subscription } from '../domain/subscription.entity';
import { SubscriptionRepository } from '../infrastructure/subscription.repository';
import { SubscriptionQuotaService } from './subscription-quota.service';

const NOW = new Date('2026-08-16T12:00:00Z');
const MANAGER = {} as EntityManager;

function bundle(overrides: Partial<Subscription> = {}): Subscription {
  return Object.assign(new Subscription(), {
    id: 'sub-1',
    userId: 'user-1',
    tier: BundleTier.BASIC,
    billingCycle: BillingCycle.MONTHLY,
    status: SubscriptionStatus.ACTIVE,
    maxMessages: 10,
    messagesUsed: 3,
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

describe('SubscriptionQuotaService', () => {
  let service: SubscriptionQuotaService;
  let repository: jest.Mocked<SubscriptionRepository>;

  beforeEach(() => {
    repository = {
      findServingForUserLocked: jest.fn().mockResolvedValue([]),
      findServingForUser: jest.fn().mockResolvedValue([]),
      findById: jest.fn().mockResolvedValue(null),
      save: jest.fn().mockImplementation((s: Subscription) => Promise.resolve(s)),
    } as unknown as jest.Mocked<SubscriptionRepository>;

    service = new SubscriptionQuotaService(repository);
  });

  describe('reserveOne', () => {
    it('increments the chosen bundle and reports what is left', async () => {
      const chosen = bundle({ messagesUsed: 3 });
      repository.findServingForUserLocked.mockResolvedValue([chosen]);

      const reservation = await service.reserveOne('user-1', NOW, MANAGER);

      expect(chosen.messagesUsed).toBe(4);
      expect(reservation).toEqual({
        subscriptionId: 'sub-1',
        tier: BundleTier.BASIC,
        remainingAfter: 6,
      });
      expect(repository.save).toHaveBeenCalledWith(chosen, MANAGER);
    });

    it('reports null remaining for an unlimited bundle', async () => {
      repository.findServingForUserLocked.mockResolvedValue([
        bundle({ tier: BundleTier.ENTERPRISE, maxMessages: null, messagesUsed: 500 }),
      ]);

      const reservation = await service.reserveOne('user-1', NOW, MANAGER);

      expect(reservation?.remainingAfter).toBeNull();
    });

    it('returns null when nothing can serve', async () => {
      repository.findServingForUserLocked.mockResolvedValue([bundle({ messagesUsed: 10 })]);

      await expect(service.reserveOne('user-1', NOW, MANAGER)).resolves.toBeNull();
      expect(repository.save).not.toHaveBeenCalled();
    });

    it('takes a row lock — the whole point of reserving inside a transaction', async () => {
      await service.reserveOne('user-1', NOW, MANAGER);

      expect(repository.findServingForUserLocked).toHaveBeenCalledWith('user-1', MANAGER);
    });
  });

  describe('releaseOne', () => {
    it('decrements the bundle it was reserved from', async () => {
      const target = bundle({ messagesUsed: 4 });
      repository.findById.mockResolvedValue(target);

      await service.releaseOne('sub-1');

      expect(target.messagesUsed).toBe(3);
    });

    it('never drops usage below zero', async () => {
      const target = bundle({ messagesUsed: 0 });
      repository.findById.mockResolvedValue(target);

      await service.releaseOne('sub-1');

      expect(target.messagesUsed).toBe(0);
    });

    it('is a no-op for an unknown bundle', async () => {
      await service.releaseOne('missing');
      expect(repository.save).not.toHaveBeenCalled();
    });
  });

  describe('describeUsableBundles', () => {
    it('reports quota per bundle and hides expired periods', async () => {
      repository.findServingForUser.mockResolvedValue([
        bundle({ id: 'current' }),
        bundle({ id: 'lapsed', endDate: new Date('2026-08-01T00:00:00Z') }),
      ]);

      const snapshots = await service.describeUsableBundles('user-1', NOW);

      expect(snapshots).toHaveLength(1);
      expect(snapshots[0]).toMatchObject({
        subscriptionId: 'current',
        maxMessages: 10,
        messagesUsed: 3,
        remainingMessages: 7,
      });
    });

    it('reports null remaining for unlimited bundles', async () => {
      repository.findServingForUser.mockResolvedValue([
        bundle({ tier: BundleTier.ENTERPRISE, maxMessages: null }),
      ]);

      expect((await service.describeUsableBundles('user-1', NOW))[0].remainingMessages).toBeNull();
    });
  });
});
