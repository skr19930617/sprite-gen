declare module 'gifenc' {
  export type RGBA4444 = 'rgba4444';
  export type ColorFormat = RGBA4444 | 'rgb444' | 'rgb565' | 'rgba565';

  export interface FrameOptions {
    palette: number[][];
    delay?: number;
    transparent?: boolean;
    transparentIndex?: number;
    repeat?: number;
    dispose?: number;
  }

  export interface GIFEncoderInstance {
    writeFrame(
      indexed: Uint8Array,
      width: number,
      height: number,
      opts: FrameOptions,
    ): void;
    finish(): void;
    bytes(): Uint8Array;
  }

  export function GIFEncoder(): GIFEncoderInstance;
  export function quantize(
    rgba: Uint8Array | Buffer,
    maxColors: number,
    opts?: { format?: ColorFormat; clearAlpha?: boolean },
  ): number[][];
  export function applyPalette(
    rgba: Uint8Array | Buffer,
    palette: number[][],
    format?: ColorFormat,
  ): Uint8Array;
}
