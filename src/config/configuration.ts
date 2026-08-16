/** Typed, validated view over `process.env`. Loaded once at bootstrap. */
export interface AppConfig {
  env: string;
  port: number;
  apiPrefix: string;
  database: DatabaseConfig;
  freeMessagesPerMonth: number;
  mockAi: MockAiConfig;
  paymentFailureRate: number;
  enableScheduledJobs: boolean;
}

export interface DatabaseConfig {
  host: string;
  port: number;
  username: string;
  password: string;
  database: string;
  logging: boolean;
}

export interface MockAiConfig {
  minDelayMs: number;
  maxDelayMs: number;
  model: string;
}

export const configuration = (): AppConfig => ({
  env: str('NODE_ENV', 'development'),
  port: int('PORT', 3000),
  apiPrefix: str('API_PREFIX', 'api/v1'),
  database: {
    host: str('DB_HOST', 'localhost'),
    port: int('DB_PORT', 5432),
    username: str('DB_USER', 'ggi'),
    password: str('DB_PASSWORD', 'ggi_password'),
    database: str('DB_NAME', 'ggi_assessment'),
    logging: bool('DB_LOGGING', false),
  },
  freeMessagesPerMonth: int('FREE_MESSAGES_PER_MONTH', 3),
  mockAi: {
    minDelayMs: int('MOCK_AI_MIN_DELAY_MS', 300),
    maxDelayMs: int('MOCK_AI_MAX_DELAY_MS', 1200),
    model: str('MOCK_AI_MODEL', 'gpt-4o-mini'),
  },
  paymentFailureRate: float('PAYMENT_FAILURE_RATE', 0.2),
  enableScheduledJobs: bool('ENABLE_SCHEDULED_JOBS', true),
});

function str(key: string, fallback: string): string {
  return process.env[key]?.trim() || fallback;
}

function int(key: string, fallback: number): number {
  const raw = process.env[key];
  if (raw === undefined || raw.trim() === '') return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid integer for env var ${key}: '${raw}'`);
  }
  return parsed;
}

function float(key: string, fallback: number): number {
  const raw = process.env[key];
  if (raw === undefined || raw.trim() === '') return fallback;
  const parsed = Number.parseFloat(raw);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
    throw new Error(`Invalid probability (expected 0..1) for env var ${key}: '${raw}'`);
  }
  return parsed;
}

function bool(key: string, fallback: boolean): boolean {
  const raw = process.env[key]?.trim().toLowerCase();
  if (raw === undefined || raw === '') return fallback;
  return raw === 'true' || raw === '1' || raw === 'yes';
}
