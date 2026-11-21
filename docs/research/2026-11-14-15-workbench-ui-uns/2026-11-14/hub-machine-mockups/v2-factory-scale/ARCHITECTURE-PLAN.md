# FactoryLM equipment navigation — architecture estimate and delivery plan

> Publication note (2026-11-15): archived research and observations from the date stated below, not a current release-status report or new authorization. See the [collection index](../../../README.md) and [private-evidence policy](../../../PRIVATE-EVIDENCE.md).


Date: 2026-11-14 (America/New_York). Planning only; no implementation or deployment dispatched.
Source baseline: local HEAD and remote main both eab62164db37b18c824a47de897e89fa6fce1f01 at inspection.
Target: the v2 factory-scale mockups beside this document, delivered through the canonical shared FactoryLM UI.

Reconciliation update: Mike confirmed the agents have made no progress beyond his pasted handoffs. [HANDOFF-RECONCILIATION.md](HANDOFF-RECONCILIATION.md) now controls the immediate queue, owner transitions and resume-date schedule. It retains the actual coordinator transfer and drive + MLC scope, and distinguishes CHARLIE's component/UI and ontology sessions.

## Estimate

| Milestone | Elapsed time from a coordinated start | What it proves |
|---|---|---|
| Interactive design prototype | 1–2 working days | Navigation, labels, density, touch layout and context recovery with fixtures; no backend or data-safety claim. |
| Connected drive + MLC staging pilot | 5–8 working days | Existing machine and notebook records open through the new shell; component selection, citations, saved work and restart recovery remain correct. |
| Bounded factory-scale pilot | 3–5 working weeks, cumulative | One representative site, multiple lines, 20,000-component test fixture, bounded database reads, explicit permissions and physical-device acceptance. |

These architecture estimates start from a cleared integration baseline, which the frozen handoffs have not yet reached. Allow provisionally 2–4 working days for existing repair/review/composition closeout if the final source repair passes. From a coordinated resume, use approximately 7–12 working days for connected new-interface bench acceptance and 4–6 working weeks for the bounded factory-scale pilot, subject to re-estimation after closeout and the identity audit. The 1–2-day prototype can overlap independent closeout work once the UI writer is available.

These are engineering estimates, not measured task durations or promised dates. They assume four coordinated lanes with five distinct sessions reported across them, normally two implementation streams, one integration/review stream and one verification stream, with the ontology specialist supporting the data contract; the shared core has one writer. Human/device review windows and existing budget/release approvals must be available. The architecture effort includes ordinary integration and repair allowance, not pre-existing unresolved retrieval/identity defects, enterprise-wide data cleanup, a new CMMS or full UNS rollout.

Estimated total effort: 16–26 engineering days of base work, plus roughly 25–35% allowance for identity mapping, query tuning and review repairs; plan on 20–35 engineering days across the lanes. The milestone elapsed times overlap; they are not additive. Agent execution hours and model charges are not calculated from engineering days.

The first baseline/identity work package is the re-estimation checkpoint. If existing plant data requires extensive reconciliation or a component lifecycle redesign, add a separate 1–3-week data workstream and rebaseline instead of hiding that work in UI polishing.

## What already exists and what changes

Verified in this checkout/current main:
- Canonical FactoryLM theme, interaction contracts, shell, source viewer and disconnected fixture lab.
- Hub adapter and Equipment Notebook persistence, thread identity, component revisions, server-side selection versions, sources and existing work-record capabilities.
- cmms_equipment.parent_asset_id and UNS paths; kg_entities namespace; component templates and installed_component_instances with placement/aliases.
- Separate notebook_components and notebook_component_revisions used by the bench workflow. Migration 115's inspected component records do not contain an installed-component-instance link.
- The current /api/assets GET returns an array without cursor pagination. ScopePicker filters fetched machines in the browser. The namespace route constructs a whole tenant tree.

