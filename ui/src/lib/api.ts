/**
 * Shared API client. Vite dev-server proxies /projects and /api to the FastAPI
 * server (see vite.config.ts), so we use relative paths here.
 */

export type ApiError = {
  status: number;
  error_kind?: string;
  detail?: string;
  retriable?: boolean;
};

async function parseError(response: Response): Promise<ApiError> {
  const status = response.status;
  try {
    const body = (await response.json()) as Partial<ApiError> & { detail?: string };
    return {
      status,
      error_kind: body.error_kind,
      detail: body.detail,
      retriable: body.retriable,
    };
  } catch {
    return { status };
  }
}

async function request<T>(method: string, path: string, body?: BodyInit, headers?: Record<string, string>): Promise<T> {
  const response = await fetch(path, {
    method,
    body,
    headers,
  });
  if (!response.ok) {
    throw await parseError(response);
  }
  if (response.status === 204) {
    return undefined as T;
  }
  return (await response.json()) as T;
}

export const api = {
  health: () => request<{ status: string }>("GET", "/healthz"),

  // Project lifecycle (implementations land in later bundles).
  listProjects: () => request<{ projects: ProjectSummary[] }>("GET", "/projects"),
  getProject: (id: string) => request<ProjectDetail>("GET", `/projects/${id}`),
  deleteProject: (id: string) => request<void>("DELETE", `/projects/${id}`),
  duplicateProject: (id: string) =>
    request<{ project_id: string }>("POST", `/projects/${id}/duplicate`),

  // Mask upload — bundle 5
  uploadMask: (id: string, label: string, file: Blob) => {
    const form = new FormData();
    form.append("mask", file);
    return request<MaskUploadResponse>(
      "POST",
      `/projects/${id}/masks/${label}`,
      form,
    );
  },

  // LLM plan — bundle 6
  postLlmPlan: (id: string, prompt: string) =>
    request<LlmPlanResponse>(
      "POST",
      `/projects/${id}/llm-plan`,
      JSON.stringify({ prompt }),
      { "Content-Type": "application/json" },
    ),
  patchActiveDraftParams: (id: string, params: PlanParams) =>
    request<LlmPlanResponse>(
      "PATCH",
      `/projects/${id}/active-draft/params`,
      JSON.stringify({ params }),
      { "Content-Type": "application/json" },
    ),
  deleteActiveDraft: (id: string) =>
    request<void>("DELETE", `/projects/${id}/active-draft`),

  // Renderer config — bundle 9
  postRendererConfig: (id: string) =>
    request<{ renderer_config: RendererConfig }>(
      "POST",
      `/projects/${id}/renderer-config`,
      "{}",
      { "Content-Type": "application/json" },
    ),
  patchActiveDraftRendererConfig: (id: string, args: RendererArgs) =>
    request<{ renderer_config: RendererConfig }>(
      "PATCH",
      `/projects/${id}/active-draft/renderer-config`,
      JSON.stringify({ args }),
      { "Content-Type": "application/json" },
    ),

  // Animations — bundle 10
  postAnimation: (id: string) =>
    request<{ animation: AnimationEntry }>(
      "POST",
      `/projects/${id}/animations`,
      "{}",
      { "Content-Type": "application/json" },
    ),
  postAnimationReRender: (id: string, animationId: string) =>
    request<{ animation: AnimationEntry }>(
      "POST",
      `/projects/${id}/animations/${animationId}/re-render`,
      "{}",
      { "Content-Type": "application/json" },
    ),
  postSeedFrom: (id: string, animationId: string) =>
    request<{ plan: PlanDraft; renderer_config: RendererConfig }>(
      "POST",
      `/projects/${id}/active-draft/seed-from/${animationId}?overwrite=true`,
      "{}",
      { "Content-Type": "application/json" },
    ),

  // Project creation — bundle 4
  createProject: (file: File, output: ProjectOutput) => {
    const form = new FormData();
    form.append("source", file);
    form.append("output", JSON.stringify(output));
    return request<{ project_id: string; source_dim: { w: number; h: number }; output: ProjectOutput; color_mode_converted: boolean }>(
      "POST",
      "/projects",
      form,
    );
  },
};

// ─── Types ────────────────────────────────────────────────────────────────

export type ProjectOutput = {
  width: number;
  height: number;
  fps: number;
  frame_count: number;
  export_format: "gif" | "spritesheet" | "both";
};

export type PlanParams = {
  speed: "slow" | "medium";
  amplitude: "small" | "medium";
  emphasis: "none" | "tail" | "mouth" | "fin";
  loop: boolean;
};

export type LlmPlan = {
  entity_type: "fish";
  animation_type: "swim_slow" | "turn" | "approach_food" | "eat";
  required_regions: string[];
  optional_regions: string[];
  params: PlanParams;
  annotation_schema: { label: string; required: boolean }[];
};

export type PlanDraft = {
  prompt: string;
  llm_plan: LlmPlan;
  params: PlanParams;
  missing_masks: string[];
  plan_token: string;
  created_at: string;
};

export type LlmPlanResponse = {
  resolved_plan: LlmPlan;
  missing_masks: string[];
};

export type RendererArgs = {
  tail_amplitude: number;
  mouth_open_ratio: number;
  body_follow: number;
  fps: number;
  frames: number;
  output_width: number;
  output_height: number;
};

export type RendererConfig = {
  renderer_template: string;
  args: RendererArgs;
  loop: boolean;
  plan_token?: string;
  created_at?: string;
};

export type MaskUploadResponse = {
  label: string;
  persisted_path: string;
  dims: { w: number; h: number };
  mask_url: string;
  has_content: boolean;
};

export type AnimationEntry = {
  animation_id: string;
  prompt: string;
  llm_plan: LlmPlan;
  params: PlanParams;
  annotation: { labels_present: string[] };
  renderer_config_path: string;
  outputs: { gif_path: string | null; spritesheet_path: string | null };
  renderer_version: number;
  created_at: string;
  updated_at: string;
  // Server-resolved view-only fields
  renderer_config?: RendererConfig;
  outputs_urls?: { gif_url: string | null; spritesheet_url: string | null };
};

export type ProjectSummary = {
  project_id: string;
  thumbnail_b64?: string;
  animation_summaries: { animation_id: string; animation_type: string }[];
  updated_at: string;
};

export type ProjectDetail = {
  project_id: string;
  schema_version: "v3";
  entity_type: "fish";
  source_url: string;
  masks: Record<string, string>;
  mask_dir: string;
  output: ProjectOutput;
  animations: AnimationEntry[];
  mask_presence: Record<string, boolean>;
  active_draft: {
    has_plan: boolean;
    has_renderer_config: boolean;
    plan?: PlanDraft;
    renderer_config?: RendererConfig;
  };
  created_at: string;
  updated_at: string;
};
