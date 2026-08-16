import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { CurrentUserGuard } from '../../shared/auth/current-user.guard';
import { Clock, FixedClock } from '../../shared/time/clock';
import { User } from '../../users/domain/user.entity';
import { ChatService } from '../application/chat.service';
import { QuotaService } from '../application/quota.service';
import { ChatMessage, QuotaSource } from '../domain/chat-message.entity';
import { ChatController } from './chat.controller';
import { FreeQuotaController } from './free-quota.controller';

const NOW = new Date('2026-08-16T12:00:00Z');
const USER = Object.assign(new User(), { id: 'user-1', email: 'a@b.c', name: 'A' });

function message(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return Object.assign(new ChatMessage(), {
    id: 'msg-1',
    userId: 'user-1',
    question: 'Why is the sky blue?',
    answer: 'Rayleigh scattering.',
    model: 'gpt-4o-mini',
    promptTokens: 6,
    completionTokens: 4,
    totalTokens: 10,
    quotaSource: QuotaSource.FREE_TIER,
    subscriptionId: null,
    latencyMs: 420,
    createdAt: NOW,
    ...overrides,
  } satisfies Partial<ChatMessage>);
}

describe('ChatController', () => {
  let controller: ChatController;
  let freeQuotaController: FreeQuotaController;
  let chat: jest.Mocked<ChatService>;
  let quota: jest.Mocked<QuotaService>;

  beforeEach(async () => {
    chat = {
      ask: jest.fn().mockResolvedValue({
        message: message(),
        reservation: { source: QuotaSource.FREE_TIER, subscriptionId: null, remainingAfter: 2 },
      }),
      history: jest.fn().mockResolvedValue({ items: [message()], total: 25, page: 2, limit: 10 }),
      monthlyUsage: jest.fn().mockResolvedValue({ messages: 4, tokens: 250 }),
    } as unknown as jest.Mocked<ChatService>;

    quota = {
      summarise: jest.fn().mockResolvedValue({
        free: {
          allowance: 3,
          used: 1,
          remaining: 2,
          periodStart: '2026-08-01T00:00:00.000Z',
          resetsAt: '2026-09-01T00:00:00.000Z',
        },
        bundles: [],
        totalRemaining: 2,
      }),
      resetFreeQuotas: jest.fn().mockResolvedValue({ resetAt: NOW, rowsReset: 4 }),
    } as unknown as jest.Mocked<QuotaService>;

    const moduleRef = await Test.createTestingModule({
      controllers: [ChatController, FreeQuotaController],
      providers: [
        { provide: ChatService, useValue: chat },
        { provide: QuotaService, useValue: quota },
        { provide: Clock, useValue: new FixedClock(NOW) },
        { provide: ConfigService, useValue: { get: () => '' } },
      ],
    })
      .overrideGuard(CurrentUserGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = moduleRef.get(ChatController);
    freeQuotaController = moduleRef.get(FreeQuotaController);
  });

  describe('POST /chat', () => {
    it('returns the answer, the token usage and what the response was charged to', async () => {
      const result = await controller.ask(USER, { question: 'Why is the sky blue?' });

      expect(chat.ask).toHaveBeenCalledWith({
        userId: 'user-1',
        question: 'Why is the sky blue?',
      });
      expect(result).toMatchObject({
        id: 'msg-1',
        answer: 'Rayleigh scattering.',
        usage: { promptTokens: 6, completionTokens: 4, totalTokens: 10 },
        quota: { chargedTo: QuotaSource.FREE_TIER, subscriptionId: null, remainingAfter: 2 },
      });
    });

    it('surfaces the bundle a paid response was charged to', async () => {
      chat.ask.mockResolvedValue({
        message: message({ quotaSource: QuotaSource.SUBSCRIPTION, subscriptionId: 'sub-1' }),
        reservation: {
          source: QuotaSource.SUBSCRIPTION,
          subscriptionId: 'sub-1',
          periodKey: null,
          remainingAfter: 9,
        },
      });

      const result = await controller.ask(USER, { question: 'hi' });

      expect(result.quota).toEqual({
        chargedTo: QuotaSource.SUBSCRIPTION,
        subscriptionId: 'sub-1',
        remainingAfter: 9,
      });
    });
  });

  describe('GET /chat/history', () => {
    it('defaults to the first page', async () => {
      await controller.history(USER, {});
      expect(chat.history).toHaveBeenCalledWith('user-1', 1, 20);
    });

    it('passes an explicit page and limit through and computes the page count', async () => {
      const result = await controller.history(USER, { page: 2, limit: 10 });

      expect(chat.history).toHaveBeenCalledWith('user-1', 2, 10);
      expect(result.pagination).toEqual({ total: 25, page: 2, limit: 10, totalPages: 3 });
    });
  });

  describe('GET /chat/usage', () => {
    it('combines the quota summary with month-to-date totals', async () => {
      const result = await controller.usage(USER);

      expect(result.free.remaining).toBe(2);
      expect(result.monthToDate).toEqual({ messages: 4, tokens: 250 });
    });
  });

  describe('POST /billing/reset-free-quota', () => {
    it('reports how many counters were rolled forward', async () => {
      await expect(freeQuotaController.reset()).resolves.toEqual({
        resetAt: NOW.toISOString(),
        rowsReset: 4,
      });
    });
  });
});
