"""Sprite-gen renderer package — fixed templates only.

Public API:
    render(...)                 — render an animation, write GIF/spritesheet
    REGISTERED_TEMPLATES        — read-only mapping of template_id → class
    UnknownTemplateError        — raised by render() for unknown template_id
    RenderError                 — generic render failure
"""

from sprite_gen.renderer.base import (
    BaseTemplate,
    RenderError,
    RenderOutputs,
    RendererArgs,
    UnknownTemplateError,
    render,
)
from sprite_gen.renderer.registry import REGISTERED_TEMPLATES

__all__ = [
    "BaseTemplate",
    "REGISTERED_TEMPLATES",
    "RenderError",
    "RenderOutputs",
    "RendererArgs",
    "UnknownTemplateError",
    "render",
]
