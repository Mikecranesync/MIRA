# Packet intake and technician closeout evidence

Branch: `codex/living-sheet-intake-qc`, based on
`7d3a4654d4c8c895792b5dc3726505bd02ca3436`. This is a draft continuation of
the read-only instruction contract, not reusable acceptance or deployment.

The source contract and implementation rulings are in
[`living-instruction-intake-closeout.md`](../../specs/living-instruction-intake-closeout.md).

## Verification

- Red-first `packet-intake.test.ts` failed because the adapter did not exist,
  then passed supported-version, bounded-shape/image, lossless preservation,
  fresh-execution, unknown and correction/source tests.
- Full Hub unit run: **13,061 passed / 53 skipped**, 587 passing files. Command
  from `mira-hub`: `./node_modules/.bin/vitest run --cache=false`.
- Typecheck: `./node_modules/.bin/tsc --noEmit --incremental false` retains the
  byte-identical **159-line existing baseline** at
  [`typecheck-baseline.txt`](../living-instruction-record-v1/typecheck-baseline.txt).
- Actual task-owned PostgreSQL 18.6: **28 passed / zero skipped**, including
  reload, concurrent intake/QC retries, actor/key conflicts, tenant/notebook and
  identity refusal, changed model refusal, exhaustive targets, exact sequence/
  hash refusal, append-only draft candidates, preserved originals/corrections,
  generic metadata anti-forgery, blocked legacy acceptance, new-job clear ticks,
  no finish/outbox resend, crossed UUIDs and QC/generic revision races.
- PostgreSQL command: `TEST_DATABASE_URL=postgres://postgres@127.0.0.1:55783/living_intake_qc MIRA_TEST_DB_CONFIRM=DISPOSABLE ./node_modules/.bin/vitest run --cache=false --config vitest.integration.config.ts --maxWorkers=1 --no-file-parallelism src/capabilities/living-sheet/__tests__/job-sheet-template.integration.test.ts`.
  The selected sandbox denied loopback with `EPERM`; the parent executed this
  against its own disposable local database, not a shared database.
- Parent owns the minimal CI must-run step and final PDF/viewport inspection
  receipt. The engineering PDF uses synthetic art and sample data only; it is
  not evidence of any workplace task or customer acceptance.

The saved guide uses existing packet layout/placement helpers and the existing
browser print portal. It has no new browser persistence store, dependency,
migration, server browser service, benchmark system, or external publication.
The old print root is unmounted while the guide is selected, and print CSS also
suppresses legacy sheet/packet roots. Unit tests verify the exact pure guide
renderer, provenance wording and initially unselected QC decisions.

## Review remediation

Official review F1 was reproduced before editing: three unit regressions failed
for lost 30 → 50 synthetic source-value lineage, screen/print output and a QC
form displaying an older guide than the current candidate. Two real-PostgreSQL
regressions failed while the existing 28 tests passed: all-confirm QC erased
the imported correction source, and a second QC reverted a saved 60-unit
correction to the source job's 50-unit value. A separate screen/print test
reproduced execution completion leaking onto revised instructions.

The fix preserves packet value/edit provenance while resetting approval flags.
The guide displays an original source claim and each sourced correction in
separate columns, with explicit historical versus current QC provenance. Screen
and print tests cover initial import, all-confirm QC and a fresh inherited job;
the original packet also supplies provenance for older draft rows whose packet
history was cleared. Unrecoverable transitions remain explicitly unresolved.
Inherited source-job QC never becomes current-job QC or reusable acceptance.

QC now requires `baseCandidateId` alongside the immutable source sequence/hash.
It reviews the same effective candidate shown by the guide, checks that revision
under the existing job lock, preserves prior corrections, and rejects stale
candidate submissions. Idempotent replay returns the original candidate before
checking candidate freshness. Candidate steps show source execution history with
the original instruction, and never carry its completion onto revised content.

Parent's remediation PostgreSQL run passes **57 / zero skipped**: 30 template/QC,
19 job-log and 8 finish/outbox tests. It includes concurrent stale candidate
rejection, replay against an older base, repeated QC without correction loss,
and a fresh inherited server correction with its source retained. Parent owns
the updated full-suite/typecheck and final synthetic PDF/viewport receipt in
`verification.md`. Protected packet/V2 components, CI and parent proof files
were not changed by this remediation.

## Remaining gates and limits

Dedicated structured reusable acceptance is intentionally absent. Legacy review
refuses these candidates. Draft candidate execution is restricted to its source
notebook/machine identity. Every fresh job starts with clear execution marks;
source-job QC is lineage, not current-job review. Existing event rows retain the
exact immutable source view through notebook/job/sequence/hash references.

Exact conversation linkage and benchmark exposure are unknown in v2. Workplace
data and images remain private; this work grants no publication or benchmark
permission. Unknown future packet properties are preserved opaquely and are not
interpreted as instructions. No physical-device, staging, production or complete
guide-reuse acceptance claim is made.
