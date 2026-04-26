"""Server configuration constants."""

from __future__ import annotations

import os
from pathlib import Path

# Filesystem layout
REPO_ROOT = Path(os.environ.get("SPRITE_GEN_REPO_ROOT", Path(__file__).resolve().parent.parent))
PROJECTS_DIR = REPO_ROOT / "projects"

# Server bind (loopback only by spec)
HOST = "127.0.0.1"
PORT = int(os.environ.get("SPRITE_GEN_PORT", "8000"))

# UI dev server origin (CORS allow-list — localhost only)
UI_ORIGIN = os.environ.get("SPRITE_GEN_UI_ORIGIN", "http://127.0.0.1:5173")
ALLOWED_ORIGINS = [
    UI_ORIGIN,
    "http://localhost:5173",
]

# Validation limits (from spec image-input-intake)
MAX_IMAGE_WIDTH = 2048
MAX_IMAGE_HEIGHT = 2048
MAX_FILE_BYTES = 10 * 1024 * 1024  # 10 MB

OUTPUT_WIDTH_RANGE = (64, 512)
OUTPUT_HEIGHT_RANGE = (64, 512)
FPS_RANGE = (1, 30)
FRAME_COUNT_RANGE = (2, 32)

EXPORT_FORMATS = ("gif", "spritesheet", "both")

# Mask labels (fixed vocabulary)
LABELS: tuple[str, ...] = ("body", "tail", "mouth", "fin")

# Body initialization alpha threshold
BODY_ALPHA_THRESHOLD = 128

# LLM (Claude Code CLI) configuration
LLM_BIN = os.environ.get("SPRITE_GEN_CLAUDE_BIN", "claude")
LLM_TIMEOUT_SECONDS = int(os.environ.get("SPRITE_GEN_LLM_TIMEOUT", "60"))

# Renderer
RENDERER_VERSION = 1

# animation_type → renderer_template canonical mapping
ANIMATION_TYPE_TO_TEMPLATE: dict[str, str | None] = {
    "swim_slow": "fish_swim_slow_v1",
    "eat": "fish_eat_v1",
    "turn": None,  # PoC: not implemented
    "approach_food": None,  # PoC: not implemented
}

# Slug regex for IDs (project_id, animation_id)
SLUG_PATTERN = r"^[a-z0-9][a-z0-9-]{0,63}$"
