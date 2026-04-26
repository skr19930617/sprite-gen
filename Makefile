.PHONY: help install dev server ui test test-server test-renderer fmt

help:
	@echo "Targets:"
	@echo "  install   - install Python deps + UI deps"
	@echo "  dev       - run server + UI (foreground; Ctrl+C stops both)"
	@echo "  server    - run FastAPI server only"
	@echo "  ui        - run Vite dev server only"
	@echo "  test      - run Python tests"
	@echo "  fmt       - ruff format"

install:
	python3 -m pip install -e '.[dev]'
	cd ui && npm install

server:
	python3 -m server.main

ui:
	cd ui && npm run dev

# Foreground orchestrator: starts server in background, then runs UI in foreground.
# Killing the UI (Ctrl+C) trips the trap and kills the server.
dev:
	@trap 'kill 0' INT TERM; \
	python3 -m server.main & \
	sleep 1 ; \
	cd ui && npm run dev ; \
	wait

test:
	python3 -m pytest -q

fmt:
	ruff format .
	ruff check . --fix
