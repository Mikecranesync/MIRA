# Supported QC fields in the saved repair guide

Status: local follow-up for #5237, 2026-11-06. The parent explicitly asked to
keep this defect in the requested reusable-guide scope. No human verification,
merge, deployment or CMMS propagation is claimed.

## Scope and authorization

Prepare and test the fix locally in the guide files already covered by this
session's ACTIVE G05/G06 claim on #5232. The old #5236 head/body remain frozen
at8a54f29a73507da80eee98bfcb6534f332617a24 and its converged review is not reopened.
Branch: codex/living-guide-qc-field-completeness. R0 is the local branch
rollback/living-guide-qc-field-completeness-r0 at that exact SHA.

Automatic approval review rejected both the parent claim-release publication
and a new ACTIVE claim on #5237 as organizational commitments without specific
publication authorization. Neither comment executed. No new branch/PR/claim
will be published to bypass those decisions; local preparation remains within
the authorized product task and existing owned files. Publication/authoritative
review is pending that approval. The parent tracker claim remains ACTIVE.

Fresh #5237 issue/open-PR and owner-summary checks found no competing writer.
Peer-owned Work Packet/drawing/Stardust/core/mobile files and existing holds
remain protected. No API/store/schema/outbox, credentials, shared environment,
paid provider or physical-device changes are in scope.

## Reproduced problem

The exact validator accepts inclusion, image-placement and measurement
tool/link/measured Fields. Closeout preserves their corrections in JSON, but
the saved guide prints only inclusion/placement basis and omits measurement
tool/link/measured content. A local actual-renderer reproduction retained all
five distinct corrected values in JSON and rendered none in either guide copy.
This violates the human/machine preservation requirement; it does not establish
that the whole guide is human verified.

## Acceptance checks

1. Show each source step's effective inclusion value, basis, unknown/excluded
   state, citation and correction provenance beside that step. Equal basis
   strings must not deduplicate different step decisions.
2. Show a figure's effective placement Field and provenance beside that exact
   source figure. Preserve the source index through placement helpers, including
   repeated captions and unplaced figures; do not guess associations.
3. Show measurement name, tool, link and reported reading Fields with effective
   values, unknown/excluded states, sources and correction provenance. Keep
   reported readings distinct from original source values/specifications and
   proposed corrections. Do not infer OEM authorship or human authority.
4. Use the same effective saved record for screen and print. Red-first tests
   cover closeout corrections, all-confirm/repeated QC, fresh inherited jobs,
   differing decisions with equal basis, unknown/excluded Fields and unchanged
   original execution history. Assert operational guide content rather than
   incidental JSON/audit text. Retain existing torque provenance regressions.
5. Preserve current candidate binding, v1/v2 contracts and metadata authority.
   Add no new acceptance or safety-clearance state. Imported/source-job review
   never becomes current-job review, acceptance or performed execution.
6. Run relevant unit/lint/typecheck checks, then the full Hub suite. Inspect
   every actual synthetic PDF page and a narrow viewport; page count follows
   content. Use no workplace data/images. Mark synthetic fixtures exposed.

## Existing facts and boundaries

TypeScript/Postgres JSONB and the canonical event/revision stores remain the
contract. CodeGraph preflight is READY at R0; source inspection also covers its
known blind spots. The current159-line typecheck failure baseline is retained.

The saved record preserves server-captured UNS identity. The current canonical
finish-outbox INSERT still writes asset_uns_path=NULL (finish-outbox.ts:162).
Captured address and actual CMMS delivery are separate facts; this fix does not
alter routing, enable Atlas sync or claim propagation.

Hub release metadata follows the current component rule. The overall /VERSION
counter is retired by docs/versioning.md; no obsolete counter or release tag
will be introduced. Any later remote review/CI remains separate from local
verification, and the stacked drafts are not merge-ready until the main-base
integration and existing gates are satisfied.

## Local implementation ledger

- Reproduced six failing actual-renderer unit cases before the fix in
  `/tmp/guide-fields-red.txt`. Assertions extract balanced operational step,
  figure and measurement elements from both screen and print copies; audit
  decisions/JSON cannot accidentally satisfy a missing-field assertion.
- Step inclusion now uses the shared Field renderer beside each source step.
  The phase helper's equal-basis aggregation does not determine which step
  decisions appear. Different values, unknowns and exclusions remain distinct.
- Each source figure array slot receives its own transient object/index mapping
  before existing placement helpers run. Repeated captions or input references
  do not determine decision paths. Unmatched legacy figure sections remain in
  the unplaced appendix, with their original array index and placement evidence.
- Linked measurement Fields appear beside the exact source-associated step:
  name, current proposed value, tool, link and reported reading. Freeform link
  corrections are displayed as proposed evidence; they are never parsed into
  new step associations. The full provenance table retains original source
  values/corrections and points to source-associated steps. Only unlinked rows
  repeat the complete tool/link/reading details below the table.
- Reported reading Fields are explicitly observations, separate from source
  specifications. Corrected values are called current proposed measurement
  values, not original/OEM specifications. The existing original-value and
  correction-source table semantics remain intact.
- Field presentation history includes exclusions as well as value changes.
  Repeated all-confirm QC does not erase the exclusion's actor/time or make
  imported/source-job provenance current human approval. Value-only lineage
  helpers continue to exclude strike entries from original-value derivation.
  If a settled value is later excluded, both its latest correction source and
  exclusion provenance remain operationally visible. A separate red-first
  regression in `/tmp/guide-fields-excluded-source-red.txt` caught the last-action
  presentation hiding that earlier correction source before this was corrected.
- Both views label the server-recorded address **Captured UNS address** and
  state **CMMS delivery is not established by this guide**. No backend routing,
  finish-outbox, sync or v2 representation was changed.
- Additional edge tests were red in `/tmp/guide-fields-edge-red.txt` for hidden
  exclusion provenance and unmatched legacy figures, then passed. Test data is
  explicitly exposed synthetic developer input, never workplace evidence or a
  held-out benchmark. Candidate completion remains original source execution
  history; fresh inherited jobs retain clear execution marks.
- Hub component version advances from 2.56.0 to 2.57.0 for the meaningful guide
  change. No retired `/VERSION` file or tag is introduced. Parent owns final
  full-suite/PDF/viewport proof and any later publication approval.

Local verification: eight completeness tests and all prior guide/torque tests
pass; the final focused command reports 27 passed in
`/tmp/guide-fields-final-focused.txt`. The wider Living Sheet/UI run reports
529 passed in `/tmp/guide-fields-wide.txt` before the final additional state
regression. The final complete Hub run reports **13,078 passed / 53 skipped**,
588 passing files, in `/tmp/guide-fields-full-unit-final.txt`. Scoped ESLint has
zero errors/warnings (`/tmp/guide-fields-lint.txt`); typecheck remains the exact
159-line baseline (`/tmp/guide-fields-typecheck-final.txt`). Sitemap check passes
with unchanged 70 pages / 207 API routes. No API/store/schema/outbox or protected
packet/V2/core/mobile files changed.

The parent's actual synthetic capture reproduced all five formerly omitted
effective values in both guide copies and a four-page A4 PDF, with no 412 px
horizontal overflow. A targeted print label class keeps inclusion, placement,
tool, link, reported reading and current-value labels with their following
Field content; the parent confirmed the orphaned reported-reading label was
resolved. Final artifact/hash evidence is parent-owned and will be attached
separately. The fixture is exposed synthetic engineering evidence, not a task
benchmark result or human verification. Remote publication remains blocked by
the stated automatic approval review; no denied operation was retried.
