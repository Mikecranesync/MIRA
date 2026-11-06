# Instruction record v1 — local evidence

Status: PARTIAL (draft implementation; independent review/CI/release separate).
Base/R0: `090c8e15bfcbd85f0091103cf5a6f5fc6b221056`.
Spec: `docs/specs/living-instruction-record-v1.md`.
Claim: https://github.com/Mikecranesync/MIRA/issues/5232#issuecomment-6674935524

## Actual verification

* R0 reducer and sheets route: 50/50 tests passed before changes.
* Red: opt-in export and unsupported-format assertions failed against the old
  route; the new pure contract test also reported its missing module.
* Green: Living Sheet12 files/368 tests passed. Cases preserve corrected reading
  history and current attribution, separate observations from legacy template
  values, leave unknowns visible, retain stable step IDs, keep finished/reviewed
  jobs unaccepted, compare interrupted prefixes/repeated exports, distinguish fresh
  jobs, bind content/history independently of JSON key order, and cover existing
  flag/notebook/job/sequence/storage gates for the opt-in representation.
* Full Hub `npm test -- --cache=false --maxWorkers=4`:583 files passed,4 skipped;
  13,044 tests passed,53 skipped. No failing tests. The initial run using the main
  checkout's outdated dependency tree could not load109 suites because
  `@opentelemetry/api` was missing. Reusing the existing complete Living Sheet
  dependency tree resolved this; no dependency versions changed.
* Focused ESLint and `git diff --check`: passed. No new route/path, so no sitemap
  addition. All three Hub manifest version fields move2.54.2 →2.55.0 as required
  by module instructions; no root VERSION/archive changelog change.
* Full `tsc --noEmit --incremental false`: exit2. A clean detached R0 worktree with
  the same complete dependencies produced byte-identical159-line diagnostics.
  No changed file has a diagnostic. Exact baseline output is retained alongside
  this receipt in `typecheck-baseline.txt`; the project typecheck is NOT green.
* CodeGraph local index initialized/synced; repository preflight returned READY,
  healthy20-caller canary. Literal-source checks cover the snapshot/route seam.

## Ownership and boundaries

Isolated task checkout, own Git metadata, read-only object reuse from the original
repo. The original dirty main checkout is untouched. Updated main before edits and
again before publication; it remains at R0. PR5157's apparent Living Sheet overlap
was inspected against its actual head: the job route/body match main; that PR is
findings-only and its recorded worktree is retired. #5204 drawing/torque, the
shared UI/restart lane #3882/#3626, observation migration/adoption, and Atlas
recovery remain separate owners' work. Local coordination messages were delivered
to Living Sheet peer vvmfyb3m and Work Packet peer01zlia4k; no reply received at this
checkpoint. No conflicting active implementation claim was found in the reread.

No migration114 edit, new persistence, new outbox, shared DB/ledger operation,
credential change, shared staging/deployment, cleanup, paid provider call, or
physical-device operation occurred. No photograph or customer data was published.
Only fictional fixtures are used. A content hash identifies snapshot content; it
is not a signature, human attestation or permission to operate equipment.

## Open gates and next slice

Fresh exact-head review and CI are required before any merge. No merge, staged
candidate, deployed behavior or representative human acceptance is claimed.
This export does not ingest Work Packets or store technician closeout reviews.
Next: coordinate one lossless packet/job intake and durable content-scoped closeout
review proposal with the owners, followed by separate later reusable acceptance.
Preserve execution closure and existing transactional outbox/idempotency gates.