Change three layers:
1. Shared presentation: equipment navigation, contextual search, machine/component lists, persistent question context, accessible layout and FactoryLM tokens.
2. Hub read capability: bounded authorized child/search/detail reads and mapping from a navigation result to its existing notebook/chat target.
3. Identity integration: reconcile existing equipment, installed-instance and notebook-component references with an explicit audited link where required.

Keep existing authentication, Notebook storage, typed streaming, retrieval, citations, safety, work records and provider routing. No separate chat store, equipment registry, graph database, search SaaS or LLM-driven navigator is part of this plan.

## Architecture

    Shared FactoryLM shell
      Equipment browser · Machine/component view · Existing conversation/source/work panels
                         |
      Hub adapter: separate browse location from question target
                         |
      Existing Hub capabilities
        Bounded equipment reads + explicit identity resolution
        Notebook/component selection + chat + evidence + work records
                         |
      Existing PostgreSQL records
        Equipment parents / namespace / installed instances / notebook components

The hierarchy is a navigation projection over canonical records:
company where needed → site → area → line/cell → machine → optional assembly → component.
Reuse the customer's approved levels; standalone utilities do not get an invented line. Keep physical containment separate from control/power/wiring relationships.

The current bench keeps its established IDs and integration path. A more readable breadcrumb must not rename a UNS topic or rewrite telemetry history.

## Identity contract and migration approach

- Distinguish asset IDs, installed-instance IDs, notebook-component IDs and namespace-node IDs. A UUID-shaped value is not enough to identify its domain.
- A browse/search result carries a typed canonical reference, parent/location display context, and only an authorized existing chat target when one resolves unambiguously.
- Keep notebook component revisions and server selection versions authoritative for the currently shipped chat path. An installed-instance human_confirmed boolean cannot silently promote a notebook identity revision.
- Keep the installed-instance register authoritative for its placement/catalog linkage. Explicitly establish how it relates to the notebook component; never merge by tag, model or equal names.
- For the small bench increment, render existing notebook components directly under their already-bound machine; this does not require a bulk migration.
- For factory-wide component search, add a tenant- and asset-validated link between existing records if the current code has no adequate mapping. One physical instance must not acquire two active ambiguous chat mappings. A catalog template is never the instance key.
- Preserve historic turns, component IDs, approvals and evidence. Backfill only deterministic proven links; send ambiguous/unplaced records to a visible reconciliation list. No AI auto-merge and no inferred confirmation.
- Any schema change is additive and separately reviewed, with composite ownership enforcement and replay-safe backfill. Rehearse migration forward/rollback on a disposable database. Feature rollback retains additive records; it must not rely on destructive table drops.
- Full replacement management and cross-site reparenting UI are later slices. Initial search must preserve existing replacement/history distinctions and reject invalid mappings; it cannot claim those lifecycle workflows are complete.

## API and client changes

Reuse current API capabilities if the baseline audit finds equivalent bounded endpoints on active branches. Otherwise add read-only browser children/search/detail operations to the existing Hub capability layer; these are small adapters over existing records, not another asset service.

Required request behavior: explicit authorized parent or search scope, query/filter, stable cursor and bounded page size. Default 50, maximum 100. Reuse the existing cursor conventions where applicable. Reject invalid/cross-scope cursors rather than restarting silently.

Required response behavior: typed canonical references, readable breadcrumbs, child availability, enough machine/location context to distinguish repeated tags, next cursor, and explicit loading/error/empty semantics. Exact counts are optional: calculate them with bounded indexed queries or show honest partial/unknown counts. Do not perform an expensive full-tree count simply to reproduce a mockup number.

Keep /api/assets' existing array response and current notebook/thread URL grammar compatible. New clients use bounded operations. Existing clients and recovery routes remain usable. Add only necessary indexes after explaining query plans on representative fixtures. Use PostgreSQL capabilities already approved and installed; no new external search dependency by default.

Search must enforce tenant and applicable project/capability access before returning records, names, counts or autocomplete. Session/tenant changes clear caches and invalidate in-flight requests. No whole-notebook history fan-out, no manual loading and no LLM call while navigating.

