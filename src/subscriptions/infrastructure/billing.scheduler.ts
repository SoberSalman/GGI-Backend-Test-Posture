import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { BillingService } from '../application/billing.service';

/**
 * Runs the billing cycle nightly.
 *
 * Single-process cron. Two instances would both fire, though the renewal
 * path's SKIP LOCKED claim and dueness re-check make that safe rather than
 * double-charging; a proper job queue is still the right answer at scale.
 */
@Injectable()
export class BillingScheduler {
  private readonly logger = new Logger(BillingScheduler.name);
  private readonly enabled: boolean;

  constructor(
    private readonly billing: BillingService,
    config: ConfigService,
  ) {
    this.enabled = config.get<boolean>('enableScheduledJobs', true);
  }

  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT, { name: 'billing-cycle' })
  async handleNightlyBilling(): Promise<void> {
    if (!this.enabled) return;

    try {
      const report = await this.billing.runBillingCycle();
      this.logger.log(
        `Nightly billing: ${report.renewed} renewed, ${report.failed} failed, ` +
          `${report.expired} expired`,
      );
    } catch (error) {
      // A crash here must not take the scheduler down, the next run retries.
      this.logger.error('Nightly billing run failed', error instanceof Error ? error.stack : error);
    }
  }
}
