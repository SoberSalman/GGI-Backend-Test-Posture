import { Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ADMIN_KEY_HEADER, AdminGuard } from '../../shared/auth/admin.guard';
import { QuotaService } from '../application/quota.service';

/**
 * Operational trigger for the monthly free-quota reset.
 *
 * The reset also happens on a cron at 00:05 UTC on the 1st, and reads are
 * period-aware regardless, so this endpoint just makes the job observable
 * without waiting for a month boundary. It rewrites every user's counter, so it
 * is admin-gated.
 */
@ApiTags('billing')
@ApiHeader({ name: ADMIN_KEY_HEADER, description: 'Administrative key', required: false })
@Controller('billing')
@UseGuards(AdminGuard)
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
