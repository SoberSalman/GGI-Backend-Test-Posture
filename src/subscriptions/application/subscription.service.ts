import { Injectable, Logger } from '@nestjs/common';
import { Clock } from '../../shared/time/clock';
import { addMonthsUtc, addYearsUtc } from '../../shared/time/billing-period';
import {
  BillingCycle,
  BundleTier,
  SubscriptionStatus,
  tierDefinition,
} from '../domain/bundle-tier';
import { Payment, PaymentKind, PaymentStatus } from '../domain/payment.entity';
import { Subscription } from '../domain/subscription.entity';
import {
  InvalidSubscriptionStateError,
  SubscriptionAccessDeniedError,
  SubscriptionNotFoundError,
} from '../domain/subscription.errors';
import { PaymentRepository } from '../infrastructure/payment.repository';
import { SubscriptionRepository } from '../infrastructure/subscription.repository';

export interface CreateSubscriptionCommand {
  userId: string;
  tier: BundleTier;
  billingCycle: BillingCycle;
  autoRenew: boolean;
}

/** Lifecycle of a subscription bundle: purchase, auto-renew toggle, cancel. */
@Injectable()
export class SubscriptionService {
  private readonly logger = new Logger(SubscriptionService.name);

  constructor(
    private readonly subscriptions: SubscriptionRepository,
    private readonly payments: PaymentRepository,
    private readonly clock: Clock,
  ) {}

  /**
   * Purchases a bundle.
   *
   * The initial charge always succeeds — random payment failure is scoped to
   * auto-renewal (per the brief), which keeps setting up test data
   * deterministic. The charge is still recorded so billing history is complete.
   */
  async create(command: CreateSubscriptionCommand): Promise<Subscription> {
    const now = this.clock.now();
    const definition = tierDefinition(command.tier);
    const endDate = addBillingCycle(now, command.billingCycle);

    const subscription = await this.subscriptions.save(
      this.subscriptions.create({
        userId: command.userId,
        tier: command.tier,
        billingCycle: command.billingCycle,
        status: SubscriptionStatus.ACTIVE,
        maxMessages: definition.maxMessages,
        messagesUsed: 0,
        priceCents: definition.priceCents[command.billingCycle],
        autoRenew: command.autoRenew,
        startDate: now,
        endDate,
        renewalDate: command.autoRenew ? endDate : null,
        cancelledAt: null,
        renewalCount: 0,
        lastPaymentFailureReason: null,
      }),
    );

    await this.payments.record({
      subscriptionId: subscription.id,
      userId: command.userId,
      kind: PaymentKind.INITIAL,
      status: PaymentStatus.SUCCEEDED,
      amountCents: subscription.priceCents,
    });

    this.logger.log(
      `User ${command.userId} subscribed to ${command.tier} (${command.billingCycle}), ` +
        `bundle ${subscription.id}`,
    );
    return subscription;
  }

  async listForUser(userId: string): Promise<Subscription[]> {
    return this.subscriptions.findAllForUser(userId);
  }

  async getOwned(subscriptionId: string, userId: string): Promise<Subscription> {
    const subscription = await this.subscriptions.findById(subscriptionId);
    if (!subscription) throw new SubscriptionNotFoundError(subscriptionId);
    if (subscription.userId !== userId) throw new SubscriptionAccessDeniedError(subscriptionId);
    return subscription;
  }

  async paymentHistory(subscriptionId: string, userId: string): Promise<Payment[]> {
    await this.getOwned(subscriptionId, userId);
    return this.payments.findForSubscription(subscriptionId);
  }

  /**
   * Turns auto-renew on or off. Switching it on re-arms the renewal date to the
   * end of the current period; switching it off clears it.
   */
  async setAutoRenew(
    subscriptionId: string,
    userId: string,
    autoRenew: boolean,
  ): Promise<Subscription> {
    const subscription = await this.getOwned(subscriptionId, userId);

    if (subscription.status !== SubscriptionStatus.ACTIVE) {
      throw new InvalidSubscriptionStateError(
        subscriptionId,
        subscription.status,
        'change auto-renew on',
      );
    }

    subscription.autoRenew = autoRenew;
    subscription.renewalDate = autoRenew ? subscription.endDate : null;
    return this.subscriptions.save(subscription);
  }

  /**
   * Cancels a bundle.
   *
   * The user keeps what they paid for: the bundle stays servable until
   * `endDate`, renewal is disarmed, and no usage or payment history is touched.
   * The expiry sweep flips it to EXPIRED once the period closes.
   */
  async cancel(subscriptionId: string, userId: string): Promise<Subscription> {
    const subscription = await this.getOwned(subscriptionId, userId);

    if (subscription.status !== SubscriptionStatus.ACTIVE) {
      throw new InvalidSubscriptionStateError(subscriptionId, subscription.status, 'cancel');
    }

    subscription.status = SubscriptionStatus.CANCELLED;
    subscription.autoRenew = false;
    subscription.renewalDate = null;
    subscription.cancelledAt = this.clock.now();

    this.logger.log(
      `Bundle ${subscriptionId} cancelled; remains usable until ${subscription.endDate.toISOString()}`,
    );
    return this.subscriptions.save(subscription);
  }
}

/** Advances a date by one billing cycle. */
export function addBillingCycle(from: Date, cycle: BillingCycle): Date {
  return cycle === BillingCycle.YEARLY ? addYearsUtc(from, 1) : addMonthsUtc(from, 1);
}
