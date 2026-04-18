---
name: security-boundaries
description: MIRA security — secrets via Doppler, PII sanitization, safety keywords, Docker constraints, API auth patterns
---

# Security Boundaries

## Secrets Management
All secrets via Doppler (`factorylm/prd`). Never in `.env` files committed to git.
- `.env.template` has placeholders only — no real values
- Rotation needed: `WEBUI_SECRET_KEY`, `MCPO_API_KEY` (both in git history)
- Before every commit: `git remote -v` (right repo?) + `git diff --cached` (no secrets?)

## PII Sanitization
`InferenceRouter.sanitize_context()` in `mira-bots/shared/inference/router.py`:
- IPv4 → `[IP]`, MAC → `[MAC]`, Serial numbers → `[SN]`
- Static method — callers must invoke explicitly before any API call
- Applied to both `str` content and multipart `text` blocks

## Safety Keywords
`SAFETY_KEYWORDS` in `mira-bots/shared/guardrails.py` — 21 phrase-level triggers (arc flash, LOTO, confined space, etc.). Match in `classify_intent()` → immediate STOP escalation.
- Add keywords as phrases (not single words) to avoid false positives
- Test: `pytest tests/ -k "safety"`

## Tier Limits
`check_tier_limit(tenant_id)` in `mira-core/mira-ingest/db/neon.py` → `(allowed, reason)`. Fail-open on DB errors. Wire to HTTP 429 in ingest endpoints.

## Docker Security
**Never:** `privileged: true`, `network_mode: host`, `:latest`/`:main` tags
**Always:** `restart: unless-stopped`, healthcheck, pinned versions, named networks

## API Auth
| Service | Auth | Key |
|---------|------|-----|
| mira-mcp REST (:8001) | Bearer token | `MCP_REST_API_KEY` |
| Open WebUI | Bearer token | `OPENWEBUI_API_KEY` |
| mira-ingest | None (core-net only) | — |
| mira-web | JWT (`PLG_JWT_SECRET`) | Per-tenant |

## Input Validation
- Telegram: 20MB PDF limit. Slack: MIME allowlist (images + PDF only).
- All adapters: strip `@mention` tags via `guardrails.strip_mentions()`
- Ingest: image resize (MAX_INGEST_PX), asset_tag path prefix (no traversal)
- **Never:** accept arbitrary file paths, execute user strings as shell, deserialize untrusted pickle
