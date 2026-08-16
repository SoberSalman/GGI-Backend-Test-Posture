import { Injectable, Logger } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import {
  BundleQuotaSnapshot,
  BundleReservation,
  SubscriptionQuotaPort,
} from '../../shared/contracts/subscription-quota.port';
import { selectBundleToCharge } from '../domain/quota-selection.policy';
import { SubscriptionRepository } from '../infrastructure/subscription.repository';

/** The only place chat usage touches subscription state. */
@Injectable()
export class SubscriptionQuotaService extends SubscriptionQuotaPort {
  private readonly logger = new Logger(SubscriptionQuotaService.name);

  constructor(private readonly subscriptions: SubscriptionRepository) {
    super();
  }

  async reserveOne(
    userId: string,
    now: Date,
    manager: EntityManager,
  ): Promise<BundleReservation | null> {
    const candidates = await this.subscriptions.findServingForUserLocked(userId, manager);
    const chosen = selectBundleToCharge(candidates, now);
    if (!chosen) return null;

    await this.subscriptions.incrementUsage(chosen.id, manager);

    const remainingAfter = chosen.isUnlimited ? null : chosen.remainingMessages - 1;
    this.logger.log(
      `Reserved 1 response from ${chosen.tier} bundle ${chosen.id} for user ${userId} ` +
        `(${remainingAfter ?? 'unlimited'} left)`,
    );

    return { subscriptionId: chosen.id, tier: chosen.tier, remainingAfter };
  }

  async releaseOne(subscriptionId: string, manager?: EntityManager): Promise<void> {
    const subscription = await this.subscriptions.findById(subscriptionId, manager);

    if (!subscription) {
      // The reservation was already counted against this bundle, so losing the
      // refund costs the user a paid response. Never fail silently here.
      this.logger.error(
        `Cannot refund bundle ${subscriptionId}: no such subscription. ` +
          'One response was charged for an answer that was never delivered.',
      );
      return;
    }

    await this.subscriptions.decrementUsage(subscriptionId, manager);
    this.logger.warn(`Released 1 reserved response back to bundle ${subscriptionId}`);
  }

  async describeUsableBundles(userId: string, now: Date): Promise<BundleQuotaSnapshot[]> {
    const serving = await this.subscriptions.findServingForUser(userId);

    return serving
      .filter((subscription) => subscription.isWithinPeriod(now))
      .map((subscription) => ({
        subscriptionId: subscription.id,
        tier: subscription.tier,
        status: subscription.status,
        maxMessages: subscription.maxMessages,
        messagesUsed: subscription.messagesUsed,
        remainingMessages: subscription.isUnlimited ? null : subscription.remainingMessages,
        endDate: subscription.endDate,
      }));
  }
}
