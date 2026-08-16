import { Injectable, Logger } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { Clock } from '../../shared/time/clock';
import { PaymentKind, PaymentStatus } from '../domain/payment.entity';
import { Subscription } from '../domain/subscription.entity';
import { PaymentRepository } from '../infrastructure/payment.repository';
import { SubscriptionRepository } from '../infrastructure/subscription.repository';
import { PaymentGateway } from './payment-gateway.port';
import { addBillingCycle } from './subscription.service';

export interface RenewalOutcome {
  subscriptionId: string;
  userId: string;
  tier: string;
  result: 'RENEWED' | 'PAYMENT_FAILED' | 'SKIPPED' | 'ERROR';
  reason?: string;
  nextEndDate?: Date;
}

export interface BillingRunReport {
  runAt: Date;
  processed: number;
  renewed: number;
  failed: number;
  skipped: number;
  errored: number;
  expired: number;
  outcomes: RenewalOutcome[];
}

/**
 * Charges bundles whose renewal date has arrived, then retires the ones whose
 * paid period closed. Runs nightly on a cron and on demand via POST /billing/run.
 */
@Injectable()
export class BillingService {
  private readonly logger = new Logger(BillingService.name);

  constructor(
    private readonly subscriptions: SubscriptionRepository,
    private readonly payments: PaymentRepository,
    private readonly gateway: PaymentGateway,
    private readonly dataSource: DataSource,
    private readonly clock: Clock,
  ) {}

  async runBillingCycle(): Promise<BillingRunReport> {
    const runAt = this.clock.now();
    const due = await this.dataSource.transaction((manager) =>
      this.subscriptions.claimDueForRenewal(runAt, manager),
    );

    this.logger.log(`Billing run at ${runAt.toISOString()}: ${due.length} subscription(s) due`);

    // Serial on purpose: these charges hit one payment provider, and the
    // connection pool is the ceiling on concurrent transactions.
    const outcomes: RenewalOutcome[] = [];
    for (const subscription of due) {
      // One bad row must not abort the batch or skip the expiry sweep below.
      // A blip on somebody else's bundle should never leave lapsed bundles
      // serving for another day.
      try {
        outcomes.push(await this.renewOne(subscription.id, runAt));
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        this.logger.error(`Renewal failed for ${subscription.id}: ${reason}`);
        outcomes.push({
          subscriptionId: subscription.id,
          userId: subscription.userId,
          tier: subscription.tier,
          result: 'ERROR',
          reason,
        });
      }
    }

    const expired = await this.expireLapsed(runAt);

    return {
      runAt,
      processed: outcomes.length,
      renewed: countBy(outcomes, 'RENEWED'),
      failed: countBy(outcomes, 'PAYMENT_FAILED'),
      skipped: countBy(outcomes, 'SKIPPED'),
      errored: countBy(outcomes, 'ERROR'),
      expired,
      outcomes,
    };
  }

  /**
   * Re-reads the row under a lock and re-checks dueness before charging, so an
   * overlapping run cannot charge the same bundle twice. Payment and period
   * advance commit together.
   *
   * The charge itself is still not safe to repeat: crash after the gateway
   * returns and the rollback loses the payment row, so the next run charges
   * again. Needs an idempotency key against a real PSP.
   */
  private async renewOne(subscriptionId: string, runAt: Date): Promise<RenewalOutcome> {
    return this.dataSource.transaction(async (manager) => {
      const subscription = await this.subscriptions.findByIdLocked(subscriptionId, manager);

      if (!subscription?.isDueForRenewal(runAt)) {
        this.logger.log(`Skipping ${subscriptionId}: no longer due (claimed by another run)`);
        return {
          subscriptionId,
          userId: subscription?.userId ?? 'unknown',
          tier: subscription?.tier ?? 'unknown',
          result: 'SKIPPED' as const,
          reason: 'not_due',
        };
      }

      const charge = await this.gateway.charge({
        userId: subscription.userId,
        subscriptionId: subscription.id,
        amountCents: subscription.priceCents,
        description: `${subscription.tier} bundle renewal (${subscription.billingCycle})`,
      });

      await this.payments.record(
        {
          subscriptionId: subscription.id,
          userId: subscription.userId,
          kind: PaymentKind.RENEWAL,
          status: charge.outcome === 'SUCCEEDED' ? PaymentStatus.SUCCEEDED : PaymentStatus.FAILED,
          amountCents: subscription.priceCents,
          failureReason: charge.outcome === 'FAILED' ? charge.reason : null,
        },
        manager,
      );

      return charge.outcome === 'FAILED'
        ? this.applyDecline(subscription, charge.reason, manager)
        : this.applyRenewal(subscription, manager);
    });
  }

  /** A decline stops the bundle serving at once and is not retried. */
  private async applyDecline(
    subscription: Subscription,
    reason: string,
    manager: EntityManager,
  ): Promise<RenewalOutcome> {
    await this.subscriptions.applyPaymentFailure(subscription.id, reason, manager);
    this.logger.warn(`Bundle ${subscription.id} marked INACTIVE: payment ${reason}`);

    return {
      subscriptionId: subscription.id,
      userId: subscription.userId,
      tier: subscription.tier,
      result: 'PAYMENT_FAILED',
      reason,
    };
  }

  private async applyRenewal(
    subscription: Subscription,
    manager: EntityManager,
  ): Promise<RenewalOutcome> {
    // The new period starts where the old one ended, so repeated renewals never
    // drift away from the original anniversary date.
    const startDate = subscription.endDate;
    const endDate = addBillingCycle(startDate, subscription.billingCycle);

    await this.subscriptions.applyRenewal(
      subscription.id,
      { startDate, endDate, renewalDate: endDate },
      manager,
    );

    this.logger.log(`Bundle ${subscription.id} renewed through ${endDate.toISOString()}`);
    return {
      subscriptionId: subscription.id,
      userId: subscription.userId,
      tier: subscription.tier,
      result: 'RENEWED',
      nextEndDate: endDate,
    };
  }

  private async expireLapsed(now: Date): Promise<number> {
    const lapsed = await this.subscriptions.findLapsed(now);
    if (lapsed.length === 0) return 0;

    const count = await this.subscriptions.markExpired(
      lapsed.map((subscription) => subscription.id),
      now,
    );
    this.logger.log(`Expired ${count} lapsed subscription(s)`);
    return count;
  }
}

function countBy(outcomes: readonly RenewalOutcome[], result: RenewalOutcome['result']): number {
  return outcomes.filter((outcome) => outcome.result === result).length;
}
