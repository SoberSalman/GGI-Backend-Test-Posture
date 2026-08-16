import { configuration } from './configuration';

describe('configuration', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('falls back to sane defaults when nothing is set', () => {
    delete process.env.PORT;
    delete process.env.FREE_MESSAGES_PER_MONTH;
    delete process.env.PAYMENT_FAILURE_RATE;

    const config = configuration();

    expect(config.port).toBe(3000);
    expect(config.freeMessagesPerMonth).toBe(3);
    expect(config.paymentFailureRate).toBe(0.2);
    expect(config.enableScheduledJobs).toBe(true);
  });

  it('reads overrides from the environment', () => {
    process.env.PORT = '4100';
    process.env.FREE_MESSAGES_PER_MONTH = '5';
    process.env.PAYMENT_FAILURE_RATE = '0.5';
    process.env.ENABLE_SCHEDULED_JOBS = 'false';

    const config = configuration();

    expect(config.port).toBe(4100);
    expect(config.freeMessagesPerMonth).toBe(5);
    expect(config.paymentFailureRate).toBe(0.5);
    expect(config.enableScheduledJobs).toBe(false);
  });

  it('treats an empty string as unset', () => {
    process.env.PORT = '   ';
    expect(configuration().port).toBe(3000);
  });

  it('accepts the usual truthy spellings for booleans', () => {
    for (const value of ['true', '1', 'yes', 'YES']) {
      process.env.DB_LOGGING = value;
      expect(configuration().database.logging).toBe(true);
    }

    process.env.DB_LOGGING = 'off';
    expect(configuration().database.logging).toBe(false);
  });

  it('fails fast on a non-numeric integer', () => {
    process.env.PORT = 'not-a-port';
    expect(() => configuration()).toThrow(/Invalid integer for env var PORT/);
  });

  it('fails fast on a probability outside 0..1', () => {
    process.env.PAYMENT_FAILURE_RATE = '1.5';
    expect(() => configuration()).toThrow(/Invalid probability/);
  });
});
