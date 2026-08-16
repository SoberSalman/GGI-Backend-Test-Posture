import { Test } from '@nestjs/testing';
import { ChatMessage, QuotaSource } from '../domain/chat-message.entity';
import { ChatMessageRepository } from '../infrastructure/chat-message.repository';
import { AiProvider } from './ai-provider.port';
import { ChatService } from './chat.service';
import { QuotaReservation, QuotaService } from './quota.service';

const FREE_RESERVATION: QuotaReservation = {
  source: QuotaSource.FREE_TIER,
  periodKey: '2026-08',
  remainingAfter: 2,
};

describe('ChatService', () => {
  let service: ChatService;
  let quota: jest.Mocked<QuotaService>;
  let ai: jest.Mocked<AiProvider>;
  let messages: jest.Mocked<ChatMessageRepository>;

  beforeEach(async () => {
    quota = {
      reserve: jest.fn().mockResolvedValue(FREE_RESERVATION),
      release: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<QuotaService>;

    ai = {
      complete: jest.fn().mockResolvedValue({
        answer: 'A mocked answer.',
        model: 'gpt-4o-mini',
        usage: { promptTokens: 6, completionTokens: 4, totalTokens: 10 },
        latencyMs: 450,
      }),
    };

    messages = {
      save: jest
        .fn()
        .mockImplementation((message: Partial<ChatMessage>) =>
          Promise.resolve(Object.assign(new ChatMessage(), { id: 'msg-1' }, message)),
        ),
      findPageForUser: jest.fn(),
      monthToDateUsage: jest.fn().mockResolvedValue({ messages: 3, tokens: 120 }),
    } as unknown as jest.Mocked<ChatMessageRepository>;

    const moduleRef = await Test.createTestingModule({
      providers: [
        ChatService,
        { provide: QuotaService, useValue: quota },
        { provide: AiProvider, useValue: ai },
        { provide: ChatMessageRepository, useValue: messages },
      ],
    }).compile();

    service = moduleRef.get(ChatService);
  });

  it('reserves quota before calling the provider', async () => {
    const callOrder: string[] = [];
    quota.reserve.mockImplementation(() => {
      callOrder.push('reserve');
      return Promise.resolve(FREE_RESERVATION);
    });
    ai.complete.mockImplementation(() => {
      callOrder.push('ai');
      return Promise.resolve({
        answer: 'ok',
        model: 'gpt-4o-mini',
        usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
        latencyMs: 10,
      });
    });

    await service.ask({ userId: 'user-1', question: 'hello?' });

    expect(callOrder).toEqual(['reserve', 'ai']);
  });

  it('persists the exchange with its token accounting and quota source', async () => {
    const { message } = await service.ask({ userId: 'user-1', question: 'hello?' });

    expect(messages.save).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-1',
        question: 'hello?',
        answer: 'A mocked answer.',
        model: 'gpt-4o-mini',
        promptTokens: 6,
        completionTokens: 4,
        totalTokens: 10,
        quotaSource: QuotaSource.FREE_TIER,
        subscriptionId: null,
        latencyMs: 450,
      }),
    );
    expect(message.id).toBe('msg-1');
  });

  it('attributes the message to the bundle that paid for it', async () => {
    quota.reserve.mockResolvedValue({
      source: QuotaSource.SUBSCRIPTION,
      subscriptionId: 'sub-1',
      remainingAfter: 9,
    });

    await service.ask({ userId: 'user-1', question: 'hello?' });

    expect(messages.save).toHaveBeenCalledWith(
      expect.objectContaining({
        quotaSource: QuotaSource.SUBSCRIPTION,
        subscriptionId: 'sub-1',
      }),
    );
  });

  it('refunds the reservation and reports a provider error when the AI call fails', async () => {
    ai.complete.mockRejectedValue(new Error('upstream timeout'));

    await expect(service.ask({ userId: 'user-1', question: 'hello?' })).rejects.toMatchObject({
      code: 'AI_PROVIDER_ERROR',
      status: 502,
    });

    expect(quota.release).toHaveBeenCalledWith('user-1', FREE_RESERVATION);
    expect(messages.save).not.toHaveBeenCalled();
  });

  it('does not charge anything when the quota check itself rejects', async () => {
    quota.reserve.mockRejectedValue(new Error('QUOTA_EXCEEDED'));

    await expect(service.ask({ userId: 'user-1', question: 'hello?' })).rejects.toThrow();

    expect(ai.complete).not.toHaveBeenCalled();
    expect(quota.release).not.toHaveBeenCalled();
  });

  it('reports month-to-date message and token totals', async () => {
    const usage = await service.monthlyUsage('user-1', new Date('2026-08-16T12:00:00Z'));
    expect(usage).toEqual({ messages: 3, tokens: 120 });
  });
});
