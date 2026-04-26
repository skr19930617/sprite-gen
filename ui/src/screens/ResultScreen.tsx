import { useEffect, useState } from "react";
import {
  api,
  type AnimationEntry,
  type ProjectDetail,
  type RendererArgs,
  type RendererConfig,
} from "../lib/api";
import type { NavigateFn } from "../app/screens";

export function ResultScreen(props: { projectId: string; onNavigate: NavigateFn }) {
  const [detail, setDetail] = useState<ProjectDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [args, setArgs] = useState<RendererArgs | null>(null);
  const [renderingState, setRenderingState] = useState<"idle" | "rendering" | "done" | "error">("idle");
  const [savingArgs, setSavingArgs] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [activeAnimationId, setActiveAnimationId] = useState<string | null>(null);

  const reload = async () => {
    try {
      const d = await api.getProject(props.projectId);
      setDetail(d);
      const draftRc = d.active_draft.renderer_config;
      if (draftRc) {
        setArgs(draftRc.args);
      } else {
        setArgs(null);
      }
    } catch (e: any) {
      setError(`Failed to reload (status=${e.status ?? "?"})`);
    }
  };

  useEffect(() => {
    void reload();
  }, [props.projectId]);

  const onArgChange = async (next: RendererArgs) => {
    setArgs(next);
    setSavingArgs("saving");
    try {
      await api.patchActiveDraftRendererConfig(props.projectId, next);
      setSavingArgs("saved");
    } catch {
      setSavingArgs("error");
    }
  };

  const onRender = async () => {
    setRenderingState("rendering");
    setError(null);
    try {
      let res;
      if (activeAnimationId) {
        res = await api.postAnimationReRender(props.projectId, activeAnimationId);
      } else {
        res = await api.postAnimation(props.projectId);
      }
      setActiveAnimationId(res.animation.animation_id);
      setRenderingState("done");
      await reload();
    } catch (e: any) {
      setRenderingState("error");
      setError(JSON.stringify(e));
    }
  };

  const onRegenerate = async (animation: AnimationEntry) => {
    setError(null);
    try {
      await api.postSeedFrom(props.projectId, animation.animation_id);
      setActiveAnimationId(animation.animation_id);
      await reload();
    } catch (e: any) {
      setError(JSON.stringify(e));
    }
  };

  const onAddAnother = () => {
    setActiveAnimationId(null);
    props.onNavigate({ name: "input", projectId: props.projectId });
  };

  if (!detail) {
    return (
      <section data-testid="result-screen">
        <h2>Result</h2>
        <p>Loading…</p>
      </section>
    );
  }

  return (
    <section data-testid="result-screen">
      <div style={{ display: "flex", justifyContent: "space-between" }}>
        <h2>Result</h2>
        <button onClick={() => props.onNavigate({ name: "library" })}>Back to library</button>
      </div>

      {detail.active_draft.has_renderer_config && args && (
        <RendererConfigForm
          renderer_config={detail.active_draft.renderer_config!}
          args={args}
          onChange={onArgChange}
          savingState={savingArgs}
          onRender={onRender}
          renderingState={renderingState}
          activeAnimationId={activeAnimationId}
        />
      )}

      <h3 style={{ marginTop: "1.5rem" }}>Animations ({detail.animations.length})</h3>
      <ul>
        {detail.animations.map((a) => (
          <li key={a.animation_id} style={{ marginBottom: "1rem" }}>
            <strong>{a.animation_id}</strong> — {a.llm_plan.animation_type} — created {a.created_at}
            {a.outputs_urls?.gif_url && (
              <div>
                <img
                  src={a.outputs_urls.gif_url}
                  alt={`gif for ${a.animation_id}`}
                  style={{ maxWidth: 256, border: "1px solid #ccc" }}
                />
              </div>
            )}
            {a.outputs_urls?.spritesheet_url && (
              <div>
                <img
                  src={a.outputs_urls.spritesheet_url}
                  alt={`spritesheet for ${a.animation_id}`}
                  style={{ maxWidth: 512, border: "1px solid #ccc" }}
                />
              </div>
            )}
            <p>
              <button onClick={() => onRegenerate(a)} data-testid={`regenerate-${a.animation_id}`}>
                Re-generate (overwrite this entry)
              </button>
            </p>
          </li>
        ))}
      </ul>

      <button onClick={onAddAnother} data-testid="add-another-animation">
        + Add another animation (new prompt → new entry)
      </button>

      {error && <p style={{ color: "red" }}>{error}</p>}
      <p>
        <small>
          Save state: animation entries are persisted by the server on every successful
          POST/PATCH; nothing else needs to be saved manually.
        </small>
      </p>
    </section>
  );
}

function RendererConfigForm(props: {
  renderer_config: RendererConfig;
  args: RendererArgs;
  onChange: (next: RendererArgs) => void;
  savingState: "idle" | "saving" | "saved" | "error";
  onRender: () => void;
  renderingState: "idle" | "rendering" | "done" | "error";
  activeAnimationId: string | null;
}) {
  const set = (key: keyof RendererArgs, value: number) =>
    props.onChange({ ...props.args, [key]: value });

  return (
    <fieldset style={{ border: "1px solid #ccc", padding: "0.5rem", marginTop: "1rem" }}>
      <legend>
        Renderer config — {props.renderer_config.renderer_template} (loop={String(props.renderer_config.loop)})
      </legend>
      <div style={{ display: "grid", gridTemplateColumns: "auto auto auto", gap: "0.5rem" }}>
        <label>
          tail_amplitude:{" "}
          <input
            type="number"
            min={0}
            max={1}
            step={0.05}
            value={props.args.tail_amplitude}
            onChange={(e) => set("tail_amplitude", Number(e.target.value))}
          />
        </label>
        <label>
          mouth_open_ratio:{" "}
          <input
            type="number"
            min={0}
            max={1}
            step={0.05}
            value={props.args.mouth_open_ratio}
            onChange={(e) => set("mouth_open_ratio", Number(e.target.value))}
          />
        </label>
        <label>
          body_follow:{" "}
          <input
            type="number"
            min={0}
            max={0.5}
            step={0.05}
            value={props.args.body_follow}
            onChange={(e) => set("body_follow", Number(e.target.value))}
          />
        </label>
      </div>
      <p>Save: {props.savingState}</p>
      <button onClick={props.onRender} disabled={props.renderingState === "rendering"} data-testid="render-now">
        {props.renderingState === "rendering"
          ? "Rendering…"
          : props.activeAnimationId
            ? "Re-render in place"
            : "Render"}
      </button>
    </fieldset>
  );
}
