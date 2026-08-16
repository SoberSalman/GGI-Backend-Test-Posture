import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import {
  BundleQuotaSnapshot,
  SubscriptionQuotaPort,
} from '../../shared/contracts/subscription-quota.port';
import { startOfMonthUtc, startOfNextMonthUtc } from '../../shared/time/billing-period';
import { Clock } from '../../shared/time/clock';
import { QuotaSource } from '../domain/chat-message.entity';
import { QuotaExceededError } from '../domain/chat.errors';
import { FreeQuotaRepository } from '../infrastructure/free-quota.repository';

/**
 * A response held for the caller, pending a successful AI call.
 *
 * A union rather than one shape with nullable fields: which identifier applies
 * depends on which allowance paid, and the refund path needs exactly one of
 * them. Optional fields would leave every consumer to remember that.
 */
export type QuotaReservation =
  | {
      source: QuotaSource.FREE_TIER;
      /** Month it came from, so a late refund cannot cross into the next one. */
      periodKey: string;
      remainingAfter: number;
    }
  | {
      source: QuotaSource.SUBSCRIPTION;
      subscriptionId: string;
      /** `null` for unlimited tiers. */
      remainingAfter: number | null;
    };

export interface QuotaSummary {
  free: {
    allowance: number;
    used: number;
    remaining: number;
    periodStart: string;
    resetsAt: string;
  };
  bundles: BundleQuotaSnapshot[];
  /** Responses available right now, across free tier and every usable bundle. */
  totalRemaining: number | null;
}

/**
 * Decides who pays for the next response and holds it.
 *
 * Free tier first: never burn paid quota while free messages remain.
 */
@Injectable()
export class QuotaService {
  private readonly logger = new Logger(QuotaService.name);
  private readonly freeAllowance: number;

  constructor(
    private readonly freeQuotas: FreeQuotaRepository,
    private readonly bundles: SubscriptionQuotaPort,
    private readonly dataSource: DataSource,
    private readonly clock: Clock,
    config: ConfigService,
  ) {
    this.freeAllowance = config.get<number>('freeMessagesPerMonth', 3);
  }

  /**
   * Reserves one response, or throws `QuotaExceededError`.
   *
   * Read-check-increment runs in one transaction under row locks, so two
   * concurrent requests can never both spend the last response. Reserving
   * before the slow AI call is deliberate: an answer nobody paid for is worse
   * than one that has to be refunded.
   */
  async reserve(userId: string): Promise<QuotaReservation> {
    const now = this.clock.now();

    return this.dataSource.transaction(async (manager) => {
      const freeQuota = await this.freeQuotas.findOrCreateLocked(userId, now, manager);

      if (freeQuota.remainingIn(now, this.freeAllowance) > 0) {
        freeQuota.consume(now);
        await this.freeQuotas.save(freeQuota, manager);

        const remaining = this.freeAllowance - freeQuota.messagesUsed;
        this.logger.log(`User ${userId} used a free message (${remaining} left this month)`);
        return {
          source: QuotaSource.FREE_TIER,
          periodKey: freeQuota.periodKey,
          remainingAfter: remaining,
        };
      }

      const reservation = await this.bundles.reserveOne(userId, now, manager);
      if (reservation) {
        return {
          source: QuotaSource.SUBSCRIPTION,
          subscriptionId: reservation.subscriptionId,
          remainingAfter: reservation.remainingAfter,
        };
      }

      throw new QuotaExceededError({
        freeMessagesAllowance: this.freeAllowance,
        freeMessagesUsed: freeQuota.usedIn(now),
        freeMessagesRemaining: 0,
        activeBundles: (await this.bundles.describeUsableBundles(userId, now)).length,
        freeQuotaResetsAt: startOfNextMonthUtc(now).toISOString(),
      });
    });
  }

  /**
   * Hands a reservation back after a failed AI call.
   *
   * Best-effort: a failure to refund is logged, never rethrown, because the
   * caller is already handling the original provider error.
   */
  async release(userId: string, reservation: QuotaReservation): Promise<void> {
    try {
      if (reservation.source === QuotaSource.SUBSCRIPTION) {
        await this.bundles.releaseOne(reservation.subscriptionId);
        return;
      }

      if (await this.freeQuotas.refundOne(userId, reservation.periodKey)) {
        this.logger.warn(`Released 1 free message back to user ${userId}`);
        return;
      }

      // Either the counter rolled into a new month, so the allowance this
      // message came out of no longer exists, or the row is gone, which should
      // be impossible because reserve created it.
      this.logger.warn(
        `No free message refunded to user ${userId}: no counter for ${reservation.periodKey}`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to release reserved quota for user ${userId}`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  async summarise(userId: string): Promise<QuotaSummary> {
    const now = this.clock.now();
    const freeQuota = await this.freeQuotas.findForUser(userId);
    const used = freeQuota?.usedIn(now) ?? 0;
    const freeRemaining = Math.max(0, this.freeAllowance - used);
    const bundles = await this.bundles.describeUsableBundles(userId, now);

    const hasUnlimited = bundles.some((bundle) => bundle.remainingMessages === null);
    const bundleRemaining = bundles.reduce(
      (sum, bundle) => sum + (bundle.remainingMessages ?? 0),
      0,
    );

    return {
      free: {
        allowance: this.freeAllowance,
        used,
        remaining: freeRemaining,
        periodStart: startOfMonthUtc(now).toISOString(),
        resetsAt: startOfNextMonthUtc(now).toISOString(),
      },
      bundles,
      totalRemaining: hasUnlimited ? null : freeRemaining + bundleRemaining,
    };
  }

  async resetFreeQuotas(): Promise<{ resetAt: Date; rowsReset: number }> {
    const resetAt = this.clock.now();
    const rowsReset = await this.freeQuotas.resetStale(resetAt);
    this.logger.log(`Free quota reset: ${rowsReset} counter(s) rolled into the current month`);
    return { resetAt, rowsReset };
  }
}
