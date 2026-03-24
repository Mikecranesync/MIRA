---
name: python-standards
description: MIRA Python coding standards — Python 3.12, ruff, line length, HTTP client, YAML, SQLAlchemy, pytest asyncio
---

# Python Standards

Source of truth: `pyproject.toml` at repo root.

## Runtime

- **Python version:** 3.12
- **Package manager:** `uv` (NOT pip, poetry, or conda)

## Linter / Formatter: ruff

Use `ruff`, NOT flake8, pylint, or black.

```toml
[tool.ruff]
line-length = 100
target-version = "py312"
exclude = ["mira-bots-phase1", "mira-bots-phase2", "mira-bots-phase3", "archives"]

[tool.ruff.lint]
select = ["E", "F", "W", "I"]
ignore = ["E501"]  # line length handled by formatter
```

**Run:**
```bash
ruff check --fix path/to/file.py
ruff format path/to/file.py
```

**CI gate:** `ruff check .` must pass before merge.

## HTTP Client: httpx

Use `httpx` for all HTTP calls, NOT `requests` or `urllib`.

```python
import httpx

# Async (preferred)
async with httpx.AsyncClient(timeout=60) as client:
    resp = await client.post(url, json=payload, headers=headers)
    resp.raise_for_status()

# Sync (scripts only)
with httpx.Client(timeout=30) as client:
    resp = client.get(url)
```

## YAML Loading

Always use `yaml.safe_load()`, NEVER `yaml.load()`:

```python
import yaml

with open(path) as f:
    data = yaml.safe_load(f)
```

## SQLAlchemy (NeonDB only)

Use `NullPool` — Neon's PgBouncer handles pooling. Never use connection pooling on the application side.

```python
from sqlalchemy import create_engine, text
from sqlalchemy.pool import NullPool

engine = create_engine(
    os.environ["NEON_DATABASE_URL"],
    poolclass=NullPool,
    connect_args={"sslmode": "require"},
    pool_pre_ping=True,
)
```

For SQLite (local state): use `sqlite3` stdlib directly (not SQLAlchemy). Always set WAL mode:
```python
db = sqlite3.connect(db_path)
db.execute("PRAGMA journal_mode=WAL")
```

## Async

- Use `asyncio` throughout — all bot handlers, engine calls, and HTTP calls are async
- `pytest-asyncio` with `asyncio_mode = "auto"` (set in `pyproject.toml`)
- Never use `asyncio.run()` inside async functions — only at entry points

```toml
[tool.pytest.ini_options]
asyncio_mode = "auto"
```

## Type Hints

Use modern Python 3.12 style:

```python
# Use built-in generics (not typing module)
def foo(items: list[str]) -> dict[str, int]: ...
def bar(x: str | None) -> None: ...

# Use from __future__ import annotations for forward references
from __future__ import annotations
```

## Logging

Use `logging` stdlib, NOT `print()`:

```python
import logging
logger = logging.getLogger("mira-gsd")  # use service-specific name

logger.info("CLAUDE_CALL model=%s latency_ms=%d", model, ms)
logger.warning("Fallback triggered: %s", reason)
logger.error("LLM call failed: %s", e)
```

## Error Handling

- Catch specific exceptions, not bare `except:`
- Log errors with context before re-raising or returning fallback
- LLM calls always return a fallback value on error — never raise to the user

```python
try:
    result = await client.post(...)
    result.raise_for_status()
except httpx.HTTPStatusError as e:
    logger.error("HTTP %s: %s", e.response.status_code, e.response.text[:200])
    return ""
except Exception as e:
    logger.error("Unexpected error: %s", e)
    return ""
```

## Imports

- Standard library first, then third-party, then local (ruff `I` rules enforce this)
- Local imports use relative paths within a package (`from .guardrails import ...`)
- Bot adapters use absolute imports from `shared` (`from shared.gsd_engine import GSDEngine`)

## Secrets

Never hardcode or default to real values:
```python
# WRONG
api_key = os.getenv("ANTHROPIC_API_KEY", "sk-ant-...")

# CORRECT
api_key = os.getenv("ANTHROPIC_API_KEY", "")
if not api_key:
    logger.warning("ANTHROPIC_API_KEY not set — Claude backend disabled")
```
