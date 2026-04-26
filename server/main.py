"""FastAPI application — sprite-gen local PoC server.

Binds to 127.0.0.1 by default; CORS allow-list contains only localhost origins.
"""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from sprite_gen import config
from sprite_gen.project_store import startup_recovery

logger = logging.getLogger("sprite_gen.server")


@asynccontextmanager
async def lifespan(_app: FastAPI):
    config.PROJECTS_DIR.mkdir(parents=True, exist_ok=True)
    startup_recovery(config.PROJECTS_DIR)
    yield


def create_app() -> FastAPI:
    app = FastAPI(
        title="sprite-gen",
        version="0.1.0",
        description="Local PoC sprite animation generator",
        lifespan=lifespan,
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=config.ALLOWED_ORIGINS,
        allow_credentials=False,
        allow_methods=["GET", "POST", "PATCH", "DELETE"],
        allow_headers=["*"],
    )

    # Routers are registered lazily so this module can be imported standalone
    # (e.g. by tests) before the full router stack is wired in later bundles.
    from server.routers import (
        projects,
        masks,
        llm_plan,
        active_draft,
        renderer_config,
        animations,
        static_assets,
    )

    app.include_router(projects.router)
    app.include_router(masks.router)
    app.include_router(llm_plan.router)
    app.include_router(active_draft.router)
    app.include_router(renderer_config.router)
    app.include_router(animations.router)
    app.include_router(static_assets.router)

    @app.get("/healthz")
    async def healthz() -> dict[str, str]:
        return {"status": "ok"}

    return app


app = create_app()


def main() -> None:
    """Entry point for `python -m server.main` / uvicorn cli."""
    import uvicorn

    uvicorn.run(
        "server.main:app",
        host=config.HOST,
        port=config.PORT,
        reload=False,
        log_level="info",
    )


if __name__ == "__main__":
    main()
