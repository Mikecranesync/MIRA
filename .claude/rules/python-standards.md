---
name: python-standards
description: MIRA Python coding standards — Python 3.12, ruff, httpx, async, NeonDB
---

# Python Standards

Source of truth: `pyproject.toml` at repo root.

## Runtime
- **Python 3.12** | **Package manager:** `uv` (NOT pip, poetry, conda)

## Linter / Formatter: ruff
Use `ruff`, NOT flake8, pylint, or black. Config in `pyproject.toml`.
```bash
ruff check --fix path/to/file.py
ruff format path/to/file.py
```
CI gate: `ruff check .` must pass before merge.

## HTTP Client: httpx
Use `httpx` for all HTTP calls, NOT `requests` or `urllib`.
```python
async with httpx.AsyncClient(timeout=60) as client:
    resp = await client.post(url, json=payload, headers=headers)
    resp.raise_for_status()
```

## YAML: always `yaml.safe_load()`, NEVER `yaml.load()`

## SQLAlchemy (NeonDB only)
`NullPool` — Neon's PgBouncer handles pooling. Never pool application-side.
```python
engine = create_engine(url, poolclass=NullPool, connect_args={"sslmode": "require"}, pool_pre_ping=True)
```
For SQLite: `sqlite3` stdlib directly, always `PRAGMA journal_mode=WAL`.

## Async
- `asyncio` throughout — all bot handlers, engine calls, HTTP calls
- `asyncio_mode = "auto"` in `pyproject.toml`
- Never `asyncio.run()` inside async functions — only at entry points

## Type Hints
Modern Python 3.12: `list[str]`, `dict[str, int]`, `str | None`. Use `from __future__ import annotations` for forward refs.

## Logging
`logging` stdlib, NOT `print()`. Service-specific logger names: `logging.getLogger("mira-gsd")`.

## Error Handling
- Catch specific exceptions, not bare `except:`
- Log with context before re-raising or returning fallback
- LLM calls always return fallback on error — never raise to user

## Imports
- stdlib → third-party → local (ruff `I` enforces)
- Relative within packages (`from .guardrails import ...`)
- Bot adapters: absolute from `shared` (`from shared.gsd_engine import GSDEngine`)

## Secrets
Never hardcode or default to real values:
```python
api_key = os.getenv("ANTHROPIC_API_KEY", "")
if not api_key:
    logger.warning("ANTHROPIC_API_KEY not set — Claude backend disabled")
```
