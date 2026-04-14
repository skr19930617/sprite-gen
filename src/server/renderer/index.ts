import sharp from 'sharp';
import {
  rendererInputSchema,
  type RendererInput,
  type RendererOutput,
  RENDERER_VERSION,
  RENDER_TIMEOUT_MS,
} from './types';
import { decodeMaskPng } from './decode-mask';
import { mapParams } from './params';
import { renderFrames } from './templates';
import { encodeGif, encodeSpritesheet } from './encode';

export class RenderTimeoutError extends Error {
  override readonly name = 'RenderTimeoutError';
}

const withTimeout = async <T>(
  promise: Promise<T>,
  ms: number,
  controller?: AbortController,
): Promise<T> => {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller?.abort();
      reject(new RenderTimeoutError(`render exceeded ${ms}ms`));
    }, ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
};

const innerRender = async (input: RendererInput): Promise<RendererOutput> => {
  // Decode source RGBA + dims.
  const sourceImage = sharp(input.source).ensureAlpha();
  const meta = await sourceImage.metadata();
  const width = meta.width ?? 0;
  const height = meta.height ?? 0;
  if (!width || !height) {
    throw new Error('renderer: invalid source image dimensions');
  }
  const sourceRgba = await sourceImage.raw().toBuffer();

  // Decode mask palette PNG into 4 boolean layers.
  const masks = await decodeMaskPng(input.mask);
  if (masks.width !== width || masks.height !== height) {
    throw new Error('renderer: mask dimensions differ from source');
  }

  const coeffs = mapParams(input.params);
  const { frames, fellBackToBodyOnly } = await renderFrames(
    { width, height, sourceRgba, masks, coeffs, params: input.params },
    input.animation_type,
    input.required_regions ?? [],
  );

  const gif = encodeGif(frames, width, height, coeffs.gifLoopCount);
  const spritesheet = await encodeSpritesheet(frames, width, height);
  return {
    gif,
    spritesheet,
    rendererVersion: RENDERER_VERSION,
    frameCount: frames.length,
    width,
    height,
    fellBackToBodyOnly,
  };
};

export const render = async (
  input: unknown,
  options: { timeoutMs?: number } = {},
): Promise<RendererOutput> => {
  const parsed = rendererInputSchema.safeParse(input);
  if (!parsed.success) {
    throw new Error(`renderer: invalid input — ${parsed.error.message}`);
  }
  const validated = parsed.data as RendererInput;
  return await withTimeout(
    innerRender(validated),
    options.timeoutMs ?? RENDER_TIMEOUT_MS,
  );
};

export { RENDERER_VERSION } from './types';
