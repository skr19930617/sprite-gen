import { z } from 'zod';

export const ANIMATION_TYPES = [
  'swim_slow',
  'turn',
  'approach_food',
  'eat',
] as const;

export const REGIONS = ['body', 'tail', 'mouth', 'fin'] as const;
export const SPEEDS = ['slow', 'medium'] as const;
export const AMPLITUDES = ['small', 'medium'] as const;
export const EMPHASES = ['none', 'tail', 'mouth', 'fin'] as const;

export const animationTypeSchema = z.enum(ANIMATION_TYPES);
export const regionSchema = z.enum(REGIONS);

export const animationParamsSchema = z
  .object({
    speed: z.enum(SPEEDS),
    amplitude: z.enum(AMPLITUDES),
    emphasis: z.enum(EMPHASES),
    loop: z.boolean(),
  })
  .strict();

export type AnimationParams = z.infer<typeof animationParamsSchema>;

export const llmAnimationSpecSchema = z
  .object({
    entity_type: z.literal('fish'),
    animation_type: animationTypeSchema,
    required_regions: z.array(regionSchema).min(1),
    optional_regions: z.array(regionSchema),
    params: animationParamsSchema,
  })
  .strict();

export type LlmAnimationSpec = z.infer<typeof llmAnimationSpecSchema>;

/**
 * JSON-schema mirror of the Zod schema, used for the Anthropic `tools` API.
 * Keep in sync with `llmAnimationSpecSchema`.
 */
export const llmToolJsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'entity_type',
    'animation_type',
    'required_regions',
    'optional_regions',
    'params',
  ],
  properties: {
    entity_type: { type: 'string', enum: ['fish'] },
    animation_type: {
      type: 'string',
      enum: ANIMATION_TYPES as unknown as string[],
    },
    required_regions: {
      type: 'array',
      minItems: 1,
      items: { type: 'string', enum: REGIONS as unknown as string[] },
    },
    optional_regions: {
      type: 'array',
      items: { type: 'string', enum: REGIONS as unknown as string[] },
    },
    params: {
      type: 'object',
      additionalProperties: false,
      required: ['speed', 'amplitude', 'emphasis', 'loop'],
      properties: {
        speed: { type: 'string', enum: SPEEDS as unknown as string[] },
        amplitude: { type: 'string', enum: AMPLITUDES as unknown as string[] },
        emphasis: { type: 'string', enum: EMPHASES as unknown as string[] },
        loop: { type: 'boolean' },
      },
    },
  },
} as const;
