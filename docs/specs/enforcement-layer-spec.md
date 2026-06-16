---
title: Enforcement Layer
status: draft
owner: Mike
created: 2026-05-07
last_updated: 2026-05-07
related:
  - docs/specs/factorylm-platform-v2.md
  - mira-hub/AGENTS.md
  - .githooks/pre-commit
  - .github/workflows/code-review.yml
---

# Enforcement Layer Spec

## 1. Problem

Mike has caught more regressions than CI has. The pattern is consistent:

- A migration adds an enum value, code references a value that does not exist, the WO write fails silently in production.
- A page renders blank because a fetch returns 500, but no Playwright test covers it, so the hub looks fine to whoever last shipped.
- A spec exists somewhere in `docs/`, but the implementation has drifted and no one notices because nothing forces the spec author to look.
- A NeonDB role loses write permission and the next user sees the bug; ops finds out from a Telegram complaint.

Manual testing does not scale. The platform now has 32 hub pages, 40+ API routes, and 5 migrations layering enums on top of each other. We need mechanical gates that fail loudly *before* a human user does.

## 2. Goals

1. Every page on app.factorylm.com is audited on every deploy.
2. Every write path (WO, asset, PM) round-trips through CI before merge.
3. Enum mismatches between Postgres migrations and TS/Python code fail CI.
4. Specs cannot silently rot — pre-commit warns when code outpaces docs.
5. Every PR points at a spec and confirms acceptance criteria.
6. NeonDB write-path health is observed every 15 minutes by a real INSERT, not a ping.

## 3. Non-Goals

- Auto-fixing detected drift. The reviewer does that; the gate just refuses.
- Replacing existing CI (`code-review.yml`, `ci.yml`, `smoke-test.yml`) — this layer is additive.
- Shipping deploy-blocking gates from day one. Phase 1 = warn-only; Phase 2 (after 2026-05-21) = block.

## 4. Architecture

Six independent mechanisms, each with a clear failure mode and owner:

```
                   ┌──────────────────────────────────────┐
                   │  Trigger: PR / push / cron / deploy  │
                   └──────────────────────────────────────┘
                                    │
           ┌────────────┬───────────┼───────────┬────────────┐
           │            │           │           │            │
           ▼            ▼           ▼           ▼            ▼
       (1) Page      (2) Write    (3) Enum    (5) PR     (6) Canary
        audit        round-trip    drift       template    (15m cron)
       Playwright    pytest        py script   markdown    heartbeat
           │            │           │           │            │
           ▼            ▼           ▼           ▼            ▼
       docs/audits/  CI gate      CI gate     reviewer    Telegram
       /YYYY-MM-DD   block-on-fail block-on-  must check  ops alert
                                  fail
                                              (4) Pre-commit
                                              spec staleness
                                              warn-only
```

### 4.1 Mechanism 1 — Playwright full-page audit

- **File:** `tests/e2e/hub-page-audit.spec.ts`
- **Trigger:**
  - On every PR that touches `mira-hub/**` (via `enforcement-audit.yml`)
  - Nightly at 03:00 UTC against `https://app.factorylm.com/hub` (regression catch)
  - Manual: `cd mira-hub && HUB_URL=… npx playwright test tests/e2e/hub-page-audit.spec.ts`
- **Route catalog:** 28 routes derived from `mira-hub/src/app/(hub)/**/page.tsx` plus the public auth routes:
  ```
  /login, /signup, /pending-approval, /magic, /upgrade
  /feed, /event-log, /actions, /alerts, /requests, /requests/new
  /workorders, /workorders/new, /assets, /parts, /documents
  /knowledge, /reports, /schedule, /usage, /more
  /channels, /conversations, /integrations, /team, /cmms
  /admin/users, /admin/roles
  ```
  The list is regenerated from the filesystem at test boot — adding a `page.tsx` automatically expands the audit.
- **Per-route checks:**
  - HTTP status 200 (or 401/302 for auth-gated, treated as pass when redirected to /login)
  - Zero `console.error` events captured during page load
  - Zero unhandled JS exceptions
  - Page paints non-empty `<body>` text (>20 chars excluding nav chrome)
  - `domcontentloaded` < 5000 ms
