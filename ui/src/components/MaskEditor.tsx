import { useState } from "react";
import { MaskCanvas } from "./MaskCanvas";

export type Label = "body" | "tail" | "mouth" | "fin";
const LABELS: Label[] = ["body", "tail", "mouth", "fin"];

export function MaskEditor(props: {
  projectId: string;
  sourceUrl: string;
  width: number;
  height: number;
  initialLabel?: Label;
  onMaskSaved: (label: Label, hasContent: boolean) => void;
}) {
  const [active, setActive] = useState<Label>(props.initialLabel ?? "tail");
  const [tool, setTool] = useState<"pen" | "eraser" | "bucket">("pen");
  const [brushSize, setBrushSize] = useState(8);

  return (
    <div>
      <div style={{ display: "flex", gap: "0.5rem", marginBottom: "0.5rem", flexWrap: "wrap" }}>
        <strong>Label:</strong>
        {LABELS.map((lbl) => (
          <button
            key={lbl}
            onClick={() => setActive(lbl)}
            style={{
              fontWeight: active === lbl ? "bold" : "normal",
              border: active === lbl ? "2px solid black" : "1px solid #aaa",
            }}
          >
            {lbl}
          </button>
        ))}
        <span style={{ marginLeft: "1rem" }}>
          <strong>Tool:</strong>{" "}
          {(["pen", "eraser", "bucket"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTool(t)}
              style={{ fontWeight: tool === t ? "bold" : "normal", marginRight: "0.25rem" }}
            >
              {t}
            </button>
          ))}
        </span>
        <span>
          <strong>Brush:</strong>{" "}
          <input
            type="range"
            min={1}
            max={32}
            value={brushSize}
            onChange={(e) => setBrushSize(Number(e.target.value))}
          />{" "}
          {brushSize}
        </span>
      </div>
      <MaskCanvas
        projectId={props.projectId}
        sourceUrl={props.sourceUrl}
        activeLabel={active}
        width={props.width}
        height={props.height}
        tool={tool}
        brushSize={brushSize}
        onSaved={props.onMaskSaved}
      />
    </div>
  );
}
