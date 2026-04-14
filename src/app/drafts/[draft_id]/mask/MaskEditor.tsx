'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  REGION_LABELS,
  REGION_PALETTE,
  type RegionLabel,
} from '@/lib/mask/palette';
import {
  applyMaskCorrection,
  countSetPixels,
  type MaskBuffer,
} from '@/lib/mask/correction';
import { encodeMaskRgba } from '@/lib/mask/encode';
import {
  ANIMATION_TYPES,
  SPEEDS,
  AMPLITUDES,
  EMPHASES,
  llmAnimationSpecSchema,
  type AnimationParams,
  animationParamsSchema,
} from '@/server/llm/schema';

type Tool = 'pen' | 'eraser' | 'bucket';

type Props = {
  draftId: string;
  sourceUrl: string;
  llmResult: unknown;
  initialAnimationType: string | null;
  initialParams: unknown;
};

const buildEmptyMask = (w: number, h: number): MaskBuffer => ({
  width: w,
  height: h,
  data: new Uint8Array(w * h),
});

export default function MaskEditor({
  draftId,
  sourceUrl,
  llmResult,
  initialAnimationType,
  initialParams,
}: Props) {
  const router = useRouter();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [imageData, setImageData] = useState<{
    width: number;
    height: number;
    pixels: Uint8ClampedArray;
    alpha: Uint8Array;
  } | null>(null);
  const [masks, setMasks] = useState<Record<RegionLabel, MaskBuffer> | null>(
    null,
  );
  const undoStackRef = useRef<Record<RegionLabel, MaskBuffer>[]>([]);
  const [activeLabel, setActiveLabel] = useState<RegionLabel>('body');
  const [tool, setTool] = useState<Tool>('pen');
  const [showSource, setShowSource] = useState(true);
  const [zoom, setZoom] = useState(2);
  const drawingRef = useRef(false);
  const [warning, setWarning] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // Animation params (D9.1 fixed enum/boolean schema).
  const llmSpecResult = llmAnimationSpecSchema.safeParse(llmResult);
  const llmSpec = llmSpecResult.success ? llmSpecResult.data : null;
  const initialParamsParsed = animationParamsSchema.safeParse(initialParams);
  const [finalAnimationType, setFinalAnimationType] = useState(
    () =>
      (initialAnimationType ??
        llmSpec?.animation_type ??
        'swim_slow') as (typeof ANIMATION_TYPES)[number],
  );
  const [finalParams, setFinalParams] = useState<AnimationParams>(() =>
    initialParamsParsed.success
      ? initialParamsParsed.data
      : (llmSpec?.params ?? {
          speed: 'medium',
          amplitude: 'medium',
          emphasis: 'none',
          loop: true,
        }),
  );

  // Load the source image -> ImageData -> alpha map -> auto-init body.
  useEffect(() => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.src = sourceUrl;
    img.onload = () => {
      const off = document.createElement('canvas');
      off.width = img.width;
      off.height = img.height;
      const ctx = off.getContext('2d', { willReadFrequently: true });
      if (!ctx) return;
      ctx.drawImage(img, 0, 0);
      const data = ctx.getImageData(0, 0, img.width, img.height);
      const alpha = new Uint8Array(img.width * img.height);
      for (let i = 0; i < alpha.length; i++) {
        alpha[i] = (data.data[i * 4 + 3] ?? 0) > 0 ? 1 : 0;
      }
      setImageData({
        width: img.width,
        height: img.height,
        pixels: data.data,
        alpha,
      });
      const empty = (): Record<RegionLabel, MaskBuffer> => ({
        body: buildEmptyMask(img.width, img.height),
        tail: buildEmptyMask(img.width, img.height),
        mouth: buildEmptyMask(img.width, img.height),
        fin: buildEmptyMask(img.width, img.height),
      });
      const initial = empty();
      // auto-body init
      initial.body.data.set(alpha);
      setMasks(initial);
    };
  }, [sourceUrl]);

  // Repaint canvas whenever masks/zoom/overlay change.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !imageData || !masks) return;
    const { width, height, pixels } = imageData;
    canvas.width = width * zoom;
    canvas.height = height * zoom;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Step 1: source overlay (semi-transparent if showSource).
    if (showSource) {
      const off = document.createElement('canvas');
      off.width = width;
      off.height = height;
      const offCtx = off.getContext('2d');
      if (offCtx) {
        const id = new ImageData(
          new Uint8ClampedArray(
            pixels,
          ) as unknown as Uint8ClampedArray<ArrayBuffer>,
          width,
          height,
        );
        offCtx.putImageData(id, 0, 0);
        ctx.globalAlpha = 0.5;
        ctx.drawImage(off, 0, 0, canvas.width, canvas.height);
        ctx.globalAlpha = 1;
      }
    }

    // Step 2: mask layers (last writer wins).
    const maskRgba = encodeMaskRgba(width, height, masks);
    const maskOff = document.createElement('canvas');
    maskOff.width = width;
    maskOff.height = height;
    const maskCtx = maskOff.getContext('2d');
    if (maskCtx) {
      maskCtx.putImageData(
        new ImageData(
          maskRgba as unknown as Uint8ClampedArray<ArrayBuffer>,
          width,
          height,
        ),
        0,
        0,
      );
      ctx.globalAlpha = 0.7;
      ctx.drawImage(maskOff, 0, 0, canvas.width, canvas.height);
      ctx.globalAlpha = 1;
    }
  }, [imageData, masks, zoom, showSource]);

  const pushUndo = (snapshot: Record<RegionLabel, MaskBuffer>) => {
    undoStackRef.current.push({
      body: { ...snapshot.body, data: new Uint8Array(snapshot.body.data) },
      tail: { ...snapshot.tail, data: new Uint8Array(snapshot.tail.data) },
      mouth: { ...snapshot.mouth, data: new Uint8Array(snapshot.mouth.data) },
      fin: { ...snapshot.fin, data: new Uint8Array(snapshot.fin.data) },
    });
    if (undoStackRef.current.length > 50) undoStackRef.current.shift();
  };

  const applyAt = (clientX: number, clientY: number) => {
    if (!canvasRef.current || !masks || !imageData) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const x = Math.floor((clientX - rect.left) / zoom);
    const y = Math.floor((clientY - rect.top) / zoom);
    if (x < 0 || y < 0 || x >= imageData.width || y >= imageData.height) return;
    const idx = y * imageData.width + x;
    const next = { ...masks, [activeLabel]: { ...masks[activeLabel] } };
    next[activeLabel].data = new Uint8Array(masks[activeLabel].data);
    next[activeLabel].data[idx] = tool === 'eraser' ? 0 : 1;
    setMasks(next);
  };

  const handleBucket = (clientX: number, clientY: number) => {
    if (!canvasRef.current || !masks || !imageData) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const x = Math.floor((clientX - rect.left) / zoom);
    const y = Math.floor((clientY - rect.top) / zoom);
    if (x < 0 || y < 0 || x >= imageData.width || y >= imageData.height) return;
    const startIdx = y * imageData.width + x;
    if ((imageData.alpha[startIdx] ?? 0) === 0) return;

    const next = { ...masks, [activeLabel]: { ...masks[activeLabel] } };
    next[activeLabel].data = new Uint8Array(masks[activeLabel].data);
    const visited = new Uint8Array(imageData.alpha.length);
    const stack: number[] = [startIdx];
    while (stack.length) {
      const i = stack.pop()!;
      if ((visited[i] ?? 0) === 1) continue;
      visited[i] = 1;
      if ((imageData.alpha[i] ?? 0) === 0) continue;
      next[activeLabel].data[i] = 1;
      const cx = i % imageData.width;
      const cy = Math.floor(i / imageData.width);
      if (cx > 0) stack.push(i - 1);
      if (cx < imageData.width - 1) stack.push(i + 1);
      if (cy > 0) stack.push(i - imageData.width);
      if (cy < imageData.height - 1) stack.push(i + imageData.width);
    }
    pushUndo(masks);
    setMasks(next);
  };

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!masks) return;
    if (tool === 'bucket') {
      handleBucket(e.clientX, e.clientY);
      return;
    }
    pushUndo(masks);
    drawingRef.current = true;
    applyAt(e.clientX, e.clientY);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawingRef.current) return;
    applyAt(e.clientX, e.clientY);
  };

  const onPointerUp = () => {
    drawingRef.current = false;
  };

  const onUndo = () => {
    const snapshot = undoStackRef.current.pop();
    if (snapshot) setMasks(snapshot);
  };

  const onCorrect = () => {
    if (!masks || !imageData) return;
    pushUndo(masks);
    const corrected: Record<RegionLabel, MaskBuffer> = {
      body: applyMaskCorrection(masks.body, imageData.alpha),
      tail: applyMaskCorrection(masks.tail, imageData.alpha),
      mouth: applyMaskCorrection(masks.mouth, imageData.alpha),
      fin: applyMaskCorrection(masks.fin, imageData.alpha),
    };
    setMasks(corrected);
  };

  // Keyboard undo
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'z') {
        e.preventDefault();
        onUndo();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const recomputeWarnings = (): string | null => {
    if (!llmSpec || !masks) return null;
    const advisories: string[] = [];
    for (const region of llmSpec.required_regions) {
      const count = countSetPixels(masks[region]);
      if (count === 0) {
        advisories.push(`${region}マスクが空のため body のみで生成されます`);
      } else if (count < 10) {
        advisories.push(`${region}マスクのピクセル数が少なすぎます`);
      }
    }
    return advisories.length ? advisories.join(' / ') : null;
  };

  const onSave = () => {
    if (!masks || !imageData) return;
    const advisory = recomputeWarnings();
    setWarning(advisory);
    const rgba = encodeMaskRgba(imageData.width, imageData.height, masks);
    const off = document.createElement('canvas');
    off.width = imageData.width;
    off.height = imageData.height;
    const ctx = off.getContext('2d');
    if (!ctx) return;
    ctx.putImageData(
      new ImageData(
        rgba as unknown as Uint8ClampedArray<ArrayBuffer>,
        imageData.width,
        imageData.height,
      ),
      0,
      0,
    );
    off.toBlob(async (blob) => {
      if (!blob) return;
      const buf = new Uint8Array(await blob.arrayBuffer());
      const base64 = btoa(String.fromCharCode(...buf));
      startTransition(async () => {
        const res = await fetch('/api/mask/save', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            draft_id: draftId,
            mask_png_base64: base64,
            width: imageData.width,
            height: imageData.height,
            final_animation_type: finalAnimationType,
            final_params: finalParams,
          }),
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) {
          setWarning(json.error ?? `保存に失敗しました (${res.status})`);
          return;
        }
        router.push(`/drafts/${draftId}/preview`);
      });
    }, 'image/png');
  };

  const SegBtn = ({
    options,
    value,
    onChange,
    label,
  }: {
    options: readonly string[];
    value: string;
    onChange: (v: string) => void;
    label: string;
  }) => (
    <fieldset style={{ border: '1px solid #ccc', padding: 8 }}>
      <legend>{label}</legend>
      {options.map((opt) => (
        <label key={opt} style={{ marginRight: 8 }}>
          <input
            type="radio"
            checked={value === opt}
            onChange={() => onChange(opt)}
          />
          {opt}
        </label>
      ))}
    </fieldset>
  );

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <section>
        <h2>LLM 解析結果（読み取り専用）</h2>
        <pre
          style={{
            background: '#f5f5f5',
            padding: 8,
            fontSize: 12,
            overflow: 'auto',
          }}
        >
          {JSON.stringify(llmSpec ?? llmResult ?? {}, null, 2)}
        </pre>
      </section>

      <section>
        <h2>ツール</h2>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button onClick={() => setTool('pen')} aria-pressed={tool === 'pen'}>
            ペン
          </button>
          <button
            onClick={() => setTool('eraser')}
            aria-pressed={tool === 'eraser'}
          >
            消しゴム
          </button>
          <button
            onClick={() => setTool('bucket')}
            aria-pressed={tool === 'bucket'}
          >
            バケツ
          </button>
          <button onClick={onUndo}>Undo</button>
          <button onClick={onCorrect}>補正</button>
          <button onClick={() => setShowSource((s) => !s)}>
            {showSource ? 'ソース非表示' : 'ソース表示'}
          </button>
          <label>
            ズーム
            <input
              type="range"
              min={1}
              max={8}
              value={zoom}
              onChange={(e) => setZoom(Number(e.target.value))}
            />
          </label>
        </div>
      </section>

      <section>
        <h2>ラベル</h2>
        <div style={{ display: 'flex', gap: 8 }}>
          {REGION_LABELS.map((label) => (
            <button
              key={label}
              onClick={() => setActiveLabel(label)}
              aria-pressed={activeLabel === label}
              style={{
                background: `rgb(${REGION_PALETTE[label].join(',')})`,
                color: label === 'body' ? '#000' : '#fff',
                padding: '6px 12px',
                border:
                  activeLabel === label ? '3px solid #000' : '1px solid #888',
              }}
            >
              {label}
            </button>
          ))}
        </div>
      </section>

      <section>
        <h2>キャンバス</h2>
        <canvas
          ref={canvasRef}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerLeave={onPointerUp}
          style={{
            border: '1px solid #888',
            cursor: tool === 'bucket' ? 'cell' : 'crosshair',
            touchAction: 'none',
          }}
        />
      </section>

      <section>
        <h2>アニメーションパラメータ</h2>
        <div
          style={{ display: 'grid', gap: 8, gridTemplateColumns: '1fr 1fr' }}
        >
          <label>
            animation_type
            <select
              value={finalAnimationType}
              onChange={(e) =>
                setFinalAnimationType(
                  e.target.value as (typeof ANIMATION_TYPES)[number],
                )
              }
              style={{ width: '100%' }}
            >
              {ANIMATION_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </label>
          <SegBtn
            label="speed"
            options={SPEEDS}
            value={finalParams.speed}
            onChange={(v) =>
              setFinalParams({ ...finalParams, speed: v as 'slow' | 'medium' })
            }
          />
          <SegBtn
            label="amplitude"
            options={AMPLITUDES}
            value={finalParams.amplitude}
            onChange={(v) =>
              setFinalParams({
                ...finalParams,
                amplitude: v as 'small' | 'medium',
              })
            }
          />
          <SegBtn
            label="emphasis"
            options={EMPHASES}
            value={finalParams.emphasis}
            onChange={(v) =>
              setFinalParams({
                ...finalParams,
                emphasis: v as 'none' | 'tail' | 'mouth' | 'fin',
              })
            }
          />
          <fieldset style={{ border: '1px solid #ccc', padding: 8 }}>
            <legend>loop (read-only)</legend>
            <input type="checkbox" checked={finalParams.loop} disabled />{' '}
            {String(finalParams.loop)}
          </fieldset>
        </div>
      </section>

      {warning ? (
        <p role="alert" style={{ color: '#a60' }}>
          ⚠ {warning}
        </p>
      ) : null}

      <button
        onClick={onSave}
        disabled={pending || !masks}
        style={{ padding: 12 }}
      >
        {pending ? '保存中…' : 'マスクを保存して生成へ'}
      </button>
    </div>
  );
}
