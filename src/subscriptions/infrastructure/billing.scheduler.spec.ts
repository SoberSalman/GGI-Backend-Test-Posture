import { ConfigService } from '@nestjs/config';
import { BillingService } from '../application/billing.service';
import { BillingScheduler } from './billing.scheduler';

function schedulerWith(enabled: boolean, billing: Partial<BillingService>): BillingScheduler {
  return new BillingScheduler(
    billing as BillingService,
    {
      get: () => enabled,
    } as unknown as ConfigService,
  );
}

describe('BillingScheduler', () => {
  it('runs the cycle when scheduling is enabled', async () => {
    const runBillingCycle = jest.fn().mockResolvedValue({ renewed: 1, failed: 0, expired: 2 });

    await schedulerWith(true, { runBillingCycle }).handleNightlyBilling();

    expect(runBillingCycle).toHaveBeenCalledTimes(1);
  });

  it('does nothing when scheduling is disabled', async () => {
    // An inverted check here would silently bill everyone in an environment
    // that had explicitly opted out, or stop billing in one that had not.
    const runBillingCycle = jest.fn();

    await schedulerWith(false, { runBillingCycle }).handleNightlyBilling();

    expect(runBillingCycle).not.toHaveBeenCalled();
  });

  it('swallows a failed run so the schedule survives to the next night', async () => {
    const runBillingCycle = jest.fn().mockRejectedValue(new Error('database unreachable'));

    await expect(
      schedulerWith(true, { runBillingCycle }).handleNightlyBilling(),
    ).resolves.toBeUndefined();
  });
});
