import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { BillingService } from '../application/billing.service';

/**
 * Runs the billing cycle nightly.
 *
 * ponytail: single-process cron. Running more than one instance would double
 * charge — move to a queue with a distributed lock (BullMQ / pg advisory lock)
 * before scaling out.
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
      // A crash here must not take the scheduler down — the next run retries.
      this.logger.error('Nightly billing run failed', error instanceof Error ? error.stack : error);
    }
  }
}
