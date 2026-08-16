import { Subscription } from './subscription.entity';

/**
 * Decides which of a user's bundles pays for the next response.
 *
 * The brief says to "deduct usage from the bundle with the latest remaining
 * quota", which we read as **the bundle with the most quota left**. Two
 * refinements make that rule safe in practice:
 *
 * 1. Finite bundles are drained before unlimited ones. An Enterprise bundle has
 *    infinite remaining quota, so a naive "most remaining wins" comparison would
 *    always pick it and let every paid-for Basic/Pro response expire unused.
 * 2. Ties break on the earlier `endDate`: spend what expires soonest first.
 *
 */
export function selectBundleToCharge(
  candidates: readonly Subscription[],
  now: Date,
): Subscription | null {
  const servable = candidates.filter((subscription) => subscription.canServe(now));
  if (servable.length === 0) return null;

  return [...servable].sort(compareByChargePriority)[0];
}

function compareByChargePriority(a: Subscription, b: Subscription): number {
  // 1. Finite quota before unlimited.
  if (a.isUnlimited !== b.isUnlimited) return a.isUnlimited ? 1 : -1;

  // 2. Most remaining quota first.
  const byRemaining = b.remainingMessages - a.remainingMessages;
  if (byRemaining !== 0 && Number.isFinite(byRemaining)) return byRemaining;

  // 3. Soonest to expire first.
  const byExpiry = a.endDate.getTime() - b.endDate.getTime();
  if (byExpiry !== 0) return byExpiry;

  // 4. Stable final tiebreak so selection is deterministic across calls.
  return a.id.localeCompare(b.id);
}
