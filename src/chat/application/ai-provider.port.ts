export interface CompletionRequest {
  question: string;
  userId: string;
}

export interface CompletionResult {
  answer: string;
  model: string;
  usage: TokenUsage;
  latencyMs: number;
}

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

/** Swap point for a real OpenAI client. */
export abstract class AiProvider {
  abstract complete(request: CompletionRequest): Promise<CompletionResult>;
}
