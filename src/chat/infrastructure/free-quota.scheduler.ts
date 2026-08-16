import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { QuotaService } from '../application/quota.service';

/** 00:05 UTC on the 1st of every month. */
const FIRST_OF_MONTH_UTC = '5 0 1 * *';

/**
 * Resets the free monthly allowance.
 *
 * A safety net rather than the source of truth: `FreeQuota` compares its stored
 * period against the current month on every read, so a missed run cannot hand a
 * user a stale allowance.
 */
@Injectable()
export class FreeQuotaScheduler {
  private readonly logger = new Logger(FreeQuotaScheduler.name);
  private readonly enabled: boolean;

  constructor(
    private readonly quota: QuotaService,
    config: ConfigService,
  ) {
    this.enabled = config.get<boolean>('enableScheduledJobs', true);
  }

  @Cron(FIRST_OF_MONTH_UTC, { name: 'free-quota-reset', timeZone: 'UTC' })
  async handleMonthlyReset(): Promise<void> {
    if (!this.enabled) return;

    try {
      const { rowsReset } = await this.quota.resetFreeQuotas();
      this.logger.log(`Monthly free quota reset complete: ${rowsReset} user(s)`);
    } catch (error) {
      this.logger.error(
        'Monthly free quota reset failed',
        error instanceof Error ? error.stack : error,
      );
    }
  }
}
