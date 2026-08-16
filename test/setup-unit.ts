import { Logger } from '@nestjs/common';

/**
 * Several tests deliberately drive failure paths that log at warn/error level.
 * Silencing Nest's logger keeps that noise out of the report; a red stack
 * trace in a passing suite trains people to ignore the real ones.
 */
Logger.overrideLogger(false);
