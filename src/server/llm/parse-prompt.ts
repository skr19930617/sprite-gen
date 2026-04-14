import { env } from '@/lib/env';
import { getAnthropicClient } from './anthropic';
import { parsePromptViaClaudeCodeCli } from './cli';
import {
  DEFAULT_TIMEOUT_MS,
  MODEL,
  SYSTEM_PROMPT,
  TOOL_NAME,
} from './contracts';
import {
  InvalidLlmResponseError,
  LlmTimeoutError,
  LlmUpstreamError,
} from './errors';
import {
  llmAnimationSpecSchema,
  llmToolJsonSchema,
  type LlmAnimationSpec,
} from './schema';

export type ParsePromptOptions = {
  /** Override for tests / timeouts. */
  timeoutMs?: number;
  /** Optional source image (base64 PNG without data: prefix) attached as a content block. */
  sourceImageBase64?: string | null;
};

const parsePromptViaAnthropic = async (
  prompt: string,
  timeoutMs: number,
  sourceImageBase64: string | null,
): Promise<unknown> => {
  const client = getAnthropicClient();

  const userContent: Array<Record<string, unknown>> = [];
  if (sourceImageBase64) {
    userContent.push({
      type: 'image',
      source: {
        type: 'base64',
        media_type: 'image/png',
        data: sourceImageBase64,
      },
    });
  }
  userContent.push({ type: 'text', text: prompt });

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  let response: Awaited<ReturnType<typeof client.messages.create>>;
  try {
    response = await client.messages.create(
      {
        model: MODEL,
        max_tokens: 512,
        system: [
          {
            type: 'text',
            text: SYSTEM_PROMPT,
            cache_control: { type: 'ephemeral' },
          },
        ] as never,
        tools: [
          {
            name: TOOL_NAME,
            description:
              'Emit the structured animation specification matching the fixed schema.',
            input_schema: llmToolJsonSchema as never,
          },
        ],
        tool_choice: { type: 'tool', name: TOOL_NAME } as never,
        messages: [{ role: 'user', content: userContent as never }],
      },
      { signal: controller.signal },
    );
  } catch (err: unknown) {
    if (controller.signal.aborted) {
      throw new LlmTimeoutError(`Anthropic call exceeded ${timeoutMs}ms`);
    }
    throw new LlmUpstreamError(
      err instanceof Error ? err.message : 'unknown anthropic error',
      err as unknown,
    );
  } finally {
    clearTimeout(timeoutId);
  }

  const toolUse = response.content.find(
    (b): b is Extract<typeof b, { type: 'tool_use' }> => b.type === 'tool_use',
  );
  if (!toolUse) {
    throw new InvalidLlmResponseError(
      'LLM response contained no tool_use block',
    );
  }
  if (toolUse.name !== TOOL_NAME) {
    throw new InvalidLlmResponseError(
      `Unexpected tool_use name: ${toolUse.name}`,
    );
  }

  return toolUse.input;
};

/**
 * Send `prompt` to Claude with `tool_use` forced and parse the structured
 * arguments via Zod. Throws InvalidLlmResponseError on schema violation,
 * LlmTimeoutError on >10s, LlmUpstreamError on transport failure.
 */
export const parsePrompt = async (
  prompt: string,
  options: ParsePromptOptions = {},
): Promise<LlmAnimationSpec> => {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, sourceImageBase64 = null } = options;
  const rawResult =
    env.LLM_BACKEND === 'claude_code_cli'
      ? await parsePromptViaClaudeCodeCli({
          prompt,
          timeoutMs,
          sourceImageBase64,
        })
      : await parsePromptViaAnthropic(prompt, timeoutMs, sourceImageBase64);

  const parsed = llmAnimationSpecSchema.safeParse(rawResult);
  if (!parsed.success) {
    throw new InvalidLlmResponseError(
      'LLM structured output failed schema validation',
      parsed.error.issues,
    );
  }
  return parsed.data;
};
