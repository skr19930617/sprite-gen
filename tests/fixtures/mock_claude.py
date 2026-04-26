#!/usr/bin/env python3
"""Mock Claude Code CLI used by sprite-gen integration tests.

Behavior is driven by files in the directory pointed to by the environment
variable ``MOCK_CLAUDE_STATE_DIR``. Recognized files (checked in order):

  next_response.json  — write this content to stdout, exit 0, then delete the
                        file.
  next_failure.txt    — single-line directive controlling the failure mode:
                        ``exit_nonzero``, ``empty_output``, ``invalid_json``,
                        ``timeout`` (sleeps 90s — exceed the 60s server cap),
                        ``auth_required`` (writes a recognized auth-prompt
                        sentinel to stdout and exits 1).
  next_response.txt   — write raw text to stdout (used to inject malformed
                        JSON). Exit 0.

If none are present, exit 1 with a hint so tests fail fast.

The mock also writes the stdin it received to ``last_stdin.json`` (or
``last_stdin.txt`` if not JSON) so tests can assert on the prompt content.
"""

from __future__ import annotations

import json
import os
import sys
import time
from pathlib import Path

AUTH_PROMPT_SENTINEL = "Please run `claude login` to authenticate."


def main() -> int:
    state_dir_env = os.environ.get("MOCK_CLAUDE_STATE_DIR")
    if not state_dir_env:
        sys.stderr.write("MOCK_CLAUDE_STATE_DIR not set — mock_claude expects an isolated state dir.\n")
        return 2
    state_dir = Path(state_dir_env)

    # Capture stdin for assertions
    stdin_data = sys.stdin.read()
    if stdin_data:
        try:
            parsed = json.loads(stdin_data)
            (state_dir / "last_stdin.json").write_text(json.dumps(parsed, indent=2))
        except json.JSONDecodeError:
            (state_dir / "last_stdin.txt").write_text(stdin_data)

    failure_path = state_dir / "next_failure.txt"
    if failure_path.exists():
        directive = failure_path.read_text().strip()
        failure_path.unlink()
        if directive == "exit_nonzero":
            return 1
        if directive == "empty_output":
            return 0
        if directive == "invalid_json":
            sys.stdout.write("not really json {{")
            return 0
        if directive == "timeout":
            time.sleep(90)
            return 0
        if directive == "auth_required":
            sys.stdout.write(AUTH_PROMPT_SENTINEL + "\n")
            return 1
        sys.stderr.write(f"unknown failure directive: {directive}\n")
        return 2

    response_json = state_dir / "next_response.json"
    if response_json.exists():
        payload = response_json.read_text()
        response_json.unlink()
        sys.stdout.write(payload)
        return 0

    response_txt = state_dir / "next_response.txt"
    if response_txt.exists():
        payload = response_txt.read_text()
        response_txt.unlink()
        sys.stdout.write(payload)
        return 0

    sys.stderr.write("no queued response — write next_response.json or next_failure.txt to control mock_claude.\n")
    return 1


if __name__ == "__main__":
    sys.exit(main())
