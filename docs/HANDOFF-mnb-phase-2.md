# HANDOFF — Maintenance Namespace Builder Phase 2

**Updated:** 2026-05-16
**Parent plan:** `docs/plans/2026-05-15-maintenance-namespace-builder.md` (Phase 2)
**Spec:** `docs/specs/maintenance-namespace-builder-spec.md`
**Slice 1 PR:** `feat/mnb-phase-2-hub-surfaces`

Phase 2 (Weeks 3–4 in the plan) ships in three slices. Slice 1 is in this PR; slices 2 and 3 are outstanding. The plan's full Phase 2 acceptance line ("a manager can drag an asset and see the change persist + a `namespace_versions` snapshot row") gates on slice 2.

---

## Shipped in slice 1 (this PR)

1. **Hub migration 021** (`mira-hub/db/migrations/021_namespace_builder.sql`) — three tables: `health_scores`, `wizard_progress`, `namespace_versions`. All RLS-scoped per the existing Hub pattern.
2. **Pure health-score calculator** (`mira-hub/src/lib/health-score.ts`) — `computeHealthScore(counts) → {level, levelName, nextStep}`. L0–L6 mapping. 12 vitest unit tests green.
3. **API routes (read-only)**:
   - `GET /api/namespace/tree` — reads `kg_entities` for tenant, builds tree by `uns_path`, joins pending-proposal counts.
   - `GET /api/proposals` — reads `relationship_proposals` (Hub mig 018) ordered by risk level. Supports `?status=`, `?type=`, `?limit=`.
   - `GET /api/readiness` — computes tenant L0–L6 on demand, write-through caches into `health_scores`.
4. **Hub pages (read-only)**:
   - `/namespace` — collapsible tree view + node-detail right pane.
   - `/proposals` — risk-grouped cards with status tab filter.
5. **HealthScoreWidget** — mounted at the top of `/feed`, above the KPI row.
6. **Tests**:
   - `mira-hub/src/lib/__tests__/health-score.test.ts` — 12 unit tests, all green.
   - `mira-hub/tests/e2e/phase2-namespace-builder-proof.spec.ts` — Playwright proof spec for post-deploy validation. Hits the three routes, asserts the readiness widget renders, and verifies `/api/readiness` returns a valid L0–L6 response.

Build verified: `bun run build` succeeds with all three new routes registered in the Next.js manifest.

---

## Still outstanding for Phase 2 (slices 2 & 3)

### Slice 2 — Mutations

**Goal:** the plan's "manager can drag an asset to a different line and see the change persist + a `namespace_versions` snapshot row" acceptance line.

- **`PUT /api/namespace/node/:id`** — move/rename. Writes a `namespace_versions` row in the same transaction as the `kg_entities` update.
- **`POST /api/proposals/:id/decide`** — promote proposal status. Body: `{decision: "verify"|"reject", reason?: string}`. On `verify`, INSERT into `kg_relationships` with `approval_state='verified'`.
- **Drag-and-drop UI** on `/namespace` (use `@dnd-kit/core`; already adjacent to what Refine expects). Constrain target node kinds (e.g., a `line` cannot be dropped under a `component`).
- **Confirm / Reject buttons** on `/proposals` card. Optimistic UI update; rollback on 4xx.

**Engine-side dependency:** Phase 1 deliverable #1 — `docs/migrations/008_kg_approval_state.sql` (engine lineage). Slice 2 cannot ship until that column exists, or the `verify` action has no place to land.

### Slice 3 — Event-driven recompute worker

**Goal:** the plan's "health score recalculates within 2 seconds" acceptance line.

- **Worker** (`mira-hub/scripts/health-score-worker.ts`) listens on the same Postgres NOTIFY channel that `relationship_proposals` and `kg_entities` already emit on insert/update (or, more reliably, polls `health_scores.updated_at < NOW() - interval '30s'` against a staleness threshold).
- **Trigger** (`021_namespace_builder.sql` follow-up migration) — set up `LISTEN`/`NOTIFY` or a simple "dirty" boolean.
- **`POST /api/readiness/recalculate`** — manual flush endpoint for the widget's `Refresh` icon.

### Phase 2 acceptance checklist (full status)

- ✅ Hub tree page rendered with seeded data (slice 1).
- ⏸ Manager can drag an asset and see the change persist + a `namespace_versions` snapshot row (slice 2).
- ⏸ Pending proposal can be confirmed; `kg_*` row promotes; health score recalculates within 2 seconds (slice 2 + slice 3).
- ✅ `/feed` widget shows L0 on brand-new tenant (slice 1 — covered by the empty-counts path of the unit test).
- ⏸ Screenshots desktop + mobile to `docs/promo-screenshots/` (slice 2 — wait until drag-drop is in the frame).

### Phase 1 deliverables blocking Phase 2

These are listed in `docs/HANDOFF-mnb-phase-1.md` and are referenced again here because slice 2 will hit them:

- `008_kg_approval_state.sql` (engine lineage) — blocks the verify mutation in slice 2.
- Photo-ingest API + MCP `kg_propose_edge` tool — not blocking slice 2 strictly, but they're how new proposals enter the queue; the slice-1 `/proposals` page reads what's already there.

---

## Coordination notes

Before claiming slice 2 or slice 3, run the coordination block both the 90-day MVP plan and the namespace-builder plan share:

```bash
git fetch origin main
git log origin/main --oneline -10
gh pr list --state open --json number,title,headRefName | jq -r '.[] | select(.title | test("mnb-phase"; "i")) | .number, .title, .headRefName'
```

If another session has opened `feat/mnb-phase-2-mutations` or similar, talk first.

---

## Memory hooks for cluster sessions

- `mira-hub/db/migrations/` is canonical for namespace-builder product-surface schema per ADR-0013. Do NOT introduce `ai_suggestions` or duplicate proposal tables under `docs/migrations/`.
- Hub route convention is `/api/<resource>`, NOT `/api/v1/<resource>` even though the plan uses the v1 prefix. Match the codebase.
- The vitest config excludes `*.integration.test.ts` from the default `bun run test` run — integration tests need `TEST_DATABASE_URL` and a Postgres container. Slice 1 sticks with unit tests of the pure calculator.
- The Playwright proof spec assumes `playwright@factorylm.com` test user already exists (created idempotently via `/api/auth/register/`). The Phase 1 smoke spec uses the same credential block — keep them in sync.
- `bun run lint` enforces `react-hooks/set-state-in-effect`. Don't call `setLoading(true)` synchronously inside a `useEffect` body — extract into the async closure or rely on the initial state.