Shared UI types gain additive navigation/result/async-state inputs. The Hub adapter resolves them to existing capabilities. Unsupported public/native surfaces retain their current behavior; do not mount a partially implemented equipment browser there.

## Work packages and sequencing

| Package | Base effort | Output / exit condition |
|---|---:|---|
| A. Pin baseline, ownership and identity contract | 1–2 engineering days | Exact main/PR composition; shared-core writer claim; map current IDs/permissions; read-only data coverage audit or clearly documented access gap; bounded API contract; revised estimate. |
| B. Shared-shell prototype and style | 2–3 days | Existing fixture lab renders site/line search, tables, breadcrumbs and question context; Mike completes find/open/source/recovery walkthrough. Includes 20,000-record fixture concept but no database capacity claim. |
| C. Resolve component references | 3–5 days | Approved mapping and any additive migration/backfill; repeated tags and same-model instances stay separate; old notebook/history links still resolve. Bench projection can land first. |
| D. Bounded browse/search APIs | 3–5 days | Paged direct children and scoped search; authorized counts; indexes justified by query plans; tests against the real PostgreSQL major used by CI. |
| E. Connect the workflow | 2–4 days | Equipment opens existing notebook/thread/components; preserve drafts, attachments, selection-version checks, exact source opening, notes/photos/jobs and back navigation. |
| F. Integrated review and acceptance | 5–7 days | Exact candidate review/CI, database isolation/performance evidence, tablet/phone checks, unfamiliar-technician walkthroughs, exercised feature rollback and release packet. |

Base total: 16–26 engineering days. Package A precedes data/API implementation. B can overlap the read-only portion of A once fixture semantics are agreed. C and D can run in parallel after their reference contract is frozen. E starts with the existing bench before C/D finish; factory-scale E depends on both. F's fixture preparation starts early, but final review applies to the composed candidate only.

Suggested pull-request boundaries: shared navigation/types + fixtures; identity bridge/migration; bounded reads; Hub adapter and recovery behavior; integrated fixture/performance acceptance. Small repairs can be separate when required by ownership. Avoid a single unreviewable architecture PR.

## Reconciled lane ownership

The latest pasted handoffs control the immediate work. The following are transitions after that work, not fresh assignments that discard it. See HANDOFF-RECONCILIATION.md for the complete queue. No sessions have been dispatched or reassigned.

- CHARLIE Codex: coordination transfer is already complete. Refresh the older local composition and #5415 first; then coordinate architecture, review and release. Obtain another Codex reviewer for code this session authors.
- CHARLIE Claude component/UI session (Opus handoff): #5504 is already merged but device acceptance remains; own the #5546 obstruction and the context-retry follow-through before becoming the sole new-navigation/shared-core writer.
- BRAVO Codex: finish the two latest #5510 HIGH findings and hand the corrected head to the existing final-review operator. Then take bounded equipment reads and data/query proof, with the ontology specialist supplying identity semantics.
- BRAVO Claude: retain #5510 review, #5500 ownership/review disposition, #5544/#5545 and verification. Reuse the runbook and existing proofs for the new interface and scale fixtures.
- CHARLIE Claude ontology session (Fable handoff, separate from UI): supply #5539/#5530 evidence, preserve the shelved #5543 repair and runtime gaps, and lead the identity-map/test contract. Do not collapse this owner into the UI writer or call graph protections runtime-complete.

Only one agent edits packages/factorylm-theme, packages/factorylm-interaction, packages/factorylm-ui and apps/factorylm-ui-lab at a time. Two machines help run API and browser/database verification concurrently; they do not remove shared-core or exact-head review serialization.

## Acceptance gates

First useful staging increment:
1. Find existing Conveyor 1 without knowing a project name or creating a duplicate notebook.
2. Select VFD1 or MLC; see exact scope and honest identity state.
3. Ask a supported question, receive correct or correctly refused output, open the actual cited page and return.
4. Save/reopen an existing job, note and photo through the current capability, including reload/restart.
5. Two-screen selection change and lost response preserve the draft/attachments and require an explicit reviewed resend.
6. Known wrong-model or wrong-scope behavior affecting the exercised paths blocks acceptance, regardless of UI quality.

