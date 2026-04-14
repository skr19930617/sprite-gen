import { EventEmitter } from 'node:events';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

const ORIGINAL_ENV = { ...process.env };

const setEnv = () => {
  process.env.NEXT_PUBLIC_SITE_URL = 'http://localhost:3000';
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'svc';
  process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
  process.env.LLM_BACKEND = 'anthropic';
  process.env.LLM_CLI_COMMAND = 'claude';
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

const installCliSpawnMock = (options: {
  stdout?: string;
  stderr?: string;
  exitCode?: number | null;
  emitClose?: boolean;
}) => {
  const spawn = vi.fn(() => {
    const child = new EventEmitter() as EventEmitter & {
      stdout: EventEmitter;
      stderr: EventEmitter;
      kill: ReturnType<typeof vi.fn>;
    };
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = vi.fn(() => {
      child.emit('close', null, 'SIGTERM');
      return true;
    });

    if (options.emitClose !== false) {
      queueMicrotask(() => {
        if (options.stdout) child.stdout.emit('data', options.stdout);
        if (options.stderr) child.stderr.emit('data', options.stderr);
        child.emit('close', options.exitCode ?? 0, null);
      });
    }

    return child;
  });

  vi.doMock('node:child_process', async (importOriginal) => {
    const actual = await importOriginal<typeof import('node:child_process')>();
    return {
      ...actual,
      default: {
        ...actual,
        spawn,
      },
      spawn,
    };
  });
  return spawn;
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

  it('uses Claude Code CLI when LLM_BACKEND=claude_code_cli', async () => {
    process.env.LLM_BACKEND = 'claude_code_cli';
    installCliSpawnMock({ stdout: JSON.stringify(validToolUse.input) });
    const { parsePrompt } = await import('@/server/llm/parse-prompt');
    const spec = await parsePrompt('餌を食べる動きで', { timeoutMs: 1000 });
    expect(spec.animation_type).toBe('eat');
    expect(spec.required_regions).toContain('mouth');
  });

  it('accepts fenced JSON from Claude Code CLI', async () => {
    process.env.LLM_BACKEND = 'claude_code_cli';
    installCliSpawnMock({
      stdout: `\n\`\`\`json\n${JSON.stringify(validToolUse.input, null, 2)}\n\`\`\`\n`,
    });
    const { parsePrompt } = await import('@/server/llm/parse-prompt');
    const spec = await parsePrompt('餌を食べる動きで', { timeoutMs: 1000 });
    expect(spec.animation_type).toBe('eat');
  });

  it('throws InvalidLlmResponseError when CLI emits no JSON', async () => {
    process.env.LLM_BACKEND = 'claude_code_cli';
    installCliSpawnMock({ stdout: 'not json at all' });
    const { parsePrompt } = await import('@/server/llm/parse-prompt');
    const { InvalidLlmResponseError } = await import('@/server/llm/errors');
    await expect(
      parsePrompt('動く', { timeoutMs: 1000 }),
    ).rejects.toBeInstanceOf(InvalidLlmResponseError);
  });

  it('throws LlmTimeoutError when Claude Code CLI exceeds timeout', async () => {
    process.env.LLM_BACKEND = 'claude_code_cli';
    installCliSpawnMock({ emitClose: false });
    const { parsePrompt } = await import('@/server/llm/parse-prompt');
    const { LlmTimeoutError } = await import('@/server/llm/errors');
    await expect(parsePrompt('動く', { timeoutMs: 10 })).rejects.toBeInstanceOf(
      LlmTimeoutError,
    );
  });

  it('throws LlmUpstreamError when Claude Code CLI exits non-zero', async () => {
    process.env.LLM_BACKEND = 'claude_code_cli';
    installCliSpawnMock({ stderr: 'cli failed', exitCode: 1 });
    const { parsePrompt } = await import('@/server/llm/parse-prompt');
    const { LlmUpstreamError } = await import('@/server/llm/errors');
    await expect(
      parsePrompt('動く', { timeoutMs: 1000 }),
    ).rejects.toBeInstanceOf(LlmUpstreamError);
  });
});
