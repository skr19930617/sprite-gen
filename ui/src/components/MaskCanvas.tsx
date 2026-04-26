import { useEffect, useRef, useState } from "react";
import { api } from "../lib/api";
import type { Label } from "./MaskEditor";

type Tool = "pen" | "eraser" | "bucket";

const COLORS: Record<Label, string> = {
  body: "rgba(80, 200, 120, 0.5)",
  tail: "rgba(255, 100, 100, 0.6)",
  mouth: "rgba(100, 100, 255, 0.6)",
  fin: "rgba(255, 200, 80, 0.6)",
};

export function MaskCanvas(props: {
  projectId: string;
  sourceUrl: string;
  activeLabel: Label;
  width: number;
  height: number;
  tool: Tool;
  brushSize: number;
  onSaved: (label: Label, hasContent: boolean) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [drawing, setDrawing] = useState(false);
  const [maskBlob, setMaskBlob] = useState<Blob | null>(null);
  const [, setSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [history, setHistory] = useState<ImageData[]>([]);

  // Load existing mask for active label
  useEffect(() => {
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, props.width, props.height);
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      // Draw with the label's color (mask is grayscale white = label region)
      const off = document.createElement("canvas");
      off.width = props.width;
      off.height = props.height;
      const offCtx = off.getContext("2d");
      if (!offCtx) return;
      offCtx.drawImage(img, 0, 0, props.width, props.height);
      const data = offCtx.getImageData(0, 0, props.width, props.height);
      const tinted = ctx.createImageData(props.width, props.height);
      const color = COLORS[props.activeLabel];
      const m = color.match(/rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)/);
      const r = m ? parseInt(m[1], 10) : 255;
      const g = m ? parseInt(m[2], 10) : 0;
      const b = m ? parseInt(m[3], 10) : 0;
      const a = m ? Math.round(parseFloat(m[4]) * 255) : 128;
      for (let i = 0; i < data.data.length; i += 4) {
        if (data.data[i] > 128) {
          tinted.data[i] = r;
          tinted.data[i + 1] = g;
          tinted.data[i + 2] = b;
          tinted.data[i + 3] = a;
        }
      }
      ctx.putImageData(tinted, 0, 0);
      setHistory([ctx.getImageData(0, 0, props.width, props.height)]);
    };
    img.onerror = () => {
      setHistory([ctx.getImageData(0, 0, props.width, props.height)]);
    };
    img.src = `${props.sourceUrl.replace("source.png", `mask/${props.activeLabel}.png`)}?ts=${Date.now()}`;
  }, [props.activeLabel, props.projectId, props.sourceUrl, props.width, props.height]);

  const paintAt = (x: number, y: number) => {
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    if (props.tool === "eraser") {
      ctx.save();
      ctx.globalCompositeOperation = "destination-out";
      ctx.beginPath();
      ctx.arc(x, y, props.brushSize, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    } else {
      ctx.fillStyle = COLORS[props.activeLabel];
      ctx.beginPath();
      ctx.arc(x, y, props.brushSize, 0, Math.PI * 2);
      ctx.fill();
    }
  };

  const flushSave = async (canvas: HTMLCanvasElement) => {
    const grayscale = document.createElement("canvas");
    grayscale.width = canvas.width;
    grayscale.height = canvas.height;
    const gctx = grayscale.getContext("2d");
    if (!gctx) return;
    const data = canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height);
    const out = gctx.createImageData(canvas.width, canvas.height);
    for (let i = 0; i < data.data.length; i += 4) {
      const filled = data.data[i + 3] > 16 ? 255 : 0;
      out.data[i] = filled;
      out.data[i + 1] = filled;
      out.data[i + 2] = filled;
      out.data[i + 3] = 255;
    }
    gctx.putImageData(out, 0, 0);

    grayscale.toBlob(async (blob) => {
      if (!blob) return;
      setMaskBlob(blob);
      setSaveStatus("saving");
      try {
        const res = await api.uploadMask(props.projectId, props.activeLabel, blob);
        setSaveStatus("saved");
        props.onSaved(props.activeLabel, res.has_content);
      } catch {
        setSaveStatus("error");
      }
    }, "image/png");
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    setDrawing(true);
    const rect = e.currentTarget.getBoundingClientRect();
    paintAt(e.clientX - rect.left, e.clientY - rect.top);
  };
  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing) return;
    const rect = e.currentTarget.getBoundingClientRect();
    paintAt(e.clientX - rect.left, e.clientY - rect.top);
  };
  const handlePointerUp = () => {
    if (!drawing) return;
    setDrawing(false);
    const canvas = canvasRef.current;
    if (canvas) {
      const ctx = canvas.getContext("2d");
      if (ctx) {
        setHistory((h) => [...h, ctx.getImageData(0, 0, canvas.width, canvas.height)]);
      }
      void flushSave(canvas);
    }
  };

  const undo = () => {
    setHistory((h) => {
      if (h.length <= 1) return h;
      const next = h.slice(0, -1);
      const ctx = canvasRef.current?.getContext("2d");
      if (ctx) ctx.putImageData(next[next.length - 1], 0, 0);
      return next;
    });
    if (canvasRef.current) void flushSave(canvasRef.current);
  };

  return (
    <div>
      <div style={{ display: "flex", gap: "0.5rem", marginBottom: "0.5rem" }}>
        <button onClick={undo}>Undo</button>
      </div>
      <div
        style={{
          position: "relative",
          width: props.width,
          height: props.height,
          border: "1px solid #ccc",
        }}
      >
        <img
          src={props.sourceUrl}
          alt="source"
          style={{ position: "absolute", inset: 0, width: props.width, height: props.height, opacity: 0.7 }}
        />
        <canvas
          ref={canvasRef}
          width={props.width}
          height={props.height}
          style={{ position: "absolute", inset: 0, cursor: "crosshair" }}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerLeave={handlePointerUp}
        />
      </div>
      {/* Hidden so tests can verify save state changes propagated */}
      <span data-testid="last-mask-blob-size" hidden>
        {maskBlob?.size ?? 0}
      </span>
    </div>
  );
}
