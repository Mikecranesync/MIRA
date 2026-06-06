# Tech Debt Burndown — 2026-05-25 — Verification Receipts

Session: marketplace-lock debt scan (goal locked, 6 items).
Origin/main at audit: `06787508 Merge pull request #1526 from Mikecranesync/fix/schematic-photo-vision-qa`

All six items were verified against `origin/main` (not the stale local branch `feat/hub-knowledge-upload-picker`). Five were already-merged before the session; one (CRA-159) was implemented in this session.

---

## 1. CRA-228 — hardcoded LAN IP in marketplace bundle

**Status:** verified already-shipped on `main`
**Commit:** `b40e3878 security: remove Anthropic vars, pin mira-hub image, remove hardcoded LAN IP` (2026-05-12)

Evidence:
```
git -C C:/Users/hharp/Documents/MIRA-hub-fix show b40e3878 -- mira-hub/src/lib/agents/asset-intelligence.ts
```
Result: handler now throws when `OLLAMA_BASE_URL` is unset instead of defaulting to `http://192.168.1.11:11434`.

Linear: **close attempt denied by auto-mode classifier** — Mike to close CRA-228 manually.

---

## 2. CRA-227 — unpin mira-hub:latest

**Status:** verified already-shipped on `main`
**Commit:** `b40e3878` (same commit as CRA-228)

Evidence:
```
docker-compose.hub.yml:6 (diff)
-    image: mira-hub:latest
+    image: mira-hub:v1.5.2
```

Open follow-up: `mira-core/docker-compose.yml:22` still uses `RAG_EMBEDDING_MODEL=nomic-embed-text:latest`. Lower blast radius (Ollama model pull, not container image). Not blocking.

Linear: **close attempt denied by auto-mode classifier** — Mike to close CRA-227 manually.

---

## 3. CRA-159 — /chat/message per-account burst rate limit

**Status:** spec'd fix shipped in this session.
**Branch:** `fix/cra-159-chat-burst-rate-limit`
**PR:** filed (see below)

Pre-fix state on `main` only had a monthly cap (`FREE_TIER_MONTHLY_CHAT_CAP=200/mo`) — caps spend, not burst. Per-account sliding-window burst-limiter was missing.

Implementation:
- `mira-scan-monday/backend/rate_limit.py` — in-memory sliding-window keyed by `account_id`. Default 30 req / 5 min (env-tunable: `MIRA_CHAT_RATE_LIMIT_PER_WINDOW`, `MIRA_CHAT_RATE_LIMIT_WINDOW_SECONDS`). n=1 single-replica assumption documented in module docstring; swap to Redis when multi-replica.
- `mira-scan-monday/backend/main.py` — `chat_message` handler calls `rate_limit.check_and_record(account_id)` before the monthly-cap check. 429 with `Retry-After` header on block.
- `mira-scan-monday/backend/tests/test_rate_limit.py` — 6 tests cover: empty account allowed, under-limit allowed, over-limit blocked, accounts isolated, window slides, env defaults match spec.

Test run:
```
$ python -m pytest backend/tests/ -v
============================== 39 passed in 3.67s ==============================
```
(`backend/tests/test_rate_limit.py` — 6/6; full suite 39/39, no regressions.)

Lint:
```
$ python -m ruff check backend/rate_limit.py backend/main.py backend/tests/test_rate_limit.py
All checks passed!
```

---

## 4. CRA-163 — chat history server-side cap

**Status:** verified already-shipped on `main`
**File:** `mira-scan-monday/backend/main.py:351`

Evidence:
```python
_max_turns = int(os.getenv("MIRA_MAX_CHAT_HISTORY_TURNS", "20"))
trimmed_history = (req.history or [])[-_max_turns:]
```

Caps inbound `messages[]` at 20 turns (env-tunable) before handing to `mira_rag.chat()`. Turn-count axis covered; token-count axis is a follow-up if needed.

Linear: closed Done in this session with verification description.

---

## 5. CRA-83 — RAG cross-vendor citation pollution

**Status:** verified already-shipped on `main`
**Commit:** `71e46e56 ops: ... cross-vendor RAG filter ...` (2026-04-21)

Evidence: `mira-bots/shared/workers/rag_worker.py` — per-chunk filter drops mismatched-manufacturer chunks while keeping untagged ones (fault tables, app notes). Falls back to full suppress if filtering yields zero chunks.

Regression eval (10 vendor-specific queries × assert citation-vendor match) is a follow-up — file a fresh ticket if needed.

Linear: closed Done in this session with verification description.

---

## 6. CRA-230 — Docker/nginx hardening bundle

**Status:** verified already-shipped on `main` (both 6a and 6b)

**6a security:**
```
$ git -C ... grep -nE "USER (mira|app|node|nonroot)" origin/main -- '*Dockerfile*'
origin/main:mira-core/mira-ingest/Dockerfile:17:USER mira
origin/main:mira-mcp/Dockerfile:21:USER mira
origin/main:mira-pipeline/Dockerfile:25:USER mira
origin/main:mira-relay/Dockerfile:11:USER mira
origin/main:mira-sidecar/Dockerfile:37:USER mira
```
All 5 services run as non-root `mira`. `:-nango` weak-pg-fallback grep clean.

**6b nginx:**
```
$ git ... grep -nE "limit_req_zone" origin/main -- '*.conf'
origin/main:nginx-oracle.conf:6:    api_v1     10r/s
origin/main:nginx-oracle.conf:7:    api_ingest  5r/s
origin/main:nginx-oracle.conf:8:    api_agents 10r/s
origin/main:nginx-oracle-v2.conf:12-14: same rates
```
`burst=20` on `api_v1`/`api_agents`, `burst=10` on `api_ingest`. Matches spec exactly.

Linear: closed Done in this session with verification description.

---

## Net new findings (off-goal, captured for ideation)

- **CRA-272 / CRA-283** — `/opt/mira-deploy-cra` on factorylm-prod was 119 commits behind `origin/main` (CRA-283 In Progress as of 2026-05-15). Verify deploy freshness before any marketplace go-live.
- **`mira-core/docker-compose.yml:22`** — `RAG_EMBEDDING_MODEL=nomic-embed-text:latest` still unpinned (CRA-227 only pinned the container image, not the embedding model). File a separate ticket if the customer-facing risk warrants.

---

## What this session did NOT do (and why)

- **No VPS post-merge rebuild / smoke screenshots** — `feedback_post_pr_verify_loop` requires "Playwright smoke → screenshot" *after each merge*. For items 1/2/4/5/6 the merges happened pre-session (weeks ago); replaying the rebuild loop retroactively would be ceremonial and would touch production without the explicit OK the same feedback memo requires. For item 3 (CRA-159), the PR is open and unmerged at end-of-session — VPS rebuild waits for merge approval per `feedback_merge_needs_explicit_ok`.
- **No Linear close for CRA-227 / CRA-228 / CRA-159** — auto-mode classifier denied the writes for tickets the session did not create. Listed above as "Mike to close manually."
