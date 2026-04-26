import { useEffect, useState } from "react";
import { api, type ProjectDetail } from "../lib/api";
import type { NavigateFn } from "../app/screens";
import { MaskEditor, type Label } from "../components/MaskEditor";

export function AnnotationScreen(props: { projectId: string; onNavigate: NavigateFn }) {
  const [detail, setDetail] = useState<ProjectDetail | null>(null);
  const [maskState, setMaskState] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);
  const [proceedBusy, setProceedBusy] = useState(false);

  const reload = async () => {
    try {
      const d = await api.getProject(props.projectId);
      setDetail(d);
      setMaskState(d.mask_presence);
    } catch (e: any) {
      setError(`Failed to reload (status=${e.status ?? "?"})`);
    }
  };

  useEffect(() => {
    void reload();
  }, [props.projectId]);

  const required = detail?.active_draft.plan?.llm_plan.required_regions ?? [];
  const optional = detail?.active_draft.plan?.llm_plan.optional_regions ?? [];
  const missingRequired = required.filter((lbl) => !maskState[lbl]);
  const skipFriendly = missingRequired.length === 0;

  const onProceed = async () => {
    if (!skipFriendly) return;
    setProceedBusy(true);
    setError(null);
    try {
      await api.postRendererConfig(props.projectId);
      props.onNavigate({ name: "result", projectId: props.projectId });
    } catch (e: any) {
      setError(JSON.stringify(e));
    } finally {
      setProceedBusy(false);
    }
  };

  if (!detail) {
    return (
      <section data-testid="annotation-screen">
        <h2>Annotation</h2>
        <p>Loading…</p>
      </section>
    );
  }

  return (
    <section data-testid="annotation-screen">
      <div style={{ display: "flex", justifyContent: "space-between" }}>
        <h2>Annotation</h2>
        <button onClick={() => props.onNavigate({ name: "input", projectId: props.projectId })}>← Input</button>
      </div>
      <p>
        <strong>required:</strong> {required.join(", ") || "(none)"} —{" "}
        <strong>optional:</strong> {optional.join(", ") || "(none)"}
      </p>
      {missingRequired.length > 0 && (
        <p style={{ color: "darkorange" }}>
          You must paint these masks before continuing: <strong>{missingRequired.join(", ")}</strong>
        </p>
      )}
      <MaskEditor
        projectId={props.projectId}
        sourceUrl={detail.source_url}
        width={detail.output.width}
        height={detail.output.height}
        initialLabel={(missingRequired[0] as Label) ?? "tail"}
        onMaskSaved={async (label, has_content) => {
          setMaskState((s) => ({ ...s, [label]: has_content }));
        }}
      />
      <p>
        Mask presence:{" "}
        {(["body", "tail", "mouth", "fin"] as const).map((lbl) => (
          <span key={lbl} style={{ marginRight: "0.5rem" }}>
            {lbl}: {maskState[lbl] ? "✓" : "—"}
          </span>
        ))}
      </p>
      <button
        onClick={onProceed}
        disabled={!skipFriendly || proceedBusy}
        data-testid="continue-to-renderer-config"
      >
        {skipFriendly
          ? proceedBusy
            ? "Calling Claude…"
            : "Continue without changes"
          : "Paint required masks first"}
      </button>
      {error && <p style={{ color: "red" }}>{error}</p>}
    </section>
  );
}