Factory-scale increment:
- Real database fixture: 8 lines × 50 machines × 50 components = 20,000, plus another tenant/site, repeated tags, aliases, same-model instances, shared utility, unplaced nodes, optional levels and historical/replaced links.
- Distinguish 400 MLC-tag matches; zero wrong-instance bindings/submissions. Search scope never silently broadens.
- Tenant and applicable within-tenant permission tests cover result rows, suggestions, counts, history and caches.
- Keyset paging, cancellation/late reply, branch expansion, inaccessible links and Back restore the intended selection; failed request is not empty inventory.
- Benchmark first-page search and known-component opening on the real tablet. Proposed target: search p95 ≤1 second at ten concurrent search sessions with the agreed staging network and fixture; cached local UI response ≤100 ms. Record hardware, database plan, network, payload/row limits and raw timings. Change the target only by an explicit design decision, not by relabelling slow results.
- Test phone layout, tablet keyboard, focus, text zoom, source overlays and actual CSS contrast/touch sizes. Do not use generated images as accessibility proof.
- Mike first; then three unfamiliar technicians complete find/component/source/save/reopen and changed-selection tasks. Record assistance and errors. This is formative acceptance, not a population-wide usability claim.

The same test names and fixtures should run in CI where possible. The real-PostgreSQL selection/mapping tests must fail rather than silently skip when their required job is selected.

## Rollout and rollback

1. Complete a disconnected prototype in the existing lab.
2. Expose the connected browse experience behind a default-off capability/feature switch for the named staging testers; preserve current deep links and recovery routes.
3. Freeze included parents, final version, migration state and source hashes; run required independent review and CI on that exact candidate.
4. Authorized staging deploy, then physical drive/MLC acceptance. No machine operation is required.
5. Run scale fixtures and a controlled one-site pilot; migration/data receipts and actual product behavior are separate evidence.
6. Submit one concrete production release request only after acceptance, showing cost receipts, rollback and known limits. No merge/deploy/budget authority is granted by this document.
7. Keep legacy recovery until the existing charter's stability and retirement gates pass. The charter requires at least 14 consecutive stable days and two production releases before retirement can be considered; that stabilization/retirement is additional to reaching pilot-ready.

Rollback is primarily the feature switch and previous application artifact. New additive data must remain readable by the prior path. Do not call rollback across migration 115 safe until the existing migration review decides it.

## Verification loop and reporting

Every package advances through: implemented → exact-head tests → independent review/CI → staging → physical device → human acceptance. No stage inherits another's proof.

At each material change or handoff, update the designated owner record that feeds Mission Control/#5232, read it back, and include: owner/lease, goal, branch and full SHA, test/review receipts, deployment generation if applicable, observed device state, remaining blockers, next action and spending/authority limits. Keep all prior evidence bound to its original head. This plan remains local and undispatched; it does not overwrite another lane's Mission Control status.

## Scope kept outside this estimate

Full graph repair or approved-memory rollout; live machine control; enterprise-wide CMMS replacement; general-purpose import/cleanup of customer master data; new tenancy model; full replacement/reparenting administration; complete native/offline parity; formal ISA-95/UNS certification; automatic plant-wide diagnostics.

The UI can expose existing verified capabilities as they become ready. It must not advertise an unimplemented Connections or live-state workflow merely because a mockup includes a tab.

## Basis and limitations

Inspected current main and local checkout at eab62164d; GitHub's main assets route matches the inspected unpaged list. Targeted PR searches for hierarchy and pagination found adjacent reusable work (including existing keyset pagination patterns) but did not establish an already-completed replacement equipment browser. Search is not exhaustive evidence of absence.

Read the shared UI cutover charter, current style authority, migrations 012/015/017/081/115, namespace/asset/picker paths and notebook tree adapter. Read #5232's available comments for coordination context; owner claims and PR gates must be refreshed at the actual start.

No production database audit, scale benchmark, new test run, code modification, model-cost quote or release action was performed for this estimate.
