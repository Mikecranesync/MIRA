# Smart Sheets feasibility and reuse assessment

Scope: brake-clearance measurement sheet (founder directive #4982, Experiment D: "convert brake-gap paper sheet into usable Smart Sheet; capture before/after readings, calculate simple deterministic checks and export"). Read-only assessment against MIRA `origin/main @ 1f2ef969518cda4fadf296b23fcc2f65b7f8e483` (re-confirmed via `git rev-parse origin/main` at write time — unchanged from the task's pinned SHA). This document writes no code. Spec: `docs/specs/technician-smart-sheets-pilot.md` (PR #4862, head `bfe376ec14f`).

## 0. Path/symbol audit — corrections to the input maps

All paths below were checked with `git ls-tree origin/main -- <path>`. Two are confirmed absent (already flagged by `critic.json`); six more are new findings — the maps got the *reuse legality*, not just the file list, wrong in several places.

| Claim | Verdict |
| --- | --- |
| `mira-web/src/capabilities/marketing-claims/capabilities.json` | **Does not exist.** Claims gating is inline in `server.ts` + views. |
| `mira-hub/src/routes/api/work-packets.ts` | **Does not exist.** Correctly marked "not implemented" by map-pdf. |
| `mira-mobile/src/lib/capacitor-adapter.ts` (cited by map-pdf as where Capacitor plugins are "used") | **Does not exist** on `origin/main`. Capacitor `Filesystem`/`Share` usage is in `mira-mobile/src/lib/open-with.ts` only. |
| Capability `WO_READ_WRITE` (map-smartsheets `api_calls`) | **Invented symbol.** No such capability. Real ones are `work_orders.create`/`work_orders.update` in `mira-hub/src/lib/capabilities.ts`. |
| "`mira-hub/package.json` changes are not guarded" (map-pdf) | **Wrong.** `tools/ui_surface_lifecycle_guard.py` treats every module-root `package.json` as a guarded build/mount control (not in its narrow `.md`/image allowlist) — editing it needs the `legacy-ui-exception` label+PR section. |
| "pdf-lib ... compatible with mira-hub's Bun/Hono runtime" (map-pdf) | **Wrong runtime.** `mira-hub/package.json` declares `"next": "16.4.1"` — mira-hub is Next.js. Bun/Hono is `mira-web` (`bun run src/server.ts`). |
| `POST /api/equipment-notebooks/[id]/photos/` described as "Store photo evidence" (map-smartsheets `api_calls`) | **Mischaracterized.** The real route is `.../photos/[fileId]/source/route.ts`: it re-keys a photo *already attached via `/look`* as a citable source. The actual upload-and-classify endpoints are `/look` and `/nameplate/recognize`. |
| Both maps' proposed edit targets (`app/(hub)/workorders/[id]/readings.tsx`, `lib/brake-gap-validation.ts`, `mira-mobile/src/api/resources.ts`, `screens/MeasurementSheet.tsx`, `chat-adapter/turns-to-parts.ts`) | **All guarded** under the FactoryLM Unified UI Cutover, confirmed against the classifier functions in `tools/ui_surface_lifecycle_guard.py` (not just the charter prose). `mira-mobile/src/api/resources.ts` is worse than ordinary-guarded — it sits in `LEGACY_SURFACE_EXACT_CONTROL_PATHS`, the stricter OTA/flag-control tier. See §2/§3. |
| Migration numbering | Next free number on `origin/main` is **109** (tree runs ...107, 108). **099 is a historical gap** — confirmed by listing, not assumed; don't reuse it. |
| "PWA-installable per PR #4363" / "visible-badge pattern proven in nameplate" (map-mobile claims, used below) | **Map-reported, not independently re-verified by this pass** — flagged so, not re-checked against the PR diff. |

`contract.ts`, `turns-to-parts.ts`, `docs/prd/2026-08-28-sensor-v0-contract.md`, `mira-hub/src/app/api/admin/review/queue/route.ts`, `mira-hub/src/app/api/equipment-notebooks/[id]/chat/route.ts`, and `mira-hub/src/app/api/equipment-notebooks/[id]/nameplate/confirm/route.ts` were all additionally checked and exist as cited.

## 1. What exists today (reuse table)

| Component | Path | Status | How it is reused |
| --- | --- | --- | --- |
| Work order identity/detail | `mira-hub/src/app/(hub)/workorders/[id]/page.tsx` | VERIFIED (guarded) | Read as a shape reference only — legacy presentation page, never edit. |
| Work order API | `mira-hub/src/app/api/work-orders/[id]/route.ts`, `.../route.ts` | VERIFIED (open — `route.ts` under `app/api/**` is explicitly preserved) | Optional WO linkage: new readings can carry a nullable `work_order_id` FK and GET the WO for header context. |
| Mobile work-order screen | `mira-mobile/src/screens/Workorders.tsx` | VERIFIED (guarded) | Shape/flow reference only (list/detail/create, idempotency via `client_key`) — never edit; any new mobile UI is a sibling under the canonical adapter root instead. |
| mira-mobile WO types | `mira-mobile/src/api/resources.ts` (`WorkOrder`, `createWorkOrder`) | VERIFIED, but this exact file is a guarded **control** path, not ordinary legacy | Read the `WorkOrder` shape for reference; do not add fields or edit this file. |
| Photo capture + unconfirmed transcription | `mira-hub/src/app/api/equipment-notebooks/[id]/look/route.ts`, `.../nameplate/recognize/route.ts` | VERIFIED (open) | Call `/look` to attach a photo and get a free-text vision observation; today's `/look` returns text, not a number — numeric auto-fill from a photo does not exist. |
| Nameplate confirm step | `mira-hub/src/app/api/equipment-notebooks/[id]/nameplate/confirm/route.ts` | VERIFIED (open) | The existing confirm-or-correct gate for a photo-derived candidate — the pattern a reading's "technician confirms AI-proposed value" step should copy. |
| Candidate/confirmed evidence marking | `mira-hub/src/lib/nameplate/evidence.ts` (`toFact`) | VERIFIED (open, preserved) | Models the "unconfirmed until technician confirms" rule — same discipline spec criterion 4 requires. |
| Photo→cited source | `mira-hub/src/app/api/equipment-notebooks/[id]/photos/[fileId]/source/route.ts` | VERIFIED (open) | Re-keys an already-`/look`-attached photo as a citable source; reuse for evidence photos attached to a reading. |
| Sheet bottom-sheet chrome | `mira-mobile/src/screens/Sheet.tsx` (`Sheet`, `BackDismiss`), `mira-mobile/src/lib/transient-layer.ts` (`useTransientLayer`) | VERIFIED, both guarded | Import-only reuse from a new canonical-root screen; never edit either file. |
| Review/approval pattern | `mira-hub/src/app/api/contextualization/batches/[batchId]/review/route.ts`, `mira-hub/src/lib/contextualization/approval.ts` (`decideBatchReview`), migrations `056`/`067` (`approved_by` TEXT, `approved_at` TIMESTAMPTZ) | VERIFIED (open, preserved) | Shows the shape, but it is **admin-only** today (`proposals.decide`). Not directly usable by a technician without a new capability — §2. |
| Better-fit precedent (not cited by either map) | `mira-hub/db/migrations/105_guided_procedure_sessions.sql`, `106_...one_running.sql`, `097_asset_fix_records_idempotency.sql`, `098_...request_fingerprint.sql` | VERIFIED | `105` is a tenant-UUID, `notebook_id`-FK, RLS, append-only JSONB-records table — structurally closer to a readings table than either map's proposal. `097` is the exact client-request-id idempotent-insert pattern spec criterion 5 needs. |
| PDF export | `mira-web/src/lib/qr-pdf.ts` (pdf-lib) + `mira-web/src/routes/admin/qr-print.ts` (streaming) | VERIFIED, proven, MIT | Design reference only (table/line/text drawing primitives) — cannot be imported cross-module. `mira-hub` already declares `pdfkit ^0.15.2` (unused); prefer that over adding pdf-lib (package.json is guarded — §0). |
| Tenant isolation | `mira-hub/src/lib/tenant-context.ts` (`withTenantContext`), RLS pattern in `056`/`067`/`105` | VERIFIED (open, preserved) | New readings table follows the `105` RLS template: UUID `tenant_id`, policy comparing both `app.tenant_id`/`app.current_tenant_id`, `GRANT ... TO factorylm_app`. |
| FactoryLM UI shell | `packages/factorylm-ui/`, `packages/factorylm-theme/`, `packages/factorylm-interaction/`, `apps/factorylm-ui-lab/` (all present), `mira-hub/src/factorylm-ui/GuidedProcedure.tsx` + `.test.ts` | VERIFIED, canonical/open | `GuidedProcedure.tsx` is the closest existing template: multi-step, resumable, records-array UI already wired to migration `105`. |
| Lifecycle guard | `tools/ui_surface_lifecycle_guard.py` (2021 lines), `docs/architecture/convergence/REGISTRY.yaml` | VERIFIED | Governs every path decision below — checked directly against its classifier functions. |

## 2. What must be new

Experiment D's literal ask is **before/after readings with simple deterministic checks**. The schema and check function below are sized to that, not to the full spec's eventual superset.

| Piece | Rough size | Where it lives |
| --- | --- | --- |
| Readings schema (limit provenance + boundary rule + before/after) | ~45–60 lines SQL | `mira-hub/db/migrations/109_smart_sheet_readings.sql` (next free number; `mira-hub/db/` is outside the UI guard entirely). Modeled on `105`+`097`. Minimum fields, against the spec's own "Minimum record" table: `tenant_id UUID`, `notebook_id UUID FK`, nullable `work_order_id UUID FK`, `point_id TEXT`, `phase TEXT CHECK` (one of `before`/`after`), `raw_value NUMERIC`, `unit TEXT`, `limit_source TEXT`, `min_limit`/`max_limit NUMERIC` (nullable), `boundary_rule TEXT CHECK` (one of `inclusive`/`exclusive`), `delta_limit NUMERIC` (nullable — only set when an *approved* before/after delta limit exists), `entry_source TEXT CHECK` (one of `manual`/`ai_proposal`), `confirmed_value NUMERIC`, `confirmed_by`/`confirmed_at`, `procedure_ref TEXT`, `procedure_revision TEXT`, `method_or_conditions TEXT`, `technician TEXT`, `client_request_id UUID` unique-partial-index per `097`. |
| Deterministic check function | ~40–60 lines + tests | `mira-hub/src/capabilities/smart-sheets/gap-check.ts` (TS port, once `gap_check.py` — §5 — is validated). Pure function, decimal/fixed-point comparison (never JS `Number`/float equality at a boundary). Per reading: compare `confirmed_value` against `min_limit`/`max_limit` using `boundary_rule` → `pass\|fail\|unassessed`; `unassessed` if a limit is missing/conflicting or the unit doesn't match the limit's unit (no silent conversion in v0). Separately: always report the before→after delta as a number; **limit-check the delta only if `delta_limit` is set from an approved source** — a rule like "after must always be smaller than before" is not invented here, matching the spec's "deterministic ... traceable to approved documentation" boundary. |
| API route (create + list readings) | ~80–120 lines | `mira-hub/src/app/api/equipment-notebooks/[id]/readings/route.ts` — open path. Reuses `sessionOr401`, `withTenantContext`, `getNotebook`. |
| Numeric-with-unit input + boundary display | ~60–100 lines | `mira-hub/src/factorylm-ui/ReadingsSheet.tsx`, beside `GuidedProcedure.tsx` (avoids the `packages/factorylm-ui` shared-core single-writer lane and its Codex exact-head review gate on #3626 — see §8 note below). **Not** `app/(hub)/workorders/**` (guarded) and not `mira-mobile/src/screens/` (guarded); mobile UI, if built, goes under `mira-mobile/src/factorylm-ui/**`. |
| Export | ~60–100 lines | `mira-hub/src/capabilities/smart-sheets/export.ts`. v0: JSON/CSV (zero new dependency). PDF: reuse the already-declared `pdfkit` dependency (avoids the guarded `package.json` edit); table/line primitives patterned after `qr-pdf.ts`. |
| Capability / approval | 0 lines for v0 | **Deferred, not built.** `mira-hub/src/lib/capabilities.ts` is itself guarded (not in the preserved-lib allowlist) — minting `smart_sheets.*` or `work_packet.sign_off` trips the cutover exception process. v0 reuses the existing `work_orders.create`/`work_orders.update` capabilities technicians already hold. A real sign-off workflow (admin-gated, matching `decideBatchReview`) stays PROPOSED. |

## 3. Shortest path to a WORKING brake-clearance example (synthetic data)

**Can start now — entirely inside this GTM-prep lane, no mira-hub/mira-mobile code touched:**

1. Build out `tools/smart-sheets/gap_check.py` (already underway in this lane, §5) as the deterministic check: `phase` (before/after), `value`, `unit`, `min_limit`/`max_limit`/`boundary_rule` (nullable), optional `delta_limit` → `pass|fail|unassessed`, plus the before→after delta reported unconditionally.
2. Write synthetic fixtures covering: at-min, at-max, just-outside, far-outside, missing limit, conflicting limit, mismatched unit, and a delta with vs. without an approved `delta_limit`.
3. Write the minimum-record field list (the §2 schema table above) as a documented spec section now, in prose/table form — not as a `mira-hub/db/migrations/*.sql` file, since this lane does not write migrations.
4. Produce a JSON/CSV export directly from a `gap_check.py` synthetic run. **This is the working example on synthetic data** this step asks for — it proves the deterministic logic end-to-end without touching the guarded repo surfaces.

**Waits on a separate implementation issue/PR + Mike's go-ahead** (per the spec's own "Next action: ... scope a separate implementation issue/PR"):

5. `mira-hub/db/migrations/109_smart_sheet_readings.sql`, transcribing step 2's validated field list.
6. `mira-hub/src/capabilities/smart-sheets/gap-check.ts` (TS port of the validated `gap_check.py` logic) + `mira-hub/src/app/api/equipment-notebooks/[id]/readings/route.ts`.
7. `mira-hub/src/factorylm-ui/ReadingsSheet.tsx` (desktop/web first — the mobile map reports the hub is already PWA-installable via PR #4363, unverified here), reusing `/look` + the `nameplate/confirm` unconfirmed-until-confirmed pattern for photo evidence.
8. Export wired to the real route (JSON/CSV first; PDF via `pdfkit` as a fast follow).

**Stays PROPOSED — not reachable from this path at all:**

- A mobile form on a real phone (`mira-mobile/src/factorylm-ui/**`, untouched here; mobile's offline-queue/idempotency machinery does not yet cover structured readings).
- Approval/sign-off persistence (needs the guarded `capabilities.ts` edit plus a `supervisor` role that doesn't exist in `ROLE_CAPS` today).
- Any CMMS/work-order write-back (`cmms_equipment`/Atlas) — the spec forbids form completion implying return-to-service, and no write-back path exists.

## 4. Risks and #4862 acceptance-criteria coverage

**Risks**
- Floating-point boundary comparisons — must use decimal/fixed-point math, never float equality, addressed in the prototype (step 1/2) but not yet carried into a TypeScript port.
- `mira-hub/src/lib/capabilities.ts` and `mira-mobile/src/api/resources.ts` are both guarded/control paths — editing either needs the `legacy-ui-exception` process, a real cost, not a formality. **Accepted for v0** (deferred per §2's capability row).
- `work_packets`/approval persistence requires a `supervisor` role that is architecturally absent (`ROLE_CAPS` has operator/technician/scheduler/manager/admin/owner only) — adding one is substantial, cross-cutting work under `.claude/rules/multi-session-protocol.md` §5. **PROPOSED, not started.**
- Unit mismatch between a reading and its configured limit must resolve to `unassessed`, never a silent conversion, for v0.
- Building the new UI in `packages/factorylm-ui` (vs. `mira-hub/src/factorylm-ui/`) pulls in the shared-core single-writer lane and the Codex exact-head merge gate on issue #3626 — a real scheduling dependency, not just a path choice.

**The 9 acceptance criteria from the spec — coverage if the full path (§3, steps 1–8) ships**

| # | Criterion | Coverage |
| --- | --- | --- |
| 1 | Equipment + inspection revision visible before entry; record retains both | Covered by design (schema carries `procedure_ref`/`procedure_revision`) — not yet tested end-to-end |
| 2 | Synthetic at/below/above-boundary cases produce the expected result | **Covered** (steps 1–2) |
| 3 | Missing/conflicting limits, wrong units, invalid numbers, missing readings never pass | **Covered** (steps 1–2 — `unassessed`/reject logic) |
| 4 | Photo-derived values can't become confirmed without explicit technician confirmation | **Covered only vacuously** — this path keeps numeric entry manual-only (no photo-to-number transcription built), so the rule is never actually exercised against an AI-proposed value |
| 5 | Interrupted entry resumes without lost/duplicate readings; corrections keep audit history | **Not covered** — needs the `097`-style `client_request_id` idempotency wired into the route (schema only, step 5) plus a resume UI, neither built |
| 6 | Prior-reading comparison excludes incompatible conditions or explains why unavailable | **Not covered** — no trend/history query in this path |
| 7 | Out-of-limit result records follow-up/review state; no result implies release authorization | Partial — schema can hold a status field; no follow-up/owner workflow is built |
| 8 | A second tenant cannot read/change the inspection or its evidence | **Partial — designed, not tested.** RLS + `withTenantContext` follow the proven `105` template, but this path includes no second-tenant (UUID) negative test |
| 9 | The actual target phone can complete and reopen the form; export matches confirmed values | **PROPOSED, not covered** — mobile form is explicitly out of this path |

## 5. Parallel prototype note

A pure deterministic gap-check function with tests (`tools/smart-sheets/gap_check.py`) is being prototyped in this lane as the first step toward §2/§3 above. That file is confirmed absent from `origin/main` today. This document does not write it — it is being built separately in the same GTM-prep lane.

## Hazard ledger

- Guarded `mira-hub/src/lib/capabilities.ts` (no `supervisor`/`smart_sheets.*` capability) — **accepted for v0**, deferred per §2; re-open only with an explicit cutover exception.
- Guarded `mira-mobile/src/api/resources.ts` control path — **accepted**, read-only reuse of its types, never edited by this path.
- Missing `supervisor` role in `ROLE_CAPS` — **filed as a known gap** (matches `critic.json`); not actioned here.
- Float-boundary risk on limit comparisons — **addressed in the `gap_check.py` prototype** (decimal/fixed-point), not yet carried into the TS port (§2, not built).
- Tenant-isolation negative test (criterion 8) — **not run**; design follows the proven `105` RLS template but is marked Partial, not Covered, above.
- `packages/factorylm-ui` vs `mira-hub/src/factorylm-ui/` scheduling dependency (Codex review gate on #3626) — **noted, not resolved**; §2/§3 route around it by defaulting to the adapter root.
