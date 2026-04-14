import Anthropic from '@anthropic-ai/sdk';
import { env } from '@/lib/env';

let client: Anthropic | null = null;

/**
 * Lazily-instantiated Anthropic client (avoids reading API keys at build time).
 * Tests inject a mock via `vi.doMock('@anthropic-ai/sdk', ...)`.
 */
export const getAnthropicClient = (): Anthropic => {
  if (!client) {
    client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  }
  return client;
};

/** Test-only: clear the cached client between tests. */
export const __resetAnthropicClientForTests = (): void => {
  client = null;
};
