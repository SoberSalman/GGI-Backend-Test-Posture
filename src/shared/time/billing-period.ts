/**
 * Calendar helpers shared by the free-quota reset and the subscription billing
 * cycle. All arithmetic is done in UTC so behaviour does not drift with the
 * server's local timezone.
 */

export function startOfMonthUtc(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1, 0, 0, 0, 0));
}

/**
 * `YYYY-MM` key identifying the calendar month of `date`.
 * Used as the free-quota period marker.
 */
export function monthKey(date: Date): string {
  const month = `${date.getUTCMonth() + 1}`.padStart(2, '0');
  return `${date.getUTCFullYear()}-${month}`;
}

/** Midnight UTC on the 1st of the following month. */
export function startOfNextMonthUtc(date: Date): Date {
  return addMonthsUtc(startOfMonthUtc(date), 1);
}

/**
 * Adds whole months, clamping the day-of-month to the last valid day of the
 * target month. Jan 31 + 1 month is Feb 28 (or Feb 29 in a leap year), which is
 * the behaviour every real billing system uses; plain `setMonth` would roll
 * over into March instead.
 */
export function addMonthsUtc(date: Date, months: number): Date {
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth() + months;
  const day = date.getUTCDate();

  const lastDayOfTargetMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();

  return new Date(
    Date.UTC(
      year,
      month,
      Math.min(day, lastDayOfTargetMonth),
      date.getUTCHours(),
      date.getUTCMinutes(),
      date.getUTCSeconds(),
      date.getUTCMilliseconds(),
    ),
  );
}

/** Adds whole years, with the same end-of-month clamping as `addMonthsUtc`. */
export function addYearsUtc(date: Date, years: number): Date {
  return addMonthsUtc(date, years * 12);
}
