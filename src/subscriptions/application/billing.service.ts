import { Injectable, Logger } from '@nestjs/common';
import { Clock } from '../../shared/time/clock';
import { SubscriptionStatus } from '../domain/bundle-tier';
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
  result: 'RENEWED' | 'PAYMENT_FAILED';
  reason?: string;
  /** New end of the paid period, when the charge went through. */
  nextEndDate?: Date;
}

export interface BillingRunReport {
  runAt: Date;
  processed: number;
  renewed: number;
  failed: number;
  expired: number;
  outcomes: RenewalOutcome[];
}

/**
 * Simulated billing run: charges every bundle whose renewal date has arrived,
 * then retires bundles whose paid period has closed.
 *
 * Invoked by the nightly cron and by `POST /billing/run` so a reviewer can
 * trigger it on demand instead of waiting for the schedule.
 */
@Injectable()
export class BillingService {
  private readonly logger = new Logger(BillingService.name);

  constructor(
    private readonly subscriptions: SubscriptionRepository,
    private readonly payments: PaymentRepository,
    private readonly gateway: PaymentGateway,
    private readonly clock: Clock,
  ) {}

  async runBillingCycle(): Promise<BillingRunReport> {
    const runAt = this.clock.now();
    const due = await this.subscriptions.findDueForRenewal(runAt);

    this.logger.log(`Billing run at ${runAt.toISOString()}: ${due.length} subscription(s) due`);

    const outcomes: RenewalOutcome[] = [];
    for (const subscription of due) {
      outcomes.push(await this.renewOne(subscription));
    }

    const expired = await this.expireLapsed(runAt);

    return {
      runAt,
      processed: outcomes.length,
      renewed: outcomes.filter((outcome) => outcome.result === 'RENEWED').length,
      failed: outcomes.filter((outcome) => outcome.result === 'PAYMENT_FAILED').length,
      expired,
      outcomes,
    };
  }

  /**
   * Charges one bundle and applies the result.
   *
   * Success rolls the period forward and resets the period's message counter.
   * A decline marks the bundle INACTIVE — it stops serving immediately and is
   * not retried, and the reason is kept on the record and in payment history.
   */
  private async renewOne(subscription: Subscription): Promise<RenewalOutcome> {
    const charge = await this.gateway.charge({
      userId: subscription.userId,
      subscriptionId: subscription.id,
      amountCents: subscription.priceCents,
      description: `${subscription.tier} bundle renewal (${subscription.billingCycle})`,
    });

    await this.payments.record({
      subscriptionId: subscription.id,
      userId: subscription.userId,
      kind: PaymentKind.RENEWAL,
      status: charge.outcome === 'SUCCEEDED' ? PaymentStatus.SUCCEEDED : PaymentStatus.FAILED,
      amountCents: subscription.priceCents,
      failureReason: charge.outcome === 'FAILED' ? charge.reason : null,
    });

    return charge.outcome === 'FAILED'
      ? this.applyDecline(subscription, charge.reason)
      : this.applyRenewal(subscription);
  }

  /**
   * A decline stops the bundle serving immediately and is not retried. The
   * reason stays on the record so support can explain it without digging
   * through payment history.
   */
  private async applyDecline(subscription: Subscription, reason: string): Promise<RenewalOutcome> {
    subscription.status = SubscriptionStatus.INACTIVE;
    subscription.renewalDate = null;
    subscription.lastPaymentFailureReason = reason;
    await this.subscriptions.save(subscription);

    this.logger.warn(`Bundle ${subscription.id} marked INACTIVE: payment ${reason}`);
    return {
      subscriptionId: subscription.id,
      userId: subscription.userId,
      tier: subscription.tier,
      result: 'PAYMENT_FAILED',
      reason,
    };
  }

  /** Rolls the period forward and starts the new period's quota at zero. */
  private async applyRenewal(subscription: Subscription): Promise<RenewalOutcome> {
    // The new period starts where the old one ended, so repeated renewals never
    // drift away from the original anniversary date.
    const previousEnd = subscription.endDate;
    subscription.startDate = previousEnd;
    subscription.endDate = addBillingCycle(previousEnd, subscription.billingCycle);
    subscription.renewalDate = subscription.endDate;
    subscription.messagesUsed = 0;
    subscription.renewalCount += 1;
    subscription.lastPaymentFailureReason = null;
    await this.subscriptions.save(subscription);

    this.logger.log(
      `Bundle ${subscription.id} renewed through ${subscription.endDate.toISOString()}`,
    );
    return {
      subscriptionId: subscription.id,
      userId: subscription.userId,
      tier: subscription.tier,
      result: 'RENEWED',
      nextEndDate: subscription.endDate,
    };
  }

  /** Retires bundles that ran past their paid period without renewing. */
  private async expireLapsed(now: Date): Promise<number> {
    const lapsed = await this.subscriptions.findLapsed(now);
    if (lapsed.length === 0) return 0;

    const count = await this.subscriptions.markExpired(lapsed.map((s) => s.id));
    this.logger.log(`Expired ${count} lapsed subscription(s)`);
    return count;
  }
}
