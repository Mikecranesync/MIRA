# Living instruction record v1 — first contract slice

Status: draft implementation contract, 2026-11-06. Owner: Codex task
01a1ae98, claim on #5232. Mike explicitly requested implementation with Codex.

The intended outcome is a growing, reusable work instruction assembled while a
technician works. The performing technician first checks it at closeout; later
review governs reuse. Both human and machine views must preserve what is known,
what is proposed, who checked each fact/step, when, and against which sources.
Review is never physical safety clearance.

## Verified starting state

At main `090c8e15bfcbd85f0091103cf5a6f5fc6b221056`:

* Work Packet fields retain document/file/page/line and edit attribution.
  `verified` means a verbatim source match, not human acceptance. Packet and job
  drafts use browser localStorage. #5204 drawing/torque remains another owner's
  held effort; this slice does not change it.
* Living Sheet snapshots strict `JobSheetBody` JSON into `job_started` and reduces
  append-only events. Template revisions and whole-template review are separate
  append-only rows. Step execution and reading corrections already retain history.
* Importer source fields are short strings. Revision/date and photo references
  are flattened into notes/source text; typed Work Packet citations cannot make
  a lossless round trip through this shape.
* Machine identity is narrowed to entityId/name at job start. The finish outbox
  currently inserts a null UNS path. A current notebook binding cannot establish
  the missing historical job path.
* Finishing does not provide per-fact/step QC or a proposed reusable revision.
  Subsequent execution events are refused. An approval feature must not reopen
  execution or resend the transactional finish outbox.

## Chosen first slice and compatibility

JSON fits the actual TypeScript HTTP and Postgres JSONB system. Add an opt-in
`?format=instruction-record` representation to the existing tenant-scoped job GET;
`atSeq` keeps its existing historical-prefix semantics. Default responses are
unchanged. No schema write or migration is necessary. Migration114 stays intact.

The versioned envelope contains the exact reduced sheet used by existing human
and print views, notebook/job/template/sequence lineage, a deterministic snapshot
identity, and individual facts/steps with provenance and unreviewed states.
The envelope is an explicit **draft**. Legacy template `reviewed` status remains
lineage only; it does not manufacture reviewers, scope, time or source receipts.
An observation citing a manual remains an observation, never an OEM specification.
Unknown sources remain null. No parsing of informal citations invents pages or
document identity. No UNS path is synthesized or borrowed from a new binding.

This v1 is an export projection, not a new canonical writable store. It does not
accept uploaded records or approval receipts. The existing event log remains the
source of truth. Snapshot identity changes with any source content/history change;
IDs within a job retain the source step/reading/item IDs. Two jobs remain separate.

## Acceptance and plan

1. Lock existing reducer/route behavior; establish R0.
2. Write failing contract and route cases, then implement a pure projection and
   opt-in GET branch. Preserve complete history, corrections and unknown state.
3. Prove interruption/prefix replay, repeated deterministic export, changed content,
   finished/reviewed versus unreviewed, permission/not-found/flag/storage gates and
   default response compatibility. Run existing Living Sheet unit coverage.
4. Publish a draft PR after renewed collision check. Independent exact-head review,
   CI, merge, staging, deployment and real human acceptance remain separate gates.

R0: clean isolated checkout; rollback branch `rollback/living-instruction-r0` at
the main SHA above; reducer/route baseline50/50 passed. No shared schema/ledger or
runtime action was taken. Rollback is reverting this opt-in projection/route; data
recovery is unnecessary because it performs no writes. Registry lookup confirms
Hub remains the existing API/domain seam; no parallel service, UNS or CMMS writer.

## Remaining work, deliberately visible

Lossless packet intake (including original field and edit snapshots, stable source
step IDs and durable media), structured intake/step amendments, performing-tech
closeout QC tied to exact content, candidate template lineage and later acceptance,
fresh-job reset, shared adapter policy, structured asset/component facts and UNS
snapshot retention. A successor migration and scoped authorizations will be needed
for durable new review events/contracts. Keep ordinary work capture and CMMS-off
operation usable. Test the whole eventual loop on a real phone with real technicians;
the existing cold-restart blocker belongs to #3882/#3626, not this contract slice.
