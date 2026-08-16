import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { AppModule } from '../../src/app.module';
import { configuration } from '../../src/config/configuration';
import { PaymentGateway } from '../../src/subscriptions/application/payment-gateway.port';
import { DomainExceptionFilter } from '../../src/shared/http/domain-exception.filter';
import { ResponseEnvelopeInterceptor } from '../../src/shared/http/response.interceptor';
import { Clock, FixedClock } from '../../src/shared/time/clock';
import { User } from '../../src/users/domain/user.entity';
import {
  ChargeRequest,
  ChargeResult,
} from '../../src/subscriptions/application/payment-gateway.port';
import { AiProvider, CompletionResult } from '../../src/chat/application/ai-provider.port';
import { MockOpenAiProvider } from '../../src/chat/infrastructure/ai/mock-openai.provider';

export const E2E_START = new Date('2026-08-16T12:00:00Z');

/**
 * Payment gateway whose outcome the test decides, instead of a coin flip.
 *
 * Failures are scripted per subscription: a billing run processes every due
 * bundle in the database, so a global "fail the next charge" switch would leak
 * declines into other tests' bundles.
 */
export class ScriptedPaymentGateway extends PaymentGateway {
  private readonly declines = new Map<string, string>();

  /** Decline every charge for this subscription until `reset` is called. */
  failFor(subscriptionId: string, reason = 'insufficient_funds'): void {
    this.declines.set(subscriptionId, reason);
  }

  reset(): void {
    this.declines.clear();
  }

  charge(request: ChargeRequest): Promise<ChargeResult> {
    const reason = this.declines.get(request.subscriptionId);
    return Promise.resolve(
      reason ? { outcome: 'FAILED', reason } : { outcome: 'SUCCEEDED', reference: 'sim_test' },
    );
  }
}

/**
 * Wraps the real mock provider so a test can make the completion fail on
 * demand. Without this the refund path never runs against a real database.
 */
export class SwitchableAiProvider extends AiProvider {
  private failure: string | null = null;

  constructor(private readonly inner: AiProvider) {
    super();
  }

  failNext(reason = 'upstream timeout'): void {
    this.failure = reason;
  }

  succeed(): void {
    this.failure = null;
  }

  complete(request: Parameters<AiProvider['complete']>[0]): Promise<CompletionResult> {
    if (this.failure) return Promise.reject(new Error(this.failure));
    return this.inner.complete(request);
  }
}

export interface E2EContext {
  app: INestApplication;
  moduleRef: TestingModule;
  dataSource: DataSource;
  clock: FixedClock;
  gateway: ScriptedPaymentGateway;
  ai: SwitchableAiProvider;
  createUser: (name: string) => Promise<User>;
  close: () => Promise<void>;
}

/**
 * Boots the real application against the e2e database, with two seams replaced:
 * a clock the test can move, and a payment gateway the test can script.
 * Everything else, guards, pipes, filters, repositories, is production code.
 */
export interface E2EOptions {
  /** Set to exercise the admin gate; unset leaves the endpoints open. */
  adminApiKey?: string;
  /** Lowered by the rate-limiting test; the suite otherwise runs uncapped. */
  throttleLimit?: number;
}

export async function createE2EContext(options: E2EOptions = {}): Promise<E2EContext> {
  const clock = new FixedClock(E2E_START);
  const gateway = new ScriptedPaymentGateway();

  // Env, not a provider override: both values are read through ConfigService at
  // module-construction time.
  const previous = { ...process.env };
  if (options.adminApiKey) process.env.ADMIN_API_KEY = options.adminApiKey;
  if (options.throttleLimit) process.env.THROTTLE_LIMIT = String(options.throttleLimit);

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(Clock)
    .useValue(clock)
    .overrideProvider(PaymentGateway)
    .useValue(gateway)
    .overrideProvider(AiProvider)
    .useFactory({
      inject: [ConfigService],
      factory: (config: ConfigService) => new SwitchableAiProvider(new MockOpenAiProvider(config)),
    })
    .compile();

  const ai = moduleRef.get<SwitchableAiProvider>(AiProvider);

  const app = moduleRef.createNestApplication();
  app.setGlobalPrefix(configuration().apiPrefix);
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );
  app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
  app.useGlobalFilters(new DomainExceptionFilter());
  await app.init();

  const dataSource = moduleRef.get(DataSource);
  let userCounter = 0;

  return {
    app,
    moduleRef,
    dataSource,
    clock,
    gateway,
    ai,
    createUser: async (name: string) => {
      userCounter += 1;
      return dataSource.getRepository(User).save({
        name,
        email: `${name.toLowerCase().replace(/\W+/g, '-')}-${Date.now()}-${userCounter}@e2e.test`,
      });
    },
    close: async () => {
      await app.close();
      process.env = previous;
    },
  };
}
