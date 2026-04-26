import { useEffect, useState } from "react";
import {
  api,
  type LlmPlan,
  type LlmPlanResponse,
  type PlanParams,
  type ProjectDetail,
  type ProjectOutput,
} from "../lib/api";
import type { NavigateFn } from "../app/screens";

const DEFAULT_OUTPUT: ProjectOutput = {
  width: 128,
  height: 128,
  fps: 12,
  frame_count: 8,
  export_format: "both",
};

export function InputScreen(props: { projectId?: string; onNavigate: NavigateFn }) {
  const [pid, setPid] = useState<string | null>(props.projectId ?? null);
  const [detail, setDetail] = useState<ProjectDetail | null>(null);
  const [output, setOutput] = useState<ProjectOutput>(DEFAULT_OUTPUT);
  const [file, setFile] = useState<File | null>(null);
  const [prompt, setPrompt] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [planResp, setPlanResp] = useState<LlmPlanResponse | null>(null);

  useEffect(() => {
    if (!pid) return;
    api
      .getProject(pid)
      .then((d) => {
        setDetail(d);
        setOutput(d.output);
        if (d.active_draft.has_plan && d.active_draft.plan) {
          setPlanResp({
            resolved_plan: d.active_draft.plan.llm_plan,
            missing_masks: d.active_draft.plan.missing_masks,
          });
          setPrompt(d.active_draft.plan.prompt);
        }
      })
      .catch((err) => setError(`Failed to load project (status=${err.status ?? "?"})`));
  }, [pid]);

  const durationSec = (output.frame_count / Math.max(output.fps, 1)).toFixed(2);
  const valid =
    output.width >= 64 &&
    output.width <= 512 &&
    output.height >= 64 &&
    output.height <= 512 &&
    output.fps >= 1 &&
    output.fps <= 30 &&
    output.frame_count >= 2 &&
    output.frame_count <= 32 &&
    (pid !== null || file !== null) &&
    prompt.trim().length > 0;

  const onCreate = async () => {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api.createProject(file, output);
      setPid(res.project_id);
      const d = await api.getProject(res.project_id);
      setDetail(d);
    } catch (e: any) {
      setError(JSON.stringify(e));
    } finally {
      setBusy(false);
    }
  };

  const onPlan = async () => {
    if (!pid) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api.postLlmPlan(pid, prompt.trim());
      setPlanResp(res);
    } catch (e: any) {
      setError(JSON.stringify(e));
    } finally {
      setBusy(false);
    }
  };

  const onProceed = async () => {
    if (!pid || !planResp) return;
    // Always route through annotation, even when missing_masks is empty.
    props.onNavigate({ name: "annotation", projectId: pid });
  };

  return (
    <section data-testid="input-screen" style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
      <div style={{ display: "flex", justifyContent: "space-between" }}>
        <h2>Input</h2>
        <button onClick={() => props.onNavigate({ name: "library" })}>Back to library</button>
      </div>

      {!pid && (
        <div>
          <label>
            Source PNG:&nbsp;
            <input
              type="file"
              accept="image/png"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              data-testid="source-file"
            />
          </label>
        </div>
      )}

      <fieldset style={{ border: "1px solid #ccc", padding: "0.5rem" }}>
        <legend>Output settings</legend>
        <div style={{ display: "grid", gridTemplateColumns: "auto auto auto auto", gap: "0.5rem" }}>
          <label>
            width:{" "}
            <input
              type="number"
              min={64}
              max={512}
              value={output.width}
              onChange={(e) => setOutput({ ...output, width: Number(e.target.value) })}
              disabled={!!pid}
            />
          </label>
          <label>
            height:{" "}
            <input
              type="number"
              min={64}
              max={512}
              value={output.height}
              onChange={(e) => setOutput({ ...output, height: Number(e.target.value) })}
              disabled={!!pid}
            />
          </label>
          <label>
            fps:{" "}
            <input
              type="number"
              min={1}
              max={30}
              value={output.fps}
              onChange={(e) => setOutput({ ...output, fps: Number(e.target.value) })}
              disabled={!!pid}
            />
          </label>
          <label>
            frame_count:{" "}
            <input
              type="number"
              min={2}
              max={32}
              value={output.frame_count}
              onChange={(e) => setOutput({ ...output, frame_count: Number(e.target.value) })}
              disabled={!!pid}
            />
          </label>
          <label style={{ gridColumn: "span 2" }}>
            export_format:{" "}
            <select
              value={output.export_format}
              onChange={(e) =>
                setOutput({ ...output, export_format: e.target.value as ProjectOutput["export_format"] })
              }
              disabled={!!pid}
            >
              <option value="gif">gif</option>
              <option value="spritesheet">spritesheet</option>
              <option value="both">both</option>
            </select>
          </label>
          <span data-testid="duration-sec">duration_sec: {durationSec}s</span>
        </div>
      </fieldset>

      {!pid && (
        <button disabled={!file || busy} onClick={onCreate} data-testid="create-project">
          {busy ? "Uploading…" : "Create project"}
        </button>
      )}

      {pid && (
        <div>
          <label>
            Prompt:
            <br />
            <textarea
              rows={3}
              cols={60}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              data-testid="prompt"
            />
          </label>
          <div>
            <button disabled={!valid || busy || !pid} onClick={onPlan} data-testid="run-llm-plan">
              {busy ? "Calling Claude…" : planResp ? "Re-run plan" : "Run LLM plan"}
            </button>
          </div>
        </div>
      )}

      {planResp && pid && (
        <ParamsEditor
          projectId={pid}
          plan={planResp.resolved_plan}
          missingMasks={planResp.missing_masks}
          onUpdated={(refreshed) => setPlanResp(refreshed)}
          onProceed={onProceed}
        />
      )}

      {error && <p style={{ color: "red" }}>{error}</p>}
      {detail && <small>project_id: {detail.project_id}</small>}
    </section>
  );
}

