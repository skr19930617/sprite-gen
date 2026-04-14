import { describe, expect, it } from 'vitest';
import {
  buildProjectJson,
  type DraftRowForSerialize,
  type ProjectIdentForSerialize,
} from '@/server/projects/serialize';
import { projectJsonSchema } from '@/server/projects/project-json-schema';

const baseDraft: DraftRowForSerialize = {
  id: '11111111-1111-1111-1111-111111111111',
  user_id: '22222222-2222-2222-2222-222222222222',
  prompt: '餌を食べる',
  llm_result: {
    entity_type: 'fish',
    animation_type: 'eat',
    required_regions: ['body', 'tail', 'mouth'],
    optional_regions: ['fin'],
    params: {
      speed: 'slow',
      amplitude: 'small',
      emphasis: 'mouth',
      loop: false,
    },
  },
  final_animation_type: 'swim_slow',
  final_params: {
    speed: 'medium',
    amplitude: 'medium',
    emphasis: 'none',
    loop: true,
  },
  created_at: '2026-04-13T12:00:00.000Z',
};

const baseProject: ProjectIdentForSerialize = {
  id: '33333333-3333-3333-3333-333333333333',
  user_id: '22222222-2222-2222-2222-222222222222',
  created_at: '2026-04-13T12:00:00.000Z',
  updated_at: '2026-04-13T12:00:00.000Z',
};

describe('buildProjectJson', () => {
  it("'new' scope writes final paths and uses now() for created+updated", () => {
    const json = buildProjectJson({
      scope: 'final',
      draft: baseDraft,
      project: baseProject,
    });
    expect(projectJsonSchema.safeParse(json).success).toBe(true);
    expect(json.source_image_path).toBe(
      `${baseProject.user_id}/${baseProject.id}/source.png`,
    );
    expect(json.outputs.gif_path).toBe(
      `${baseProject.user_id}/${baseProject.id}/result.gif`,
    );
    expect(json.outputs.spritesheet_path).toBe(
      `${baseProject.user_id}/${baseProject.id}/spritesheet.png`,
    );
    expect(json.created_at).toBe(json.updated_at);
    expect(json.renderer_version).toBe(1);
    expect(json.version).toBe(1);
  });

  it("'overwrite' preserves created_at and refreshes updated_at", () => {
    const earlier = '2026-04-10T00:00:00.000Z';
    const now = '2026-04-13T12:34:56.000Z';
    const json = buildProjectJson({
      scope: 'final',
      draft: baseDraft,
      project: { ...baseProject, created_at: earlier, updated_at: now },
    });
    expect(json.created_at).toBe(earlier);
    expect(json.updated_at).toBe(now);
  });

  it("'duplicate' rewrites all paths to the new project_id", () => {
    const dupId = '44444444-4444-4444-4444-444444444444';
    const json = buildProjectJson({
      scope: 'final',
      draft: baseDraft,
      project: {
        id: dupId,
        user_id: baseProject.user_id,
        created_at: '2026-04-13T13:00:00.000Z',
        updated_at: '2026-04-13T13:00:00.000Z',
      },
    });
    expect(json.source_image_path).toContain(`/${dupId}/`);
    expect(json.mask_image_path).toContain(`/${dupId}/`);
    expect(json.outputs.gif_path).toContain(`/${dupId}/`);
    expect(json.outputs.spritesheet_path).toContain(`/${dupId}/`);
  });

  it('preserves llm_result byte-identical even when user overrides final_*', () => {
    const json = buildProjectJson({
      scope: 'final',
      draft: baseDraft,
      project: baseProject,
    });
    expect(json.llm_result.animation_type).toBe('eat');
    expect(json.llm_result.params.loop).toBe(false);
    expect(json.final_animation_type).toBe('swim_slow');
    expect(json.final_params.loop).toBe(true);
  });

  it('rejects extra top-level keys', () => {
    const json = buildProjectJson({
      scope: 'final',
      draft: baseDraft,
      project: baseProject,
    }) as Record<string, unknown>;
    json.bonus = 'extra';
    expect(projectJsonSchema.safeParse(json).success).toBe(false);
  });

  it('rejects numeric final_params (D9.1 vocabulary contract)', () => {
    const json = buildProjectJson({
      scope: 'final',
      draft: baseDraft,
      project: baseProject,
    }) as Record<string, unknown>;
    (json.final_params as Record<string, unknown>).speed = 0.7;
    expect(projectJsonSchema.safeParse(json).success).toBe(false);
  });

  it("'draft' scope writes draft paths under user_id/drafts/draft_id", () => {
    const json = buildProjectJson({ scope: 'draft', draft: baseDraft });
    expect(json.source_image_path).toBe(
      `${baseDraft.user_id}/drafts/${baseDraft.id}/source.png`,
    );
    expect(json.outputs.gif_path).toContain('/drafts/');
  });

  it('throws when llm_result is missing/invalid', () => {
    expect(() =>
      buildProjectJson({
        scope: 'final',
        draft: { ...baseDraft, llm_result: null },
        project: baseProject,
      }),
    ).toThrow();
  });

  it('schema rejects non-UTC offset timestamps (must be Z-suffixed)', () => {
    const json = buildProjectJson({
      scope: 'final',
      draft: baseDraft,
      project: baseProject,
    }) as Record<string, unknown>;
    json.created_at = '2026-04-13T12:00:00+09:00';
    expect(projectJsonSchema.safeParse(json).success).toBe(false);
    json.created_at = '2026-04-13T03:00:00.000Z';
    json.updated_at = '2026-04-13T12:00:00+09:00';
    expect(projectJsonSchema.safeParse(json).success).toBe(false);
  });

  it("'draft' scope updated_at is ISO8601 UTC with trailing Z regardless of host TZ", () => {
    // Simulate running with different host timezones; Node's Date.toISOString()
    // always emits UTC+Z independent of process.env.TZ, so this asserts the
    // serializer does not accidentally swap in a local-offset formatter.
    const original = process.env.TZ;
    try {
      for (const tz of ['Asia/Tokyo', 'America/Los_Angeles', 'UTC']) {
        process.env.TZ = tz;
        const json = buildProjectJson({ scope: 'draft', draft: baseDraft });
        expect(json.created_at).toBe(baseDraft.created_at);
        expect(json.updated_at).toMatch(/Z$/);
        expect(projectJsonSchema.safeParse(json).success).toBe(true);
      }
    } finally {
      process.env.TZ = original;
    }
  });

  it("'final' scope passes through pre-normalized UTC timestamps unchanged across TZ", () => {
    const original = process.env.TZ;
    try {
      const fixedCreated = '2026-04-10T00:00:00.000Z';
      const fixedUpdated = '2026-04-13T12:34:56.000Z';
      const outputs: string[] = [];
      for (const tz of ['Asia/Tokyo', 'America/Los_Angeles', 'UTC']) {
        process.env.TZ = tz;
        const json = buildProjectJson({
          scope: 'final',
          draft: baseDraft,
          project: {
            ...baseProject,
            created_at: fixedCreated,
            updated_at: fixedUpdated,
          },
        });
        expect(json.created_at).toBe(fixedCreated);
        expect(json.updated_at).toBe(fixedUpdated);
        outputs.push(JSON.stringify(json));
      }
      // Byte-identical across timezones.
      expect(new Set(outputs).size).toBe(1);
    } finally {
      process.env.TZ = original;
    }
  });
});