- **Output:** `docs/audits/YYYY-MM-DD-audit.md` with a table: route, status, paint time, errors, regressions vs previous audit.
- **Phase 1 gate (now → 2026-05-21):** workflow logs warnings; never blocks merge.
- **Phase 2 gate (2026-05-21+):** if score < previous score, deploy job fails.

### 4.2 Mechanism 2 — Write-path integration tests

- **File:** `tests/integration/test_write_paths.py`
- **Trigger:** PR touching `mira-hub/src/app/api/**/route.ts` or `mira-hub/db/migrations/**`
- **Coverage:**
  - Work orders: `POST /api/work-orders` → `GET /api/work-orders/{id}` → assert title, priority, status round-trip; cleanup via `DELETE` or status=`cancelled`.
  - Assets: `POST /api/assets` → `GET /api/assets/{id}` → assert manufacturer, model, criticality round-trip.
  - PM schedules: `POST /api/pm-schedules` → `PATCH /api/pm-schedules/{id}` (frequency change) → `GET` → assert.
- **Auth:** uses a long-lived `ENFORCEMENT_TEST_BEARER` test tenant token (Doppler `factorylm/prd`), or a synthesized session via `/api/auth/register/`.
- **Target:** by default `BASE_URL=https://app.factorylm.com`; PR runs may target preview deploy URL when emitted.
- **Gate:** any failure blocks PR merge. Phase 1 = block from day one (write paths are too critical to warn-only).

### 4.3 Mechanism 3 — Enum drift CI check

- **File:** `scripts/check_enum_drift.py`
- **Trigger:** PR touching `mira-hub/db/migrations/**`, `mira-hub/src/**`, or `mira-bots/shared/**`
- **Algorithm:**
  1. Walk `mira-hub/db/migrations/*.sql` and extract every enum type declaration:
     - `CREATE TYPE <name> AS ENUM ('a', 'b', 'c')`
     - `ALTER TYPE <name> ADD VALUE 'd'`
     - Casts of literals: `'foo'::workorderstatus` (informational only)
  2. Build canonical map `{ enum_name: set(values) }`.
  3. Walk:
     - TS files in `mira-hub/src/**` for `as "open" | "in_progress" | …` patterns and `::workorderstatus` casts.
     - Python files in `mira-bots/shared/**` for `::workorderstatus`/`::prioritylevel` casts and string-literal status comparisons.
  4. Report:
     - `code-not-in-migrations`: a literal cast to an enum that doesn't appear in any migration.
     - `migrations-not-in-code`: an enum value declared but never referenced (informational, not failing).
- **Gate:** `code-not-in-migrations` fails CI. Phase 1 = block from day one.
- **Escape hatch:** values listed in `.enum-drift-allowlist.txt` are skipped.

### 4.4 Mechanism 4 — Pre-commit spec staleness

- **File:** `.githooks/pre-commit` (extended)
- **Trigger:** every commit (already wired via `git config core.hooksPath .githooks`).
- **Algorithm:**
  - Map `mira-hub/src/app/api/<module>/**` → `docs/specs/<module>-spec.md` (or `factorylm-platform-v2.md` as fallback).
  - If staged files include any path under `mira-hub/src/app/api/`, look up the matching spec.
  - Read the spec's `last_updated:` frontmatter date.
  - If `(today - last_updated) > 7 days`, emit a yellow warning: `Consider updating docs/specs/<spec>.md (last updated <date>)`.
- **Gate:** never blocks. Mike does not want a hook that he has to bypass.

### 4.5 Mechanism 5 — PR template with spec reference

- **File:** `.github/pull_request_template.md`
- **Required fields (markdown checkboxes):**
  - `Spec reference: docs/specs/___` (literal path or `N/A — see below`)
  - `Acceptance criteria verified: [ ] yes [ ] N/A`
  - Pre-merge checklist:
    - `[ ] No regressions on Playwright audit`
    - `[ ] Write-path tests pass`
    - `[ ] Enum drift check pass`
    - `[ ] No new secrets in diff`
- **Enforcement:** GitHub UI surfaces the template; reviewer confirms by ticking boxes. Phase 2 (post-2026-05-21) may add a labeler action that blocks merge if the spec field is empty — but that's out of scope here.

### 4.6 Mechanism 6 — Data canary in heartbeat

