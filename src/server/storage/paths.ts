/**
 * Single source of truth for Supabase Storage paths.
 * RLS gates by the first segment (= owning user_id), so all helpers MUST
 * place user_id at the front.
 */

export const STORAGE_BUCKET = 'projects';

export type DraftArtifact =
  | 'source.png'
  | 'mask.png'
  | 'result.gif'
  | 'spritesheet.png'
  | 'project.json';

export const draftDir = (userId: string, draftId: string): string =>
  `${userId}/drafts/${draftId}`;

export const draftPath = (
  userId: string,
  draftId: string,
  artifact: DraftArtifact,
): string => `${draftDir(userId, draftId)}/${artifact}`;

export const projectDir = (userId: string, projectId: string): string =>
  `${userId}/${projectId}`;

export const projectPath = (
  userId: string,
  projectId: string,
  artifact: DraftArtifact,
): string => `${projectDir(userId, projectId)}/${artifact}`;
