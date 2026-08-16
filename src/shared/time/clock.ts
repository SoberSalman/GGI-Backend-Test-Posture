import { Injectable } from '@nestjs/common';

/**
 * Injectable source of "now".
 *
 * Every date-sensitive rule in this codebase (monthly free-quota resets,
 * subscription expiry, renewal windows) reads the current time through this
 * port so tests can travel through time without touching the system clock.
 */
export abstract class Clock {
  abstract now(): Date;
}

@Injectable()
export class SystemClock extends Clock {
  now(): Date {
    return new Date();
  }
}

/** Test double: a clock frozen at, and manually advanced from, a fixed instant. */
export class FixedClock extends Clock {
  constructor(private current: Date) {
    super();
  }

  now(): Date {
    return new Date(this.current);
  }

  setTo(date: Date): void {
    this.current = new Date(date);
  }
}
