import { Payment } from '../domain/payment.entity';
import { Subscription } from '../domain/subscription.entity';

/**
 * Shapes aggregates for the wire.
 *
 * Entities are never returned directly: money is stored in cents and exposed as
 * a decimal string, and unlimited quota is expressed as `null` rather than
 * leaking `Infinity` (which is not valid JSON).
 */
export interface SubscriptionView {
  id: string;
  tier: string;
  billingCycle: string;
  status: string;
  maxMessages: number | null;
  messagesUsed: number;
  remainingMessages: number | null;
  unlimited: boolean;
  price: string;
  priceCents: number;
  autoRenew: boolean;
  startDate: string;
  endDate: string;
  renewalDate: string | null;
  cancelledAt: string | null;
  renewalCount: number;
  lastPaymentFailureReason: string | null;
  createdAt: string;
}

export function toSubscriptionView(subscription: Subscription): SubscriptionView {
  return {
    id: subscription.id,
    tier: subscription.tier,
    billingCycle: subscription.billingCycle,
    status: subscription.status,
    maxMessages: subscription.maxMessages,
    messagesUsed: subscription.messagesUsed,
    remainingMessages: subscription.isUnlimited ? null : subscription.remainingMessages,
    unlimited: subscription.isUnlimited,
    price: formatCents(subscription.priceCents),
    priceCents: subscription.priceCents,
    autoRenew: subscription.autoRenew,
    startDate: subscription.startDate.toISOString(),
    endDate: subscription.endDate.toISOString(),
    renewalDate: subscription.renewalDate?.toISOString() ?? null,
    cancelledAt: subscription.cancelledAt?.toISOString() ?? null,
    renewalCount: subscription.renewalCount,
    lastPaymentFailureReason: subscription.lastPaymentFailureReason,
    createdAt: subscription.createdAt.toISOString(),
  };
}

export function toPaymentView(payment: Payment) {
  return {
    id: payment.id,
    subscriptionId: payment.subscriptionId,
    kind: payment.kind,
    status: payment.status,
    amount: formatCents(payment.amountCents),
    amountCents: payment.amountCents,
    failureReason: payment.failureReason,
    createdAt: payment.createdAt.toISOString(),
  };
}

export function formatCents(cents: number): string {
  return (cents / 100).toFixed(2);
}
