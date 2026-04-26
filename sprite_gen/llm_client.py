"""Claude Code CLI subprocess wrapper.

Spec: design.md "Server ↔ LLM CLI" + "LLM plan normalization" + spec
``llm-renderer-config`` Requirement "LLM CLI failure handling".

Failure modes are normalized to a small set of error_kind values:

  llm_cli_not_found       — `claude` binary missing on PATH (HTTP 503)
  llm_cli_exit_nonzero    — non-zero exit status (HTTP 422)
  llm_cli_empty_output    — stdout empty (HTTP 422)
  llm_invalid_json        — stdout not parseable JSON (HTTP 422)
  llm_schema_mismatch     — JSON shape violates the per-stage schema (HTTP 422)
  llm_timeout             — exceeded LLM_TIMEOUT_SECONDS (HTTP 504)
  llm_auth_required       — auth-prompt sentinel detected (HTTP 401)
"""

from __future__ import annotations

import json
import logging
import shutil
import subprocess
from dataclasses import dataclass
from typing import Any

from sprite_gen import config

logger = logging.getLogger("sprite_gen.llm_client")

AUTH_PROMPT_SENTINEL = "Please run `claude login` to authenticate."


class LlmCliError(Exception):
    """Raised when the LLM CLI fails. ``error_kind`` is the canonical key."""

    def __init__(
        self,
        error_kind: str,
        detail: str,
        retriable: bool,
        http_status: int,
        raw: dict[str, Any] | None = None,
    ) -> None:
        super().__init__(f"{error_kind}: {detail}")
        self.error_kind = error_kind
        self.detail = detail
        self.retriable = retriable
        self.http_status = http_status
        self.raw = raw or {}

    def to_response_payload(self) -> dict[str, Any]:
        return {
            "error_kind": self.error_kind,
            "detail": self.detail,
            "retriable": self.retriable,
        }


@dataclass
class LlmInvocationResult:
    parsed: dict[str, Any]
    raw_stdout: str


def extract_json(stdout: str) -> dict[str, Any]:
    """Try direct JSON parse; fall back to ```json ... ``` fenced block."""
    text = stdout.strip()
    if not text:
        raise json.JSONDecodeError("empty stdout", text or "", 0)
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass

    fence_start = text.find("```json")
    if fence_start != -1:
        body_start = text.find("\n", fence_start) + 1
        fence_end = text.find("```", body_start)
        if fence_end != -1:
            return json.loads(text[body_start:fence_end].strip())

    raise json.JSONDecodeError("could not extract JSON", text, 0)


def invoke_claude(prompt_payload: dict[str, Any]) -> LlmInvocationResult:
    """Run the Claude CLI with a JSON prompt on stdin; parse JSON stdout."""
    import os

    binary = os.environ.get("SPRITE_GEN_CLAUDE_BIN") or config.LLM_BIN
    resolved = shutil.which(binary)
    if resolved is None:
        # Try as absolute path
        from pathlib import Path

        if not Path(binary).exists():
            raise LlmCliError(
                "llm_cli_not_found",
                f"`claude` binary not found on PATH (resolved={binary!r})",
                retriable=False,
                http_status=503,
            )
        resolved = binary

    stdin_data = json.dumps(prompt_payload, ensure_ascii=False)

    timeout = int(os.environ.get("SPRITE_GEN_LLM_TIMEOUT") or config.LLM_TIMEOUT_SECONDS)
    try:
        completed = subprocess.run(
            [resolved],
            input=stdin_data,
            capture_output=True,
            text=True,
            timeout=timeout,
            check=False,
        )
    except subprocess.TimeoutExpired:
        raise LlmCliError(
            "llm_timeout",
            f"claude exceeded {timeout}s timeout",
            retriable=True,
            http_status=504,
        )

    stdout = completed.stdout or ""
    stderr = completed.stderr or ""

    if AUTH_PROMPT_SENTINEL in stdout or AUTH_PROMPT_SENTINEL in stderr:
        raise LlmCliError(
            "llm_auth_required",
            "Claude CLI requires authentication; run `claude login` interactively first.",
            retriable=False,
            http_status=401,
        )

    if completed.returncode != 0:
        raise LlmCliError(
            "llm_cli_exit_nonzero",
            f"claude exited with code {completed.returncode}; stderr={stderr.strip()[:500]!r}",
            retriable=True,
            http_status=422,
        )

    if not stdout.strip():
        raise LlmCliError(
            "llm_cli_empty_output",
            "claude exited 0 but stdout was empty",
            retriable=True,
            http_status=422,
        )

    try:
        parsed = extract_json(stdout)
    except json.JSONDecodeError as exc:
        raise LlmCliError(
            "llm_invalid_json",
            f"could not parse claude stdout as JSON: {exc.msg}",
            retriable=True,
            http_status=422,
        )

    if not isinstance(parsed, dict):
        raise LlmCliError(
            "llm_schema_mismatch",
            f"top-level JSON must be an object; got {type(parsed).__name__}",
            retriable=True,
            http_status=422,
        )

    return LlmInvocationResult(parsed=parsed, raw_stdout=stdout)
