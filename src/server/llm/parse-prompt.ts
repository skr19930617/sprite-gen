import { getAnthropicClient } from './anthropic';
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

const MODEL = 'claude-haiku-4-5-20251001';
const DEFAULT_TIMEOUT_MS = 10_000;
const TOOL_NAME = 'emit_animation_spec';

const SYSTEM_PROMPT = `You are an animation parameter extractor for a 2D pixel-fish sprite generator.
You must call the tool \`${TOOL_NAME}\` exactly once with structured arguments.

Vocabulary (use these values verbatim):
- entity_type: "fish"
- animation_type: one of swim_slow | turn | approach_food | eat
- required_regions / optional_regions: subset of [body, tail, mouth, fin]
- params.speed: slow | medium
- params.amplitude: small | medium
- params.emphasis: none | tail | mouth | fin
- params.loop: true (default) | false

Mapping hints:
- "ゆっくり泳ぐ" / "swim slowly" -> swim_slow, requires [body, tail]
- "向きを変える" / "turn around" -> turn, requires [body, tail]
- "餌に近づく" / "approach food" -> approach_food, requires [body, tail]
- "食べる" / "餌を食べる" / "open mouth" -> eat, requires [body, tail, mouth]

Always include "body" in required_regions. Pick optional_regions for parts the
animation may emphasize (e.g. fin during turn). Set params.loop=false ONLY when
the prompt explicitly says "once" / "1回" / "single play"; otherwise true.`;

export type ParsePromptOptions = {
  /** Override for tests / timeouts. */
  timeoutMs?: number;
  /** Optional source image (base64 PNG without data: prefix) attached as a content block. */
  sourceImageBase64?: string | null;
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

  const parsed = llmAnimationSpecSchema.safeParse(toolUse.input);
  if (!parsed.success) {
    throw new InvalidLlmResponseError(
      'tool_use input failed schema validation',
      parsed.error.issues,
    );
  }
  return parsed.data;
};
