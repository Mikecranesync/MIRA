# CV-101 guided first-user experience

Mike's six-workflow mission is the product contract and authorizes safe
implementation. Routine implementation choices below are the implementer's
choices; they do not add release, data or equipment authority.

## Intent and scope

A new technician can navigate CV-101's evidence, practice documenting a job,
and understand exactly which real-world claims remain unproven. The existing
FactoryLM/MIRA product hosts the experience. No parallel application, graph,
registry, production event store, parser, chat transport or machine connector.

Start at #5241 revision211e5c78ecdc6cf538e7509206a3397167f74d5e. Preserve that
reviewed branch/body. This is a new dependent draft, with its own delta review;
it does not reset #5241's review budget or authorize either PR to merge.

## Existing UI and ownership

Use the canonical `mira-hub/src/factorylm-ui` adapter. Add a launcher to the
existing `HubAccountFooter` in the shared shell's navigation. Avoid the active
#5195 shared-core/hub-host writer and #5204 WorkPacketPanel owner. Shared
theme/interaction/UI/lab roots remain unchanged.

The guide is a native modal dialog with accessible close/back behavior, six
numbered navigation buttons, next/previous, practice/live-evidence/case-study
views, responsive layout and the existing `--fl-*` tokens. Its entry point says
“CV-101 walkthrough”. Direct linking may use a captured `walkthrough=cv101`
query in the launcher; closing it must not alter the selected real notebook.

## Two clearly separate proof boundaries

**Practice:** curated historical identity/source cards and explicitly synthetic
interactive actions. A persistent banner says no live connection, no actual
MIRA inference and no physical work. Each result is labelled demonstration.
No fetch, provider, authentication, ingest, work-order or equipment calls occur.
Opening a deliberate original-source link is user navigation, not an API call.

**Live evidence:** immutable, dated November6 receipts from #5241, not an
automatic current-state monitor. Workflow status remains BLOCKED or FAIL as
recorded. No practice action can change live status. Missing owner session,
reader identity and fresh telemetry stop live testing. Normal sign-in/source
links and a precise owner checklist are provided; no controls or mutations.

The case study reports the exact software/test/review scope separately from
actual cloud history and unavailable real-equipment proof. No marketing claim
of a completed job, deployed feature, accepted instruction or physical safety.

## Six connected practice workflows

Every workflow shows ordered instructions, expected result, current actual
result, pinned evidence/source link and PASS/FAIL/BLOCKED status. “PASS” always
identifies its practice scope; pending prerequisites are BLOCKED, not silently
passed by Next. The live row is visible alongside the practice status.

1. **Sign in/discover:** explain normal real sign-in and simulate selecting a
   local practice asset. A demo selection cannot authenticate the garage owner.
2. **Inspect:** clickable PLC/drive/motor/photoeye cards, source and uncertainty
   labels, manual references and visual relationship diagram. Historical
   claims do not become current verified graph edges. Exact PLC identifiers,
   drive/motor suitability and photoeye identity remain unresolved.
3. **Telemetry:** show actual dated source-group receipts with their missing
   tenant/tag/quality scope. Offer an explicitly synthetic DI05 sample replay;
   never show those samples as live or infer motor motion/polarity. Preserve
   acquisition versus QualifiedValue last-change versus receipt semantics.
4. **Question/citation:** play a labelled prepared technical question/answer,
   using the existing shared `SourceViewer` to open the applicable OEM reference.
   State that this is not a live generated/retrieved answer or an asset-attached
   manual ingestion receipt. No free-form question is falsely answered by a
   fixed response.
5. **Document inspection:** create a synthetic Work Packet and use existing
   `StepRecordControls`, `JobNotesSection` and `CompletionBlock`. Adapt changes
   into existing Living Sheet event types, replay with `reduceSheet`, and
   render through existing `LivingSheetPrint`. Finish only after explicit
   checkoffs and a note. Duplicate finish is idempotent. Unknowns remain open;
   finish does not imply closeout QC, reusable approval or equipment operation.
6. **New practice session/recall:** reload the bounded local practice record,
   replay the same event prefix and display its notes, completion and sources.
   Clearly identify same-browser practice persistence, not a second technician
   account, server durability or a proven live Asset Memory answer. A real
   new-session/tenant-isolation journey stays BLOCKED.

## Local practice state

Use only tutorial-local state, explicitly marked synthetic and keyed to the
current viewer scope. Never read/write existing real packet/job keys. Reuse
Work Packet `JobRecord`, Living Sheet `StoredEvent`/validators/reducer; do not
invent a maintenance-record schema. A small versioned envelope only identifies
the tutorial and holds those existing shapes plus navigation progress.
Bound serialized bytes/event counts, validate shape/identity/sequence before
replay, reject corruption, handle storage denial/full disk visibly, and never
report successful persistence after a failed write. Changing viewer scope
must not expose another viewer's practice entries. No credentials in storage.

## Acceptance and evidence

Native tests cover practice/live separation, guarded finish/retries,
correction/source history where applicable, corrupt storage, unavailable
storage, viewer changes and real UI mounting. Browser journey uses actual
product components, captures all six workflows at desktop1440×900 and
mobile412×915, source navigation, completion and actual reload. Its fixtures
and every screenshot are labelled demonstration; live blockers are retained.

Evidence includes exact source revision, test outputs, screenshots, responsive
overflow/focus checks, a reproducible checklist and a local preview URL while
the task runs. Existing first-slice code remains covered by focused regressions.
No production build/deploy/config change, Atlas write, control command, physical
start, purchase or merge. A dependent-base review is not a main-base release
clearance; retain the established gate when the parent is later authorized.
