# Durable packet intake and technician closeout QC

Status: implementation slice draft, 2026-11-06. Continuation explicitly requested
by Mike through the parent task after draft5235. No merge/deployment authority.

## Goal

The product outcome is a downloadable illustrated, numbered Chilton-style repair
guide another technician can use. It grows from manuals/photos and work updates;
the performing technician checks the draft at closeout. Later review governs
accepted reuse. Page count follows complexity, not a fixed two-page promise.

This next slice connects the existing packet, canonical saved job and closeout
candidate. It does not grant reuse acceptance or physical safety clearance.

## Binding requirements

1. Reuse the canonical Living Sheet event and template revision stores. Migration114
   and shared outbox stay unchanged. Existing JSONB snapshots can preserve an
   additive, versioned instruction metadata object; avoid a new table/migration
   unless discovery proves it essential and report before changing that design.
2. Import a supported WorkPacket1/2 plus optional local JobRecord through a new
   tenant-scoped, feature-gated intake route. Validate shape, bounded payload,
   supported version, notebook identity/confirmed asset and image types. Preserve
   complete original packet/record, structured citations/revisions/figures/edit
   provenance and stable source step mapping. Unknown or future content must be
   refused clearly or preserved opaquely, never silently reinterpreted.
3. Server captures import actor/time and confirmed asset identity/UNS. Client
   metadata is never human approval. New job execution ticks are clear, regardless
   of imported template review/local checkmarks. Original work evidence remains
   visibly imported/reported. Retries are idempotent; changed same-key requests
   conflict. Preserve existing legacy writes/reads and validators.
4. Prevent generic client template/start/revision writes from forging server-owned
   import/QC metadata. Templates loaded by server revision ID may retain authentic
   metadata; ignored client template bodies do not become authority.
5. After job finish, allow the finishing/performing technician (server user ID,
   not a supplied name) to record closeout QC against exact job sequence/hash.
   Explicit per-field/step decisions retain unknowns and corrections, reviewer,
   server time, original sources and job lineage. Stale/wrong-user/wrong-tenant
   requests fail closed. An idempotent transaction creates an append-only DRAFT
   reusable candidate in existing job_sheet_revisions; it never reopens execution,
   mutates old evidence, or resends finish/outbox events.
6. Ordinary legacy template review must not accidentally promote this new candidate
   as accepted. Until a dedicated content-scoped later acceptance slice exists,
   refuse the legacy review operation for structured instruction candidates with
   a clear structured_review_required error. Legacy templates remain compatible.
7. Keep export v1 compatible; use an explicit v2 representation for richer structured
   provenance/QC semantics rather than changing existing v1 field types. Both views
   retain the same canonical snapshot and distinguish technician QC from acceptance.
