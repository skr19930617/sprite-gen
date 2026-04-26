# sprite-gen

Local-first PoC that turns a transparent PNG of a fish + a natural-language prompt + human mask annotations into a sprite animation (GIF + spritesheet) using a fixed-template renderer guided by a Claude Code CLI conversation.

See `openspec/changes/sprite-gen-poc/proposal.md` and `openspec/changes/sprite-gen-poc/design.md` for the full PoC specification.

## Quickstart

```bash
make install   # installs Python deps + UI deps
make dev       # runs FastAPI on 127.0.0.1:8000 and Vite on 127.0.0.1:5173
```

Open http://127.0.0.1:5173 in a browser.

## Tests

```bash
make test               # Python tests (server + renderer)
cd ui && npm test       # UI tests (later bundles)
```

## Project layout

```
sprite_gen/        - shared library (project store, renderer core, llm client)
server/            - FastAPI app + routers
ui/                - React + Vite app
tests/             - Python tests (unit, integration, golden, e2e)
projects/          - runtime project storage (git-ignored, see .gitignore)
openspec/          - spec-driven proposal/design/tasks artifacts
```

## Spec compliance

This PoC's specs are spec deltas under `openspec/changes/sprite-gen-poc/specs/<capability>/spec.md` (they have not yet been merged into the baseline `openspec/specs/`). Each capability is implemented by code under `sprite_gen/` and `server/routers/` plus the matching UI screens. The bundle structure in `openspec/changes/sprite-gen-poc/task-graph.json` records the implementation order, and `openspec/changes/sprite-gen-poc/tasks.md` enumerates the tasks each bundle owned.
