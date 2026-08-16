import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, In, Repository } from 'typeorm';
import { SubscriptionStatus } from '../domain/bundle-tier';
import { Subscription } from '../domain/subscription.entity';

/** A cancelled bundle still runs out the period it was paid for. */
const SERVING_STATUSES = [SubscriptionStatus.ACTIVE, SubscriptionStatus.CANCELLED];

export interface RenewalUpdate {
  startDate: Date;
  endDate: Date;
  renewalDate: Date;
}

/**
 * Persistence for the `Subscription` aggregate.
 *
 * Writes are targeted `UPDATE`s, not `save(entity)`. A full-entity save writes
 * every column from the snapshot the caller read, so the billing job would
 * silently roll back a `messagesUsed` increment a chat request committed in
 * between. Each method touches only the columns it owns.
 */
@Injectable()
export class SubscriptionRepository {
  constructor(
    @InjectRepository(Subscription)
    private readonly subscriptions: Repository<Subscription>,
  ) {}

  private scoped(manager?: EntityManager): Repository<Subscription> {
    return manager ? manager.getRepository(Subscription) : this.subscriptions;
  }

  async insert(data: NewSubscription): Promise<Subscription> {
    return this.subscriptions.save(this.subscriptions.create(data));
  }

  async findById(id: string, manager?: EntityManager): Promise<Subscription | null> {
    return this.scoped(manager).findOne({ where: { id } });
  }

  async findByIdLocked(id: string, manager: EntityManager): Promise<Subscription | null> {
    return manager
      .getRepository(Subscription)
      .createQueryBuilder('subscription')
      .setLock('pessimistic_write')
      .where('subscription.id = :id', { id })
      .getOne();
  }

  async findAllForUser(userId: string): Promise<Subscription[]> {
    return this.subscriptions.find({
      where: { userId },
      order: { createdAt: 'DESC' },
      take: 100,
    });
  }

  async findServingForUser(userId: string): Promise<Subscription[]> {
    return this.subscriptions.find({
      where: { userId, status: In(SERVING_STATUSES) },
      order: { endDate: 'ASC' },
    });
  }

  /**
   * Loads the user's serving bundles `FOR UPDATE`. Must run in a transaction.
   *
   * The lock is what stops two concurrent chat requests both reading
   * `messagesUsed = 9` on a Basic bundle and each spending the tenth response.
   * `id` is in the ordering so two transactions take the rows in the same
   * order. Bundles bought back to back share an `endDate`, and without the
   * tiebreak Postgres may return them either way round, which deadlocks.
   */
  async findServingForUserLocked(userId: string, manager: EntityManager): Promise<Subscription[]> {
    return manager
      .getRepository(Subscription)
      .createQueryBuilder('subscription')
      .setLock('pessimistic_write')
      .where('subscription.userId = :userId', { userId })
      .andWhere('subscription.status IN (:...statuses)', { statuses: SERVING_STATUSES })
      .orderBy('subscription.endDate', 'ASC')
      .addOrderBy('subscription.id', 'ASC')
      .getMany();
  }

  /** Spends one response. Atomic, so it cannot lose a concurrent increment. */
  async incrementUsage(id: string, manager: EntityManager): Promise<void> {
    await manager.increment(Subscription, { id }, 'messagesUsed', 1);
  }

  /** Hands one response back, floored at zero. */
  async decrementUsage(id: string, manager?: EntityManager): Promise<void> {
    await this.scoped(manager)
      .createQueryBuilder()
      .update(Subscription)
      .set({ messagesUsed: () => 'GREATEST("messagesUsed" - 1, 0)' })
      .where('id = :id', { id })
      .execute();
  }

  /**
   * Claims the bundles due for renewal `FOR UPDATE SKIP LOCKED`.
   *
   * `SKIP LOCKED` only settles the race between two runs issuing this query at
   * the same instant. It is not what prevents double charging: this transaction
   * commits as soon as the rows are read, so a later run sees them again. The
   * actual guarantee is the lock and dueness re-check in `renewOne`.
   */
  async claimDueForRenewal(now: Date, manager: EntityManager): Promise<Subscription[]> {
    return manager
      .getRepository(Subscription)
      .createQueryBuilder('subscription')
      .setLock('pessimistic_write')
      .setOnLocked('skip_locked')
      .where('subscription.status = :status', { status: SubscriptionStatus.ACTIVE })
      .andWhere('subscription.autoRenew = true')
      .andWhere('subscription.renewalDate <= :now', { now })
      .orderBy('subscription.renewalDate', 'ASC')
      .addOrderBy('subscription.id', 'ASC')
      .getMany();
  }

  /** Rolls the period forward and starts the new period's usage at zero. */
  async applyRenewal(id: string, update: RenewalUpdate, manager: EntityManager): Promise<void> {
    await manager
      .getRepository(Subscription)
      .createQueryBuilder()
      .update(Subscription)
      .set({
        startDate: update.startDate,
        endDate: update.endDate,
        renewalDate: update.renewalDate,
        messagesUsed: 0,
        renewalCount: () => '"renewalCount" + 1',
        lastPaymentFailureReason: null,
      })
      .where('id = :id', { id })
      .execute();
  }

  async applyPaymentFailure(id: string, reason: string, manager: EntityManager): Promise<void> {
    await manager.getRepository(Subscription).update(
      { id },
      {
        status: SubscriptionStatus.INACTIVE,
        renewalDate: null,
        lastPaymentFailureReason: reason,
      },
    );
  }

  async applyCancellation(id: string, cancelledAt: Date): Promise<void> {
    await this.subscriptions.update(
      { id, status: SubscriptionStatus.ACTIVE },
      {
        status: SubscriptionStatus.CANCELLED,
        autoRenew: false,
        renewalDate: null,
        cancelledAt,
      },
    );
  }

  async applyAutoRenew(id: string, autoRenew: boolean, renewalDate: Date | null): Promise<void> {
    await this.subscriptions.update(
      { id, status: SubscriptionStatus.ACTIVE },
      { autoRenew, renewalDate },
    );
  }

  /** Bundles whose paid period closed without renewing. */
  async findLapsed(now: Date): Promise<Subscription[]> {
    return this.subscriptions
      .createQueryBuilder('subscription')
      .where('subscription.status IN (:...statuses)', { statuses: SERVING_STATUSES })
      .andWhere('subscription.endDate <= :now', { now })
      .andWhere('(subscription.autoRenew = false OR subscription.renewalDate IS NULL)')
      .getMany();
  }

  /**
   * The status guard matters: a bundle renewed between the `findLapsed` read
   * and this write must not be force-expired on the strength of a stale row.
   */
  async markExpired(ids: readonly string[], now: Date): Promise<number> {
    if (ids.length === 0) return 0;

    const result = await this.subscriptions
      .createQueryBuilder()
      .update(Subscription)
      .set({ status: SubscriptionStatus.EXPIRED, renewalDate: null })
      .where('id IN (:...ids)', { ids: [...ids] })
      .andWhere('status IN (:...statuses)', { statuses: SERVING_STATUSES })
      .andWhere('"endDate" <= :now', { now })
      .execute();

    return result.affected ?? 0;
  }
}

/** Getters and methods on the entity; not columns anyone can supply. */
type Computed =
  'remainingMessages' | 'isUnlimited' | 'isWithinPeriod' | 'canServe' | 'isDueForRenewal';

/** Every column a new bundle must carry, so a missing one fails to compile. */
export type NewSubscription = Omit<
  Subscription,
  'id' | 'createdAt' | 'updatedAt' | 'user' | Computed
>;
