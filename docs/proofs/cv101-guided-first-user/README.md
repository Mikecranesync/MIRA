# CV-101 guided first-user evidence

November 6, 2026. Starting revision: `211e5c78e` (draft #5241).

**Practice journey: PASS. Authenticated live CV-101 journey: BLOCKED.**
This slice adds an account-footer walkthrough to the existing Hub adapter,
not another product or equipment pipeline. Nothing here was merged or deployed.

## Open the walkthrough

In a normal authenticated Hub session, open navigation, then **CV-101
walkthrough** in the existing account footer. The six numbered workflows,
**Steps**, **Previous/Next**, **Live evidence** and **Case study** are navigable.
Each workflow shows instructions, expected result, actual practice result,
evidence and a separately dated live result. An unknown account cannot open a
shared anonymous practice cache.

The real product mount is `HubAccountFooter` through the existing
`HubShellHost`. Its mount is regression-tested; a real authenticated host
journey has **not** been established in this environment. The captured browser
session below uses the actual Sidebar, Footer, walkthrough, SourceViewer,
Work Packet controls, event reducer and LivingSheetPrint in a labelled component
test harness. It supplies a synthetic viewer, not NextAuth or an API mock.

## Six-workflow acceptance checklist

Start a fresh practice inspection when reproducing. Use synthetic notes only.
All PASS results below concern the bounded practice, never the corresponding
live acceptance. Full original live evidence remains in
[the preserved CV-101 package](../cv101-asset-memory-acceptance/README.md).

| Workflow and steps | Expected | Actual result | Practice | Dated live result | Screenshots |
|---|---|---|---|---|---|
| 1. Open footer guide; select CV-101 practice asset. Real path is Projects → owner-confirmed project → machine link. | Explicit asset identity; no name-only join. | Selected synthetic `DEMO-CV101`; no real tenant/asset selection or sign-in. | PASS | BLOCKED: owner authentication and exact notebook binding unestablished. | [Desktop](workflow-1-desktop.jpg), [phone](workflow-1-mobile.jpg) |
| 2. Read all four component cards; open Micro820 reference. | Sources and unknown relationships visible. | Four historical cards, dashed relationship diagram and shared source viewer opened. Current physical identities remain unverified. | PASS | BLOCKED: component conflicts and current attachments unresolved. | [Desktop](workflow-2-desktop.jpg), [phone](workflow-2-mobile.jpg), [source](workflow-2-source-desktop.jpg) |
| 3. Read actual historical receipt; replay synthetic DI05 examples. | Source, timestamps and quality distinguished. | Three clearly synthetic raw samples; no polarity or motion inferred. Dated historical source remains stale. | PASS | FAIL: saved November 6 receipt had >12-hour-old PLC observations; no current acquisition baseline. | [Desktop](workflow-3-desktop.jpg), [phone](workflow-3-mobile.jpg) |
| 4. Play prepared question; open supporting citation and original document. | A claim links to its actual source. | Prepared reference identifies 2080-UM005 via 2080-IN009 page 6. Shared viewer and original Rockwell PDF opened; page 6 lists that publication. No MIRA generation/retrieval call. | PASS | BLOCKED: owner-authorized, asset-attached answer not proven. | [Desktop](workflow-4-desktop.jpg), [phone](workflow-4-mobile.jpg), [original PDF](original-manual-desktop.jpg) |
| 5. Create synthetic documentation review; check both steps; add unresolved note; finish. | Record actor/time, preserve unknowns, show same event history. | Existing Work Packet controls produced five events; finish retains the unresolved note; actual Living Sheet renderer previews the same record. No physical inspection or QC approval recorded. | PASS | BLOCKED: no genuine CV-101 technician closeout. | [Desktop](workflow-5-desktop.jpg), [phone](workflow-5-mobile.jpg) |
| 6. Start new practice session; retrieve; actually reload tab, reopen guide, retrieve again. | Same job, event sequence and unresolved note. | Same mobile job `demo-cv101-05643205-ef89-4810-80a6-82d7be247445`, change #5, before/after reload. Earlier desktop run independently retained its own same job. Local same-viewer browser storage only. | PASS | BLOCKED: server restart/new authenticated technician/Atlas continuity not proven. | [Desktop](workflow-6-desktop.jpg), [phone](workflow-6-mobile.jpg), [phone reload](workflow-6-reload-mobile.jpg) |

[Browser receipts and actual timings](browser-journey.json) retain the original
desktop run and subsequent phone/reload checks. Desktop action-to-observation
measurements were 379 ms selection, 1,540 ms component/source exploration,
1,820 ms prepared citation, 1,298 ms inspection and 1,165 ms reload/recall.
These are one local automated run, include browser/tool work and establish no
service SLA. Phone timings include interaction/inspection pauses; they are not
application latency benchmarks.

## Visual architecture and case study

The walkthrough's **Case study** contains the relationship diagram, saved
verified capabilities, unresolved facts and human actions:
[desktop](case-study-desktop.jpg), [phone](case-study-mobile.jpg).
Dashed physical links mean historical/reported, currently unverified.
The software flow shows the existing reader → authenticated relay → Postgres
history/graph → confirmed notebook/Living Sheet → MIRA/guide path, with an
explicit warning that not all links have been proved together.

[Live evidence screenshot](live-evidence-desktop.jpg) preserves the separate
BLOCKED/FAIL results. The original inventory, mappings, architecture, receipts
and real operator procedure are linked from every relevant workflow:
[inventory](../cv101-asset-memory-acceptance/inventory.md),
[procedure](../cv101-asset-memory-acceptance/procedure.md),
[SQL receipt](../cv101-asset-memory-acceptance/db-inspect-cv101.txt).
No historical claim has been refreshed into a current-condition claim.

## Negative checks and boundaries

| Check | Actual | Result / evidence |
|---|---|---|
| Denied storage write/read | Memory-only warning and FAIL; retrieval unavailable; no false saved claim. | PASS negative case: [screenshot](storage-denied.jpg), browser receipt. |
| Corrupt saved envelope | Refused as evidence; FAIL, no completed recall. | PASS negative case: [screenshot](storage-corrupt.jpg). |
| Different synthetic viewer | Could not retrieve viewer A's job. | PASS local scoping: [screenshot](viewer-isolation.jpg). This is not a server tenant-isolation proof. |
| Already-loaded component offline | Same local practice record retrieved; network restored afterward. | PASS local only: [screenshot](offline-local-recall-desktop.jpg). No cold offline load or original-source availability claimed. |
| Source focus/Escape | Initial Close focus; Escape closes source but retains outer dialog; focus returns to citation opener; closing walkthrough returns to footer launcher. | PASS desktop, actual DOM/focus receipt. External `dialog.close()` contract (the shell Back path) reproduced RED then GREEN; first close returns to citation, second closes guide and retains the same job. [Receipt](review-fix-browser.json), [screenshot](nested-source-back-desktop.jpg). Actual browser/hardware Back: NOT TESTED. |
| Responsive layout | Page/dialog width 412 px at 412×915; page 1440 px/dialog 1160 px at 1440×900. Sticky practice banner and Close remain visible. | PASS inspected screenshots/DOM metrics; no horizontal page overflow. |
| Network scope | Observed requests only loopback GET page/CSS/JS. | [Request audit](browser-requests.json), not truncated. Separate explicitly opened OEM tab excluded. No equipment/provider/Atlas requests. |

The practice namespace is browser-local and viewer-scoped, with strict bounded
record parsing. It contains synthetic asset/job IDs only. It does not import
or mutate a real notebook, work packet, tenant, equipment connection or Atlas
order. Completion never changes the fixed live acceptance results, promotes a
relationship or grants review/safety clearance. Browser-local storage is not a
secure server boundary; do not enter private workplace material.

## Reproduce the component proof

Use the existing locked dependencies and Node version for the Hub:

```sh
npm --prefix mira-hub ci
npm --prefix mira-hub test -- src/factorylm-ui/cv101-walkthrough-model.test.ts src/factorylm-ui/CV101Walkthrough.test.tsx src/factorylm-ui/HubAccountFooter.test.tsx src/factorylm-ui/LivingSheetPrint.preview.test.tsx
node docs/proofs/cv101-guided-first-user/build-preview.mjs /tmp/cv101-walkthrough-preview
python3 -m http.server 55821 --bind 127.0.0.1 --directory /tmp/cv101-walkthrough-preview
```

Open `http://127.0.0.1:55821/` in a browser. On a phone-sized viewport use
**Open navigation (preview control)**, then the real footer launcher. Follow
the table above. Query fixtures `?storage=denied`, `?storage=corrupt` and
`?viewer=B` exist only in `browser.tsx`, never the shipping footer. No hidden
storage manipulation or server authentication bypass was used. The original
manual link is
[Rockwell 2080-IN009 page 6](https://literature.rockwellautomation.com/idc/groups/literature/documents/in/2080-in009_-en-p.pdf#page=6).

Actual browser interactions used CUA. Final 1440×900 and 412×915 captures use
CUA CDP `Page.captureScreenshot` because its higher-level wrapper returned a
stale desktop canvas; corrected surface captures were inspected. Negative
shots and the original manual use their actual default 1280×720 view.
[Screenshot manifest](screenshots.json) records dimensions and SHA-256.
Every proof screenshot is also archived under `docs/promo-screenshots/`.

## Automated verification and limits

- [Full Hub run](full-unit.log): **595 files passed / 4 existing skips;
  13,160 tests passed / 53 existing skips**. Final focused run: 25 passed.
- [Scoped lint](lint.txt): zero errors; one unchanged `<img>` warning in
  LivingSheetPrint. No added dependency or framework.
- [Typecheck](typecheck.txt): **not green**; 159 existing diagnostics,
  byte-identical to the pre-UI baseline, SHA-256
  `1183f05bfa9611f78df9870ecacf249465c2c8cebf7a25817922755be8648ff3`.
- Full Next build **not verified locally**. Default build first could not
  fetch Google Inter, then failed Turbopack worker port binding in this
  environment. Alternate `--webpack` encountered unchanged optional
  `assistant-cloud/ai-sdk` peer resolution. No dependency/config workaround
  was introduced. [Default log](next-build.txt), [alternate log](webpack-build.txt).
- Early harness `process` reference error at 12:11 UTC was corrected before
  successful flows; retained in browser receipts. No error/warn after the
  final navigation cutoff at 12:13 UTC.
- No actual current telemetry, owner login, live MIRA answer, server restart,
  Atlas association/write, field operation or human acceptance occurred.
- Parent #5241 remains preserved at 211e5c78e, with its tracked low #5245
  unchanged. The new dependent draft must be reviewed separately; a non-main
  base does not clear main-base lifecycle/release gates.

## Remaining human actions

1. Sign in normally to the existing garage-owner workspace; establish the
   exact CV-101 project/asset binding. Do not send credentials.
2. Have the PLC-laptop owner identify the existing reader and provide fresh,
   timestamped per-tag values, source/quality and acquisition evidence.
   Stop if identity/freshness cannot be established. Do not change its
   configuration or start a competing poller.
3. Reconcile current controller/drive/motor/photoeye identity, serial settings
   and original manual attachments against the preserved inventory conflicts.
4. Only then execute the existing real acceptance procedure with an authorized
   technician. Physical operation, Atlas writes, merge and deployment each
   remain outside this mission's authorization.

The next acceptance test is owner-authenticated discovery plus a proven fresh
read-only baseline. The walkthrough is useful today as explicitly labelled
practice; the real six-workflow end-to-end journey remains blocked.

## Independent review correction pass

Fresh whole-branch review of211e5c78e..70e6d4aaf found two Important issues.
Both were reproduced before correction, then fixed in one pass:

- Resolution fields must be well typed and agree with the replayed note kind,
  actor, time and resolution. Three new regression cases failed first, then
  all16model cases passed, including a legitimate resolved-issue round trip.
- The native dialog consumes the shell-style direct close at the nested source
  before closing the whole guide. The component harness uses Alt+Left solely
  to reproduce the existing shell's `dialog.close()` contract, not to simulate
  a device Back implementation. Before: guide closed. After: source closes,
  outer guide stays open, citation regains focus and the same completed job
  remains; the second direct close returns to the launcher.

Parent behavior, live authentication/equipment/server/tenant proof, full build
and actual hardware Back remain outside this fresh review's verified scope.
The final independent exact-head/body PR review is recorded on GitHub; these
local fixes alone do not constitute that attestation.
