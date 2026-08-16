export interface CompletionRequest {
  question: string;
  /** Correlation id for logs — the calling user. */
  userId: string;
}

export interface CompletionResult {
  answer: string;
  model: string;
  usage: TokenUsage;
  /** Observed round-trip time in milliseconds. */
  latencyMs: number;
}

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

/**
 * Outbound port for the LLM.
 *
 * The application layer knows only this contract, so the mocked provider used
 * here and a real OpenAI client are interchangeable.
 */
export abstract class AiProvider {
  abstract complete(request: CompletionRequest): Promise<CompletionResult>;
}
