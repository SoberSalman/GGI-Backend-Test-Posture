import { Injectable } from '@nestjs/common';

/**
 * Every date-sensitive rule reads "now" through this, so tests can travel
 * through time without touching the system clock.
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

/** Test double: frozen at an instant, advanced by hand. */
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