- **File:** `scripts/heartbeat_monitor.py` (new)
- **Trigger:** cron every 15 min on Charlie via `~/factorylm/CLUSTER.md` cowork tasks.
- **Schema:**
  ```sql
  CREATE TABLE IF NOT EXISTS system_canary (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    value       TEXT        NOT NULL
  );
  -- No RLS, no tenant_id — this is platform health, not customer data.
  ```
  Migration: `mira-hub/db/migrations/006_system_canary.sql`.
- **Steps each run:**
  1. `INSERT INTO system_canary (value) VALUES ($1) RETURNING id` — value is `iso_timestamp + hostname + uuid4()`.
  2. `SELECT created_at, value FROM system_canary WHERE id = $1` — assert match.
  3. `DELETE FROM system_canary WHERE id = $1`.
  4. `DELETE FROM system_canary WHERE created_at < NOW() - INTERVAL '24 hours'` — janitor sweep.
- **Failure mode:** any step error → POST to ops Telegram channel via existing webhook, log to `wiki/heartbeat.log`, exit 1.
- **Connection:** Doppler `NEON_DATABASE_URL`; `psycopg2`; no app code dependency — this monitor must keep working when the rest of the stack is down.

## 5. Acceptance criteria

- [ ] `docs/specs/enforcement-layer-spec.md` lands and is referenced from at least one of: `CLAUDE.md` pointers section, `mira-hub/AGENTS.md`, or `wiki/hot.md`.
- [ ] `tests/e2e/hub-page-audit.spec.ts` runs locally against the live hub and emits a `docs/audits/YYYY-MM-DD-audit.md` file.
- [ ] `tests/integration/test_write_paths.py` passes against staging when run with `pytest tests/integration/test_write_paths.py -v`.
- [ ] `python scripts/check_enum_drift.py` exits 0 against current `main`.
- [ ] `.githooks/pre-commit` warns (without blocking) when a stale spec is detected via a hand-crafted test commit.
- [ ] `.github/pull_request_template.md` renders on a new PR.
- [ ] `scripts/heartbeat_monitor.py` runs end-to-end against Doppler `factorylm/prd` and writes a successful run line to `wiki/heartbeat.log`.
- [ ] `.github/workflows/enforcement-audit.yml` exists, is `workflow_dispatch`-able, and runs the three CI gates (audit, write-path, enum drift).

## 6. Phasing

| Date | What activates |
|---|---|
| 2026-05-07 | All 6 files merged, all gates **warn-only or manual**. Mechanism 2 (write-path) and 3 (enum drift) block merge starting day one because they're cheap and high-signal. |
| 2026-05-14 | Mechanism 6 (canary) cron installed on Charlie via `infra/ansible/`. |
| 2026-05-21 | Mechanism 1 (Playwright audit) flips to block on regression. PR template field becomes label-enforced. |
| 2026-06-01 | Audit history (`docs/audits/`) used as input for monthly KPI report on platform health. |

## 7. Risks

- **Test tenant data pollution.** Write-path tests create real rows in NeonDB. Mitigation: each test creates a row with `tag` prefixed `__ENFORCEMENT__-<runid>` and unconditionally cleans up in `finally`. A nightly sweep deletes any leaked `__ENFORCEMENT__-*` rows older than 24h.
- **Audit flakes due to network.** Playwright runs against live prod. Mitigation: each route is retried once at the test layer; only consistent failures are reported.
- **Enum drift false positives.** Some literals are not enum casts (e.g. arbitrary status strings). Mitigation: only flag literals adjacent to a `::<enum_name>` cast or in a known constant array; allowlist via `.enum-drift-allowlist.txt`.
- **Canary table bloat.** 96 inserts/day × ∞. Mitigation: per-run sweep deletes rows older than 24h; table never grows.
- **Spec staleness fatigue.** If every commit warns, Mike will tune it out. Mitigation: warning fires only when the *matching* spec is stale, not all specs.

## 8. Open questions

- Should the Playwright audit run against staging or prod? Current answer: prod (we ship continuously, staging would lie).
- Where should canary alerts fire? Current answer: `#alpha-status` Discord webhook + Telegram ops channel; both already exist.
- When does Phase 2 (block-on-regression) flip? Current answer: 2026-05-21, gated on two clean weeks of audit data.
