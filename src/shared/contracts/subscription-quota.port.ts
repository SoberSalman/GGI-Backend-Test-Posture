import { EntityManager } from 'typeorm';

/**
 * Contract between the chat module and the subscriptions module.
 *
 * Chat must never reach into subscription tables itself — it only needs to
 * reserve a response and, if the AI call blows up, hand it back. Both modules
 * depend on this shared contract rather than on each other, so neither owns the
 * other's schema and there is no module cycle.
 */
export abstract class SubscriptionQuotaPort {
  /**
   * Reserves one response from the caller's best-suited bundle.
   *
   * Runs inside the caller's transaction and takes a row lock, so concurrent
   * requests cannot both spend the same last response.
   *
   * @returns the reservation, or `null` when no bundle can serve.
   */
  abstract reserveOne(
    userId: string,
    now: Date,
    manager: EntityManager,
  ): Promise<BundleReservation | null>;

  /** Returns a reserved response after a downstream failure. */
  abstract releaseOne(subscriptionId: string, manager?: EntityManager): Promise<void>;

  /** Read-only snapshot of the caller's usable bundles, for quota reporting. */
  abstract describeUsableBundles(userId: string, now: Date): Promise<BundleQuotaSnapshot[]>;
}

export interface BundleReservation {
  subscriptionId: string;
  tier: string;
  /** Responses left after this reservation. `null` for unlimited tiers. */
  remainingAfter: number | null;
}

export interface BundleQuotaSnapshot {
  subscriptionId: string;
  tier: string;
  status: string;
  /** `null` for unlimited tiers. */
  maxMessages: number | null;
  messagesUsed: number;
  /** `null` for unlimited tiers. */
  remainingMessages: number | null;
  endDate: Date;
}
