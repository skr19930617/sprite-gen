"""Unit tests for sprite_gen.project_store."""

from __future__ import annotations

import io
import json
from pathlib import Path

import numpy as np
import pytest
from PIL import Image

from sprite_gen import project_store
from sprite_gen.project_models import (
    PlanDraft,
    ProjectOutput,
    RendererConfigDraft,
    is_valid_label,
    is_valid_slug,
)


# ---------------------------------------------------------------------------
# Slug / label validation
# ---------------------------------------------------------------------------


def test_slug_accepts_lowercase_alnum_dash() -> None:
    assert is_valid_slug("abc")
    assert is_valid_slug("abc-123")
    assert is_valid_slug("a")
    assert is_valid_slug("a" * 64)


def test_slug_rejects_invalid_inputs() -> None:
    assert not is_valid_slug("Foo")  # uppercase
    assert not is_valid_slug("-foo")  # leading dash
    assert not is_valid_slug("foo bar")  # space
    assert not is_valid_slug("a" * 65)  # too long
    assert not is_valid_slug("../escape")
    assert not is_valid_slug("foo/bar")


def test_label_vocabulary() -> None:
    for lbl in ("body", "tail", "mouth", "fin"):
        assert is_valid_label(lbl)
    assert not is_valid_label("wing")
    assert not is_valid_label("BODY")


# ---------------------------------------------------------------------------
# Project lifecycle
# ---------------------------------------------------------------------------


def _output() -> ProjectOutput:
    return ProjectOutput(width=128, height=128, fps=12, frame_count=8, export_format="both")


def test_create_load_round_trip(tmp_projects_dir: Path) -> None:
    proj = project_store.create_project("demo", _output())
    assert proj.project_id == "demo"
    assert proj.version == 3
    assert proj.entity_type == "fish"
    assert proj.animations == []

    loaded = project_store.load_project("demo")
    assert loaded.to_json() == proj.to_json()


def test_create_rejects_invalid_slug(tmp_projects_dir: Path) -> None:
    with pytest.raises(project_store.InvalidIdError):
        project_store.create_project("Bad ID", _output())


def test_load_missing_project_raises(tmp_projects_dir: Path) -> None:
    with pytest.raises(project_store.ProjectNotFoundError):
        project_store.load_project("nope")


def test_list_project_ids(tmp_projects_dir: Path) -> None:
    project_store.create_project("alpha", _output())
    project_store.create_project("beta", _output())
    ids = project_store.list_project_ids()
    assert ids == ["alpha", "beta"]


def test_delete_project(tmp_projects_dir: Path) -> None:
    project_store.create_project("doomed", _output())
    project_store.delete_project("doomed")
    with pytest.raises(project_store.ProjectNotFoundError):
        project_store.load_project("doomed")


def test_duplicate_project_copies_source_and_masks(tmp_projects_dir: Path) -> None:
    project_store.create_project("orig", _output())
    src_dir = project_store.project_dir("orig")
    # Create a fake source.png and tail mask
    Image.new("RGBA", (32, 32), (200, 0, 0, 255)).save(src_dir / "source.png")
    tail = np.zeros((32, 32), dtype=np.uint8)
    tail[10:20, 10:20] = 255
    Image.fromarray(tail, mode="L").save(src_dir / "mask" / "tail.png")
    # Add an animation entry to ensure it is NOT copied
    proj = project_store.load_project("orig")
    proj.animations = []  # placeholder, no mutation needed for the assertion
    project_store.save_project(proj)
    # Throw a dummy animations subdir to mimic an existing render
    fake_anim = project_store.animations_dir("orig") / "anim1"
    fake_anim.mkdir(parents=True)
    (fake_anim / "result.gif").write_bytes(b"GIF89a")

    project_store.duplicate_project("orig", "copy")
    new_proj = project_store.load_project("copy")
    assert new_proj.animations == []
    new_dir = project_store.project_dir("copy")
    assert (new_dir / "source.png").exists()
    assert (new_dir / "mask" / "tail.png").exists()
    assert (new_dir / "animations").exists()
    assert not (new_dir / "animations" / "anim1").exists()
    # Drafts MUST NOT be copied
    assert not (new_dir / "_drafts").exists()


# ---------------------------------------------------------------------------
# mask_has_content
# ---------------------------------------------------------------------------


def _save_grayscale(path: Path, arr: np.ndarray) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(arr.astype(np.uint8), mode="L").save(path)


def test_mask_has_content_false_when_missing(tmp_projects_dir: Path) -> None:
    project_store.create_project("p1", _output())
    assert project_store.mask_has_content("p1", "tail") is False


def test_mask_has_content_false_when_all_black(tmp_projects_dir: Path) -> None:
    project_store.create_project("p1", _output())
    src_path = project_store.project_dir("p1") / "source.png"
    Image.new("RGBA", (16, 16), (0, 0, 0, 255)).save(src_path)
    _save_grayscale(project_store.mask_path("p1", "tail"), np.zeros((16, 16), dtype=np.uint8))
    assert project_store.mask_has_content("p1", "tail") is False


def test_mask_has_content_true_when_filled_inside_source(tmp_projects_dir: Path) -> None:
    project_store.create_project("p1", _output())
    # Source: fully opaque so clip-to-source keeps everything
    src_path = project_store.project_dir("p1") / "source.png"
    Image.new("RGBA", (16, 16), (200, 0, 0, 255)).save(src_path)
    arr = np.zeros((16, 16), dtype=np.uint8)
    arr[5:11, 5:11] = 255
    _save_grayscale(project_store.mask_path("p1", "tail"), arr)
    assert project_store.mask_has_content("p1", "tail") is True


