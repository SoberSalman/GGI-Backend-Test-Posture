import 'dotenv/config';

/**
 * Environment for the e2e suite. Runs before any application module is
 * imported, so `configuration()` picks these up.
 *
 * The suite talks to a dedicated database on the same Postgres instance as the
 * dev stack, `test/global-setup-e2e.ts` creates it and applies the migrations.
 */
process.env.NODE_ENV = 'test';
process.env.DB_NAME = process.env.E2E_DB_NAME ?? 'ggi_assessment_e2e';
process.env.DB_LOGGING = 'false';

// Keep the mocked provider fast so the suite is not dominated by fake latency.
process.env.MOCK_AI_MIN_DELAY_MS = '5';
process.env.MOCK_AI_MAX_DELAY_MS = '15';

// Cron jobs would race the assertions; the tests drive billing explicitly.
process.env.ENABLE_SCHEDULED_JOBS = 'false';

process.env.FREE_MESSAGES_PER_MONTH = '3';

// The suite fires far more requests per minute from one address than a real
// client would; rate limiting is exercised in its own test instead.
process.env.THROTTLE_LIMIT = '100000';

// The concurrency test deliberately fires more requests at once than a default
// pool would hold; without headroom they fail on connection timeout rather than
// on the quota rule under test.
process.env.DB_POOL_SIZE = '30';
