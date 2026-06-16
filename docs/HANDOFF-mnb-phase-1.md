# HANDOFF — Maintenance Namespace Builder Phase 1

**Updated:** 2026-05-16
**Parent plan:** `docs/plans/2026-05-15-maintenance-namespace-builder.md`
**Spec:** `docs/specs/maintenance-namespace-builder-spec.md`

Phase 0 (doctrine docs) merged via PR #1323. Phase 1 has six deliverables; this branch (`feat/mnb-phase-1-uns-gate-state`) ships one piece. The rest is outstanding — listed below in dependency order.

---

## Shipped in this PR

1. **`AWAITING_UNS_CONFIRMATION` FSM side state** (`mira-bots/shared/fsm.py`) — added to `VALID_STATES`. Set when the gate fires, cleared back to `IDLE` on yes / no / fallthrough. Lets downstream paths (citation enforcement, telemetry, DST) key off a single FSM state instead of inspecting context.
2. **`MIRA_UNS_GATE_ENABLED` kill-switch** (`mira-bots/shared/engine.py`) — default `1` (enabled). `=0` returns to pre-gate behavior; satisfies the flag-off regression acceptance criterion.
3. **Tests** — `tests/test_uns_confirmation_gate.py` extended from 11 → 13 tests. New: state-transition asserts on request/response handlers, gate-disabled flag test, VALID_STATES membership test.
4. **ADR-0013** — schema canonicalization (Hub `mira-hub/db/migrations/` is authoritative for product-surface schema; engine `docs/migrations/` keeps `kg_entities`/`kg_relationships`).
5. **`docs/env-vars.md`** — `MIRA_UNS_GATE_ENABLED` documented.
6. **Plan in-flight + change-log** — both updated.

---

## Still outstanding (in rough order of value)

### Deliverable 2 — `uns_resolver.py` location extension

The spec calls for `site`, `area`, `line`, `machine`, `asset`, `component` resolution beyond today's `vendor / model / fault_code / category`. Plan calls out the (a) vs (b) shape decision (extend `UNSContext` vs add `resolve_location()` sibling). Decision still owed.

**Suggested smallest first step:** add `asset` (single string) to `UNSContext` populated from a `kg_entities` lookup keyed on `(tenant_id, asset_tag)` extracted from the message. Defer `site / area / line / machine / component` until the asset path is round-trip green.

**Files to touch:** `mira-bots/shared/uns_resolver.py`, `tests/test_uns_resolver.py`, possibly `docs/specs/uns-message-resolver-spec.md` (extend §2.x with location section).

### Deliverable 1 — engine-side `008_kg_approval_state.sql`

Add `approval_state` column (+ `proposed_by`, `evidence_summary`) to `kg_entities` and `kg_relationships` under `docs/migrations/`. Per ADR-0013, this is the engine-side complement to Hub's `relationship_proposals.status`. DOWN migration verified on staging clone before merge.

**Note:** Hub already ships `relationship_proposals` (migration 018); do NOT create `ai_suggestions` here.

### Deliverable 5 — Photo ingestion API + worker

`POST /api/v1/ingestion/photo` on `mira-mcp` wraps the existing `nameplate_worker.py` and writes proposed entities into Hub's `relationship_proposals` (NOT a new `ai_suggestions` table). MCP route file: `mira-mcp/routes/ingestion.py`. Worker: `mira-bots/shared/workers/photo_ingest_worker.py`.

### Deliverable 4 — Citation enforcement on the gate path

`mira-bots/shared/citation_compliance.py` upgrade from observational to enforcing *only* when the conversation passed through `AWAITING_UNS_CONFIRMATION` this session. The FSM side state added in this PR is the hook to key on.

### Deliverable 6 — MCP tools

`kg_search_entities`, `kg_propose_edge`, `kg_approve_suggestion`, `namespace_resolve` exposed via the MCP tool layer in `mira-mcp/server.py`. `kg_propose_edge` writes to Hub's `relationship_proposals` (per ADR-0013).

### Hub-side schema gaps (still missing)

- `wizard_progress` — needed for Phase 3 onboarding wizard resume-on-return.
- `health_scores` — needed for Phase 2 readiness widget.
- `namespace_versions` — needed for Phase 2 drag-drop versioning.

Suggested combined home: `mira-hub/db/migrations/021_namespace_builder.sql`. Decide column shape with the Hub UI sub-task that defines the read contract.

### Phase 1 acceptance the plan listed (status check)

- ✅ Pre-existing UNS gate regression set still passes (129 UNS + 9 FSM tests green locally on this branch).
- ⏸ New migration applies + reverses cleanly on staging — **deferred** (no migration in this slice).
- ⏸ `pytest tests/ -k "uns_gate or uns_resolver"` green + 6+ new golden cases — partial; gate tests extended, location-resolution golden cases pending Deliverable 2.
- ⏸ `POST /api/v1/ingestion/photo` returns `ingestion_job_id` + creates ≥ 1 `relationship_proposals` row — **deferred** (Deliverable 5).
- ⏸ `bash install/smoke_test.sh` clean after deploy — to run post-merge.
- ✅ Flag-off behavior: `MIRA_UNS_GATE_ENABLED=0` returns to pre-gate behavior — covered by `test_gate_disabled_via_env_flag_does_not_fire`.

---

## Coordination notes for the next session

Before claiming any sub-task above, run the same coordination block both the 90-day MVP plan and this plan use:

```bash
git fetch origin main
git log origin/main --oneline -10
gh pr list --state open --json number,title,headRefName
```

If a recent commit or open PR touches the file the sub-task will edit, edit *this* HANDOFF doc's "Outstanding" section first and ping the other session before writing code. The same protocol prevents the two-sessions-same-file collisions both plans warn about.

---

## Memory hooks for cluster sessions

- The `mira-bots/email/` package has a `from chat_adapter import ...` that breaks pytest when `PYTHONPATH=mira-bots` is set explicitly (stdlib `email` gets shadowed). Run `.venv/bin/pytest` without `PYTHONPATH`; `tests/conftest.py` already wires `sys.path` after stdlib's `email` is cached. Unrelated to UNS work but worth knowing if a future agent hits the same wall.
- The local checkout was 0 commits behind origin/main at PR-cut time. Always re-verify with `git fetch origin && git log main..origin/main --oneline` before claiming the state of any file.
