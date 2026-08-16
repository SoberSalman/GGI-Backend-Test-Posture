import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, In, LessThanOrEqual, Repository } from 'typeorm';
import { SubscriptionStatus } from '../domain/bundle-tier';
import { Subscription } from '../domain/subscription.entity';

/** Serving statuses — a cancelled bundle still runs out its paid period. */
const SERVING_STATUSES = [SubscriptionStatus.ACTIVE, SubscriptionStatus.CANCELLED];

/**
 * Persistence adapter for the `Subscription` aggregate.
 *
 * Application services depend on this class, never on `Repository<Subscription>`
 * directly, so query details (locking, ordering, soft state) stay in one place.
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

  async save(subscription: Subscription, manager?: EntityManager): Promise<Subscription> {
    return this.scoped(manager).save(subscription);
  }

  create(data: Partial<Subscription>): Subscription {
    return this.subscriptions.create(data);
  }

  async findById(id: string, manager?: EntityManager): Promise<Subscription | null> {
    return this.scoped(manager).findOne({ where: { id } });
  }

  async findAllForUser(userId: string): Promise<Subscription[]> {
    return this.subscriptions.find({ where: { userId }, order: { createdAt: 'DESC' } });
  }

  /** Bundles that may still serve messages, without locking. Read-only views. */
  async findServingForUser(userId: string): Promise<Subscription[]> {
    return this.subscriptions.find({
      where: { userId, status: In(SERVING_STATUSES) },
      order: { endDate: 'ASC' },
    });
  }

  /**
   * Loads the user's serving bundles with `SELECT ... FOR UPDATE`.
   *
   * Must be called inside a transaction. The row lock is what stops two
   * concurrent chat requests from both reading `messagesUsed = 9` on a Basic
   * bundle and each deducting the tenth response.
   */
  async findServingForUserLocked(userId: string, manager: EntityManager): Promise<Subscription[]> {
    return manager
      .getRepository(Subscription)
      .createQueryBuilder('subscription')
      .setLock('pessimistic_write')
      .where('subscription.userId = :userId', { userId })
      .andWhere('subscription.status IN (:...statuses)', { statuses: SERVING_STATUSES })
      .orderBy('subscription.endDate', 'ASC')
      .getMany();
  }

  /** Active auto-renewing bundles whose renewal date has arrived. */
  async findDueForRenewal(now: Date): Promise<Subscription[]> {
    return this.subscriptions.find({
      where: {
        status: SubscriptionStatus.ACTIVE,
        autoRenew: true,
        renewalDate: LessThanOrEqual(now),
      },
      order: { renewalDate: 'ASC' },
    });
  }

  /**
   * Bundles whose paid period has elapsed and which are therefore no longer
   * serving. Cancelled bundles land here once their final period closes.
   */
  async findLapsed(now: Date): Promise<Subscription[]> {
    return this.subscriptions
      .createQueryBuilder('subscription')
      .where('subscription.status IN (:...statuses)', { statuses: SERVING_STATUSES })
      .andWhere('subscription.endDate <= :now', { now })
      .andWhere('(subscription.autoRenew = false OR subscription.renewalDate IS NULL)')
      .getMany();
  }

  async markExpired(ids: readonly string[]): Promise<number> {
    if (ids.length === 0) return 0;
    const result = await this.subscriptions.update(
      { id: In([...ids]) },
      { status: SubscriptionStatus.EXPIRED, renewalDate: null },
    );
    return result.affected ?? 0;
  }
}
