import { z } from 'zod';
import {
  animationParamsSchema,
  animationTypeSchema,
  llmAnimationSpecSchema,
} from '@/server/llm/schema';
import { REGION_LABELS } from '@/lib/mask/palette';

export const PROJECT_JSON_VERSION = 1 as const;

export const regionPaletteSchema = z
  .object({
    body: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    tail: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    mouth: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    fin: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  })
  .strict();

export const outputsSchema = z
  .object({
    gif_path: z.string().min(1),
    spritesheet_path: z.string().min(1),
  })
  .strict();

export const projectJsonSchema = z
  .object({
    version: z.literal(PROJECT_JSON_VERSION),
    entity_type: z.literal('fish'),
    source_image_path: z.string().min(1),
    mask_image_path: z.string().min(1),
    prompt: z.string().min(1),
    llm_result: llmAnimationSpecSchema,
    final_animation_type: animationTypeSchema,
    final_params: animationParamsSchema,
    region_palette: regionPaletteSchema,
    outputs: outputsSchema,
    renderer_version: z.number().int().positive(),
    // Enforce ISO8601 UTC with trailing `Z` (no `+09:00`-style offsets).
    // See design D9.1 timestamp UTC contract.
    created_at: z.string().datetime({ offset: false }),
    updated_at: z.string().datetime({ offset: false }),
  })
  .strict();

export type ProjectJson = z.infer<typeof projectJsonSchema>;
export type RegionPalette = z.infer<typeof regionPaletteSchema>;

export const REGION_PALETTE_HEX: RegionPalette = {
  body: '#FFFFFF',
  tail: '#0000FF',
  mouth: '#FF0000',
  fin: '#00FF00',
};

void REGION_LABELS;