def test_mask_has_content_drops_isolated_pixel(tmp_projects_dir: Path) -> None:
    project_store.create_project("p1", _output())
    src_path = project_store.project_dir("p1") / "source.png"
    Image.new("RGBA", (16, 16), (200, 0, 0, 255)).save(src_path)
    arr = np.zeros((16, 16), dtype=np.uint8)
    arr[8, 8] = 255  # single isolated pixel
    _save_grayscale(project_store.mask_path("p1", "tail"), arr)
    assert project_store.mask_has_content("p1", "tail") is False


def test_mask_has_content_skips_filters_for_body(tmp_projects_dir: Path) -> None:
    project_store.create_project("p1", _output())
    src_path = project_store.project_dir("p1") / "source.png"
    # Source has no opaque pixels — body's clip-to-source would wipe everything
    # if filters applied to body. Spec: body skips filters.
    Image.new("RGBA", (16, 16), (0, 0, 0, 0)).save(src_path)
    arr = np.zeros((16, 16), dtype=np.uint8)
    arr[8, 8] = 255  # single pixel — would be killed by isolated-pixel-removal if filters ran
    _save_grayscale(project_store.mask_path("p1", "body"), arr)
    assert project_store.mask_has_content("p1", "body") is True


def test_labels_present_returns_only_filled(tmp_projects_dir: Path) -> None:
    project_store.create_project("p1", _output())
    src_path = project_store.project_dir("p1") / "source.png"
    Image.new("RGBA", (16, 16), (200, 0, 0, 255)).save(src_path)

    body_arr = np.full((16, 16), 255, dtype=np.uint8)
    _save_grayscale(project_store.mask_path("p1", "body"), body_arr)
    tail_arr = np.zeros((16, 16), dtype=np.uint8)
    tail_arr[5:11, 5:11] = 255
    _save_grayscale(project_store.mask_path("p1", "tail"), tail_arr)

    assert project_store.labels_present("p1") == ["body", "tail"]


# ---------------------------------------------------------------------------
# Draft slot lifecycle
# ---------------------------------------------------------------------------


def _draft() -> PlanDraft:
    return PlanDraft(
        prompt="swim please",
        llm_plan={
            "entity_type": "fish",
            "animation_type": "swim_slow",
            "required_regions": ["tail"],
            "optional_regions": ["fin"],
            "params": {"speed": "slow", "amplitude": "small", "emphasis": "tail", "loop": True},
            "annotation_schema": [{"label": "tail", "required": True}],
        },
        params={"speed": "slow", "amplitude": "small", "emphasis": "tail", "loop": True},
        missing_masks=[],
        plan_token="t1",
        created_at="2026-04-26T09:00:00Z",
    )


def test_save_load_plan_draft(tmp_projects_dir: Path) -> None:
    project_store.create_project("p1", _output())
    project_store.save_plan_draft("p1", _draft())
    assert project_store.has_plan_draft("p1")
    loaded = project_store.load_plan_draft("p1")
    assert loaded.to_json() == _draft().to_json()


def test_delete_plan_draft(tmp_projects_dir: Path) -> None:
    project_store.create_project("p1", _output())
    project_store.save_plan_draft("p1", _draft())
    project_store.delete_plan_draft("p1")
    assert not project_store.has_plan_draft("p1")


def test_renderer_draft_round_trip(tmp_projects_dir: Path) -> None:
    project_store.create_project("p1", _output())
    rc = RendererConfigDraft(
        renderer_template="fish_swim_slow_v1",
        args={"tail_amplitude": 0.2, "mouth_open_ratio": 0.0, "body_follow": 0.1, "fps": 12, "frames": 8, "output_width": 128, "output_height": 128},
        loop=True,
        plan_token="t1",
        created_at="2026-04-26T09:00:00Z",
    )
    project_store.save_renderer_draft("p1", rc)
    assert project_store.has_renderer_config_draft("p1")
    loaded = project_store.load_renderer_draft("p1")
    assert loaded.to_json() == rc.to_json()


def test_clear_active_draft_removes_both(tmp_projects_dir: Path) -> None:
    project_store.create_project("p1", _output())
    project_store.save_plan_draft("p1", _draft())
    project_store.clear_active_draft("p1")
    assert not project_store.has_plan_draft("p1")
    assert not project_store.has_renderer_config_draft("p1")


# ---------------------------------------------------------------------------
# Startup recovery
# ---------------------------------------------------------------------------


def test_startup_recovery_removes_orphan_staging(tmp_projects_dir: Path) -> None:
    project_store.create_project("p1", _output())
    staging = project_store.animation_staging_dir("p1", "anim1")
    staging.mkdir(parents=True)
    (staging / "renderer_config.json").write_text("{}")

    project_store.startup_recovery(tmp_projects_dir)
    assert not staging.exists()


def test_startup_recovery_restores_backup_when_real_missing(tmp_projects_dir: Path) -> None:
    project_store.create_project("p1", _output())
    bak = project_store.animation_backup_dir("p1", "anim1")
    bak.mkdir(parents=True)
    (bak / "renderer_config.json").write_text('{"renderer_template":"fish_swim_slow_v1"}')

    project_store.startup_recovery(tmp_projects_dir)
    real = project_store.animation_dir("p1", "anim1")
    assert real.exists()
    assert (real / "renderer_config.json").exists()
    assert not bak.exists()


def test_startup_recovery_drops_orphan_backup_when_real_exists(tmp_projects_dir: Path) -> None:
    project_store.create_project("p1", _output())
    real = project_store.animation_dir("p1", "anim1")
    real.mkdir(parents=True)
    (real / "renderer_config.json").write_text("{}")
    bak = project_store.animation_backup_dir("p1", "anim1")
    bak.mkdir(parents=True)

    project_store.startup_recovery(tmp_projects_dir)
    assert real.exists()
    assert not bak.exists()
