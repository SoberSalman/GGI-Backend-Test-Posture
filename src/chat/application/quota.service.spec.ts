import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { DataSource, EntityManager } from 'typeorm';
import { SubscriptionQuotaPort } from '../../shared/contracts/subscription-quota.port';
import { Clock, FixedClock } from '../../shared/time/clock';
import { QuotaSource } from '../domain/chat-message.entity';
import { QuotaExceededError } from '../domain/chat.errors';
import { FreeQuota } from '../domain/free-quota.entity';
import { FreeQuotaRepository } from '../infrastructure/free-quota.repository';
import { QuotaService } from './quota.service';

const FREE_ALLOWANCE = 3;
const NOW = new Date('2026-08-16T12:00:00Z');

describe('QuotaService', () => {
  let service: QuotaService;
  let freeQuotas: jest.Mocked<FreeQuotaRepository>;
  let bundles: jest.Mocked<SubscriptionQuotaPort>;
  let storedQuota: FreeQuota;

  beforeEach(async () => {
    storedQuota = Object.assign(new FreeQuota(), {
      userId: 'user-1',
      periodKey: '2026-08',
      messagesUsed: 0,
    });

    freeQuotas = {
      findForUser: jest.fn().mockResolvedValue(storedQuota),
      findOrCreateLocked: jest.fn().mockResolvedValue(storedQuota),
      save: jest.fn().mockImplementation((quota: FreeQuota) => Promise.resolve(quota)),
      resetStale: jest.fn().mockResolvedValue(7),
    } as unknown as jest.Mocked<FreeQuotaRepository>;

    bundles = {
      reserveOne: jest.fn().mockResolvedValue(null),
      releaseOne: jest.fn().mockResolvedValue(undefined),
      describeUsableBundles: jest.fn().mockResolvedValue([]),
    };

    // Run the callback straight through, the transaction itself is exercised
    // by the e2e suite against a real database.
    const dataSource = {
      transaction: jest.fn((work: (manager: EntityManager) => Promise<unknown>) =>
        work({} as EntityManager),
      ),
    } as unknown as DataSource;

    const moduleRef = await Test.createTestingModule({
      providers: [
        QuotaService,
        { provide: FreeQuotaRepository, useValue: freeQuotas },
        { provide: SubscriptionQuotaPort, useValue: bundles },
        { provide: DataSource, useValue: dataSource },
        { provide: Clock, useValue: new FixedClock(NOW) },
        {
          provide: ConfigService,
          useValue: { get: jest.fn().mockReturnValue(FREE_ALLOWANCE) },
        },
      ],
    }).compile();

    service = moduleRef.get(QuotaService);
  });

  describe('reserve', () => {
    it('charges the free tier first and never touches a bundle', async () => {
      const reservation = await service.reserve('user-1');

      expect(reservation.source).toBe(QuotaSource.FREE_TIER);
      expect(reservation.subscriptionId).toBeNull();
      expect(reservation.remainingAfter).toBe(FREE_ALLOWANCE - 1);
      expect(bundles.reserveOne).not.toHaveBeenCalled();
    });

    it('reports the free allowance draining across the month', async () => {
      const first = await service.reserve('user-1');
      const second = await service.reserve('user-1');
      const third = await service.reserve('user-1');

      expect([first, second, third].map((r) => r.remainingAfter)).toEqual([2, 1, 0]);
    });

    it('falls through to a bundle once the free allowance is spent', async () => {
      storedQuota.messagesUsed = FREE_ALLOWANCE;
      bundles.reserveOne.mockResolvedValue({
        subscriptionId: 'sub-1',
        tier: 'PRO',
        remainingAfter: 59,
      });

      const reservation = await service.reserve('user-1');

      expect(reservation).toEqual({
        source: QuotaSource.SUBSCRIPTION,
        subscriptionId: 'sub-1',
        periodKey: null,
        remainingAfter: 59,
      });
    });

    it('reports an unlimited bundle as null remaining, not Infinity', async () => {
      storedQuota.messagesUsed = FREE_ALLOWANCE;
      bundles.reserveOne.mockResolvedValue({
        subscriptionId: 'sub-ent',
        tier: 'ENTERPRISE',
        remainingAfter: null,
      });

      const reservation = await service.reserve('user-1');

      expect(reservation.remainingAfter).toBeNull();
    });

    it('throws a structured QuotaExceededError when nothing can pay', async () => {
      storedQuota.messagesUsed = FREE_ALLOWANCE;

      await expect(service.reserve('user-1')).rejects.toBeInstanceOf(QuotaExceededError);
      await expect(service.reserve('user-1')).rejects.toMatchObject({
        code: 'QUOTA_EXCEEDED',
        status: 402,
        details: {
          freeMessagesAllowance: FREE_ALLOWANCE,
          freeMessagesUsed: FREE_ALLOWANCE,
          freeMessagesRemaining: 0,
          activeBundles: 0,
          freeQuotaResetsAt: '2026-09-01T00:00:00.000Z',
        },
      });
    });

    it('ignores a counter left over from a previous month', async () => {
      storedQuota.periodKey = '2026-07';
      storedQuota.messagesUsed = FREE_ALLOWANCE;

      const reservation = await service.reserve('user-1');

      expect(reservation.source).toBe(QuotaSource.FREE_TIER);
      expect(storedQuota.periodKey).toBe('2026-08');
      expect(storedQuota.messagesUsed).toBe(1);
    });
  });

  describe('release', () => {
    it('hands a free message back', async () => {
      storedQuota.messagesUsed = 2;

      await service.release('user-1', {
        source: QuotaSource.FREE_TIER,
        subscriptionId: null,
        periodKey: '2026-08',
        remainingAfter: 1,
      });

      expect(storedQuota.messagesUsed).toBe(1);
      expect(freeQuotas.save).toHaveBeenCalled();
    });

    it('hands a bundle response back to its bundle', async () => {
      await service.release('user-1', {
        source: QuotaSource.SUBSCRIPTION,
        subscriptionId: 'sub-1',
        periodKey: null,
        remainingAfter: 5,
      });

      expect(bundles.releaseOne).toHaveBeenCalledWith('sub-1');
      expect(freeQuotas.save).not.toHaveBeenCalled();
    });

    it('swallows refund failures, the caller is already reporting an error', async () => {
      bundles.releaseOne.mockRejectedValue(new Error('database unreachable'));

      await expect(
        service.release('user-1', {
          source: QuotaSource.SUBSCRIPTION,
          subscriptionId: 'sub-1',
          periodKey: null,
          remainingAfter: 5,
        }),
      ).resolves.toBeUndefined();
    });
  });

  describe('summarise', () => {
    it('adds free and bundle allowances together', async () => {
      storedQuota.messagesUsed = 1;
      bundles.describeUsableBundles.mockResolvedValue([
        {
          subscriptionId: 'sub-1',
          tier: 'BASIC',
          status: 'ACTIVE',
          maxMessages: 10,
          messagesUsed: 4,
          remainingMessages: 6,
          endDate: new Date('2026-09-01T00:00:00Z'),
        },
      ]);

      const summary = await service.summarise('user-1');

      expect(summary.free).toMatchObject({ allowance: 3, used: 1, remaining: 2 });
      expect(summary.totalRemaining).toBe(8);
    });

    it('reports null total when an unlimited bundle is in play', async () => {
      bundles.describeUsableBundles.mockResolvedValue([
        {
          subscriptionId: 'sub-ent',
          tier: 'ENTERPRISE',
          status: 'ACTIVE',
          maxMessages: null,
          messagesUsed: 12,
          remainingMessages: null,
          endDate: new Date('2026-09-01T00:00:00Z'),
        },
      ]);

      expect((await service.summarise('user-1')).totalRemaining).toBeNull();
    });

    it('treats a missing counter as a full allowance', async () => {
      freeQuotas.findForUser.mockResolvedValue(null);

      const summary = await service.summarise('user-1');

      expect(summary.free.used).toBe(0);
      expect(summary.free.remaining).toBe(FREE_ALLOWANCE);
    });
  });

  describe('resetFreeQuotas', () => {
    it('rolls stale counters forward and reports the row count', async () => {
      const result = await service.resetFreeQuotas();

      expect(freeQuotas.resetStale).toHaveBeenCalledWith(NOW);
      expect(result).toEqual({ resetAt: NOW, rowsReset: 7 });
    });
  });
});
