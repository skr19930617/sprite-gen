import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

const ORIGINAL_ENV = { ...process.env };

const setEnv = () => {
  process.env.NEXT_PUBLIC_SITE_URL = 'http://localhost:3000';
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'svc';
  process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
};

beforeEach(() => {
  vi.resetModules();
  setEnv();
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

const validToolUse = {
  type: 'tool_use',
  name: 'emit_animation_spec',
  input: {
    entity_type: 'fish',
    animation_type: 'eat',
    required_regions: ['body', 'tail', 'mouth'],
    optional_regions: ['fin'],
    params: {
      speed: 'slow',
      amplitude: 'small',
      emphasis: 'mouth',
      loop: false,
    },
  },
};

const installAnthropicMock = (impl: () => Promise<unknown> | unknown) => {
  const create = vi.fn(impl);
  vi.doMock('@anthropic-ai/sdk', () => ({
    default: class {
      messages = { create };
    },
  }));
  return create;
};

describe('parsePrompt', () => {
  it('returns the parsed spec on a valid tool_use response', async () => {
    installAnthropicMock(async () => ({
      content: [validToolUse],
    }));
    const { parsePrompt } = await import('@/server/llm/parse-prompt');
    const spec = await parsePrompt('餌を食べる動きで', { timeoutMs: 1000 });
    expect(spec.animation_type).toBe('eat');
    expect(spec.params.loop).toBe(false);
  });

  it('throws InvalidLlmResponseError when schema is violated', async () => {
    installAnthropicMock(async () => ({
      content: [
        {
          type: 'tool_use',
          name: 'emit_animation_spec',
          input: { ...validToolUse.input, animation_type: 'dance' },
        },
      ],
    }));
    const { parsePrompt } = await import('@/server/llm/parse-prompt');
    const { InvalidLlmResponseError } = await import('@/server/llm/errors');
    await expect(
      parsePrompt('動く', { timeoutMs: 1000 }),
    ).rejects.toBeInstanceOf(InvalidLlmResponseError);
  });

  it('throws InvalidLlmResponseError when tool_use is missing', async () => {
    installAnthropicMock(async () => ({
      content: [{ type: 'text', text: 'hello' }],
    }));
    const { parsePrompt } = await import('@/server/llm/parse-prompt');
    const { InvalidLlmResponseError } = await import('@/server/llm/errors');
    await expect(
      parsePrompt('動く', { timeoutMs: 1000 }),
    ).rejects.toBeInstanceOf(InvalidLlmResponseError);
  });

  it('throws LlmTimeoutError when the SDK aborts', async () => {
    installAnthropicMock(
      async (_args?: unknown, opts?: { signal?: AbortSignal }) => {
        return new Promise((_resolve, reject) => {
          opts?.signal?.addEventListener('abort', () => {
            const err = new Error('aborted');
            (err as unknown as { name: string }).name = 'AbortError';
            reject(err);
          });
        });
      },
    );
    const { parsePrompt } = await import('@/server/llm/parse-prompt');
    const { LlmTimeoutError } = await import('@/server/llm/errors');
    await expect(parsePrompt('動く', { timeoutMs: 50 })).rejects.toBeInstanceOf(
      LlmTimeoutError,
    );
  });

  it('throws LlmUpstreamError on a generic SDK error', async () => {
    installAnthropicMock(async () => {
      throw new Error('500 internal');
    });
    const { parsePrompt } = await import('@/server/llm/parse-prompt');
    const { LlmUpstreamError } = await import('@/server/llm/errors');
    await expect(
      parsePrompt('動く', { timeoutMs: 1000 }),
    ).rejects.toBeInstanceOf(LlmUpstreamError);
  });
});
