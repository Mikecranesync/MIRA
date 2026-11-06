# CV-101 progressive real-equipment acceptance procedure

Run stages in order. This is an acceptance observation procedure, not repair,
electrical commissioning, safety approval or permission to alter the equipment.
Stop at a failed prerequisite. Record actual UTC times, durations, IDs, sources
and outcomes; use PASS / FAIL / BLOCKED / NOT TESTED. The
[current attempt](README.md) stopped before physical operation.

## 0. Access checklist — required now; leave the conveyor stopped

1. Mike signs in normally to the existing garage-owner workspace at
   [app.factorylm.com](https://app.factorylm.com/), using his existing account.
   Do not paste a password, session cookie, HMAC key or token into chat or a PR.
   Do not reset credentials, create users, expand permissions or impersonate
   tenant headers. Use an already authorized session for protected reads.
2. Verify tenant `e88bd0e8-8a84-4e30-9803-c0dc6efb07fe` and asset CMMS UUID
   `64a24de7-2809-4c35-b4fe-202be80393d6`, CV-101 / Discharge Conveyor. Compare
   the normal session and asset response; a similarly named other-tenant asset
   is not acceptable. If the owner sees a different identity, stop and reconcile.
3. The **PLC-laptop owner** reports the laptop's current address and which
   already-installed reader/collector is running (Ignition or the existing
   #5110 DI05 reader), with its version/process/service identity. Confirm its
   existing log/read endpoint is reachable. Do not start a second reader,
   restart services, change bindings/allowlists, enable workflows or reconfigure
   the network as part of this test. Restoration needing such work is a
   separate owner action with its normal gates.
4. From ordinary accessible labels/UI, identify the installed PLC model and
   unit identifier, GS10 exact nameplate if available, motor identity and
   photoeye identity. Do not open an energized enclosure, move wiring or
   inspect inside a hazard zone. If a label cannot be safely read, retain the
   historical evidence and mark current identity unresolved. Do not silently
   choose among contradictory MACs, firmware, motor ratings or serial settings.
5. Record “access ready / existing reader ready / machine remains stopped”
   with time and operator name. This confirms prerequisites only. It does not
   authorize a start/stop or a photoeye intervention.

An access request was sent during this attempt. Its absence of an answer is
not authority, an equipment-state observation or an operator confirmation.

## 1. Read-only baseline and identity (Tests A/B)

Capture the existing source for at least two successive source observations,
without operating the machine. Prefer its existing historian/collector HTTP
surface over a new PLC client. Never attach a second RS485 master. Never run
`provision.py`, legacy deploy/map scripts, monitor/poller main paths or ingestion
POST tools merely to obtain evidence; several mutate configuration or send data.

The already-existing GET surface, **only after its owner confirms the address**:

```sh
# Substitute the actual confirmed existing historian origin, not a guessed host.
curl --fail --max-time 10 "$CV101_READER_ORIGIN/health"
curl --fail --max-time 10 "$CV101_READER_ORIGIN/trends/summary?window=30"
```

Do not probe address ranges or reuse the historical `.99:8766` address as a
current fact. A connection refusal proves that endpoint failed, not that the
PLC or complete laptop is offline. Keep private addresses in the authorized
evidence location. The current attempt's endpoint timings are retained.

For cloud evidence, use the authorized app's existing telemetry/Machine Memory
reads or the repository-sanctioned workflow; never raw production SQL in a code
session. The existing inspection can be reproduced with:

```sh
gh workflow run db-inspect.yml --repo Mikecranesync/MIRA --ref main -f target=prod
gh run list --repo Mikecranesync/MIRA --workflow db-inspect.yml --limit 1
# Then inspect that returned run ID, saving raw logs privately.
gh run view <actual-run-id> --repo Mikecranesync/MIRA --log
```

This workflow has a five-minute timeout and did not finish the current probe;
do not interpret its incomplete sections as no data. Do not loop dispatches or
change its timeout. `cv101-live-gate.yml` is disabled; do not enable it for this
mission. Its classifier also requires broader tag coverage than the DI05-only
fallback and selects the busiest source: a healthy single tag is not proof of
the complete drive/PLC view, nor should the threshold be weakened to claim it.

For every sample preserve: authenticated tenant, asset UUID/UNS, component/tag
ID, source_system, source_connection_id, raw tag path/value/unit, source
observed_at, server ingested_at, quality, simulation marker and relevant producer
metadata. Compute observed age and delivery lag from those clocks. The fallback
clock is host UTC read-completion time, not PLC time. Preserve this distinction.
`simulated=false`, a recent receipt or cached “live” label alone does not pass.
Check acquisition/heartbeat/receipt clocks against that producer's configured
cadence and bounded delivery. Ignition QualifiedValue timestamps may represent
the last change/observation and remain unchanged during legitimate report-by-
exception operation; preserve them separately from an actual current read.
Do not diagnose pathological replay from grouped timestamp counts alone. Obtain
source quality, per-tag history and a current acquisition/heartbeat when needed.
Record the existing app freshness threshold rather than inventing one.

Ask MIRA in the authenticated CV-101 notebook, saving **the exact question,
actual served answer, cited records and request time**:

> What is this CV-101 conveyor? Identify the asset and components, explain the
> evidenced connections, list applicable manuals with original source links,
> and identify missing or conflicting evidence. Distinguish current facts from
> historical photographs, technician reports and proposed seed relationships.

Then:

> What does the latest actual equipment evidence show? Give each available
> reading's source, observed time, quality and age. Which drive parameters, PLC
> inputs and photoeye status are unavailable or stale? Do not infer current
> motion or photoeye polarity from historical data.

Compare every material answer with the retained samples and the inventory.
Open the actual component and manual links. Verify publication/model/page,
original bytes/version or recorded hash, not just an upload role or cited
filename. Current Rev. C does not silently replace a historically used Rev. B.
Where only authored print packs are attached, mark the OEM-manual requirement
unmet. Do not import a corrected manual or promote relationships silently.

## 2. Operator-confirmed normal transition (Test C; not yet authorized)

Proceed only when the baseline and exact asset are established and an
authorized person is physically present. Mike's mission requires his
confirmation before a physical operation. Ask him to identify the normal,
already approved operation he will perform and confirm readiness. Record that
confirmation and planned observation window. Do not interpret software QC as
physical clearance.

Operator checklist for that later confirmation:

1. The operator confirms the actual CV-101, their authority, and their normal
   safe operating procedure. The existing equipment condition and unresolved
   suitability/wiring questions must be handled by that responsible person;
   this audit does not resolve them or authorize operation.
2. Choose **one** normal, approved start/stop using existing operator controls,
   **or** an ordinary photoeye transition achievable without entering the
   conveyor/hazard zone or moving safeguards. If neither is safe/normal, stop.
   No E-stop test, fault injection, reset, bypass or forced IO is requested.
3. Record pre-state/time and the operator's observation; perform only the
   confirmed normal operation; record transition and post-state/time. Codex
   sends no PLC/VFD commands or parameter writes. No register values in the
   inventory are executable instructions.
4. Retain source samples before/during/after. Compare physical state and exact
   tag transitions, clock order, lag, quality, missing samples and reversals.
   A DI05 change alone does not prove motor motion or VFD values. Do not assume
   `true=blocked`; confirm polarity from the correlated observation.
5. Ask MIRA to explain what changed with evidence, including unavailable drive
   signals. Compare with the captured samples. An answer exceeding those
   samples fails even if the UI looks plausible.

## 3. Persistent maintenance observation and review (Test D)

Use the **existing Living Sheet / technician workflow** in the confirmed
CV-101 notebook, in an explicitly authorized environment. The mission authorizes
a genuine observation; do not fabricate a repair, copy fixture values, or write
an acceptance event into production as a configuration workaround. Record the
actual observer, component, observed/recorded times, exact readings, source
links and uncertainty. A feed-unavailable observation describes the feed, not
the conveyor's mechanical state.

If a correction is needed, use the existing correction/QC workflow, retaining
the original and correction source. Save actual job ID, event prefix/sequence,
snapshot hash and candidate revision. Technician closeout QC and later reusable
procedure approval are separate; neither certifies physical safety. Imported
source-line verification does not establish human acceptance or execution.

Compare the same saved revision in human Living Sheet, machine-readable record,
MIRA selected-job context and illustrated Guide/print. Effective corrections,
exclusions and step-specific citations must agree. Save the actual PDF and
screenshots only when generated. A historical print pack cannot stand in for
the new job's illustrated output. No later reusable acceptance is asserted
where this draft lacks that workflow.

## 4. New-session recall / historical stability / isolation (Test E)

Close and reopen the authorized client/session, sign in normally as a newly
opened technician session that is already entitled to this asset, and ask:

> What happened to CV-101 in the recorded job, what did the technician actually
> report doing, which facts were corrected or remain unresolved, and what are
> the original sources? Separate that history from current telemetry.

Do not automatically share another viewer's private notebook turns. Use the
existing job read policy and actual viewer-owned chat. Verify exact job/sequence/
candidate/source IDs, actor and timestamps. Follow the saved-record selector and
manual/photo/work-order links; each must open the intended authenticated record.
Repeat in a new authorized client, and in the task-owned candidate process if
available. Restart only the authorized test process; **never production or the
physical reader**. Missing automatic selection is a navigation gap, not erasure.

For negative controls, use an existing authorized different-tenant test session
and anonymous requests. Expect the existing 401/404 policy for this asset,
notebook, job, document passage and selector; never change tenant headers to
impersonate a user. Test a notebook A→B reassignment only in isolated disposable
test data or the existing regressions. Do not rebind the real garage notebook
to prove history stability. Old job identity/prefix must stay A, with today's
binding shown separately. Source deletion/conflict must yield uncertainty.

The existing `asset-memory-5241-continuation/authenticated-read.mjs` is hardcoded
and guarded for fictional QA99/PUMP-01. **Do not point it at CV-101 or remove its
tenant guard.** Use the normal authenticated journey and existing read routes;
the fake case is not a fallback for this acceptance.

## 5. Work-order continuity (Test F)

Read the actual CV-101 Atlas/Hub asset mapping and existing authorized test job
through the existing adapter/status interface. If no appropriate order exists,
record BLOCKED; a new provider order requires its normal explicit authorized
workflow and must not be invented for a passing screenshot.

Where authorized, associate the real observation via that supported workflow.
Preserve both Hub and Atlas IDs, environment, external asset FK, outbox key,
delivery/readback status, source job/sequence and original URI. Navigate to the
actual Atlas order and check its equipment, content and closeout comment.
`accepted:0`, an HTTP200, description text, `verified_by_readback`, captured UNS
or numeric externalRef alone does not prove provider asset linkage. Do not guess
an Atlas URL from an integer or a hostname default. Existing finish outboxes may
carry NULL asset_uns_path. Verify actual propagation separately; do not fix it
by editing production data. Do not reopen execution or duplicate finish to
record later QC. Preserve restart and retry/idempotency evidence where available.

## 6. Independent review and final receipt

Have the independent reviewer inspect the captured chain, original sources,
actual timestamps, negative controls and code revision. Distinguish offline
fixtures, real service reads, physical observations and human acceptance.
Update PR #5241 with exact SHA, source links, tests/CI/review and the A–F matrix.
Only call MERGE READY when the requested complete journey and established gates
pass. Do not merge or deploy. Missing operator/access/source evidence remains
BLOCKED or NOT TESTED, never an invented PASS.
