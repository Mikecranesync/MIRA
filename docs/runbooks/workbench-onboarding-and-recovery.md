# Runbook: onboard one bench component and recover its record

**Status:** DRAFT 2026-11-14. Written before any run under it. Nothing in this file is a test result.
**Tracker:** #5232 (lane report: comment 6872204712). **Plan:** `DELIVERY.md`.
**Use it for:** taking one installed component of the workbench from "nothing in the app" to "a
second technician can reopen the record after a restart", the same way every time, and for
recovering when a step fails.

This runbook adds no test framework. It orders steps that already exist and says what to record:

| Existing asset | What it gives this runbook |
|---|---|
| CV-101 journey scenarios S1 to S17 (draft PR #5336, `mira-hub/tests/stranger-walk/cv101-journey.scenarios.md`) | The step wording, expected results and backend traces for project setup, answer, citation, job, restart, failed upload, cancel |
| Component checklist and confirmation card (draft PR #5504) | Selecting a component, confirming what its label says, "Save, not confirmed", "Retake", the look-alike warning |
| `tools/mobile-e2e/` and the `mobile-device-acceptance` skill | Driving the real phone or tablet, proving the installed build, phone etiquette, evidence rules |
| Pending-manual recovery and setup retry (#5312, #5326, #5344, #5353, merged) | The visible controls used in the recovery section |
| Integration acceptance matrix (integration owner, 19 seed keys) | Where each item's verdict is entered. This runbook does not keep a second matrix |

## 1. Ground rules

1. **The screen is the only way in.** State changes are made with controls a technician can see:
   taps, typing, the file picker, the camera. No request sent by hand, no database edit, no
   seed run to make a step pass. If a record is wrong, the step FAILS and the defect goes to its
   owner (section 7). Read-only traces are allowed and wanted.
2. **Equipment is read-only.** The conveyor stays stopped. Nothing in this runbook operates,
   resets or writes to the PLC, the drive or any device. Photos of labels are taken with power
   state unchanged.
3. **Synthetic is labelled.** A run driven by an agent is `SYNTHETIC TECHNICIAN`. A synthetic
   photo says SYNTHETIC in the picture. Human acceptance is a separate row and is never filled in
   by an agent.
4. **Verdicts:** PASS, FAIL, BLOCKED, NOT TESTED. A screen that loaded, or an HTTP 200 alone, is
   never a PASS. An honest refusal is recorded as a refusal, not as coverage.
5. **Authority.** Merge, deploy, staging writes outside the screen, stored-manual reprocess,
   device use and paid runs each need the owner's own word for that run. The device is used only
   by, or with, the device lease holder.
6. **Expectations are written before the run** and are not edited afterwards to match what
   happened.

## 2. Freeze record (fill in once per run, before step O1)

| Field | Value |
|---|---|
| Candidate commit (40 hex) and Hub version | |
| Included changes not yet on main (PR, head, body hash) | |
| Environment and its config (flags that differ from default) | |
| Runtime generation / deploy run id | |
| Device: model, OS, serial suffix; browser or app build and its hash | |
| Operator (person or agent session) and device lease holder | |
| Account used (role only, never the address) and tenant kind | |
| Source files: name, bytes, SHA-256, page count, revision printed on the cover | |
| Spend bound for this run and what it covers | |
| Rollback point | |

## 3. Identity record for the component (fill in before step O4)

Three facts are kept apart. They are often different, and mixing them is how a wrong manual gets
attached.

| Fact | Meaning | Where it comes from |
|---|---|---|
| **Local label** | What is written on or beside the device on this machine | A photo of this device |
| **Catalog type** | Maker and full catalog number printed on the part | The part's own nameplate |
| **Installed role** | What the part does in this machine | The print set, the program, a technician's confirmation |

Plus: **unresolved installation facts**, listed and left open. They are never filled in from a
manual.

Worked example, from `plc/conv_simple_electrical/model/devices.yaml` (tag `Q1`):

| Fact | Q1 |
|---|---|
| Local label | "MLC", hand-written on the device. Schedule tag Q1 |
| Catalog type | Schneider Electric TeSys CA3KN22BD control relay, 24 V DC coil, 2 NO + 2 NC |
| Installed role | Single-phase 230 V supply switch for the drive VFD1, through NO contacts 13-14 and 43-44; coil from PLC output O-02 |
| Unresolved | Where 13-14 and 43-44 land in the control circuit. Whether breaker CB1 exists, its type and rating. NC 21-22 and 31-32 appear unused |
| Hazard line the answers must carry | Q1 is not a safety-rated disconnect; lock out at CB1 (print set) |

The trap this example shows: the label says "MLC" (a contactor's name), the part is a control
relay, and the role is a supply switch. A search for a contactor manual would be wrong; the
catalog type decides which document applies, and the role decides which questions matter.

## 4. Onboarding steps

Run them in order for one component. "Ref" is the existing scenario to follow for exact wording.
Take a screenshot after every step and read it.

| Step | Do (visible controls only) | Expected | Ref |
|---|---|---|---|
| O1 Sign in | Fresh supported sign-in on the device. Not a reused session | Lands in the app as the stated role | mobile-e2e |
| O2 Create project | New project, choose the machine, go as far as review, then Cancel. Then do it again and create | Cancel creates nothing. Create opens a project titled with the machine | S2, S3 |
| O3 Capture evidence | Take or attach the label photo for the component. Attach the source document through the file picker | Photo is on the record. The document shows a truthful state while it is read | S3, S10 |
| O4 Confirm identity | Open Components, pick the component, read the card against the photo, then Confirm. Once, use "Save, not confirmed" first and check it reads as not confirmed | Card shows local label, what it is, what the label says, full catalog number. Header reads "Asking about" that component. A near-miss number raises the look-alike warning | #5504 |
| O5 Approve sources | Attach the document that applies to the catalog type. Then try one that does not apply (sibling model or other revision) | The applicable one becomes a source. The other is refused by name, with no value taken from it | S6, #5510 |
| O6 Readiness | Read the project's own readiness wording before asking anything | It says what it can and cannot answer from. An unconfirmed component says manuals are not checked yet. No "ready" while a document is still being read | S3, S4 |
| O7 Correct an ambiguity | Select the wrong component on purpose, ask, then correct the selection. Change the selection on a second screen and try to send from the first | The answer is tied to the component shown in the header. After correction the next answer uses the corrected one. The stale screen is told the component changed | #5504 |
| O8 Open the exact page | Ask the component's reference question (section 5). Open the first citation in the device's own viewer | Answer names the right value, carries that page's own cautions, cites document and page. The viewer opens that file at that page. Record PDF page and printed page against the file hash | S5, S5c |
| O9 Save work | Job sheet: title, start a job, add a note, take a photo | Job shows saved, with the note and the photo attached to that job | S10 |
| O10 Restart | Close the app or browser fully, reopen, open the project, new chat, open the job | Same machine, component, sources, job, note and photo. Review labels match the stored record | S11, S12 |
| O11 Second technician | A different account with access opens the same record on another device or after sign-out | Sees the same confirmed identity, sources, job, note and photo, and who recorded them. Sees nothing from projects it has no access to | DELIVERY.md |

## 5. Reference question per component

One question whose answer is on a known page of a known file, checked against the file's text
before the run. Chosen so a wrong document or a wrong variant gives a visibly wrong answer.

| Component | Reference question | Expected | State |
|---|---|---|---|
| VFD1, GS11N-20P2 (baseline) | Which parameter controls acceleration time; explain and cite the page; recommend no setting | P01.12; GS10 manual Rev C printed page 4-69 (PDF 139); that page's cautions | Defined (S5) |
| Q1, CA3KN22BD | To be keyed from the attached datasheet's own text before the run: the coil voltage and the conventional thermal current of this catalog number, and whether Q1 may be used as the lockout point | Values from the datasheet page, cited; the lockout answer is no, with the print set's CB1 line | NOT KEYED. Needs the datasheet file and its hash from the coordinator |
| Others | Keyed when the item is agreed and a document exists. An item with no document gets the refusal check only | | NOT KEYED |

## 6. Recovery checks

Each is a deliberate failure followed by recovery through a visible control.

| Check | Cause it | Expected | Ref |
|---|---|---|---|
| R1 Upload fails | Connection drops during the upload in setup | Truthful error. A visible control retries. One source afterwards, not two | S16 |
| R2 Attach fails | File saved, but adding it as a source fails | Truthful error. A control in the project attaches it. One source | S16b |
| R3 Still reading | Open the project while the document is being read | It is shown as pending, then attaches itself when ready. A failed read is shown as failed, not as still reading | #5312, #5316 |
| R4 Upload again | Use "Upload again" on a pending document | Approval and source state survive. The just-attached document is not listed as missing | #5322, #5325 |
| R5 Cancel setup | Cancel at each setup screen | Nothing is created | S2 |
| R6 Cancel an answer | Send, then Stop | The turn reads stopped. No false "answered" | S17 |
| R7 Offline note | Go offline, add a note, reconnect | The note is kept and sent once, or truthfully held. Never silently lost | S15 |
| R8 Sign out | Sign out with a pending upload and an unsent note | The next account on the device sees none of it. The first account, signing back in, gets a truthful state of what was kept | #5297, #5311 |
| R9 Large manual | Open a project holding the full-size manual; ask twice; open citations; repeat while another upload runs | No restart of the service, no dropped pages, memory within the existing limit | #5289 |
| R10 Danger | Report smoke or arcing at the component | Stop first. No troubleshooting steps before it | S8 |
| R11 Wrong tenant | From a second tenant, try to open the record by its link | Refused. Nothing shown | DELIVERY.md |

When a check fails, stop that check, keep the screenshots and traces, and file the defect
(section 7). Do not repair the record by another route and carry on as if it passed. A later
step that depends on the failed one is BLOCKED, not PASS.

## 7. Where defects go

A defect found here goes to the lane that owns that behaviour. Check the current owner on #5232
before filing; the table is a starting point, not a claim.

| Area | Starting reference |
|---|---|
| Component selection, confirmation card, switching | PR #5504 and its owner |
| Which document or section applies to which variant | #5503 / PR #5510; #5484 / PR #5500; #5343 |
| Own-machine print set refused | #5514 / PR #5517 |
| Project setup, pending manual, upload retry, sign-out marker | #5302, #5308, #5315, #5316, #5322, #5325 (this lane) |
| Hazard line from the cited page not restated | #5370 |
| Citation markers and source numbering | #4750 |
| Citation viewer on the tablet | #5511 / PR #5532 |
| Large-manual stability | #5289 |
| Saved-evidence recall | #5328 and the recall owner |

## 8. Receipt (one per component per run)

```text
[ONBOARDING-RECEIPT] component key: <seed key>; run id: <id>; label: SYNTHETIC TECHNICIAN | HUMAN
Freeze record: <link or path>          Identity record: <link or path>
Steps:   O1 .. O11  -> verdict each, screenshot path each
Checks:  R1 .. R11  -> verdict each, screenshot path each
Citation: file SHA-256, PDF page, printed page, opened in <viewer>
Provenance kept: document id and page on every cited statement: yes | no (which)
Unresolved installation facts still open: <list>
Effort: minutes from O1 to O10; taps and typed fields counted from the recording
Interventions: <count>; each one: step, what the operator had to do that a technician could not
Defects filed: <issue links>           Spend: <amount, kind>
Human acceptance: NOT DONE | <who, when, link>
```

**Effort and interventions.** An intervention is anything outside the visible controls, or any
help a technician at the bench would not have: a retry the screen did not offer, a reload to get
past a stuck state, a hint about which document to pick, a fix by someone else. Zero
interventions is the target; every one is listed, with the step it happened on.

## 9. Order of work

1. VFD1 (GS11N-20P2): the regression baseline. Re-run O1 to O11 and R1 to R11 first on every new
   candidate, so a later item's failure can be told apart from a regression.
2. Q1 (hand-labelled MLC).
3. The remaining items the coordinator agrees, by seed key from the provisional inventory in
   PR #5504 (`mira-hub/scripts/data/cv101-provisional-inventory.json`). That list is provisional:
   one PLC or two, and whether the reducer belongs to this conveyor, are open.

## 10. What is not established yet (2026-11-14)

- No run has been made under this runbook. Every step and check is NOT TESTED for every item.
- The drive baseline rests on a limited human-reported pass held by the integration owner; it
  does not cover saved work, restart, a second technician or the recovery checks, and the wider
  campaign (#5458) still reads NO-GO.
- The component screen (PR #5504) is not merged or deployed. Steps O4 and O7 cannot run until a
  candidate includes it.
- Q1's reference question is not keyed; its datasheet file and hash are not recorded here.
- Device lease holder, candidate build and the agreed inventory are the coordinator's to state.
- Offline, long-duration and production acceptance are separate stages and are not covered.
