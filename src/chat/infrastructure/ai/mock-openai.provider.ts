import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { setTimeout as delay } from 'node:timers/promises';
import { MockAiConfig } from '../../../config/configuration';
import {
  AiProvider,
  CompletionRequest,
  CompletionResult,
  TokenUsage,
} from '../../application/ai-provider.port';

/**
 * Stand-in for the OpenAI Chat Completions API: randomised network delay, a
 * model name, and a prompt/completion token breakdown.
 */
@Injectable()
export class MockOpenAiProvider extends AiProvider {
  private readonly logger = new Logger(MockOpenAiProvider.name);
  private readonly config: MockAiConfig;

  constructor(config: ConfigService) {
    super();
    this.config = config.getOrThrow<MockAiConfig>('mockAi');
  }

  async complete(request: CompletionRequest): Promise<CompletionResult> {
    const startedAt = Date.now();
    await this.withTimeout(delay(this.randomLatency()));

    const answer = this.composeAnswer(request.question);
    const usage = estimateUsage(request.question, answer);
    const latencyMs = Date.now() - startedAt;

    this.logger.log(
      `Mock completion for user ${request.userId}: ${usage.totalTokens} tokens in ${latencyMs}ms`,
    );

    return { answer, model: this.config.model, usage, latencyMs };
  }

  /**
   * A completion that never returns would strand the reserved quota: the
   * request holds a message the caller can never spend and never gets back.
   */
  private async withTimeout<T>(work: Promise<T>): Promise<T> {
    const timeout = new Promise<never>((_resolve, reject) =>
      setTimeout(
        () => reject(new Error(`Completion timed out after ${this.config.timeoutMs}ms`)),
        this.config.timeoutMs,
      ).unref(),
    );

    return Promise.race([work, timeout]);
  }

  private randomLatency(): number {
    const { minDelayMs, maxDelayMs } = this.config;
    const span = Math.max(0, maxDelayMs - minDelayMs);
    return minDelayMs + Math.floor(Math.random() * (span + 1));
  }

  private composeAnswer(question: string): string {
    const trimmed = question.trim();
    const subject = trimmed.length > 120 ? `${trimmed.slice(0, 117)}...` : trimmed;

    return (
      `Here is a mocked assistant response to: "${subject}"\n\n` +
      'This deployment runs against a simulated OpenAI provider, so the wording is ' +
      'generated locally. The request path is otherwise identical to production: the ' +
      'quota was reserved before the call, the provider latency was simulated, and the ' +
      'token counts below were recorded against your account.'
    );
  }
}

/**
 * Approximates tokenisation at the well-known ~4 characters per token ratio.
 *
 * Good enough for a mock. Swap in the provider's reported `usage` the moment a
 * real client is wired up; never bill real money off this.
 */
export function estimateUsage(question: string, answer: string): TokenUsage {
  const promptTokens = estimateTokens(question);
  const completionTokens = estimateTokens(answer);
  return { promptTokens, completionTokens, totalTokens: promptTokens + completionTokens };
}

const CHARS_PER_TOKEN = 4;

function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.trim().length / CHARS_PER_TOKEN));
}
