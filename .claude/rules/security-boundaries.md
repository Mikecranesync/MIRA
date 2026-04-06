---
name: security-boundaries
description: MIRA security boundaries — secrets management, PII sanitization, safety keywords, tier limits, Docker security, API auth
---

# Security Boundaries

## Secrets Management

**Rule:** All secrets via Doppler (`factorylm/prd`). Never in `.env` files committed to git.

```bash
# Correct: run with Doppler
doppler run --project factorylm --config prd -- docker compose up -d

# Wrong: never do this
echo "ANTHROPIC_API_KEY=sk-ant-..." > .env
```

`.env.template` documents all variables with placeholder values only — no real secrets ever in this file.

**Rotation required for:**
- `WEBUI_SECRET_KEY` — was in git history (rotate immediately)
- `MCPO_API_KEY` — was in git history (rotate immediately)

**Check before every commit:**
```bash
git remote -v          # verify you're in the right repo
git diff --cached      # scan for accidental secret inclusion
```

---

## PII Sanitization

`InferenceRouter.sanitize_context()` in `mira-bots/shared/inference/router.py` strips sensitive data before sending to Claude API:

| Pattern | Regex | Replacement |
|---------|-------|-------------|
| IPv4 addresses | `_IPV4_RE` | `[IP]` |
| MAC addresses | `_MAC_RE` | `[MAC]` |
| Serial numbers | `_SERIAL_RE` (S/N, SER#...) | `[SN]` |

Applied to both `str` content and `text` blocks in multipart content arrays.

**This is a static method — callers must invoke it explicitly.** If adding a new inference path, call `InferenceRouter.sanitize_context(messages)` before the API call.

---

## Safety Keywords (21 triggers)

`mira-bots/shared/guardrails.py` — `SAFETY_KEYWORDS` list:

```python
SAFETY_KEYWORDS = [
    "exposed wire", "energized conductor", "arc flash", "lockout", "tagout",
    "loto", "smoke", "burn mark", "melted insulation", "electrical fire",
    "shock hazard", "rotating hazard", "pinch point", "entanglement",
    "confined space", "pressurized", "caught in", "crush hazard",
    "fall hazard", "chemical spill", "gas leak",
]
```

When any keyword matches in `classify_intent()`, the FSM short-circuits immediately to:
> "STOP — describe the hazard. De-energize the equipment first. Do not proceed until the area is safe."

**Adding a new safety keyword:**
1. Add to `SAFETY_KEYWORDS` list in `guardrails.py`
2. Run `pytest tests/ -k "safety"` to verify no regressions
3. Keywords should be phrases, not single words (to avoid false positives)

---

## Tier Limits

`check_tier_limit(tenant_id)` in `mira-core/mira-ingest/db/neon.py`:

```python
def check_tier_limit(tenant_id: str) -> tuple[bool, str]:
    # Returns (allowed, reason)
    # Returns (True, '') on error — fail open, never block on DB errors
```

Wire to HTTP 429 in ingest endpoints:
```python
allowed, reason = check_tier_limit(tenant_id)
if not allowed:
    raise HTTPException(status_code=429, detail=reason)
```

Tier data lives in NeonDB `tier_limits` table. Adding a new tier: insert a row in `tier_limits`.

---

## Docker Security

**Never use:**
- `privileged: true` in any container
- `network_mode: host`
- `:latest` or `:main` image tags

**Always use:**
- `restart: unless-stopped`
- Healthcheck on every container
- Pinned image versions (semver tag or SHA)
- Named networks (`core-net`, `bot-net`) — never default bridge

**Volume mounts:** Only mount what's needed. The SQLite DB is shared via:
```yaml
volumes:
  - ./mira-bridge/data:/data
```

No container has write access to host system directories outside of `/data`.

---

## API Authentication

### MCP REST API (`mira-mcp/server.py`)

Bearer token required on all REST endpoints:
```python
MCP_REST_API_KEY = os.environ.get("MCP_REST_API_KEY", "")
if not MCP_REST_API_KEY:
    sys.stderr.write("ERROR: MCP_REST_API_KEY not set — REST :8001 will reject all requests\n")
```

Bot adapters include the token:
```python
headers["Authorization"] = f"Bearer {MCP_REST_API_KEY}"
```

### Open WebUI (`mira-core`)

Bearer token via `OPENWEBUI_API_KEY`. Set by Doppler.

### Ingest service (`mira-ingest`)

No bearer auth currently — only accessible on `core-net` (not exposed to bot-net or public internet).

---

## Input Validation

**Bot adapters:**
- Telegram: file size check before download (20MB limit for PDFs)
- Slack: MIME type allowlist (`IMAGE_MIMES`, `application/pdf` only)
- All adapters: strip Slack `@mention` tags via `guardrails.strip_mentions()`

**Ingest service:**
- Image resize before storage (MAX_INGEST_PX)
- Photo saved to PHOTOS_DIR with asset_tag prefix (no path traversal possible via `/{asset_tag}/`)

**Do not:**
- Accept arbitrary file paths from user input
- Execute user-supplied strings as shell commands
- Deserialize untrusted pickle data