function ParamsEditor(props: {
  projectId: string;
  plan: LlmPlan;
  missingMasks: string[];
  onUpdated: (resp: LlmPlanResponse) => void;
  onProceed: () => void;
}) {
  const [params, setParams] = useState<PlanParams>(props.plan.params);
  const [savingState, setSavingState] = useState<"idle" | "saving" | "saved" | "error">("idle");

  const update = async (next: PlanParams) => {
    setParams(next);
    setSavingState("saving");
    try {
      await api.patchActiveDraftParams(props.projectId, next);
      setSavingState("saved");
      props.onUpdated({ resolved_plan: { ...props.plan, params: next }, missing_masks: props.missingMasks });
    } catch {
      setSavingState("error");
    }
  };

  return (
    <fieldset style={{ border: "1px solid #ccc", padding: "0.5rem" }}>
      <legend>Resolved plan</legend>
      <p>
        <strong>animation_type:</strong>{" "}
        <span data-testid="animation-type" aria-readonly>
          {props.plan.animation_type}
        </span>{" "}
        <small>(read-only — re-prompt to change)</small>
      </p>
      <p>
        <strong>required_regions:</strong> {props.plan.required_regions.join(", ") || "(none)"}
        <br />
        <strong>optional_regions:</strong> {props.plan.optional_regions.join(", ") || "(none)"}
      </p>
      {props.missingMasks.length > 0 && (
        <p style={{ color: "darkorange" }}>
          missing_masks: {props.missingMasks.join(", ")} — annotation screen will require painting these.
        </p>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "auto auto auto auto", gap: "0.5rem" }}>
        <label>
          speed:{" "}
          <select
            value={params.speed}
            onChange={(e) => update({ ...params, speed: e.target.value as "slow" | "medium" })}
          >
            <option value="slow">slow</option>
            <option value="medium">medium</option>
          </select>
        </label>
        <label>
          amplitude:{" "}
          <select
            value={params.amplitude}
            onChange={(e) => update({ ...params, amplitude: e.target.value as "small" | "medium" })}
          >
            <option value="small">small</option>
            <option value="medium">medium</option>
          </select>
        </label>
        <label>
          emphasis:{" "}
          <select
            value={params.emphasis}
            onChange={(e) => update({ ...params, emphasis: e.target.value as PlanParams["emphasis"] })}
          >
            <option value="none">none</option>
            <option value="tail">tail</option>
            <option value="mouth">mouth</option>
            <option value="fin">fin</option>
          </select>
        </label>
        <label>
          loop:{" "}
          <input
            type="checkbox"
            checked={params.loop}
            onChange={(e) => update({ ...params, loop: e.target.checked })}
          />
        </label>
      </div>
      <p style={{ marginTop: "0.5rem" }}>Save: {savingState}</p>

      <button onClick={props.onProceed} data-testid="proceed-to-annotation">
        Continue to annotation
      </button>
    </fieldset>
  );
}
