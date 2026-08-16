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

  /** The initial charge always succeeds; random failure is scoped to renewals. */
  async create(command: CreateSubscriptionCommand): Promise<Subscription> {
    const now = this.clock.now();
    const definition = tierDefinition(command.tier);
    const endDate = addBillingCycle(now, command.billingCycle);

    const subscription = await this.subscriptions.insert({
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
    });

    await this.payments.record({
      subscriptionId: subscription.id,
      userId: command.userId,
      kind: PaymentKind.INITIAL,
      status: PaymentStatus.SUCCEEDED,
      amountCents: subscription.priceCents,
      failureReason: null,
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

  /** Switching auto-renew on re-arms the renewal date to the end of the period. */
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

    await this.subscriptions.applyAutoRenew(
      subscriptionId,
      autoRenew,
      autoRenew ? subscription.endDate : null,
    );
    return this.getOwned(subscriptionId, userId);
  }

  /**
   * The user keeps what they paid for: the bundle stays servable until
   * `endDate` and no usage or payment history is touched. The expiry sweep
   * flips it to EXPIRED once the period closes.
   */
  async cancel(subscriptionId: string, userId: string): Promise<Subscription> {
    const subscription = await this.getOwned(subscriptionId, userId);

    if (subscription.status !== SubscriptionStatus.ACTIVE) {
      throw new InvalidSubscriptionStateError(subscriptionId, subscription.status, 'cancel');
    }

    await this.subscriptions.applyCancellation(subscriptionId, this.clock.now());

    this.logger.log(
      `Bundle ${subscriptionId} cancelled; usable until ${subscription.endDate.toISOString()}`,
    );
    return this.getOwned(subscriptionId, userId);
  }
}

export function addBillingCycle(from: Date, cycle: BillingCycle): Date {
  return cycle === BillingCycle.YEARLY ? addYearsUtc(from, 1) : addMonthsUtc(from, 1);
}
