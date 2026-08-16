import { Injectable, Logger } from '@nestjs/common';
import { ChatMessage } from '../domain/chat-message.entity';
import { AiProviderError } from '../domain/chat.errors';
import { ChatMessageRepository, HistoryPage } from '../infrastructure/chat-message.repository';
import { AiProvider } from './ai-provider.port';
import { QuotaReservation, QuotaService } from './quota.service';

export interface AskCommand {
  userId: string;
  question: string;
}

export interface AskResult {
  message: ChatMessage;
  reservation: QuotaReservation;
}

/**
 * The ask-a-question use case.
 *
 * Sequence: reserve quota (short, locked transaction) -> call the provider
 * (slow, no locks held) -> persist the exchange. The provider call sits outside
 * the transaction on purpose: holding a row lock across a multi-second network
 * call would serialise every other request for that user.
 */
@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);

  constructor(
    private readonly quota: QuotaService,
    private readonly ai: AiProvider,
    private readonly messages: ChatMessageRepository,
  ) {}

  async ask(command: AskCommand): Promise<AskResult> {
    const reservation = await this.quota.reserve(command.userId);

    let completion;
    try {
      completion = await this.ai.complete({
        userId: command.userId,
        question: command.question,
      });
    } catch (error) {
      // The user never got an answer, so they must not be charged for one.
      await this.quota.release(command.userId, reservation);
      const reason = error instanceof Error ? error.message : String(error);
      this.logger.error(`AI call failed for user ${command.userId}: ${reason}`);
      throw new AiProviderError(reason);
    }

    const message = await this.messages.save({
      userId: command.userId,
      question: command.question,
      answer: completion.answer,
      model: completion.model,
      promptTokens: completion.usage.promptTokens,
      completionTokens: completion.usage.completionTokens,
      totalTokens: completion.usage.totalTokens,
      quotaSource: reservation.source,
      subscriptionId: reservation.subscriptionId,
      latencyMs: completion.latencyMs,
    });

    return { message, reservation };
  }

  async history(userId: string, page: number, limit: number): Promise<HistoryPage> {
    return this.messages.findPageForUser(userId, page, limit);
  }

  /** Message and token totals for the current calendar month. */
  async monthlyUsage(userId: string, now: Date): Promise<{ messages: number; tokens: number }> {
    const [messages, tokens] = await Promise.all([
      this.messages.countInMonth(userId, now),
      this.messages.sumTokensThisMonth(userId, now),
    ]);
    return { messages, tokens };
  }
}
