import { ConfigService } from '@nestjs/config';
import { QuotaService } from '../application/quota.service';
import { FreeQuotaScheduler } from './free-quota.scheduler';

function schedulerWith(enabled: boolean, quota: Partial<QuotaService>): FreeQuotaScheduler {
  return new FreeQuotaScheduler(
    quota as QuotaService,
    {
      get: () => enabled,
    } as unknown as ConfigService,
  );
}

describe('FreeQuotaScheduler', () => {
  it('resets stale counters when scheduling is enabled', async () => {
    const resetFreeQuotas = jest.fn().mockResolvedValue({ resetAt: new Date(), rowsReset: 12 });

    await schedulerWith(true, { resetFreeQuotas }).handleMonthlyReset();

    expect(resetFreeQuotas).toHaveBeenCalledTimes(1);
  });

  it('does nothing when scheduling is disabled', async () => {
    const resetFreeQuotas = jest.fn();

    await schedulerWith(false, { resetFreeQuotas }).handleMonthlyReset();

    expect(resetFreeQuotas).not.toHaveBeenCalled();
  });

  it('swallows a failed reset, which cannot hand out a stale allowance anyway', async () => {
    // Reads compare the stored period against the current month, so a missed
    // run is housekeeping debt, not a correctness problem.
    const resetFreeQuotas = jest.fn().mockRejectedValue(new Error('database unreachable'));

    await expect(
      schedulerWith(true, { resetFreeQuotas }).handleMonthlyReset(),
    ).resolves.toBeUndefined();
  });
});
