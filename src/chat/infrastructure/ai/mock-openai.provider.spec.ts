import { ConfigService } from '@nestjs/config';
import { MockAiConfig } from '../../../config/configuration';
import { MockOpenAiProvider, estimateUsage } from './mock-openai.provider';

function providerWith(config: Partial<MockAiConfig>): MockOpenAiProvider {
  const merged: MockAiConfig = {
    minDelayMs: 20,
    maxDelayMs: 40,
    model: 'gpt-4o-mini',
    ...config,
  };
  return new MockOpenAiProvider({
    getOrThrow: () => merged,
  } as unknown as ConfigService);
}

describe('MockOpenAiProvider', () => {
  it('waits at least the configured minimum delay', async () => {
    const provider = providerWith({ minDelayMs: 60, maxDelayMs: 60 });

    const startedAt = Date.now();
    const result = await provider.complete({ userId: 'user-1', question: 'Why is the sky blue?' });

    // Timers can fire a millisecond early; allow a small tolerance.
    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(55);
    expect(result.latencyMs).toBeGreaterThanOrEqual(55);
  });

  it('returns the configured model and a non-empty answer', async () => {
    const provider = providerWith({ model: 'gpt-4.1-mini' });

    const result = await provider.complete({ userId: 'user-1', question: 'Hello?' });

    expect(result.model).toBe('gpt-4.1-mini');
    expect(result.answer.length).toBeGreaterThan(0);
    expect(result.answer).toContain('Hello?');
  });

  it('truncates a very long question when echoing it back', async () => {
    const provider = providerWith({ minDelayMs: 0, maxDelayMs: 0 });

    const result = await provider.complete({ userId: 'user-1', question: 'x'.repeat(500) });

    expect(result.answer).toContain('...');
  });

  it('reports a prompt/completion token split that adds up', async () => {
    const provider = providerWith({ minDelayMs: 0, maxDelayMs: 0 });

    const { usage } = await provider.complete({ userId: 'user-1', question: 'Explain pooling.' });

    expect(usage.promptTokens).toBeGreaterThan(0);
    expect(usage.completionTokens).toBeGreaterThan(0);
    expect(usage.totalTokens).toBe(usage.promptTokens + usage.completionTokens);
  });
});

describe('estimateUsage', () => {
  it('scales with text length at roughly four characters per token', () => {
    const usage = estimateUsage('a'.repeat(40), 'b'.repeat(80));

    expect(usage.promptTokens).toBe(10);
    expect(usage.completionTokens).toBe(20);
    expect(usage.totalTokens).toBe(30);
  });

  it('never reports zero tokens for a non-empty exchange', () => {
    const usage = estimateUsage('a', 'b');

    expect(usage.promptTokens).toBe(1);
    expect(usage.completionTokens).toBe(1);
  });
});
