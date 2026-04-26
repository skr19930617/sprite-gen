"""Pydantic / dataclass models for project.json v3 + draft slot files.

The v3 schema is the authoritative persisted shape — see
``openspec/specs/project-store/spec.md``.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any, Literal

from sprite_gen import config

# ---------------------------------------------------------------------------
# Validation helpers (used by config.py and routes)
# ---------------------------------------------------------------------------

SLUG_RE = re.compile(config.SLUG_PATTERN)


def is_valid_slug(value: str) -> bool:
    return isinstance(value, str) and bool(SLUG_RE.match(value))


def is_valid_label(value: str) -> bool:
    return value in config.LABELS


# ---------------------------------------------------------------------------
# Output settings
# ---------------------------------------------------------------------------


ExportFormat = Literal["gif", "spritesheet", "both"]


@dataclass
class ProjectOutput:
    width: int
    height: int
    fps: int
    frame_count: int
    export_format: ExportFormat

    def to_json(self) -> dict[str, Any]:
        return {
            "width": self.width,
            "height": self.height,
            "fps": self.fps,
            "frame_count": self.frame_count,
            "export_format": self.export_format,
        }

    @classmethod
    def from_json(cls, data: dict[str, Any]) -> "ProjectOutput":
        return cls(
            width=int(data["width"]),
            height=int(data["height"]),
            fps=int(data["fps"]),
            frame_count=int(data["frame_count"]),
            export_format=data["export_format"],
        )


# ---------------------------------------------------------------------------
# v3 animation entry
# ---------------------------------------------------------------------------


@dataclass
class AnimationEntry:
    animation_id: str
    prompt: str
    llm_plan: dict[str, Any]
    params: dict[str, Any]
    annotation: dict[str, Any]  # {"labels_present": [...]}
    renderer_config_path: str
    outputs: dict[str, str | None]  # gif_path, spritesheet_path
    renderer_version: int
    created_at: str
    updated_at: str

    def to_json(self) -> dict[str, Any]:
        return {
            "animation_id": self.animation_id,
            "prompt": self.prompt,
            "llm_plan": self.llm_plan,
            "params": self.params,
            "annotation": self.annotation,
            "renderer_config_path": self.renderer_config_path,
            "outputs": self.outputs,
            "renderer_version": self.renderer_version,
            "created_at": self.created_at,
            "updated_at": self.updated_at,
        }

    @classmethod
    def from_json(cls, data: dict[str, Any]) -> "AnimationEntry":
        return cls(
            animation_id=data["animation_id"],
            prompt=data["prompt"],
            llm_plan=data["llm_plan"],
            params=data["params"],
            annotation=data["annotation"],
            renderer_config_path=data["renderer_config_path"],
            outputs=data["outputs"],
            renderer_version=int(data["renderer_version"]),
            created_at=data["created_at"],
            updated_at=data["updated_at"],
        )


# ---------------------------------------------------------------------------
# v3 project.json
# ---------------------------------------------------------------------------


@dataclass
class ProjectJson:
    version: int = 3
    project_id: str = ""
    entity_type: str = "fish"
    source_image_path: str = "source.png"
    mask_dir: str = "mask"
    output: ProjectOutput | None = None
    animations: list[AnimationEntry] = field(default_factory=list)
    created_at: str = ""
    updated_at: str = ""

    def to_json(self) -> dict[str, Any]:
        if self.output is None:
            raise ValueError("project.output is required")
        return {
            "version": self.version,
            "project_id": self.project_id,
            "entity_type": self.entity_type,
            "source_image_path": self.source_image_path,
            "mask_dir": self.mask_dir,
            "output": self.output.to_json(),
            "animations": [a.to_json() for a in self.animations],
            "created_at": self.created_at,
            "updated_at": self.updated_at,
        }

    @classmethod
    def from_json(cls, data: dict[str, Any]) -> "ProjectJson":
        version = int(data.get("version", 0))
        if version != 3:
            raise ValueError(f"unsupported project.json version: {version} (expected 3)")
        return cls(
            version=3,
            project_id=data["project_id"],
            entity_type=data.get("entity_type", "fish"),
            source_image_path=data.get("source_image_path", "source.png"),
            mask_dir=data.get("mask_dir", "mask"),
            output=ProjectOutput.from_json(data["output"]),
            animations=[AnimationEntry.from_json(a) for a in data.get("animations", [])],
            created_at=data.get("created_at", ""),
            updated_at=data.get("updated_at", ""),
        )


# ---------------------------------------------------------------------------
# Draft slot files
# ---------------------------------------------------------------------------


@dataclass
class PlanDraft:
    """``_drafts/active/plan.json`` — written after a successful llm-plan call.

    ``llm_plan`` is the normalized resolved plan (defaults filled). ``params`` is
    the user-editable copy (initially equal to ``llm_plan.params``).
    """

    prompt: str
    llm_plan: dict[str, Any]
    params: dict[str, Any]
    missing_masks: list[str]
    plan_token: str
    created_at: str

    def to_json(self) -> dict[str, Any]:
        return {
            "prompt": self.prompt,
            "llm_plan": self.llm_plan,
            "params": self.params,
            "missing_masks": list(self.missing_masks),
            "plan_token": self.plan_token,
            "created_at": self.created_at,
        }

    @classmethod
    def from_json(cls, data: dict[str, Any]) -> "PlanDraft":
        return cls(
            prompt=data["prompt"],
            llm_plan=data["llm_plan"],
            params=data["params"],
            missing_masks=list(data.get("missing_masks", [])),
            plan_token=data["plan_token"],
            created_at=data["created_at"],
        )


@dataclass
class RendererConfigDraft:
    renderer_template: str
    args: dict[str, Any]
    loop: bool
    plan_token: str
    created_at: str

    def to_json(self) -> dict[str, Any]:
        return {
            "renderer_template": self.renderer_template,
            "args": dict(self.args),
            "loop": bool(self.loop),
            "plan_token": self.plan_token,
            "created_at": self.created_at,
        }

    @classmethod
    def from_json(cls, data: dict[str, Any]) -> "RendererConfigDraft":
        return cls(
            renderer_template=data["renderer_template"],
            args=dict(data["args"]),
            loop=bool(data["loop"]),
            plan_token=data["plan_token"],
            created_at=data["created_at"],
        )
