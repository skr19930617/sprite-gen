import { type RenderCoefficients } from './params';
import { compositeOntoBase, extractPatch, transformPatch } from './transform';
import type { DecodedMasks } from './decode-mask';
import { FRAME_COUNT } from './types';
import type { AnimationParams, LlmAnimationSpec } from '@/server/llm/schema';
import { countSetPixels } from '@/lib/mask/correction';
import { REGION_LABELS, type RegionLabel } from '@/lib/mask/palette';

type FrameCtx = {
  width: number;
  height: number;
  sourceRgba: Buffer;
  masks: DecodedMasks;
  coeffs: RenderCoefficients;
  params: AnimationParams;
};

const TWO_PI = Math.PI * 2;

const buildBaseFrame = (
  width: number,
  height: number,
  sourceRgba: Buffer,
  masks: DecodedMasks,
  excludedRegions: RegionLabel[],
): Buffer => {
  const out = Buffer.alloc(width * height * 4);
  // Fill with the source pixels EXCLUDING any region that will be re-composited
  // separately (so it doesn't double-render on top of itself).
  const excludeSet = new Set(excludedRegions);
  for (let i = 0; i < width * height; i++) {
    const inExcluded = excludeSet.size > 0 && excludeSet.has;
    let isExcluded = false;
    if (excludeSet.size > 0) {
      for (const r of excludedRegions) {
        if (masks.layers[r].data[i] === 1) {
          isExcluded = true;
          break;
        }
      }
    }
    void inExcluded;
    if (!isExcluded) {
      const o = i * 4;
      out[o] = sourceRgba[o] ?? 0;
      out[o + 1] = sourceRgba[o + 1] ?? 0;
      out[o + 2] = sourceRgba[o + 2] ?? 0;
      out[o + 3] = sourceRgba[o + 3] ?? 0;
    }
  }
  return out;
};

const swimSlowFrame = async (ctx: FrameCtx, t: number): Promise<Buffer> => {
  const { width, height, sourceRgba, masks, coeffs } = ctx;
  const tailEmphasis =
    coeffs.emphasisRegion === 'tail' ? coeffs.emphasisMultiplier : 1;
  const tailRotate =
    Math.sin(TWO_PI * t * coeffs.speed) * coeffs.amplitudeDeg * tailEmphasis;

  const finPresent = countSetPixels(masks.layers.fin) > 0;
  const finRotate = finPresent
    ? Math.sin(TWO_PI * t * coeffs.speed + Math.PI / 4) *
      (coeffs.amplitudeDeg / 2) *
      (coeffs.emphasisRegion === 'fin' ? coeffs.emphasisMultiplier : 1)
    : 0;

  const excluded: RegionLabel[] = ['tail'];
  if (finPresent) excluded.push('fin');
  const base = buildBaseFrame(width, height, sourceRgba, masks, excluded);

  if (countSetPixels(masks.layers.tail) > 0) {
    const tailPatch = extractPatch(
      width,
      height,
      sourceRgba,
      masks.layers.tail.data,
    );
    const transformed = await transformPatch(width, height, tailPatch, {
      rotateDeg: tailRotate,
    });
    compositeOntoBase(width, height, base, transformed);
  }
  if (finPresent) {
    const finPatch = extractPatch(
      width,
      height,
      sourceRgba,
      masks.layers.fin.data,
    );
    const transformed = await transformPatch(width, height, finPatch, {
      rotateDeg: finRotate,
    });
    compositeOntoBase(width, height, base, transformed);
  }
  return base;
};

const turnFrame = async (ctx: FrameCtx, t: number): Promise<Buffer> => {
  // Tail amplitude doubled, body scaled vertically with sin envelope.
  const { width, height, sourceRgba, masks, coeffs } = ctx;
  const tailRotate =
    Math.sin(TWO_PI * t * coeffs.speed) * coeffs.amplitudeDeg * 2;
  const bodyScale = 1 + Math.sin(TWO_PI * t) * 0.05;

  const excluded: RegionLabel[] = ['tail', 'body'];
  const base = buildBaseFrame(width, height, sourceRgba, masks, excluded);

  if (countSetPixels(masks.layers.body) > 0) {
    const bodyPatch = extractPatch(
      width,
      height,
      sourceRgba,
      masks.layers.body.data,
    );
    const transformed = await transformPatch(width, height, bodyPatch, {
      scale: bodyScale,
    });
    compositeOntoBase(width, height, base, transformed);
  }
  if (countSetPixels(masks.layers.tail) > 0) {
    const tailPatch = extractPatch(
      width,
      height,
      sourceRgba,
      masks.layers.tail.data,
    );
    const transformed = await transformPatch(width, height, tailPatch, {
      rotateDeg: tailRotate,
    });
    compositeOntoBase(width, height, base, transformed);
  }
  return base;
};

