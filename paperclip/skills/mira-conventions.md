# MIRA Conventions

## Commit Format

```
feat: short description of new feature
fix: short description of bug fix
security: security hardening
docs: documentation only
refactor: code restructuring, no behavior change
test: tests only
chore: build system, deps, tooling
```

## Python Standards

- **Version:** Python 3.12
- **Linter/Formatter:** ruff (NOT flake8, pylint, or black)
  - `ruff check --fix path/to/file.py && ruff format path/to/file.py`
- **HTTP client:** httpx (NOT requests or urllib)
- **Async:** asyncio throughout, pytest-asyncio with `asyncio_mode = "auto"`
- **YAML:** Always `yaml.safe_load()`, NEVER `yaml.load()`
- **Logging:** `logging` stdlib, NEVER `print()`
- **Type hints:** Modern 3.12 style (`list[str]`, `str | None`)

## Error Handling

- Catch specific exceptions, never bare `except:`
- LLM calls return fallback value on error, never raise to user
- Log errors with context before re-raising

## Security

- All secrets via Doppler (`factorylm/prd`), never in .env files
- PII sanitization before Claude API calls: IPs -> [IP], MACs -> [MAC], serials -> [SN]
- 21 safety keywords in guardrails.py trigger immediate STOP response
- Bearer token auth on MCP REST API (`MCP_REST_API_KEY`)
- No `privileged: true` in Docker containers
- Docker images pinned to exact version, never `:latest`

## Hard Constraints

1. Licenses: Apache 2.0 or MIT ONLY
2. No LangChain, TensorFlow, n8n, or Claude API abstraction frameworks
3. One service per Docker container, `restart: unless-stopped` + healthcheck
4. NeonDB: SQLAlchemy with NullPool only
5. SQLite: Use sqlite3 stdlib with WAL mode
