# CV-101 real-equipment Asset Memory acceptance

**2026-11-06 — BLOCKED; NOT MERGE READY.** This replaces PUMP-01 as the
requested field-acceptance case for [PR #5241](https://github.com/Mikecranesync/MIRA/pull/5241).
The PUMP-01 receipts remain valid historical synthetic-QA integration evidence;
they do not establish anything about CV-101. No product implementation changed
in this acceptance audit. Audited candidate: `300685118582f14e5bef3c049939e5baf8fc3780`;
main/staging: `090c8e15bfcbd85f0091103cf5a6f5fc6b221056`.

The actual production version endpoint reports `489088d4cc0f8d16c02036df891752120a0250da`
(v3.443.1). Neither production nor staging is asserted to contain this draft.

## What this attempt established

- Production's existing asset is `64a24de7-2809-4c35-b4fe-202be80393d6`, in the
  garage tenant `e88bd0e8-8a84-4e30-9803-c0dc6efb07fe`, labelled **Discharge
  Conveyor / CV-101**. Its verified KG bridge uses that CMMS UUID and canonical
  address `enterprise.home_garage.conveyor_lab.conveyor_1`. A different tenant
  also has a CV-101; the display name is insufficient identity.
- The cross-tenant CV-101-name query returned one confirmed notebook row,
  “Sensor v0 overnight 2026-08-28”, with three sources, but omitted its tenant,
  asset UUID and notebook UUID. **Its association with the garage asset remains
  unverified.** The probe also does not establish current source bytes,
  citations, component edges, viewer turns, Living Sheet jobs or Atlas links.
  Those require the authenticated owner journey. The historical three-source
  seed used authored print packs, not original OEM manuals.
- A real SELECT-only production inspection saw `plc_bridge / cv101-bench-modbus`
  with **721 rows and 721 observation timestamps**, spanning about one hour.
  Its newest observation was **2026-11-05 22:25:02.165Z**, received at
  **22:25:02.706139Z**. This is newly established persisted cloud history,
  superseding the November 2 report of `accepted:0`. It is **not** current
  telemetry, an operator-correlated transition, or a verified end-to-end tenant/
  tag/quality check: this grouped query does not include those fields.
- At server time **2026-11-06 10:32:00.318324Z**, that observation was already
  over **12 hours old**. Ignition `cv101-bench-gw` supplied 72 receipts but only
  two source timestamps, newest **2026-11-04 01:45:41Z**, despite receipts up to
  **2026-11-05 22:58:57.993116Z**. There are no receipts newer than that in the
  returned group: this cannot establish current machine state. The grouped
  timestamp pattern is compatible with replay, but alone cannot distinguish
  a frozen producer from legitimate Ignition report-by-exception timestamps.
  The query lacks per-tag value churn, acquisition clock and quality. Receipt
  counts or `simulated=false` cannot fill that gap. Per-row ratios are not a
  general multi-tag scan metric.
- The prior historian GETs at `100.72.2.99:8766` returned connection refused;
  the current credential-reference `PLC_LAPTOP_URL` resolves to a different
  private address and its health GET timed out. Neither proves the whole
  laptop is down. The retired `api.factorylm.com` name does not resolve here.
- Normal browser navigation reaches the real production sign-in page. No
  garage-owner session or configured owner-login reference was available.
  No password reset, account creation, tenant-header override or session
  minting was used. QA tenant99 credentials were not reused for this tenant.

Primary fresh receipt: [db-inspect run 42202828348](https://github.com/Mikecranesync/MIRA/actions/runs/42202828348).
It was **cancelled at its existing five-minute job timeout**, after identity,
schema and scoreboard queries succeeded and telemetry sections A/B returned.
Sections C–H did not complete; skipped/unfinished output is not a negative
result. [Sanitized extract](db-inspect-cv101.txt), [endpoint timings](endpoints.json),
and [machine-readable status](acceptance.json) retain the actual observations.
The full log stays outside git because it contains unrelated tenant records.

The existing dedicated live gate is `disabled_manually`; dispatch returned
HTTP422 “Cannot trigger a workflow_dispatch on a disabled workflow.” Nothing
ran. It was not enabled or replaced with code-session production SQL. The
sanctioned `db-inspect.yml` was the read-only fallback, not a new telemetry path.

## Acceptance matrix

PASS means the stated subcheck has direct evidence. BLOCKED means a required
dependency prevents execution. FAIL means an executed requirement did not hold.
NOT TESTED means no attempt was made. No scenario is promoted from a code test.

| Scenario | Status | Actual result / next dependency |
|---|---|---|
| A — asset identification and MIRA topology/manual answer | **BLOCKED** | Garage cloud asset identity/UUID/UNS/KG bridge subcheck PASS. Exact notebook association, current physical inventory, component/manual navigation and actual MIRA answer remain unproven; owner authentication and identifier reconciliation required. |
| B — current equipment state | **FAIL** for fresh baseline; **BLOCKED** for answer comparison | Timestamped production history is stale. Bench reader unavailable here. No current PLC inputs, drive readings, photoeye polarity, quality or actual MIRA response was established. |
| C — observed physical transition | **NOT TESTED** | No operator confirmation and no fresh baseline. No controls were touched. Follow the staged operator procedure only after both prerequisites pass. |
| D — real technician maintenance observation | **BLOCKED** | No current physical observation or owner session. Nothing was invented or written as technician work. A factual “feed unavailable” report may be recorded by the authorized technician, separately from machine condition. |
| E — fresh-session recall / persistence / tenant isolation | **BLOCKED** | Actual anonymous CV-101 context/documents/memory reads return401. No CV-101 observation was created, and owner/cross-tenant/restart journey cannot run. Existing PUMP-01 restart/isolation tests and CV-101 offline tests are supporting software evidence only. |
| F — genuine Atlas test job continuity | **BLOCKED** | No actual authorized CV-101 Atlas asset/work-order mapping or order navigation was read. No synthetic PUMP order, numeric-ID guess, new order or finish dispatch was substituted. |
| Industrial no-control boundary | **PASS for this audit's actions** | Existing REST GETs, version reads, repository/history reads and sanctioned SELECT-only workflow only. No PLC socket, serial master, poller start, ingestion POST, logic/parameter change or physical operation. This does not certify equipment safety. |
| Independent complete evidence chain | **NOT TESTED** | There is no complete physical chain to approve. Two independent read-only source/history audits support this blocked assessment; they are not field acceptance or the authoritative final PR review. |

## Deliverables and architecture

- [Inventory, topology, actual/configured tag mappings and source conflicts](inventory.md).
- [Executable, progressive operator and application acceptance procedure](procedure.md).
- [North Star](../../NORTH_STAR_ASSET_MEMORY.md) and
  [existing capability/source-of-truth inventory](../../discovery/2026-11-06-asset-memory-inventory.md).
- Existing [software fix/test/build evidence](../asset-memory-5241-continuation/verification.md).
  #5242/#5243/#5244 are implemented there. That evidence remains scoped to its
  exact revision and synthetic QA case; it cannot satisfy this real journey.
- Current [focused regression receipts](tests.txt):148 passed, two existing
  Docker-render checks skipped because Docker Compose is unavailable. These
  are offline tests of the existing gate, reader, ingest and identity contracts,
  not live integration or physical acceptance. No code changed in this audit.
- Actual [authentication-blocker screenshot](auth-required.jpg). No equipment,
  source passage, guide, chat, physical transition or Atlas screenshot was
  fabricated to fill an inaccessible stage.

## Minimal gaps: reuse / connect / repair / defer

| Disposition | Smallest next action | Owner / gate |
|---|---|---|
| Reuse | Existing CMMS UUID, verified KG bridge, confirmed notebook, source membership, append-only Living Sheet, bounded Asset Memory projection, Atlas outboxes/status | No new database, graph, registry, event store, pipeline or framework. |
| Connect | Authenticate the existing garage owner; read components, documents, notebook/jobs and provider mappings by stable IDs | Mike/account owner. Normal sign-in only; no access expansion or QA identity substitution. |
| Repair access | PLC-laptop owner establishes the current existing reader/address and fresh source-clock/quality baseline | Existing restoration ownership, [#5110](https://github.com/Mikecranesync/MIRA/pull/5110), [#3161](https://github.com/Mikecranesync/MIRA/issues/3161). No competing poller, second serial master, allowlist/config/deploy change in this audit. |
| Reconcile | Compare the installed PLC identifier and existing reader mapping with the contradictory photos/transcriptions/program revisions; confirm physical PE-101 and applicable original manuals | Authorized operator/source owner. Seed confidence and “manual” upload role are not physical/OEM verification. |
| Connect | Capture one actual observation via the existing interface; pin job/event sequence, component/source references, actor and clocks; follow existing work-order association/readback | Requires A/B and owner access. Do not reopen finished execution or resend finish for later QC. |
| Verify | Replay after a new session and candidate process restart in authorized dev/staging, compare chat/sheet/guide and source navigation; independently review the complete chain | No production restart, candidate deployment or merge implied. |
| Defer | Wider telemetry, graph promotion, legacy seed cleanup, scaling/schema changes, automatic reusable acceptance, fleet context and architecture work | Record discrepancies here; no demonstrated software defect requires those changes to proceed with the existing path. |

## Precise stop condition

Mike's mission explicitly says to stop when a physical/access dependency requires
him. That condition is reached: **garage-owner sign-in plus an accessible fresh
existing equipment reader** are missing. The exact phased checklist is in
[procedure.md](procedure.md). A normal transition is not yet requested. Leave
the conveyor stopped while access and source freshness are established.

No merge, deployment, production configuration change, migration, graph seed,
new service, purchase or physical control operation occurred. Production data
was read only through the repository-authorized inspection workflow. This
blocked record is evidence for the next attempt, not human acceptance.
