# MIRA SaaS MVP — QA Audit Report

**Branch:** feature/paperclip
**Scope:** Brain 1/Brain 2 dual-store, safety guardrails, expanded system prompt, MIRA branding, Dockerfile fixes
**Auditor:** QA review thread T-019d55bd-0c80-7378-bfd8-d3aeb1f5c87d
**Date:** 2026-04-03
**Commits reviewed:** 40ce61c → c822bec

---

## Files Changed This Session

| File | Change |
|------|--------|
| `mira-sidecar/app.py` | Dual-store init, collection routing on `/ingest` + `/ingest/upload`, dual-brain `/rag`, version bump to 0.2.0 |
| `mira-sidecar/rag/query.py` | Rewritten — dual-brain retrieval, merge/dedup/rerank, expanded system prompt, safety integration |
| `mira-sidecar/safety.py` | **NEW** — 28 safety keywords, `detect_safety()`, `SAFETY_BANNER` |
| `mira-sidecar/Dockerfile` | Added `COPY safety.py` |
| `mira-sidecar/openwebui/mira_diagnostic_pipe.py` | Pre-existing (no changes this session, but noted for context) |
| `docker-compose.saas.yml` | Added `WEBUI_NAME=MIRA`, changed Ollama URL to `host.docker.internal` |
| `mira-sidecar/CLAUDE.md` | Updated binding docs for SaaS vs on-prem |

---

## BUGS — Will cause failures or incorrect behavior

### B1 — Version string mismatch (P1)

**Files:** `app.py:66`, `app.py:102`, `app.py:194`, `pyproject.toml:2`

Startup log says `v0.1.0` (line 66). `/status` endpoint returns `"0.2.0"` (line 194). `FastAPI(version="0.1.0")` (line 102). `pyproject.toml` says `version = "0.1.0"`.

Three locations, two different values. Will cause confusion during ops debugging — you'll see `v0.1.0` in logs but `0.2.0` from `/status`.

**Fix:** Set all four to `0.2.0`.

```python
# app.py line 66
"mira-sidecar v0.2.0 starting — ..."

# app.py line 102
app = FastAPI(title="MIRA RAG Sidecar", version="0.2.0", ...)

# pyproject.toml
version = "0.2.0"
```

---

### B2 — Dockerfile does not COPY uv.lock — builds are not reproducible (P1)

**File:** `mira-sidecar/Dockerfile:14-15`

```dockerfile
COPY pyproject.toml ./
RUN uv lock --no-cache && uv sync --frozen --no-dev
```

`uv.lock` exists locally at `mira-sidecar/uv.lock` but is never copied into the image. `uv lock --no-cache` regenerates from scratch, then `--frozen` succeeds against the just-generated lock. A rebuild on the VPS tomorrow could resolve different dependency versions than today's build.

**Fix:**

```dockerfile
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev
```

Remove the `uv lock --no-cache` — the whole point of `--frozen` is to use the committed lock file.

---

### B3 — "smoke" safety keyword is too broad — high false-positive rate (P1)

**File:** `mira-sidecar/safety.py:24`

`"smoke"` matches any query containing the substring: "smokestack ventilation," "smoke detector maintenance schedule," "what does the smoke test parameter do on a PowerFlex."

In `mira-bots`, the `classify_intent()` function provides an intent pre-filter before safety fires. In the sidecar, `detect_safety()` runs on ALL queries with no intent gating — every "smoke" substring triggers the safety banner + system prompt override.

Same concern applies to `"lockout"` (line 21) — "How do I configure the lockout timer parameter?" is a legitimate technical question.

**Fix:** Use word-boundary matching for short/ambiguous keywords. Either:
- Change `"smoke"` to `"smoke from"` or `"visible smoke"` (phrase-level)
- Or add `\b` word boundaries in the regex and keep a separate list of phrase-only matches that require surrounding context

---

### B4 — mira-mcp ports 8009 and 8001 exposed to internet (P1 security)

**File:** `docker-compose.saas.yml:93-95`

```yaml
ports:
  - "8009:8000"
  - "8001:8001"
```

These bind to `0.0.0.0` on the VPS. The MCP server is protected only by `MCP_REST_API_KEY` header auth. If UFW doesn't explicitly block 8009/8001, these are internet-accessible. Docker's iptables rules bypass UFW by default on Linux.

**Fix:** Bind to localhost or remove port mappings:

```yaml
ports:
  - "127.0.0.1:8009:8000"
  - "127.0.0.1:8001:8001"
```

Or remove `ports:` entirely if mira-mcp is only accessed via Docker network.

---

### B5 — mira-ingest port 8002 exposed to internet (P1 security)

**File:** `docker-compose.saas.yml:70-71`

```yaml
ports:
  - "8002:8001"
```

Same issue as B4. No authentication on `/ingest` endpoints. Anyone who can reach port 8002 can inject documents into the knowledge base.

**Fix:** `"127.0.0.1:8002:8001"` or remove `ports:` entirely.

---

## WARNINGS — Won't crash but need attention

### W1 — mira-mcp volume uses host path that may not exist

**File:** `docker-compose.saas.yml:103`

```yaml
volumes:
  - /opt/mira/data:/mira-db
```

Uses a host bind-mount, not a named Docker volume. If `/opt/mira/data` doesn't exist, Docker creates it as root-owned empty directory. `mira.db` is never seeded — MCP diagnostic tools will fail silently (no tables to query).

**Action:** Verify on VPS: `ls -la /opt/mira/data/mira.db`. If missing, either seed it or switch to a named volume like the other services.

---

### W2 — Dedup key in _merge_hits() will over-deduplicate

