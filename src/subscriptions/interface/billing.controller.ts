import { Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ADMIN_KEY_HEADER, AdminGuard } from '../../shared/auth/admin.guard';
import { BillingService } from '../application/billing.service';

/**
 * Operational trigger for the billing cycle.
 *
 * The same run happens nightly on a cron; this endpoint exists so a reviewer
 * can watch renewals and random payment failures without waiting for it.
 */
@ApiTags('billing')
@ApiHeader({ name: ADMIN_KEY_HEADER, description: 'Administrative key', required: false })
@Controller('billing')
@UseGuards(AdminGuard)
export class BillingController {
  constructor(private readonly billing: BillingService) {}

  @Post('run')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Run the billing cycle now: charge due renewals, expire lapsed bundles',
  })
  async run() {
    const report = await this.billing.runBillingCycle();
    return {
      ...report,
      runAt: report.runAt.toISOString(),
      outcomes: report.outcomes.map((outcome) => ({
        ...outcome,
        nextEndDate: outcome.nextEndDate?.toISOString() ?? null,
      })),
    };
  }
}
