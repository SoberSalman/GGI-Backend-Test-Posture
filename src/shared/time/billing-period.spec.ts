import { addMonthsUtc, addYearsUtc, monthKey, startOfMonthUtc } from './billing-period';

describe('billing period helpers', () => {
  describe('monthKey', () => {
    it('formats the month as zero-padded YYYY-MM', () => {
      expect(monthKey(new Date('2026-03-15T10:00:00Z'))).toBe('2026-03');
      expect(monthKey(new Date('2026-11-01T00:00:00Z'))).toBe('2026-11');
    });

    it('uses UTC, not the local timezone', () => {
      // 23:30 on 31 Jan UTC is already February in UTC+2, must still read as January.
      expect(monthKey(new Date('2026-01-31T23:30:00Z'))).toBe('2026-01');
    });
  });

  describe('startOfMonthUtc', () => {
    it('returns midnight on the 1st', () => {
      expect(startOfMonthUtc(new Date('2026-08-16T13:45:12Z')).toISOString()).toBe(
        '2026-08-01T00:00:00.000Z',
      );
    });
  });

  describe('addMonthsUtc', () => {
    it('advances by whole months', () => {
      expect(addMonthsUtc(new Date('2026-01-15T08:00:00Z'), 1).toISOString()).toBe(
        '2026-02-15T08:00:00.000Z',
      );
    });

    it('clamps to the last valid day instead of overflowing', () => {
      // Jan 31 + 1 month must be Feb 28, not Mar 3.
      expect(addMonthsUtc(new Date('2026-01-31T00:00:00Z'), 1).toISOString()).toBe(
        '2026-02-28T00:00:00.000Z',
      );
    });

    it('clamps to 29 February in a leap year', () => {
      expect(addMonthsUtc(new Date('2028-01-31T00:00:00Z'), 1).toISOString()).toBe(
        '2028-02-29T00:00:00.000Z',
      );
    });

    it('rolls over the year boundary', () => {
      expect(addMonthsUtc(new Date('2026-12-10T00:00:00Z'), 1).toISOString()).toBe(
        '2027-01-10T00:00:00.000Z',
      );
    });
  });

  describe('addYearsUtc', () => {
    it('advances by whole years', () => {
      expect(addYearsUtc(new Date('2026-08-16T00:00:00Z'), 1).toISOString()).toBe(
        '2027-08-16T00:00:00.000Z',
      );
    });

    it('clamps 29 February onto a non-leap year', () => {
      expect(addYearsUtc(new Date('2028-02-29T00:00:00Z'), 1).toISOString()).toBe(
        '2029-02-28T00:00:00.000Z',
      );
    });
  });
});
