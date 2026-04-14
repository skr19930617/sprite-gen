import type { AnimationParams } from '@/server/llm/schema';

/**
 * Single mapping from the fixed enum/boolean `final_params` schema to the
 * internal numeric coefficients the renderer uses. `final_params` is never
 * stored or transmitted in numeric form — this file is the only place numbers
 * appear.
 */

export type RenderCoefficients = {
  /** Time-base multiplier (1.0 = baseline 8fps). */
  speed: number;
  /** Tail/fin oscillation amplitude in degrees. */
  amplitudeDeg: number;
  /** Multiplier applied to the emphasised region's deformation. */
  emphasisMultiplier: number;
  /** Region the emphasis multiplier targets (or null when 'none'). */
  emphasisRegion: 'tail' | 'mouth' | 'fin' | null;
  /** GIF loop count: 0 = infinite, 1 = play once. */
  gifLoopCount: 0 | 1;
};

const SPEED_MAP: Record<AnimationParams['speed'], number> = {
  slow: 0.7,
  medium: 1.0,
};

const AMPLITUDE_MAP: Record<AnimationParams['amplitude'], number> = {
  small: 5,
  medium: 12,
};

export const mapParams = (params: AnimationParams): RenderCoefficients => ({
  speed: SPEED_MAP[params.speed],
  amplitudeDeg: AMPLITUDE_MAP[params.amplitude],
  emphasisMultiplier: params.emphasis === 'none' ? 1.0 : 1.5,
  emphasisRegion: params.emphasis === 'none' ? null : params.emphasis,
  gifLoopCount: params.loop ? 0 : 1,
});
