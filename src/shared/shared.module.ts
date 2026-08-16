import { Global, Module } from '@nestjs/common';
import { Clock, SystemClock } from './time/clock';

/**
 * Cross-cutting providers every module may inject.
 *
 * Global so `Clock` resolves the same instance everywhere — an integration test
 * swaps in a `FixedClock` once and the whole app travels through time together.
 */
@Global()
@Module({
  providers: [{ provide: Clock, useClass: SystemClock }],
  exports: [Clock],
})
export class SharedModule {}
