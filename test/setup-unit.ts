import { Logger } from '@nestjs/common';

/**
 * Several tests deliberately drive failure paths that log at warn/error level.
 * Silencing Nest's logger keeps that expected noise out of the test report —
 * a red stack trace in a passing suite trains people to ignore real ones.
 */
Logger.overrideLogger(false);