**File:** `mira-sidecar/rag/query.py:99`

```python
key = (hit.get("source_file", ""), hit.get("page", ""))
```

Two different chunks from the same file and same page (common when a dense PDF page produces 2-3 chunks at 512 tokens each) will collide. Only the first chunk survives. This silently drops relevant content.

**Fix:** Include `chunk_index`:

```python
key = (hit.get("source_file", ""), hit.get("page", ""), hit.get("chunk_index", 0))
```

---

### W3 — Stale comment in app.py entry point

**File:** `mira-sidecar/app.py:359`

```python
host=settings.host,  # always 127.0.0.1 per security policy
```

But `Dockerfile:31` sets `ENV HOST=0.0.0.0`. The comment is misleading — the security model changed for SaaS (bind 0.0.0.0 inside container, no host port exposure). Should be updated or removed.

---

### W4 — Pipe Function doesn't pass `collection` parameter on file upload

**File:** `mira-sidecar/openwebui/mira_diagnostic_pipe.py:184`

```python
data={"asset_id": asset_id},
```

The `/ingest/upload` endpoint now accepts `collection: str = Form("tenant")` but the Pipe never sends it. Defaults to `"tenant"` which is correct for user uploads. But there's no admin-facing way to upload to Brain 1 through the UI — seed ingestion must always be via direct curl to the sidecar.

Not a bug (default is correct), but worth documenting.

---

### W5 — Sidecar CLAUDE.md is stale after this session

**File:** `mira-sidecar/CLAUDE.md`

Still references:
- Single collection `mira_docs` (Storage section) — no mention of `shared_oem`
- No mention of `safety.py` module
- No mention of `/ingest/upload` endpoint in the endpoint table
- No mention of `collection` parameter on ingest endpoints
- No mention of dual-brain query behavior

Any future Claude Code session will get wrong context about the sidecar's architecture.

---

### W6 — Fragile implicit contract between Pipe and store asset_id

**File:** `mira_diagnostic_pipe.py:51` → `query.py:198-202`

The Pipe sets `asset_id = f"tenant_{user_id}"`. Brain 2 queries filter by this `asset_id`. User uploads also use this same `asset_id` (Pipe L184). This works, but the contract is implicit — if any other caller uses a different `asset_id` format, those docs become invisible.

---

## PRIOR QA CONCERNS — Disposition

| Prior Concern | Status | Notes |
|---------------|--------|-------|
| Port 5000 exposed to internet | ✅ **Fixed** | No `ports:` in compose for mira-sidecar |
| mira-mcp volume `/opt/mira/data` may not exist | ⚠️ **Still open** | W1 above |
| Dockerfile missing `COPY uv.lock` | 🐛 **Still broken** | B2 above |
| Dockerfile missing `COPY service/` dir | ✅ **Non-issue** | Grep confirms zero imports from `service/` — it's install scripts only |
| mira-ingest depends on qwen2.5vl:7b | ⚠️ **Acknowledged** | `/ingest/photo` will 502. Not in SaaS MVP scope — acceptable |
| Pipe `_ingest_text` cross-container path | ✅ **Resolved** | Was already fixed — `_ingest_text()` sends bytes via multipart upload, not filesystem path |
| UploadFile and Form imports in app.py | ✅ **Fixed** | `app.py:23` — both present |

---

## RECOMMENDED FIX ORDER

Priority sequence for next implementation session:

1. **B2** — Dockerfile: `COPY uv.lock`, remove `uv lock --no-cache` (1 line, high impact)
2. **B4 + B5** — Bind mira-mcp and mira-ingest ports to `127.0.0.1` in compose (2 lines, security)
3. **W2** — Add `chunk_index` to dedup key in `_merge_hits()` (1 line, correctness)
4. **B1** — Normalize version to `0.2.0` in 3 locations (cosmetic but prevents ops confusion)
5. **B3** — Tighten `"smoke"` keyword — change to `"visible smoke"` or add word-boundary matching
6. **W5** — Update `mira-sidecar/CLAUDE.md` with dual-brain architecture, safety.py, /ingest/upload

---

## VERIFICATION COMMANDS

Run these on the VPS after fixes are deployed:

```bash
# 1. Confirm sidecar shows both collections with doc counts
ssh vps 'docker exec mira-sidecar curl -sf http://localhost:5000/status | python3 -m json.tool'

# 2. Confirm mira-mcp/mira-ingest ports NOT reachable from internet
curl -sf --max-time 3 http://app.factorylm.com:8001/ && echo "FAIL: 8001 exposed" || echo "OK: 8001 blocked"
curl -sf --max-time 3 http://app.factorylm.com:8009/ && echo "FAIL: 8009 exposed" || echo "OK: 8009 blocked"
curl -sf --max-time 3 http://app.factorylm.com:8002/ && echo "FAIL: 8002 exposed" || echo "OK: 8002 blocked"

# 3. Safety false-positive test
ssh vps "docker exec mira-sidecar curl -sf http://localhost:5000/rag -H 'Content-Type: application/json' \
  -d '{\"query\":\"What is the smoke detector maintenance schedule?\",\"asset_id\":\"test\",\"tag_snapshot\":{}}' \
  | python3 -c \"import sys,json; d=json.load(sys.stdin); print('SAFETY TRIGGERED' if '⚠️' in d['answer'] else 'OK: no false positive')\""

# 4. Verify uv.lock is in the Docker image
ssh vps 'docker exec mira-sidecar ls -la /app/uv.lock 2>&1'

# 5. Branding check
curl -sf http://app.factorylm.com/api/config | python3 -c "import sys,json; print(json.load(sys.stdin).get('name','???'))"
```
