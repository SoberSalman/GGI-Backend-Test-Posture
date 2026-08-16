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
  adminApiKey: string;
  allowUnauthenticatedAdmin: boolean;
  exposeSeedUsers: boolean;
  throttle: ThrottleConfig;
}

export interface ThrottleConfig {
  ttlMs: number;
  limit: number;
}

export interface DatabaseConfig {
  host: string;
  port: number;
  username: string;
  password: string;
  database: string;
  logging: boolean;
  poolSize: number;
  statementTimeoutMs: number;
  lockTimeoutMs: number;
}

export interface MockAiConfig {
  minDelayMs: number;
  maxDelayMs: number;
  model: string;
  timeoutMs: number;
}

const ENVIRONMENTS = ['development', 'test', 'staging', 'production'] as const;
type Environment = (typeof ENVIRONMENTS)[number];

export const configuration = (): AppConfig => ({
  env: environment(),
  port: int('PORT', 3000),
  apiPrefix: str('API_PREFIX', 'api/v1'),
  database: {
    host: str('DB_HOST', 'localhost'),
    port: int('DB_PORT', 5432),
    username: str('DB_USER', 'ggi'),
    password: str('DB_PASSWORD', 'ggi_password'),
    database: str('DB_NAME', 'ggi_assessment'),
    logging: bool('DB_LOGGING', false),
    poolSize: int('DB_POOL_SIZE', 10),
    statementTimeoutMs: int('DB_STATEMENT_TIMEOUT_MS', 30_000),
    lockTimeoutMs: int('DB_LOCK_TIMEOUT_MS', 10_000),
  },
  freeMessagesPerMonth: int('FREE_MESSAGES_PER_MONTH', 3),
  mockAi: {
    minDelayMs: int('MOCK_AI_MIN_DELAY_MS', 300),
    maxDelayMs: int('MOCK_AI_MAX_DELAY_MS', 1200),
    model: str('MOCK_AI_MODEL', 'gpt-4o-mini'),
    timeoutMs: int('AI_TIMEOUT_MS', 15_000),
  },
  paymentFailureRate: float('PAYMENT_FAILURE_RATE', 0.2),
  enableScheduledJobs: bool('ENABLE_SCHEDULED_JOBS', true),
  adminApiKey: str('ADMIN_API_KEY', ''),
  allowUnauthenticatedAdmin: unauthenticatedAdminAllowed(),
  throttle: {
    ttlMs: int('THROTTLE_TTL_MS', 60_000),
    limit: int('THROTTLE_LIMIT', 60),
  },
  // Fail closed. Deriving this from NODE_ENV meant a typo or an unset value
  // silently published every user id, so it must be opted into explicitly.
  exposeSeedUsers: bool('EXPOSE_SEED_USERS', false),
});

/** Validated, because security defaults key off it and a typo must not pass. */
function environment(): Environment {
  const raw = str('NODE_ENV', 'development');
  if (!(ENVIRONMENTS as readonly string[]).includes(raw)) {
    throw new Error(`Invalid NODE_ENV '${raw}'. Expected one of: ${ENVIRONMENTS.join(', ')}`);
  }
  return raw as Environment;
}

/** Never honoured in production, whatever the variable says. */
function unauthenticatedAdminAllowed(): boolean {
  const allowed = bool('ALLOW_UNAUTHENTICATED_ADMIN', false);
  if (allowed && environment() === 'production') {
    throw new Error('ALLOW_UNAUTHENTICATED_ADMIN cannot be enabled in production.');
  }
  return allowed;
}

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