const approachFoodFrame = async (ctx: FrameCtx, t: number): Promise<Buffer> => {
  // swim_slow base + horizontal translation: 5px * (1-cos(πt))/2
  const { width, height } = ctx;
  const base = await swimSlowFrame(ctx, t);
  const dx = Math.round(((1 - Math.cos(Math.PI * t)) / 2) * 5);
  if (dx === 0) return base;
  // Re-composite the entire frame translated.
  const out = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const sx = x - dx;
      if (sx < 0 || sx >= width) continue;
      const oSrc = (y * width + sx) * 4;
      const oDst = (y * width + x) * 4;
      out[oDst] = base[oSrc] ?? 0;
      out[oDst + 1] = base[oSrc + 1] ?? 0;
      out[oDst + 2] = base[oSrc + 2] ?? 0;
      out[oDst + 3] = base[oSrc + 3] ?? 0;
    }
  }
  return out;
};

const eatFrame = async (ctx: FrameCtx, t: number): Promise<Buffer> => {
  // First half: approach phase. Second half: mouth open-close.
  const { width, height, sourceRgba, masks, coeffs } = ctx;
  if (t < 0.5) {
    return approachFoodFrame(ctx, t * 2);
  }
  const phase = (t - 0.5) * 2; // 0..1
  // mouth scale_y: 1 -> 0.3 -> 1
  const mouthScale = 1 - 0.7 * Math.sin(Math.PI * phase);
  const mouthEmphasis =
    coeffs.emphasisRegion === 'mouth' ? coeffs.emphasisMultiplier : 1;
  const effectiveScale = 1 - (1 - mouthScale) * mouthEmphasis;

  const excluded: RegionLabel[] = ['mouth'];
  const base = buildBaseFrame(width, height, sourceRgba, masks, excluded);
  if (countSetPixels(masks.layers.mouth) > 0) {
    const mouthPatch = extractPatch(
      width,
      height,
      sourceRgba,
      masks.layers.mouth.data,
    );
    const transformed = await transformPatch(width, height, mouthPatch, {
      scale: effectiveScale,
    });
    compositeOntoBase(width, height, base, transformed);
  }
  return base;
};

const bodyOnlyFallbackFrame = async (
  ctx: FrameCtx,
  t: number,
): Promise<Buffer> => {
  const { width, height, sourceRgba, masks } = ctx;
  // Minimal: gentle horizontal sway of the entire frame ±2px.
  const dx = Math.round(Math.sin(TWO_PI * t) * 2);
  const base = buildBaseFrame(width, height, sourceRgba, masks, []);
  if (dx === 0) return base;
  const out = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const sx = x - dx;
      if (sx < 0 || sx >= width) continue;
      const oSrc = (y * width + sx) * 4;
      const oDst = (y * width + x) * 4;
      out[oDst] = base[oSrc] ?? 0;
      out[oDst + 1] = base[oSrc + 1] ?? 0;
      out[oDst + 2] = base[oSrc + 2] ?? 0;
      out[oDst + 3] = base[oSrc + 3] ?? 0;
    }
  }
  return out;
};

const TEMPLATES = {
  swim_slow: swimSlowFrame,
  turn: turnFrame,
  approach_food: approachFoodFrame,
  eat: eatFrame,
} as const;

export type RenderFramesResult = {
  frames: Buffer[];
  fellBackToBodyOnly: boolean;
};

export const renderFrames = async (
  ctx: FrameCtx,
  animationType: keyof typeof TEMPLATES,
  requiredRegions: readonly RegionLabel[] = [],
): Promise<RenderFramesResult> => {
  // Trigger fallback iff any required region has 0 opaque pixels (strict).
  const fallback = requiredRegions.some(
    (r) => countSetPixels(ctx.masks.layers[r]) === 0,
  );
  const frameFn = fallback ? bodyOnlyFallbackFrame : TEMPLATES[animationType];
  const frames: Buffer[] = [];
  for (let i = 0; i < FRAME_COUNT; i++) {
    const t = i / FRAME_COUNT;
    frames.push(await frameFn(ctx, t));
  }
  return { frames, fellBackToBodyOnly: fallback };
};

export const allRegions = REGION_LABELS;
export type AnyTemplateName = keyof typeof TEMPLATES;
export type SpecForRender = LlmAnimationSpec;
