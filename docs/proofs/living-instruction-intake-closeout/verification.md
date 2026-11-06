# Intake, technician QC and illustrated guide — final local evidence

Status: PARTIAL — local implementation/proof; independent exact-head review and
CI are separate. No merge, shared rollout or representative human acceptance.
Product commit:67ac9192f; provenance remediation:3a25c0c6e; caption fix:4a5851195.
Parent/R0:7d3a4654d4c8c895792b5dc3726505bd02ca3436,
reviewed draft5235. This continuation is stacked on that still-unmerged draft.

## What now connects

Explicit intake reads existing packet/record cache keys and saves bounded complete
originals, images, sources/revisions and server identity/UNS in the existing job
snapshot. Local checkmarks never become current-job execution. Closeout requires
the authenticated finishing technician, exact saved sequence/hash and effective
candidate ID. Per-target
decisions/corrections create an append-only DRAFT candidate in existing template
revisions. Generic metadata forgery, wrong-asset candidate start and legacy
promotion of structured candidates are refused. New jobs reset execution marks;
prior QC remains source-job lineage. No migration114/outbox change or second store.

The saved guide uses existing phase/note/number/measurement/image-placement helpers
and the existing print portal/browser PDF path. Neutral image provenance is explicit;
the legacy renderer's manufacturer attribution was unsuitable for arbitrary intake.
Exact chat linkage and benchmark exposure remain explicit gaps. Workplace material
remains private; no publication/benchmark authority is inferred from this workflow.

## Fresh verification

* Full Hub unit suite at product commit:587 files passed,4 skipped;13,070 tests
  passed,53 skipped. Log:task root intake-review-final-unit.log at3a25c0c6e.
  Final caption-only
  change separately passes10 renderer tests and actual Chromium print/viewport
  inspection. Focused provenance/route/renderer run:23 passed; earlier wider
  Living Sheet/packet target run:521 passed.
* Native task-owned PostgreSQL18.6 on127.0.0.1:55783:30 template/intake/QC,
  19 existing job-log and8 finish-outbox tests passed,57 total/zero skipped,
  serially. Real RLS/transactions/concurrency, wrong tenant/notebook/actor,
  stale hash/sequence, repeats, source corrections, fresh execution, metadata
  forgery and crossed UUID lock namespaces are exercised. No shared DB or
  peer-owned database/service was touched. Logs:pg-intake-qc/review-final-integration.log.
* Full TypeScript check still exits2 with byte-identical159-line R0 diagnostics.
  Baseline is retained under living-instruction-record-v1; no changed-file error.
  Project typechecking is NOT claimed green.
* Focused lint, sitemap check, diff checks and actionlint pass. CodeGraph sync and
  repository preflight:READY at4a5851195, healthy20-caller canary. Referenced
  imports/signatures were grounded in code and typecheck; source inspection covers
  known graph blind spots.
* CI discovery:the existing template integration file was not run by CI. Added
  one sequential must-run/no-skip step to the existing outbox PG job. A real
  skipped-all mutation returned success from Vitest but was rejected by the new
  predicates. Existing CI gates are preserved. Open CI patches5174/5171/4930
  affect Trivy, Hub filter and consent steps, not this outbox step;4818 changes
  setup-node versions. Findings-only5157 is retired, not an active implementation.

## Review regressions

Independent round1 found HIGH F1 at4cf660ea1: clearing edit history could present
an edited measurement as its original manual value. Source inspection and three
unit/two real-PG regressions reproduced the loss before remediation. Related
regressions proved repeated QC could revert the displayed latest candidate and
source completion could leak onto revised instructions. Additional old-draft
rendering regression covers a candidate with already-cleared projection history.

Remediation preserves all value/source history separately from authority, binds
QC to the exact latest candidate under the job lock, keeps request replay stable,
and labels candidate execution as original source-snapshot history. Original
source claims, imported corrections and server QC are distinct. Lost transitions
remain unresolved; history is never silently trimmed. Screen/print regressions
cover import, all-confirm QC and a fresh inherited job; real PG covers repeats,
stale concurrent candidates, replay, inherited server correction sources and no
finish/outbox mutation. Exact-head independent review remains a separate gate.

## PDF and viewport proof

`guide-synthetic.pdf` is an engineering fixture, not a real maintenance procedure
or human acceptance. It was generated from the actual LivingInstructionGuideContent
component at the product commit. All equipment, source text, steps and artwork are
fictional. No employer/OEM photo or customer record was used. The paired
synthetic-fixture.json wraps the actual v2 record and marks this public fixture
as exposed and not a benchmark holdout; its underlying record still reports
uncaptured conversation/exposure provenance as unknown.

Actual Chromium PDF:3 A4 pages,one embedded680×310 PNG. All pages were rendered
with Poppler and visually inspected. Numbered steps, before-step note, source
revision, unknown isolation and QC-pending state remain legible. The original
30-demo-unit source claim,50-demo-unit correction and correction source are
separate and visible. Measurement caption/header/row stay together on page3. No clipping,
overlap, blank page or orphaned step heading. Legacy print sentinel is absent;
manufacturer-photo misattribution is absent; imported-source image caption is
present. A412px screen render has scrollWidth412 and one visible image; the additional
measurement-screen-412.png shows legible original/correction columns without
overlap. All source content and units are fictional. This is
viewport/render proof, not a physical-phone or authenticated live-app journey.

The page count is this fixture's result, not a fixed product promise. Existing
browser Print/Save as PDF remains the download mechanism; no server PDF service
or runtime dependency was added. Artifact hashes are in artifact-sha256.json.

## Ownership, remaining gates and rollback

Durable claim:issue5232/comment6675309588; CI refinement6675374194. Existing
Living Sheet and Work Packet owners received concrete scope/handoff messages;
no response or ownership transfer was inferred. Protected packet/drawing5204,
Stardust torque, shared UI core/mobile and restart3882/3626 surfaces were not edited.
The original dirty primary checkout was preserved. One implementer wrote product
code; coordinator owns CI/proof, publication and independent review.

Later content-scoped reusable acceptance remains deliberately unavailable; the
legacy review route cannot bypass it. Real supported-job/phone testing and actual
technician acceptance remain required. Shared schema/ledger adoption, CMMS/UNS
write policies, deployment, credentials and spend were not changed. Existing
finish outbox behavior remains intact. No paid provider request was made locally.

Rollback is the addressable rollback/living-intake-qc-r0 branch. Disable new
intake/QC writes before reverting reader versions; preserve additive JSONB history.
No shared schema or data needs to be discarded. Any merge/deployment remains
subject to the established human authorization and exact-head gates.
