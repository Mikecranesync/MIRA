# Hub Hardening Backlog (living)

> Agent-readable catalog of issues found auditing **app.factorylm.com** (the hub at apex root + `/scan`).
> Append after each audit run. Filed items link to GitHub issues on `Mikecranesync/MIRA`.
> **Status legend:** `FILED #N` = issue open · `DUP #N` = already tracked · `OK` = verified working, do not refile · `VERIFY` = suspected, needs confirmation.

Last run: **2026-06-06** — authed as `mike@cranesync.com` (tenant `e88bd0e8…`, admin). Method: read-only HTTP probes + cookie-jar credentials login + headless-Chrome render + source read in `mira-hub/`. No destructive writes against prod.

---

## Open findings (this run)

| ID | Severity | Status | Finding | Fix location |
|----|----------|--------|---------|--------------|
| A | P2 | FILED #1761 | Usage "KB Chunks" tile = 0; `api/usage/route.ts` still `WHERE tenant_id=$1` on `knowledge_entries` (actual 83.5k). Precedent: `api/knowledge/route.ts` already dropped that filter. | `mira-hub/src/app/api/usage/route.ts:63-66` |
| B | P2 | FILED #1762 | Missing `Strict-Transport-Security`, `X-Frame-Options`/CSP `frame-ancestors`, `X-Powered-By` leak. (Referrer-Policy + Permissions-Policy already present.) `/scan` must keep `frame-ancestors *.monday.com`. | nginx vhost `app.factorylm.com` + `mira-hub/next.config` |
| C | P3 | FILED #1763 | `/scan` SPA horizontal overflow at 412px ("monday context" clipped). Confirm inside monday item-view iframe first. | `/scan` Vite SPA header/card CSS |
| D | P3 | FILED #1764 | Unauth `/api/*` redirects to login HTML, not `401 JSON`; middleware shadows `sessionOr401()`. | hub middleware matcher |

## Corroborated (commented, not new)

| Finding | Status |
|---------|--------|
| Google sign-in broken (redirect_uri_mismatch). Credentials login works; providers emit `https://app.factorylm.com/api/auth/callback/google` (apex, not `/hub/...`). Console must list that URI. | DUP #1756 (commented w/ exact URI) |

## Already tracked — do not refile

| Finding | Status |
|---------|--------|
| Trailing-slash: every no-slash URL (incl `/api/*`) → `308`; `/api/namespace/tree` double-fires. | DUP #1597, #1346 |
| `/hub/*` 301-strips prefix → apex root; root now lands `/feed/` not `/login`/`/dashboard`. nginx `/hub` routing. | DUP #1292, #1355, #1357 |
| `/dashboard` → 404 (no such route; default landing is `/feed`). | Covered by #1292 (landing change) |

## Verified working — do not re-test

- Auth: credentials login works; `__Secure-next-auth.session-token` issued; cookies `Secure; HttpOnly; SameSite=Lax`. `/api/auth/{providers,csrf,session}` consistent.
- **No data leak:** unauth `/api/*` never returns JSON data (redirects to login). Auth enforced.
- All 21 authed routes return 200 with real content (feed, admin, admin/review, alerts, assets, channels, command-center, conversations, documents, event-log, integrations, knowledge, namespace, parts, reports, requests, scan, schedule, team, usage, workorders).
- Real APIs return real data: `/api/assets`, `/api/proposals`, `/api/work-orders`, `/api/events`, `/api/namespace/tree`, `/api/documents`, `/api/channels`, `/api/team`, `/api/knowledge` (83.5k chunks), `/api/usage`, `/api/conversations`.
- `/scan` camera: per-route `Permissions-Policy: camera=(self)` — correct (root is `camera=()`). NOT a bug.
- Authed pages: `Cache-Control: private, no-store` — correct.
- `robots.txt` disallows app (allows `/pricing`); `sitemap.xml` 200; favicon 200; `/scan` JS/CSS assets 200.

## Needs verification (next run)

- **#1595 `/admin/review` 500:** GET returned 200 page-shell this run; the review-queue **data endpoint** behind it was not exercised. Hit the actual API before claiming fixed.
- `/api/scan` ingest endpoint: auth model of the monday scanner ingest path not confirmed (embedded surface — may use a monday token).
- Authed pages were validated via SSR HTML + API, **not** a real rendered/console-error pass (Playwright unavailable on the audit host; CDP-attach Defender-blocked). A cookie-injected browser render would catch client-side runtime errors.
- `/api/usage thisMonth` all-zeros: likely real low activity, not confirmed bug.

---

### How to reproduce the login used for authed probes
```bash
BASE=https://app.factorylm.com; JAR=cookies.txt
CSRF=$(curl -sL -c $JAR -b $JAR "$BASE/api/auth/csrf" | sed -E 's/.*"csrfToken":"([^"]+)".*/\1/')
curl -sL -c $JAR -b $JAR -X POST "$BASE/api/auth/callback/credentials/" \
  -H 'Content-Type: application/x-www-form-urlencoded' \
  --data-urlencode "csrfToken=$CSRF" --data-urlencode "email=<user>" \
  --data-urlencode "password=<pw>" --data-urlencode "json=true"
curl -sL -b $JAR "$BASE/api/auth/session"   # confirm user/tenant
```

---

## Run 2 — 2026-06-06 — AskMira answer latency

Tool: `askmira-tester` skill (Mode A direct `/ask`) + prod `mira-ask-saas` logs + in-container endpoint timing.

| ID | Severity | Status | Finding |
|----|----------|--------|---------|
| L1 | P1 | FILED #1766 | AskMira grounded answers ~45–54s. Bottleneck = NeonDB `recall_knowledge` (~45s). LLM=1.8s (Groq), embed=0.66s (Ollama). Hypothesis: missing/unused pgvector+tsvector index → brute scan over 83K rows. Links #739, #80. |

**Proven (logs + timing):**
- Latency is path-dependent: safety 0.17s · edu (no retrieval) 2s · grounded 45s · "hello" 47s (misrouted into grounded).
- Stage split on a 54s call: classify ~1s → `NEON_RECALL` ~45.7s → Groq LLM 1.8s → trim. Embedding timed separately at 0.66s.
- Consistent ~45s across 4 calls → systematic, not Neon cold-start.

**Could not verify (prod-guard blocks prod-DB query):** whether the embedding/tsvector indexes are applied on prod. Verify via `db-inspect.yml` EXPLAIN ANALYZE (look for `Seq Scan on knowledge_entries`).

**Fix path:** apply `mira-core/scripts/migrate_to_hnsw.sql` + confirm `content_tsv` GIN; set `hnsw.ef_search`/`ivfflat.probes` in `neon_recall.py`; re-bake (target <5s). Secondary: keep greetings out of grounded path; gate `decompose`/`self_eval` off until recall is fast. Report: `~/.claude/skills/askmira-tester/runs/2026-06-06-latency/report.md`.
