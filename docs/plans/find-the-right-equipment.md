# Step 1 — Find the Right Equipment

Plan revision: 1 — 2026-11-18. **Acceptance: NOT YET PROVEN.**
Parent: [capability roadmap](capability-roadmap.md).
Accountable coordinator: existing CHARLIE Codex integration session.
Evidence ledger: [#5232](https://github.com/Mikecranesync/MIRA/issues/5232).

## Outcome and scope

A technician can find the intended drive or Q1/MLC, tell it apart from a same-name
component elsewhere, open its correct record, and explicitly choose it as the
question target. The interface never silently changes that target or loses work
because a slow request finishes late.

The first acceptance covers direct notebook/component records through the connected
Hub, not just the fixture lab. Installed equipment without a verified notebook link
stays visibly unavailable (`no_link`); mapped B1–B12 belong to Step 5. Existing
recorded locations are shown honestly; absent locations are unknown. This step does
not claim that all factory hierarchy or installed-instance mapping is complete.

Generated-answer correctness, a complete work order, approved-memory recall and
live PLC data belong to later steps. Protect existing drafts, photos and conversations
while navigating now. Do not require paid inference just to prove finding/selecting.

## Starting evidence — refresh before execution

Snapshot inspected 2026-11-18; this table is history, not a live status service.

| Existing work | What is established | What remains for this step |
|---|---|---|
| [#5602](https://github.com/Mikecranesync/MIRA/pull/5602) | Direct children/search/resolve API merged as `ad6a0c422`; final reviewed head `ab0ed25ea`. | Reuse its contract and tests; qualify the final connected composition and intended transport. Do not restart its completed review. |
| [#5614](https://github.com/Mikecranesync/MIRA/pull/5614) | Shared paged navigator merged as `01207ec3c`. | A lab navigator is not connected Hub acceptance. |
| [#5625](https://github.com/Mikecranesync/MIRA/pull/5625) | Hub integration is open; observed head `99a410364617bf42a681ca7e08eae2b4c45080e0`. | Required current-head review/CI, real-route proof, enabled staging and physical acceptance. Prior round 3 at `1f5d2d9f5` found 1 HIGH, 4 MEDIUM and 1 LOW; do not transfer its verdict to the new head. |
| [#5617](https://github.com/Mikecranesync/MIRA/issues/5617) | Four navigator refresh/snapshot defects are explicit release blockers. | Required regressions, real-route scenarios, exact-head review and deployed tablet proof. A repair claim alone does not close the issue. |
| [Staging receipt](https://github.com/Mikecranesync/MIRA/issues/5232#issuecomment-6981192492) | Reported staging `01207ec3c`, API authentication refusal and retrieval acceptance. | Contains no connected #5625 tablet acceptance. Re-read `/api/version` and flags before testing. |

Source defect [#5600](https://github.com/Mikecranesync/MIRA/issues/5600) remains an
accepted-open HIGH. Navigation does not repair it. It does not prevent a no-answer
find/select walk; Step 2 must qualify the exact source/model before claiming a correct
answer. [#5624](https://github.com/Mikecranesync/MIRA/issues/5624) is the API's recorded
input-validation follow-up; retain its disposition rather than declaring no defects.

## Existing owners and next deliverables

| Session | Deliverable for this step | Boundary |
|---|---|---|
| CHARLIE Codex — integration | Freeze the composed candidate/configuration; reconcile findings and permissions; obtain real-route and independent device evidence; maintain the acceptance matrix and final decision. | Sole integration coordinator; preserve existing device leases and exact review bindings. |
| CHARLIE Claude — shared UI | Finish the current #5625 repair, preserving the shared navigator and existing checklist selection writer. Supply reviewable head, named regressions and the precise supported tap sequence. | Sole shared-UI writer; no second navigator or selection store. |
| CHARLIE Claude Fable — ontology/acceptance | Reconcile the identity contract and existing independent acceptance receipts. Identify missing FIND cases; run only a coordinator-assigned independent pass. | Do not duplicate the replacement verifier's completed API pass. Keep mapped B1–B12 out of the direct-path verdict. |
| BRAVO Codex — source/backend support | Supply attributable source/backend handoff and identify any dependency actually needed for FIND acceptance; refresh its existing status. | Mike's implementation stop remains in force. Status/read-only handoff only unless explicitly resumed. |
| BRAVO Claude — source/CI | Complete its existing source/CI handoff; identify which current CI or source defects affect this candidate versus Step 2. | Preserve active #5627/source work. Do not start a parser redesign or duplicate UI/API review. |

Owner references: [integration](https://github.com/Mikecranesync/MIRA/issues/5232#issuecomment-6870960483),
[UI](https://github.com/Mikecranesync/MIRA/issues/5232#issuecomment-6892397495),
[ontology](https://github.com/Mikecranesync/MIRA/issues/5232#issuecomment-6888188800),
[BRAVO Codex](https://github.com/Mikecranesync/MIRA/issues/5232#issuecomment-6883373082),
[BRAVO Claude](https://github.com/Mikecranesync/MIRA/issues/5232#issuecomment-6872204712).
These are durable roles, not claims that every session is currently running.

## Pass/fail contract

All rows are required. Until a receipt is linked against the final candidate, the
row is NOT TESTED for this milestone. Existing compatible receipts may be reused
with an explicit unchanged-code/configuration binding; rerun only affected proof.

| ID | Test and expected result | Required evidence |
|---|---|---|
| FIND-01 | Supported sign-in opens the actual Hub. Find drive and Q1/MLC using browse and supported search, without a developer-created URL or database repair. | Authenticated real-route walkthrough and physical tablet recording; actual component/notebook IDs in the private receipt. |
| FIND-02 | Two `VFD1` results in different locations remain distinguishable before opening. Selecting one never resolves the other. Q1 designation, MLC label and its confirmed catalog are not presented as the Micro820 PLC or as interchangeable identifiers. | Seed manifest plus row/route identity assertions and tablet screenshots. Synthetic locations are labelled as fixtures. |
| FIND-03 | Browse/search/resolve do not write selection. Opening another notebook requires a deliberate user action and protects any draft/attachment. The existing checklist's explicit selection tap selects the displayed current record; UI and server agree on notebook, component and revision. | Real HTTP/DB before-and-after selection receipts. No automatic send or hidden whole-machine fallback. Deliberate whole-machine selection remains distinct. |
| FIND-04 | Stale/refused records stay refused until explicitly refreshed. A late older refresh cannot replace a newer revision. Refusing revision 2 cannot make refused revision 1 askable again. | #5617 F10/F11 failing-before/passing-after regressions plus real-route sequence. |
| FIND-05 | Source change, closing the panel, leaving/returning to a conversation and remount invalidate obsolete navigation. A late resolve neither switches chats nor drops/retargets a draft/photo. A consumed refresh does not replay. A failed/stale checklist reload gives a visible recoverable outcome. | #5617 F12/F13 and #5625 review regressions; at least the stale-refresh, source-switch and remount scenarios through real routes; tablet draft/photo/cancel walk. |
| FIND-06 | Foreign-tenant, unavailable, deleted, stale and unlinked records cannot become a target. Matching `VFD1` labels cannot create links. No auth bypass, selection write or inferred mapping occurs during a GET. | Independent two-tenant API/database evidence, direct A1–A12 and applicable B0 no_link cases; explicit linkage to existing case definitions. |
| FIND-07 | Search/pagination can reach records beyond the first page without duplicates, omissions on a fixed dataset or foreign counts. Large hierarchies do not require fetching/rendering all records at once. | Reuse the existing 20,000 own / 2,500 foreign synthetic fixture. Record query count, bounded page size and timings; test first/middle/last pages. No production-scale claim from a local fixture. |
| FIND-08 | On the Galaxy Tab S9 FE, portrait and landscape with the real keyboard open: find, distinguish, open and select both components; controls remain tappable and visible. Rotation retains the valid target and work. Disconnect/reconnect produces recoverable error/loading states without silent selection. | Exact device/browser/build, screenshots or video, request trace and cleanup receipt. Record task time, mis-taps and assistance. No developer-console repairs. |
| FIND-09 | Approved candidate review/CI applies to the exact composition. The intended deployment serves that build with effective flags verified. Supported authentication and real DB/proxy behavior pass. Flag-off/rollback restores the prior supported path without altering saved work. | Coordinator's release packet, version/configuration receipt, required governance results, runtime proof and scoped rollback test. Only already-authorized release actions are executable. |
| FIND-10 | An independent tester reproduces the device result, then Mike or a named representative technician completes drive → duplicate-name choice → MLC → explicit selection → return to draft unaided. | Separate synthetic and human receipts, failures/assistance recorded, explicit acceptance decision. The writer's demonstration alone cannot pass this row. |

## Implement and verify in this order

1. **Bind scope and owners.** Each session acknowledges plan revision and its FIND
   rows. Coordinator refreshes #5625, #5617, current review allowances, staging and
   existing acceptance receipts. Resolve ownership through handoff, not inference.
2. **Finish the current repair.** UI owner continues #5625. Preserve Mike's chosen
   deliberate Open/checklist handoff. Closing the panel cancels the handoff. Write
   the remaining findings as regressions before claiming closure. No feature expansion.
3. **Freeze one integration packet.** Record full SHA, base, reviewed body digest,
   included fixes, build/image, effective flags, database/migrations, source binding
   and rollback. Link any new or inherited finding to its disposition and owner.
4. **Run real integration.** Exercise FIND-03–07 against the actual routes, normal
   cookies and intended schema/transport. Browser mocks remain unit/UI evidence;
   they cannot satisfy a real-route row. Include supported session expiry and abort
   cleanup where the existing API contract requires them.
5. **Deploy within the recorded grant, then walk the tablet.** First verify URL,
   `/api/version`, flags and device lease. Use supported UI to establish the drive
   and MLC records. Keep larger scale fixtures in their authorized isolated scope;
   do not seed the live tenant with thousands of fake components.
6. **Review the evidence and accept.** Coordinator links every FIND row to PASS,
   FAIL or NOT TESTED, resolves contradictions, and requests Mike's capability
   acceptance only when the complete result is reviewable. Any missing required
   proof keeps Step 1 current. Record Step 2 as next, not already complete.

## Reuse points

Existing main-branch suites:

- `packages/factorylm-interaction/src/__tests__/equipment-paged.test.ts`
- `apps/factorylm-ui-lab/src/__tests__/paged-equipment.test.tsx`
- `mira-hub/src/capabilities/equipment-browser/__tests__/http.integration.test.ts`
- `mira-hub/src/capabilities/equipment-browser/__tests__/tenant-read.integration.test.ts`
- `mira-hub/src/capabilities/equipment-browser/__tests__/pooler-cancellation.test.ts`
- `mira-hub/src/capabilities/bench-components/__tests__/store.integration.test.ts`

The active #5625 adds the Hub adapter and
`mira-hub/tests/e2e/equipment-nav.spec.ts`. Its mocked browser responses do not
replace the live-route proof above. These are reuse pointers, not new ownership
claims or an instruction to run every repository test repeatedly.

## Evidence packet and completion decision

Use the existing integration packet and #5232 ledger. For each FIND row record:
candidate SHA/configuration; test/operator/date; synthetic or human; real or mocked
dependencies; expected/observed result; receipt link/hash; defect/owner; cleanup.
Keep account identifiers and private screenshots out of the public repository.

**Step 1 is done only when FIND-01–10 have passing, compatible evidence, required
release blockers are closed, and Mike's acceptance is recorded by the coordinator.**
This is capability acceptance on the named environment. Production rollout and
FIELD-VERIFIED remain separate under existing policy; do not fabricate those cells.
No source-model exception, silent waiver or skipped tablet case can stand in for a
required FIND result. If Mike changes scope, revise the plan explicitly and preserve
the failed or excluded result.

After acceptance, make **Open Its Workbench** current and write its detailed
contract from the same template. Carry #5600 and other source limitations forward
with the exact approved scope before running answer acceptance.
