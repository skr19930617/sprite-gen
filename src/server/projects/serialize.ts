import {
  PROJECT_JSON_VERSION,
  REGION_PALETTE_HEX,
  type ProjectJson,
} from './project-json-schema';
import { RENDERER_VERSION } from '@/server/renderer/types';
import { draftPath, projectPath } from '@/server/storage/paths';
import {
  animationParamsSchema,
  animationTypeSchema,
  llmAnimationSpecSchema,
  type AnimationParams,
  type LlmAnimationSpec,
} from '@/server/llm/schema';

export type DraftRowForSerialize = {
  id: string;
  user_id: string;
  prompt: string;
  llm_result: unknown;
  final_animation_type: string | null;
  final_params: unknown;
  created_at: string;
};

export type ProjectIdentForSerialize = {
  id: string;
  user_id: string;
  created_at: string;
  updated_at: string;
};

export type SerializeArgs =
  | {
      scope: 'draft';
      draft: DraftRowForSerialize;
    }
  | {
      scope: 'final';
      draft: DraftRowForSerialize;
      project: ProjectIdentForSerialize;
    };

const ensureSpec = (raw: unknown): LlmAnimationSpec => {
  const parsed = llmAnimationSpecSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error('serialize: missing/invalid llm_result on draft');
  }
  return parsed.data;
};

const ensureFinalAnimation = (
  raw: string | null,
  fallback: LlmAnimationSpec['animation_type'],
): LlmAnimationSpec['animation_type'] => {
  if (raw === null) return fallback;
  const parsed = animationTypeSchema.safeParse(raw);
  if (!parsed.success)
    throw new Error('serialize: invalid final_animation_type');
  return parsed.data;
};

const ensureFinalParams = (
  raw: unknown,
  fallback: AnimationParams,
): AnimationParams => {
  if (raw === null || raw === undefined) return fallback;
  const parsed = animationParamsSchema.safeParse(raw);
  if (!parsed.success) throw new Error('serialize: invalid final_params');
  return parsed.data;
};

/**
 * Single source of truth for project.json bytes. Both `/api/generate`
 * (draft scope, intermediate snapshot) and `/api/projects/save` (final scope)
 * route through this helper so the file shape and timestamp semantics stay
 * consistent.
 */
export const buildProjectJson = (args: SerializeArgs): ProjectJson => {
  const spec = ensureSpec(args.draft.llm_result);
  const finalType = ensureFinalAnimation(
    args.draft.final_animation_type,
    spec.animation_type,
  );
  const finalParams = ensureFinalParams(args.draft.final_params, spec.params);

  let sourcePath: string;
  let maskPath: string;
  let gifPath: string;
  let spritesheetPath: string;
  let createdAt: string;
  let updatedAt: string;

  if (args.scope === 'draft') {
    sourcePath = draftPath(args.draft.user_id, args.draft.id, 'source.png');
    maskPath = draftPath(args.draft.user_id, args.draft.id, 'mask.png');
    gifPath = draftPath(args.draft.user_id, args.draft.id, 'result.gif');
    spritesheetPath = draftPath(
      args.draft.user_id,
      args.draft.id,
      'spritesheet.png',
    );
    createdAt = args.draft.created_at;
    updatedAt = new Date().toISOString();
  } else {
    sourcePath = projectPath(
      args.project.user_id,
      args.project.id,
      'source.png',
    );
    maskPath = projectPath(args.project.user_id, args.project.id, 'mask.png');
    gifPath = projectPath(args.project.user_id, args.project.id, 'result.gif');
    spritesheetPath = projectPath(
      args.project.user_id,
      args.project.id,
      'spritesheet.png',
    );
    createdAt = args.project.created_at;
    updatedAt = args.project.updated_at;
  }

  return {
    version: PROJECT_JSON_VERSION,
    entity_type: 'fish',
    source_image_path: sourcePath,
    mask_image_path: maskPath,
    prompt: args.draft.prompt,
    llm_result: spec,
    final_animation_type: finalType,
    final_params: finalParams,
    region_palette: REGION_PALETTE_HEX,
    outputs: {
      gif_path: gifPath,
      spritesheet_path: spritesheetPath,
    },
    renderer_version: RENDERER_VERSION,
    created_at: createdAt,
    updated_at: updatedAt,
  };
};

export const serializeProjectJson = (args: SerializeArgs): Buffer =>
  Buffer.from(JSON.stringify(buildProjectJson(args), null, 2), 'utf8');
