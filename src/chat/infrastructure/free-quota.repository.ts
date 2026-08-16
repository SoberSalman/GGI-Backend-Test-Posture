import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Not, Repository } from 'typeorm';
import { monthKey } from '../../shared/time/billing-period';
import { FreeQuota } from '../domain/free-quota.entity';

@Injectable()
export class FreeQuotaRepository {
  constructor(
    @InjectRepository(FreeQuota)
    private readonly quotas: Repository<FreeQuota>,
  ) {}

  async findForUser(userId: string): Promise<FreeQuota | null> {
    return this.quotas.findOne({ where: { userId } });
  }

  /**
   * Loads the user's counter with `SELECT ... FOR UPDATE`, creating it on first
   * use. Must run inside a transaction: the lock is what makes the
   * read-check-increment in `QuotaService.reserve` atomic.
   */
  async findOrCreateLocked(userId: string, now: Date, manager: EntityManager): Promise<FreeQuota> {
    const repository = manager.getRepository(FreeQuota);

    const existing = await repository
      .createQueryBuilder('quota')
      .setLock('pessimistic_write')
      .where('quota.userId = :userId', { userId })
      .getOne();

    if (existing) return existing;

    // First message ever for this user. `ON CONFLICT DO NOTHING` keeps two
    // concurrent first requests from racing on the unique userId index.
    await repository
      .createQueryBuilder()
      .insert()
      .into(FreeQuota)
      .values({ userId, periodKey: monthKey(now), messagesUsed: 0 })
      .orIgnore()
      .execute();

    return repository
      .createQueryBuilder('quota')
      .setLock('pessimistic_write')
      .where('quota.userId = :userId', { userId })
      .getOneOrFail();
  }

  async save(quota: FreeQuota, manager?: EntityManager): Promise<FreeQuota> {
    const repository = manager ? manager.getRepository(FreeQuota) : this.quotas;
    return repository.save(quota);
  }

  /**
   * Hands one free message back, atomically.
   *
   * The period is part of the WHERE rather than checked in memory: a refund is
   * only valid against the month it was reserved in, and by the time a slow
   * provider call fails the counter may already have rolled over. Load, mutate
   * and full-save would also clobber a concurrent reserve that committed in
   * between, which is the same lost update the subscription writes avoid.
   *
   * @returns whether a row was actually credited.
   */
  async refundOne(userId: string, reservedPeriod: string): Promise<boolean> {
    const result = await this.quotas
      .createQueryBuilder()
      .update(FreeQuota)
      .set({ messagesUsed: () => 'GREATEST("messagesUsed" - 1, 0)' })
      .where('"userId" = :userId', { userId })
      .andWhere('"periodKey" = :reservedPeriod', { reservedPeriod })
      .execute();

    return (result.affected ?? 0) > 0;
  }

  /**
   * Rolls every counter left over from a previous month back to zero.
   *
   * @returns how many rows were reset.
   */
  async resetStale(now: Date): Promise<number> {
    const currentPeriod = monthKey(now);
    const result = await this.quotas.update(
      { periodKey: Not(currentPeriod) },
      { periodKey: currentPeriod, messagesUsed: 0 },
    );
    return result.affected ?? 0;
  }
}
