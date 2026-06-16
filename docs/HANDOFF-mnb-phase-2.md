# HANDOFF — Maintenance Namespace Builder Phase 2

**Updated:** 2026-05-16 (revised)
**Parent plan:** `docs/plans/2026-05-15-maintenance-namespace-builder.md` (Phase 2)
**Spec:** `docs/specs/maintenance-namespace-builder-spec.md`
**Phase 2 PR:** `feat/mnb-phase-2-hub-surfaces` (PR #1332)

Phase 2 is **shipped end-to-end** in PR #1332. This file enumerates what's in the PR and what remains for follow-up polish (Phase 3 onboarding, Phase 4 marketing, etc.).

---

## What's shipped

### Slice 1 — Read-only foundation

1. **Migration 021** (`mira-hub/db/migrations/021_namespace_builder.sql`) — `health_scores`, `wizard_progress`, `namespace_versions`. RLS-scoped per migration 018 pattern.
2. **Pure health-score calculator** (`mira-hub/src/lib/health-score.ts`) — `computeHealthScore(counts) → {level, levelName, nextStep}`. L0–L6 mapping. 12 vitest unit tests.
3. **Read-only API routes**:
   - `GET /api/namespace/tree`
   - `GET /api/proposals`
   - `GET /api/readiness`
4. **Hub pages**:
   - `/namespace` — collapsible tree + node-detail right pane.
   - `/proposals` — risk-grouped cards with status tab filter.
5. **HealthScoreWidget** mounted on `/feed`.

### Slice 2 — Mutations

6. **Engine migration 008** (`docs/migrations/008_kg_approval_state.sql`) — adds `approval_state`, `proposed_by`, `evidence_summary` to `kg_entities` and `kg_relationships`. Partial index for the engine's "verified-only" hot read path. Engine-side complement to Hub's `relationship_proposals.status` (per ADR-0013).
7. **`POST /api/proposals/:id/decide`** — verify/reject decisions in a single transaction. On verify, INSERT or UPDATE `kg_relationships` with `approval_state='verified'`. On reject, set proposal `status='rejected'`. Returns 404/409/400 with structured errors.
8. **`PUT /api/namespace/node/:id`** — move (newParentId) and rename (newName). Validates self-parent + descendant-parent cycles. Writes `namespace_versions` audit row in the same transaction.
9. **`POST /api/readiness/recalculate`** — manual flush endpoint for the widget refresh + the slice-3 worker.
10. **Drag-and-drop UI** on `/namespace` tree — HTML5 `draggable`, drop-target highlight, optimistic update with rollback, toast.
11. **Verify / Reject buttons** on `/proposals` cards — optimistic remove on success, rollback + toast on failure.

### Slice 3 — Event-driven recompute worker

12. **`scripts/health-score-worker.ts`** — polls `health_scores` for stale rows (default 5-minute threshold) AND tenants with `kg_entities` but no `health_scores` row, recomputes via the pure calculator, UPSERTs with full RLS scoping. Exit code 1 on per-tenant failures (cron-friendly).
13. **`bun run health-score:worker`** — package.json entry. Cron schedule belongs to the deploy surface, not this script.

### Tests

- **`src/lib/__tests__/health-score.test.ts`** — 12 vitest unit tests (every L0–L6 boundary, strictly-outnumbered L6 threshold, every level supplies a next-step hint).
- **`tests/e2e/phase2-namespace-builder-proof.spec.ts`** — Playwright spec for post-deploy validation. Covers:
  - `/namespace`, `/proposals`, `/feed` shell rendering.
  - `GET /api/readiness` returns 0 ≤ level ≤ 6 + `nextStep`.
  - `POST /api/readiness/recalculate` returns fresh level.
  - Verify/Reject buttons render on Pending tab, hidden on Verified tab.
  - Namespace nodes have `draggable="true"`.

### Build

`bun run build` registers every route correctly:

```
ƒ /api/namespace/node/[id]
ƒ /api/namespace/tree
ƒ /api/proposals
ƒ /api/proposals/[id]/decide
ƒ /api/readiness
ƒ /api/readiness/recalculate
ƒ /namespace
ƒ /proposals
```

---

## Acceptance against the plan's Phase 2 list

- ✅ Hub `/namespace` renders the tree (slice 1).
- ✅ Manager can drag an asset to a different line — slice 2 (drag-drop UI + `PUT /api/namespace/node/:id` writes `namespace_versions` snapshot).
- ✅ Pending proposal can be confirmed; corresponding `kg_relationships` row promotes to verified (slice 2).
- ✅ Health-score recalculates — `POST /api/readiness/recalculate` runs the pure calculator on demand; the worker polls stale rows (slice 3).
- ✅ `/feed` widget shows L0 on brand-new tenant (covered by empty-counts path of unit test).
- ⏸ **Screenshot pair to `docs/promo-screenshots/`** — pending post-deploy live capture. The pages render against a stub DB but the screenshots want real data; capture after the next deploy when the demo tenant has seeded entities.

---

## Known caveats (slice 1 quirks preserved)

- `/api/proposals` shows catalog-level proposals (`tenant_id IS NULL`) intentionally per migration 018's comment. If tenants shouldn't see those, flip to `p.tenant_id = $1` only.
- `/api/readiness` (GET) write-through is in a separate `withTenantContext` transaction from the read. Concurrent recomputes on the same tenant rely on the `UPSERT (tenant_id, scope, scope_path)` to converge. Slice 3 worker reduces request-path recomputes; both code paths now write through.
- `/api/namespace/node/:id` validates self-parent and descendant-parent only. Cross-kind validation (e.g., disallow dropping a `line` into a `component`) is enforced at the UI layer for now; backend-side enforcement is a Phase 5 hardening item if customer feedback demands it.

---

## What's next (Phase 3 / Phase 4)

These are listed for the next session, not for this PR:

- **Phase 3 — Onboarding wizard** (Weeks 5–6). `/onboarding` flow that writes `wizard_progress` rows. The schema is in migration 021; the UI ships in Phase 3.
- **Phase 3 — Tag-import CSV pipeline**. `POST /api/ingestion/tag-import`.
- **Phase 3 — QR capture flow** at `/m/[assetTag]/capture`.
- **Phase 4 — Marketing alignment** on factorylm.com.
- **Phase 5 — Ignition tag export helper**.

Also remaining from Phase 1:
- **Location resolution** extension to `UNSContext` (sites/areas/lines/machines/components) — `mira-bots/shared/uns_resolver.py`.
- **Photo ingestion API** — `POST /api/v1/ingestion/photo`. Engine migration 008 (this PR) unblocks the proposal-side wiring.
- **Citation enforcement** on the gate path — keyed off `state["state"] == "AWAITING_UNS_CONFIRMATION"`.

---

## Memory hooks for cluster sessions

- Hub route convention is `/api/<resource>`, NOT `/api/v1/<resource>`.
- ADR-0013 governs schema lineage: Hub `mira-hub/db/migrations/` for product-surface tables; engine `docs/migrations/` for `kg_entities`/`kg_relationships`.
- Slice-3 worker is cron-driven, not LISTEN/NOTIFY. Schedule it alongside `cmms:sync`.
- `withTenantContext` sets both `app.tenant_id` AND `app.current_tenant_id` — the worker mirrors this dual-key pattern because it bypasses the helper.
- Playwright proof spec uses shared `playwright@factorylm.com` / `TestPass123`.
- `bun run lint` enforces `react-hooks/set-state-in-effect`.