8. Make intake/QC/reopen usable through the existing Living Sheet adapter. Read the
   existing WorkPacket/JobRecord localStorage keys only as an intake source; do not
   create another browser persistence system. Do not edit WorkPacketPanel.tsx,
   WorkPacketV2Sections.tsx or work-packet/** (peer-owned). New bounded adapter
   components may reuse existing illustrated/phased sections. Preserve notices,
   source text, unknowns, notes and image placement; do not turn imported source-match
   claims into human approval. PDF action uses the existing browser print mechanism;
   no new server-side browser/runtime service or dependency. Actual local PDF proof
   and viewport inspection are required before claiming generated guide behavior.
9. Tests must prove interruption/reload, retries, correction/source retention,
   changed-step review invalidation, reviewer identity, stale sequence/hash,
   foreign-tenant/notebook, reset execution marks and unchanged finish/outbox.
   Exercise actual local disposable PostgreSQL for transaction/RLS/idempotency
   evidence. Add cases to integration files already explicitly exercised by CI
   where practical; do not silently rely on excluded integration tests.

## Scope, ownership and rollback

Branch codex/living-sheet-intake-qc is stacked on reviewed draft5235, base/R0
7d3a4654d4c8c895792b5dc3726505bd02ca3436. Current main remains090c8e15b.
R0 branch rollback/living-intake-qc-r0; clean isolated task checkout. First-slice
Living Sheet368/full Hub13,044 tests passed; typecheck baseline retained in5235.
CodeGraph was READY at R0. Existing dirty primary checkout is untouched.

Expected scope: living-sheet/types.ts, validate.ts, store.ts, job-sheet-store.ts;
new packet-intake/closeout/v2 contract helpers and tests; backend intake/closeout
routes and read representation; LivingSheet and new bounded guide/QC adapters;
needed existing client helper; release metadata, sitemap, docs/proof. Reuse existing
collectFields/applyEdit/identity helpers, do not duplicate parsers or render systems.

Work Packet/drawing5204 and Stardust torque remain their current owner; UI restart
3882/3626 remains separate. Living Sheet and packet owners were asked for concrete
handoff constraints through the broker; no response is assumed to transfer their
owned files. Actual claims/open PR files checked before acquisition and push.

No shared DB, migration/ledger, credential, spending, staging, deployment or device
operation. Use only a disposable local database; never peer-owned sr-torque-pg or
wp5204-pg. Disk space is limited; preserve evidence and remove only task-owned
scratch checkouts if necessary. No paid API/inference calls for this slice.

Rollback: revert this unmerged branch to R0; no shared schema change. New JSONB
metadata is additive. Older code may not understand new writes, so release must
coordinate reader/writer versions and disable intake/QC before code rollback.
Never delete canonical job/revision history as a rollback shortcut.

## Execution ledger

Ruling: use existing append-only revision JSONB for the QC candidate rather than a
parallel review database — canonical store already supports immutable snapshots;
wrong choice would require a successor migration before release, not rewriting114.
Ruling: technician closeout QC creates a draft candidate only. Later reusable
acceptance remains blocked until its own explicit content-scoped workflow exists.

Implemented contract (2026-11-06): `POST /api/equipment-notebooks/:id/sheets/intake/`
accepts `{clientRequestId, packet, record?}`. The route stream-bounds input at
8 MiB; the adapter also bounds depth, node count, fields, steps, figures, photos,
indices and inline PNG/JPEG/WebP signatures. Versions 1 and 2 are supported with
an identity snapshot; missing snapshots are refused rather than inferred. Extra
packet/record properties remain opaque, bounded original evidence. Known v1
coverage limitations receive an explicit guide notice. Neither source-line
matches nor imported reviewer/supervisor claims gain human authority.

Ruling: the optional server-owned `JobSheetBody.instruction` JSONB object stores
the original packet/record, stable source-step map and captured actor/time/asset/
UNS/identity. The canonical execution projection intentionally parses no numeric
specifications, omits struck steps, and starts with clear ticks. The guide keeps
the complete packet context. Generic body validators remain strict and reject
instruction metadata. A server-loaded structured revision may start a fresh job
only on its source notebook and matching confirmed machine identity; broader
reuse awaits acceptance. Generic revision of a structured candidate series is
also refused, preventing accidental removal of its review boundary.

Implemented closeout contract: `POST /sheets/:jobId/closeout/` accepts
`{clientRequestId, seq, snapshotId, decisions}`. Only the authenticated user ID
on the finishing event may save it. Decisions exhaust canonical Fields/steps,
including document revisions (the legacy collector omits these). Copies follow
their canonical field. Confirm preserves unknowns; corrections use `settle` and
require a separate source; exclusion and mark-unknown remain explicit. Each
candidate is independently derived from the exact immutable source-job snapshot,
not from another candidate's unsaved edits. New QC is an append-only draft
revision in one candidate series per source job. Current-job QC is distinct from
source-job QC lineage and never reopens execution or emits finish/outbox events.

Ruling: retain source notebook/job/sequence/hash references rather than embedding
the complete source view inside candidate metadata. Immutable event rows retain
the full source, and this avoids recursive growth as fresh jobs use candidates.
Request locks use a separate `tenant:request:UUID` namespace before resource
locks, across create/revise/review/QC, preventing both request-key races and
crossed request/resource UUID deadlocks. Replays compare stable actor/content,
excluding fresh server timestamps.

Ruling: export v1 field types stay compatible. The explicit
`?format=instruction-record-v2` envelope carries structured evidence, current QC
candidate and capture gaps with the same canonical snapshot hash. Exact chat
questions/answers and benchmark exposure remain unknown, not fabricated.
Captured workplace material is private; no publication/benchmark authorization
is inferred. All checked-in test data and PDF evidence are synthetic.

Guide ruling: use existing phased-step, numbering, note, measurement and figure
placement helpers in a bounded saved-guide adapter. The legacy image component
hardcodes manufacturer attribution, so this adapter uses neutral imported-source
image captions. The practical print guide keeps warnings, coverage, unknowns,
sources, revisions, job updates and QC summary; full raw metadata and imported
edit audit remain available on screen/JSON. Existing browser print portal is
reused, selected guide print suppresses other print roots, and ordinary steps
avoid page breaks. Length follows content complexity.

Verification discovery: the existing template integration file was excluded
from unit tests and was not explicitly run by CI. The parent added a separate
sequential, must-run/no-skip CI step for that file. Local native PostgreSQL 18.6
on task-owned port 55783 proves transaction/RLS/idempotency/concurrency behavior;
no peer-owned service or shared database was touched. Hub version is 2.56.0.
The repository's current `docs/versioning.md` retires `/VERSION`; no obsolete
shared version file or changelog counter was reintroduced.

Local evidence before final parent review: red-first content tests failed for
the absent adapter, then passed; full Hub unit suite 13,061 passed / 53 skipped.
The current typecheck output is byte-identical to the R0 159-line baseline.
Real PostgreSQL suite 28 passed / zero skipped, as executed by the parent with
loopback escalation. Parent captures and visually inspects the actual synthetic
guide PDF/412 px viewport and records final artifacts separately. These local
checks do not establish deployment, physical-device behavior, accepted reuse or
customer acceptance; final exact-head review and CI remain required.
