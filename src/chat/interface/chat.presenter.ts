import { ChatMessage } from '../domain/chat-message.entity';

export function toChatMessageView(message: ChatMessage) {
  return {
    id: message.id,
    question: message.question,
    answer: message.answer,
    model: message.model,
    usage: {
      promptTokens: message.promptTokens,
      completionTokens: message.completionTokens,
      totalTokens: message.totalTokens,
    },
    quotaSource: message.quotaSource,
    subscriptionId: message.subscriptionId,
    latencyMs: message.latencyMs,
    createdAt: message.createdAt.toISOString(),
  };
}
