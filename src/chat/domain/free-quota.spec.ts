import { FreeQuota } from './free-quota.entity';

const ALLOWANCE = 3;
const AUGUST = new Date('2026-08-16T12:00:00Z');
const SEPTEMBER = new Date('2026-09-01T00:00:00Z');

function quota(periodKey: string, messagesUsed: number): FreeQuota {
  return Object.assign(new FreeQuota(), { periodKey, messagesUsed });
}

describe('FreeQuota', () => {
  it('reports usage inside its own period', () => {
    const august = quota('2026-08', 2);

    expect(august.usedIn(AUGUST)).toBe(2);
    expect(august.remainingIn(AUGUST, ALLOWANCE)).toBe(1);
  });

  it('reads a previous month as zero used — this is the monthly reset', () => {
    const stale = quota('2026-07', ALLOWANCE);

    expect(stale.isStale(AUGUST)).toBe(true);
    expect(stale.usedIn(AUGUST)).toBe(0);
    expect(stale.remainingIn(AUGUST, ALLOWANCE)).toBe(ALLOWANCE);
  });

  it('rolls a stale counter into the current month on first use', () => {
    const stale = quota('2026-07', ALLOWANCE);

    stale.consume(AUGUST);

    expect(stale.periodKey).toBe('2026-08');
    expect(stale.messagesUsed).toBe(1);
  });

  it('increments within the current month', () => {
    const august = quota('2026-08', 1);

    august.consume(AUGUST);

    expect(august.periodKey).toBe('2026-08');
    expect(august.messagesUsed).toBe(2);
  });

  it('never reports negative remaining once the allowance is exceeded', () => {
    const overspent = quota('2026-08', ALLOWANCE + 5);
    expect(overspent.remainingIn(AUGUST, ALLOWANCE)).toBe(0);
  });

  it('refunds a message without dropping below zero', () => {
    const august = quota('2026-08', 1);

    august.release();
    august.release();

    expect(august.messagesUsed).toBe(0);
  });

  it('hands back the full allowance the moment the month turns over', () => {
    const spent = quota('2026-08', ALLOWANCE);

    expect(spent.remainingIn(AUGUST, ALLOWANCE)).toBe(0);
    expect(spent.remainingIn(SEPTEMBER, ALLOWANCE)).toBe(ALLOWANCE);
  });
});
