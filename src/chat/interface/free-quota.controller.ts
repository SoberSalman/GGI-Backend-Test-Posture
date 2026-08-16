import { Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUserGuard, USER_ID_HEADER } from '../../shared/auth/current-user.guard';
import { QuotaService } from '../application/quota.service';

/**
 * Operational trigger for the monthly free-quota reset.
 *
 * The reset also happens on a cron at 00:05 UTC on the 1st, and reads are
 * period-aware regardless — this endpoint just makes the job observable without
 * waiting for a month boundary.
 */
@ApiTags('billing')
@ApiHeader({ name: USER_ID_HEADER, description: 'Id of the calling user', required: true })
@Controller('billing')
@UseGuards(CurrentUserGuard)
export class FreeQuotaController {
  constructor(private readonly quota: QuotaService) {}

  @Post('reset-free-quota')
  @HttpCode(200)
  @ApiOperation({ summary: 'Roll every stale free-message counter into the current month' })
  async reset() {
    const { resetAt, rowsReset } = await this.quota.resetFreeQuotas();
    return { resetAt: resetAt.toISOString(), rowsReset };
  }
}
