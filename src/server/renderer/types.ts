import { z } from 'zod';
import {
  animationParamsSchema,
  animationTypeSchema,
  type LlmAnimationSpec,
} from '@/server/llm/schema';
import { REGION_LABELS } from '@/lib/mask/palette';

export const RENDERER_VERSION = 1 as const;
export const FRAME_COUNT = 16;
export const FRAME_DURATION_MS = 125; // 8fps
export const RENDER_TIMEOUT_MS = 20_000;

export const rendererInputSchema = z.object({
  source: z.instanceof(Buffer),
  mask: z.instanceof(Buffer),
  animation_type: animationTypeSchema,
  params: animationParamsSchema,
  required_regions: z.array(z.enum(REGION_LABELS)).optional(),
});

export type RendererInput = z.infer<typeof rendererInputSchema> & {
  source: Buffer;
  mask: Buffer;
};

export type RendererOutput = {
  gif: Buffer;
  spritesheet: Buffer;
  rendererVersion: typeof RENDERER_VERSION;
  frameCount: number;
  width: number;
  height: number;
  fellBackToBodyOnly: boolean;
};

export type RendererInputFromSpec = {
  source: Buffer;
  mask: Buffer;
  spec: LlmAnimationSpec;
};
