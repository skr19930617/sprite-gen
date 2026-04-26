"""Read-only registry of fixed templates implemented for the PoC."""

from __future__ import annotations

from typing import Mapping

from sprite_gen.renderer.base import BaseTemplate
from sprite_gen.renderer.templates.eat import EatTemplate
from sprite_gen.renderer.templates.swim_slow import SwimSlowTemplate

REGISTERED_TEMPLATES: Mapping[str, type[BaseTemplate]] = {
    SwimSlowTemplate.template_id: SwimSlowTemplate,
    EatTemplate.template_id: EatTemplate,
}
