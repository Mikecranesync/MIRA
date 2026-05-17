# MIRA Maintenance Namespace Builder — Execution Plan

**Window:** 2026-05-15 → 2026-08-22 (≈14 weeks; integrates the in-flight 90-day MVP)
**Status:** Phase 0 in flight (this doc + the TOO + spec)
**Owner:** Mike Harper (primary, 1.0 FTE) + agent-claude sessions
**Parent doctrine:** `docs/THEORY_OF_OPERATIONS.md`
**Contract:** `docs/specs/maintenance-namespace-builder-spec.md`
**Companion plan:** `docs/plans/2026-04-19-mira-90-day-mvp.md` (this plan integrates rather than replaces — see "Integration" below).

---

## Currently in-flight (update before starting work)

> **Protocol:** Edit this list before claiming a phase or sub-task. Edit again when you merge or hand off. A merge conflict on this section is the signal that two sessions tried to claim the same work; resolve by talking before editing files.

| Phase / Task | Owner | Branch | Started | Notes |
|---|---|---|---|---|
| Phase 0 — Docs + pointers | agent-claude | (main, doc-only) | 2026-05-15 | THEORY_OF_OPERATIONS.md, maintenance-namespace-builder-spec.md, this plan, CLAUDE.md pointer updates, wiki/hot.md flag. **Merged 2026-05-15 via PR #1323 (9ccc43af).** |
| Phase 1 — FSM `AWAITING_UNS_CONFIRMATION` side state + `MIRA_UNS_GATE_ENABLED` kill-switch (Phase 1 deliverable #3 partial) | agent-claude | `feat/mnb-phase-1-uns-gate-state` | 2026-05-16 | Adds the FSM side state the gate currently lacks, kill-switch flag for flag-off regression, ADR-0013 schema canonicalization. Extends `tests/test_uns_confirmation_gate.py` (11→13 tests). |

Coordination check before starting any sub-task (same as the 90-day MVP plan's discipline):

```bash
git fetch origin main
git log origin/main --oneline -10
gh pr list --state open --json number,title,headRefName
```

If any recent commit or open PR touches a file the sub-task will edit → see the in-flight section here AND in `docs/plans/2026-04-19-mira-90-day-mvp.md`. If still ambiguous, ping the other session before editing.

---

## Integration with the 90-day MVP plan

This plan does **not** pause, rebase, or override the in-flight 90-day MVP work. It reframes and extends:

| 90-day Unit | Status (per 90-day plan) | How it folds into this plan |
|---|---|---|
| **Unit 2** (source citations) | Ready (cites infra exists from PR #418) | **Phase 1** evidence wiring uses the same citation infra; spec's "citation enforced when gate active" acceptance criterion makes it deterministic on the gate path. |
| **Unit 4** (Excel/CSV exports) | Active branch `feat/mvp-unit-4-exports` | **Phase 2** namespace-export uses the same `mira-mcp/exports.py` host; assets + work orders extend to namespace tree + proposals. |
| **Unit 9a** (landing page rewrite) | Active branch `feat/mvp-unit-9a-landing` | **Phase 4** marketing pulls from 9a's foundation; the H1 / hero copy proposed below either ships as 9a or is iterated on after 9a lands. |
| Future 90-day units (manual ingestion polish, etc.) | Not started | Continue under the 90-day plan; this plan does not claim them. |

No collisions if both plans' in-flight sections are kept current.

---

## Phases

### Phase 0 — Doctrine + repositioning prep (Week 0, ≈3 days)

**Goal:** lay down the three docs and the pointers so every future session shares the same frame.

**Deliverables:**
- `docs/THEORY_OF_OPERATIONS.md` ✅ (this batch)
- `docs/specs/maintenance-namespace-builder-spec.md` ✅ (this batch)
- `docs/plans/2026-05-15-maintenance-namespace-builder.md` ✅ (this batch)
- Root `CLAUDE.md` — North Star pointer promoted to TOO doc.
- `.claude/CLAUDE.md` — pointers updated; remove the dangling `uns-message-resolver-spec.md` reference (subsumed by the spec's UNS gate section).
- `wiki/hot.md` — top entry flagging the three new docs as required reading for next session.
- (Optional) draft homepage copy for `mira-web/public/index.html` — provided as a comment / PR description, not merged yet (waits for Phase 4 alignment with Unit 9a's branch).

**Acceptance:**
- A fresh `claude` session, asked "what is MIRA?", names the namespace-builder framing without prompting.
- `grep -r "uns-message-resolver-spec" .claude/ docs/` returns no live references (only changelog mentions).
- `wc -l docs/THEORY_OF_OPERATIONS.md docs/specs/maintenance-namespace-builder-spec.md docs/plans/2026-05-15-maintenance-namespace-builder.md` is non-zero on all three.

**Risks:** Doc drift — mitigated by single-doc primacy (TOO is the only top-level doctrine; the spec defers to it; this plan defers to the spec).

---

### Phase 1 — Foundation (Weeks 1–2)

**Goal:** make "MIRA proposes, human confirms" real. **Audit the existing UNS gate** (already merged on origin/main via PRs #1220, #1280, #1295, #1314), extend it to full plant-hierarchy resolution, add the proposal queue, and wire the photo ingestion endpoint.

> **State of the world (verified 2026-05-15 after `git fetch origin main`):** The Stage-1 UNS resolver + confirmation gate are **already merged**. `mira-bots/shared/uns_resolver.py`, `mira-bots/shared/uns_paths.py`, and `docs/specs/uns-message-resolver-spec.md` all exist on origin/main. `engine.py` (origin/main) calls `resolve_uns_path()` in 14+ places, with the gate at line 1316. Existing scope covers vendor / model / fault-code. The Phase 1 extension adds site / area / line / machine / asset / component resolution + a clean `AWAITING_UNS_CONFIRMATION` FSM side state. Run `git log main..origin/main --oneline` before claiming any work — local checkouts may be behind.

**Branches:** `feat/mnb-phase-1-uns-gate-extend`, `feat/mnb-phase-1-schema`, `feat/mnb-phase-1-photo-ingest` (separate PRs).

**Deliverables:**

1. **Migration 008** (`docs/migrations/008_namespace_builder.sql`):
   - New tables: `ai_suggestions`, `approvals`, `wizard_progress`, `health_scores`, `qr_codes`, `namespace_versions`.
   - Column adds: `kg_entities.approval_state` + `kg_relationships.approval_state` (+ `proposed_by`, `evidence_summary`).
   - RLS policies for every new table.
   - DOWN migration verified against staging clone.
   - Schema canonicalization decision (Hub `001_knowledge_graph.sql` vs. `004_kg_entities.sql`): file an ADR if not already decided; spec assumes the 004 + 007 NeonDB flavor.

2. **`mira-bots/shared/uns_resolver.py`** (extend existing module):
   - The module already exists with `resolve_uns_path(message, tenant_id=None, prior_ctx=None) → UNSContext` covering vendor / model / fault-code / category.
   - Phase 1 extension: either (a) extend `UNSContext` with `site`, `area`, `line`, `machine`, `asset`, `component` fields populated via `kg_entities` lookups, or (b) add a sibling `resolve_location(message, tenant_id, session) → list[LocationCandidate]` helper. Decision is the first sub-task of Phase 1 — match whatever pattern the existing maintainer prefers.
   - New evidence sources to add (in priority order): prior session → technician hint → WO → UNS path direct match → manual ref → PLC tag → KG fuzzy match. The existing resolver already handles vendor + model + fault-code evidence; reuse those code paths.
   - Stays pure-ish — no LLM call required for the location extension; uses pg + ltree + simple ranking.

3. **FSM extension** (`mira-bots/shared/fsm.py` + `engine.py`):
   - The early hook already exists (`engine.py` line ~1316 — "UNS Confirmation Gate — no diagnosis without confirmed equipment").
   - Add new side state `AWAITING_UNS_CONFIRMATION` to side-states list; update `_advance_state` validator.
   - Extend the existing gate to also enter the new side state when *location* resolution is ambiguous (not just *equipment* resolution).
   - Verify behavior table from spec is fully implemented (skip / card / re-resolve / cancel / safety bypass) — close any gaps.
   - Confirm feature-flag semantics (`MIRA_UNS_GATE_ENABLED`) match spec.

4. **Citation enforcement on the gate path** (`mira-bots/shared/citation_compliance.py`):
   - Upgrade from observational to enforcing **only** for replies whose conversation passed through `AWAITING_UNS_CONFIRMATION`. Everywhere else stays observational.

5. **Photo ingestion API** (`mira-mcp/server.py` + new `mira-bots/shared/workers/photo_ingest_worker.py`):
   - `POST /api/v1/ingestion/photo`: multipart upload + optional `asset_hint`.
   - Wraps existing `nameplate_worker.py` (already functional).
   - Writes `ai_suggestions` row(s) per spec extraction schema; populates `kg_triples_log` for audit.

6. **MCP tools**:
   - `kg_search_entities`, `kg_propose_edge`, `kg_approve_suggestion`, `namespace_resolve`.

7. **Tests**:
   - 6+ golden cases in `tests/golden_factorylm.csv` per spec acceptance.
   - Hypothesis property tests for `AWAITING_UNS_CONFIRMATION` transitions in `tests/property/`.
   - Unit tests for `resolve_uns_path` covering each evidence source.
   - RLS regression test for every new table.

**Files (create):**
- `docs/migrations/008_namespace_builder.sql` (new tables — see migration-numbering note below)
- `mira-bots/shared/workers/photo_ingest_worker.py`
- `mira-mcp/routes/ingestion.py` (or extend `mira-mcp/server.py`)
- `tests/property/test_uns_gate_fsm.py`
- `tests/unit/test_uns_resolver_location.py` (the new location extension)

**Files (modify — extending existing code, not new):**
- `mira-bots/shared/uns_resolver.py` (location extension; module already exists)
- `mira-bots/shared/engine.py` (extend existing gate hook around line 1316; do **not** duplicate)
- `mira-bots/shared/fsm.py` (add `AWAITING_UNS_CONFIRMATION` side state to existing list)
- `mira-bots/shared/citation_compliance.py` (path-specific enforcement)
- `mira-bots/shared/quality_gate.py` (extend confidence ladder; do **not** break existing behavior)
- `docs/specs/uns-message-resolver-spec.md` (extend existing spec with location-resolution section; cross-link from the namespace-builder spec)
- `tests/golden_factorylm.csv` (append UNS cases — verify existing cases still pass first)
- `docs/env-vars.md` (new flag + thresholds)

**Migration-numbering note:** PR #8207b7de (`e3d48fb0 feat(seeds): GS10 VFD + Micro820 garage demo KB seed`) and others may have already used migrations 008 / 009 / 010 etc. The first sub-task of Phase 1 is `ls docs/migrations/` against origin/main to determine the next-available number; the spec's `008_namespace_builder.sql` will likely become `0NN_namespace_builder.sql` for some N > current max.

**Acceptance** (subset of spec's full list, gating Phase 1 done):
- Pre-existing UNS gate regression set still passes (no Phase 1 work regresses what PRs #1220 / #1280 / #1295 / #1314 already validated).
- New migration applies + reverses cleanly on staging.
- `pytest tests/ -k "uns_gate or uns_resolver"` green; 6+ new golden cases for location-resolution pass.
- `POST /api/v1/ingestion/photo` with a sample motor JPG returns `ingestion_job_id` + creates ≥ 1 `ai_suggestions` row.
- `bash install/smoke_test.sh` clean after deploy.
- Flag-off behavior: with `MIRA_UNS_GATE_ENABLED=false`, the engine falls back to the pre-extension gate path (i.e., today's behavior).

**Risks:**
- The gate's LLM-free first pass may miss subtle context — mitigated by the 3-candidate cap + confirmation card.
- `kg_entities.approval_state` default of `verified` could mask legitimate `proposed` data if the migration mis-orders the backfill — DOWN migration tested on staging first.
- Schema flavor decision could ripple. If Hub schema is retained, an additional consolidation migration becomes Phase 1's largest risk.

---

### Phase 2 — Hub product surfaces (Weeks 3–4)

**Goal:** the namespace, the proposal inbox, and the readiness widget — visible product, not just plumbing.

**Branches:** `feat/mnb-phase-2-namespace`, `feat/mnb-phase-2-proposals`, `feat/mnb-phase-2-readiness`.

**Deliverables:**

1. **Hub `/namespace`** (`mira-hub/src/app/(hub)/namespace/page.tsx` + components):
   - Tree view rendered from `GET /api/v1/namespace/tree`.
   - Node detail right pane: counts of assets / components / docs / pending proposals.
   - Drag-and-drop move (manager+) calling `PUT /api/v1/namespace/node/:id`.
   - Proposed-vs-verified visual distinction (existing `UploadBlock` color/state pattern).

2. **Hub `/proposals`** (`mira-hub/src/app/(hub)/proposals/page.tsx`):
   - Cards listing pending `ai_suggestions`. Filter by `?type=`, `?path=`, `?status=`.
   - Confirm / edit / reject controls → `POST /api/v1/proposals/:id/decide`.
   - Card UI mirrors UploadBlock states.

3. **Health-score widget** (`mira-hub/src/components/HealthScoreWidget.tsx`):
   - Mounted on `/feed`. Shows tenant-wide L0–L6 + top "next step."
   - Pulls from `GET /api/v1/readiness`.

4. **Health-score calculator** (new worker / job):
   - Event-driven (recompute when `ai_suggestions` status changes or `kg_*` row written).
   - Writes `health_scores` rows per path.

5. **Hub API routes** (Next.js handlers):
   - `/api/v1/namespace/tree`, `/api/v1/namespace/node/:id`
   - `/api/v1/proposals`, `/api/v1/proposals/:id/decide`
   - `/api/v1/readiness`, `/api/v1/readiness/recalculate`
   - Each wrapped in `withTenantContext`.

6. **Tests + screenshots:**
   - Playwright proof of namespace drag-drop. Screenshots saved to `docs/promo-screenshots/` per CLAUDE.md screenshot rule.
   - Playwright proof of confirm/reject of a proposal.
   - Playwright proof of health-score widget rendering L0–L6 on the demo tenant.

**Files (create):**
- `mira-hub/src/app/(hub)/namespace/page.tsx` + supporting components
- `mira-hub/src/app/(hub)/proposals/page.tsx` + card component
- `mira-hub/src/components/HealthScoreWidget.tsx`
- `mira-hub/src/app/api/v1/namespace/...` route handlers
- `mira-hub/src/app/api/v1/proposals/...` route handlers
- `mira-hub/src/app/api/v1/readiness/...` route handlers
- `mira-hub/src/lib/health-score.ts` — pure calculator (unit-testable)
- `mira-hub/tests/e2e/namespace.spec.ts`
- `mira-hub/tests/e2e/proposals.spec.ts`

**Files (modify):**
- `mira-hub/src/app/(hub)/feed/page.tsx` (mount widget)
- `mira-hub/src/middleware.ts` (no logical change; ensure new routes accept trial status — see Gap 2 in `manual-intelligence-self-serve-spec.md`)

**Acceptance:**
- A manager can drag an asset to a different line in `/namespace` and see the change persist + a `namespace_versions` snapshot row.
- A pending proposal in `/proposals` can be confirmed; the corresponding `kg_*` row promotes to `verified` AND the health score recalculates within 2 seconds.
- The `/feed` widget shows L0 on a brand-new tenant and L3+ on the demo tenant after seeded fixtures.

**Risks:**
- Tree-editor scope creep — strict cap: list + move + rename only this phase. Merge/split deferred to Phase 5+.
- Health-score thresholds may need tuning after 1–2 real tenants reach L3+. The `MIRA_HEALTH_SCORE_RECALC_THRESHOLD` env var allows runtime tuning without redeploy.

---

### Phase 3 — Onboarding + Tag Import + QR Capture (Weeks 5–6)

**Goal:** the on-ramp. A new tenant can move from signup to a first proposed namespace in under 10 minutes.

**Branches:** `feat/mnb-phase-3-onboarding`, `feat/mnb-phase-3-tag-import`, `feat/mnb-phase-3-qr-capture`.

**Deliverables:**

1. **Hub `/onboarding`** (`mira-hub/src/app/(hub)/onboarding/page.tsx`):
   - Multi-step: company → site → line → upload tags (optional) → upload manuals (optional) → photo walk (optional) → review proposed namespace.
   - Saved progress: each step persists via `POST /api/v1/wizard/:step`. Resume on next login.
   - First-time tenants land here on signup (`status=trial`) instead of `/feed`. Per `manual-intelligence-self-serve-spec.md` Gap 2, `status=pending` is **not** introduced here.

2. **Tag-import CSV pipeline:**
   - `POST /api/v1/ingestion/tag-import` (MCP).
   - New extractor `mira-crawler/ingest/extractors/tag_classifier.py` running cascade-LLM classification per spec schema.
   - Hub `/tag-import` page: upload + reconciliation table.

3. **QR capture flow:**
   - `mira-hub/src/app/m/[assetTag]/capture/page.tsx` extending the existing read-only mobile landing.
   - Photo + note upload → calls `POST /api/v1/ingestion/photo` with `asset_hint`.
   - If `qr_codes.status='unbound'`, route to a create-asset stub that requires an authenticated user (no anonymous asset creation).

4. **Tests + screenshots:**
   - E2E: new tenant signup → wizard step 1 → CSV upload → first proposed namespace, < 10 min on a CI runner.
   - Screenshot pair (mobile + desktop) saved to `docs/promo-screenshots/`.

**Files (create):**
- `mira-hub/src/app/(hub)/onboarding/page.tsx` + each step component
- `mira-hub/src/app/(hub)/tag-import/page.tsx`
- `mira-hub/src/app/m/[assetTag]/capture/page.tsx`
- `mira-hub/src/app/api/v1/wizard/...` route handlers
- `mira-crawler/ingest/extractors/tag_classifier.py`
- `mira-hub/tests/e2e/onboarding.spec.ts`
- `mira-hub/tests/e2e/tag-import.spec.ts`

**Files (modify):**
- `mira-hub/src/middleware.ts` — new tenants with `status=trial` and no `wizard_progress` rows redirect to `/onboarding`; once wizard is `completed`, default lands on `/feed`.
- `mira-scan` files only if integration tests reveal a mismatch with the existing `/m/[assetTag]` flow.

**Acceptance:**
- A new tenant can complete signup → wizard step 1 (company / site / line) → upload an Ignition tag CSV → see a proposed namespace tree, all under 10 minutes.
- Logout mid-wizard, log back in → resume at the last incomplete step with payloads preserved.
- Scanning an `unbound` QR routes to capture; binding writes to `qr_codes`.

**Risks:**
- Wizard scope creep (every line in spec is a temptation). Hard cap: 7 steps as listed; no "advanced" branches this phase.
- Per `STRATEGY.md`, "self-serve wizard" was historically deferred. The wizard is now additive on top of services, not a replacement; communicate this in homepage copy (Phase 4) so the sales team isn't surprised.

---

### Phase 4 — Marketing alignment (Weeks 7–8)

**Goal:** factorylm.com tells the namespace-builder story; the path from visitor → /onboarding is one click.

**Branches:** `feat/mnb-phase-4-homepage`, `feat/mnb-phase-4-namespace-landing`, `feat/mnb-phase-4-readiness-scan`.

**Deliverables:**

1. **factorylm.com homepage** (`mira-web/src/views/home.ts` + `public/index.html`):
   - H1: "Turn your maintenance data into an AI-ready factory namespace."
   - Subhead: "MIRA captures photos, work orders, manuals, and PLC tags from your team's normal work — and builds the factory context AI needs to actually help."
   - Primary CTA: "Start with one production line →" → `/onboarding` (auth-gated, magic-link bounce).
   - Secondary CTA: "Take the maturity scorecard →" → `/assess` (existing).
   - Tertiary CTA: "Run an automated AI-readiness scan →" → `/ai-readiness-scan`.

2. **`/namespace-builder` landing page** (`mira-web/src/views/namespace-builder.ts`):
   - Problem → solution → levels-unlock visual (L0–L6) → demo scenario (Harper / Orlando / Line 5 / Conveyor B16) → CTA.
   - One play-through video or animated diagram of the core loop.

3. **`/ignition` landing page** (`mira-web/src/views/ignition.ts`):
   - Wedge for the audience that already has Ignition + PLC tags. Emphasizes read-only, no PLC writes, outbound-only.

4. **`/ai-readiness-scan`** (`mira-web/src/views/ai-readiness-scan.ts`):
   - Anonymous CSV / PDF upload (limit: 100 tags or one manual).
   - Returns L0–L6 + missing-data list in-page.
   - Email-gates the "full namespace blueprint" PDF.
   - Distinct from `/assess` (which is the manual scorecard). Both linked from homepage.

5. **CTA wiring** — every marketing CTA into the hub uses the existing magic-link flow; landing in `/onboarding` is the default for `status=trial` per Phase 3.

**Files (create):**
- `mira-web/src/views/namespace-builder.ts`
- `mira-web/src/views/ignition.ts`
- `mira-web/src/views/ai-readiness-scan.ts` + scanner front-end (probably reuses `/assess`-style single-page pattern)
- `mira-web/src/server.ts` — route registrations

**Files (modify):**
- `mira-web/src/views/home.ts` (coordinate with Unit 9a's active branch)
- `mira-web/src/views/cmms.ts` if its signin copy needs alignment

**Acceptance:**
- Public visitor can run `/ai-readiness-scan` with a sample CSV; sees L-level + missing list without signup.
- Homepage CTA → magic-link → trial tenant → `/onboarding`, end-to-end Playwright pass.
- All Phase 4 screenshots in `docs/promo-screenshots/`.

**Risks:**
- "AI-ready factory namespace" may not parse for some buyer personas (per advisor note); A/B test against "AI-ready maintenance infrastructure" via analytics on `/assess` vs. `/ai-readiness-scan` conversion. Decision deferred to data, not committee.
- Copy outruns product reality. Rule: no copy promising features that aren't merged + screenshot-proven.

---

### Phase 5 — Ignition tag importer helper (Weeks 9–10)

**Goal:** customers with Ignition can self-export their tag tree and drop it into MIRA without an SDK module.

**Deliverables:**

1. **Tag export helper** — PowerShell + Python flavors of a script that:
   - Connects to Ignition Gateway via REST.
   - Iterates tag providers.
   - Dumps tag paths, names, descriptions, data types, alarms, engineering units, OPC item paths into CSV.
   - Does **not** dump live values (read-only metadata only for v1).

2. **Documentation** — a short customer-facing doc + a screencast.

3. **Reconciliation UX** — the Phase 3 `/tag-import` page already accepts the CSV; verify schema compatibility.

**Files (create):**
- `tools/ignition-export/export_tags.ps1`
- `tools/ignition-export/export_tags.py`
- `docs/runbooks/ignition-tag-export.md`

**Acceptance:**
- A customer running the helper against a sandbox Ignition Gateway produces a CSV that imports cleanly into `/tag-import` and yields proposed assets.

**Risks:**
- Ignition REST API behaviors vary by version. Helper tested against 8.1.x; 8.0.x deferred.

---

### Phase 6 — Read-only Ignition SDK module (Weeks 11–14)

**Goal:** outbound-only Ignition module that scans tag providers and pushes metadata to MIRA Cloud.

**Out of scope for this plan** beyond:
- A separate spec to be drafted (referenced from the namespace-builder spec's "OUT of scope" section).
- A security review checkpoint before merge: read-only confirmed, customer toggle for share-set, outbound HTTPS only, no PLC writes anywhere in the code path.

If Phase 5 reveals strong customer pull, accelerate. If not, defer.

---

### Phase 7+ — Post-MVP

Listed for completeness; not committed in this plan window.

- Live read-only tag streaming into the namespace.
- MQTT / Sparkplug B export.
- Slack proposals thread (review proposals without leaving Slack).
- Knowledge Cooperative anonymized pattern sharing.
- Voice notes (Phase 3 deferred; revisit with usage data).

---

## Verification — across all phases

| Phase | How we know it's done |
|---|---|
| 0 | Three new docs exist, CLAUDE.md pointers updated, fresh session names the framing on prompt. |
| 1 | Golden cases pass; migration applies; flag-off regression equals pre-gate; smoke clean. |
| 2 | Playwright tree drag, proposal confirm, score-widget render — all screenshotted. |
| 3 | New tenant → first proposed namespace in < 10 min on CI runner; wizard resumes. |
| 4 | Public visitor scans → L-level + missing list without signup. |
| 5 | Customer Ignition CSV → proposed assets in `/tag-import`. |
| 6 | Module signed, installable, read-only verified by security review. |

---

## Risks — plan-level

| Risk | Mitigation |
|---|---|
| Two doc systems compete (mira-component-intelligence-architecture's self-declared "North Star" vs. new TOO doc). | The new TOO doc explicitly re-layers the hierarchy; the CI doc moves to "implementation-level architecture." CLAUDE.md updates ratify this. |
| Sessions collide with the in-flight 90-day MVP. | This plan's in-flight section is the second source of truth; both plans are kept current; the same coordination commands gate every claim. |
| Namespace-builder scope balloons to "build the entire universe." | Each phase has a strict cap. Drag-drop tree without merge/split. Wizard with 7 steps, no advanced. Marketing without features not yet merged. |
| `MIRA_UNS_GATE_ENABLED=true` regresses production. | Feature flag, golden cases, fallback to specificity gate, telemetry on gate latency + false-positive markers from `quality-gate` outputs. |
| Health-score levels feel arbitrary to first customers. | Thresholds are env-vars (recalc threshold) + admin-settable (expected child counts per line). Iterate after 2–3 real tenants. |
| Marketing copy moves ahead of product. | Rule: no copy on a feature without a merged PR + a screenshot in `docs/promo-screenshots/`. |
| The schema-canonicalization decision (Hub `001` vs. NeonDB `004 + 007`) slips. | Phase 1 includes the decision as an ADR-or-die gate. If unresolved by end of Week 1, escalate. |

---

## What this plan will NOT do

- Pause or rebase any in-flight 90-day MVP branch.
- Reintroduce Anthropic anywhere (PR #610 ban; cascade is Groq → Cerebras → Gemini).
- Write to PLCs. Ever.
- Auto-verify any KG edge. Promotion is always human.
- Add LangChain or n8n abstractions (PRD §4).
- Ship marketing copy promising features that aren't merged + screenshot-proven.

---

## Change Log

- **2026-05-15** — Initial plan. Phases 0–6 + post-MVP. Integrates 90-day MVP Units 2/4/9a as Phase 1/2/4 components without claiming their branches.
- **2026-05-15 (correction)** — Reframed Phase 1 after `git fetch origin main` revealed the UNS resolver + Stage-1 gate are **already merged** (PRs #1220, #1280, #1295, #1314). Phase 1 now audits + extends existing code, not builds from scratch. Migration numbering reset to next-available (likely > 008). Acceptance includes "pre-existing gate regression set still passes." Local checkouts may be behind origin/main — `git log main..origin/main --oneline` is now part of the coordination check.
- **2026-05-16 (correction)** — Pre-build audit of `mira-hub/db/migrations/` revealed Hub already ships migrations 014–020 covering `component_templates`, `installed_component_instances`, `relationship_proposals` + `relationship_evidence`, `sessions_and_signals`, `signal_cache_and_trends`, `equipment_uns_path`, `uns_path_backfill`. Recorded in **ADR-0013** — Hub lineage is canonical for product-surface schema; engine lineage (`docs/migrations/`) keeps `kg_entities` / `kg_relationships` and adds only the `approval_state` columns there. The plan's `008_namespace_builder.sql` line is retired in favor of two narrower migrations split by lineage. The Hub-side proposals queue (`relationship_proposals.status`) is the upstream of the engine-side verified-only edge table.
- **2026-05-16 (slice 1 shipped)** — `feat/mnb-phase-1-uns-gate-state` adds the `AWAITING_UNS_CONFIRMATION` FSM side state the gate currently lacks (it stored pending state in `context["pending_uns_confirm"]` only), and the `MIRA_UNS_GATE_ENABLED` env kill-switch. `tests/test_uns_confirmation_gate.py` extended from 11 → 13 tests with new assertions on the state transitions. Phase 1 deliverable #3 ("FSM extension") partially completed; location-resolution extension (sites/areas/lines/machines/assets/components) and the citation-enforcement path-specific upgrade are still outstanding. See `docs/HANDOFF-mnb-phase-1.md` for what remains.
