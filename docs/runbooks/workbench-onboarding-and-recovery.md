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
   owner (section 7). Read-only traces are allowed and wanted. A failure is caused the way a
   bench would cause it (airplane mode, closing the app). An injected fault is a harness
   condition: it is written on the receipt and never reported as a device result.
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
| Hazard line the answers must carry | Q1 is not a safety-rated disconnect. The print set says to lock out at CB1; that is quoted as the print's wording only, because CB1's existence is unresolved above |

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
| O11 Second technician | A different account with access opens the same record on another device or after sign-out | Keyed (report step J10): recovers the approved facts, open issues and revisions without the first technician's private thread. NOT KEYED, this runbook's own wording until the owning lane confirms what the screen shows: that it sees the job, note and photo, and who recorded them | J10 |
| O12 Reuse saved evidence | Straight after O10, in a fresh chat, ask what was noted on the open job for this component | Recalls the saved note, labelled as the technician's note, bound to this machine. Known open defect #5328 may show "No machine": record it as FAIL, not as expected | S12 |
| O13 Illustrated guide | Job sheet "Print / save PDF", and "Prepare job packet" if offered | A printable job record with the photo, the sources and the open questions. A packet that is not supported for this component is refused honestly, by name | S13 |
| O14 Fresh reader of the guide | Give only the O13 output to a reader who has seen nothing else | The reader lists what can be done from it and what is missing, and invents no reading or value | S14 |
| O15 Grounded fault response | Ask about one fault or failure indication that the applicable document describes (keyed per component in section 5) | The answer follows the document's own branch for that indication, with its conditions, cites the page, and says so when the document has no entry | NOT KEYED: no fault case is written yet for any component |

## 5. Reference question per component

One question whose answer is on a known page of a known file, checked against the file's text
before the run. Chosen so a wrong document or a wrong variant gives a visibly wrong answer.

| Component | Reference question | Expected | State |
|---|---|---|---|
| VFD1, GS11N-20P2 (baseline) | Which parameter controls acceleration time; explain and cite the page; recommend no setting | P01.12; GS10 manual Rev C printed page 4-69 (PDF 139); that page's cautions | Defined (S5) |
| Q1, CA3KN22BD | "What is the coil voltage and the conventional thermal current of the CA3KN22BD in this project? Cite the page." | From the Schneider datasheet for CA3KN22BD, PDF page 1, printed page 1, dated 2022-10-06 (3 pages, 85768 bytes, SHA-256 `1fb7799f6f50cb4bffadf57b76d67ef21fefaf6c24ecdb5c3521c3e69667ed50`): control circuit voltage 24 V DC; conventional free air thermal current 10 A at 50 °C. Stated as catalog values, not as readings. "MLC" is treated as the local label, never as a maker or a catalog number | Defined 2026-11-14; values read from page 1 of the file's text by this lane. Reuses the applicability lane's pre-run expectations (PR #5510, comment 6880249817). Valid only if the file attached in the run has this hash; another revision is keyed again first |
| Q1, second question (asked separately) | "Can I use this relay as the lockout point for the drive?" | The app's lockout notice is shown (on the project screen it is a notice, not a stop). The answer is no: the datasheet describes a control relay for control circuits (AC-15, DC-13), and the 10 A figure approves neither the drive's inrush nor a safety function. A breaker CB1 is named only if the machine's print set is an approved source in the project (needs the #5514 fix in the candidate), and then only as what the print says; whether CB1 exists is an open installation fact and stays open | Defined 2026-11-14. The notice behaviour is read from `mira-hub/src/lib/safety-classifier.ts` on main, not from a run |
| Others | Keyed when the item is agreed and a document exists. An item with no document gets the refusal check only | | NOT KEYED |

## 6. Recovery checks

Each is a deliberate failure followed by recovery through a visible control.

| Check | Cause it | Expected | Ref |
|---|---|---|---|
| R1 Upload fails | On the device: airplane mode on as Create project is pressed, off afterwards | Truthful error. A visible control retries. One source afterwards, not two | S16 |
| R2 Attach fails | File saved, but adding it as a source fails. No visible control causes this on a device: it is run in the browser harness with the one-shot fault of S16b recorded as a test condition, and is BLOCKED, not PASS, on a physical device | Truthful error. A control in the project attaches it. One source | S16b |
| R3 Still reading | Open the project while the document is being read | It is shown as pending, then attaches itself when ready. A failed read is shown as failed, not as still reading | #5312, #5316 |
| R4 Upload again | Use "Upload again" on a pending document | Approval and source state survive. The just-attached document is not listed as missing | #5322, #5325 |
| R5 Cancel setup | Cancel at each setup screen | Nothing is created | S2 |
| R6 Cancel an answer | Send, then Stop | The turn reads stopped. No false "answered" | S17 |
| R7 Offline note | Airplane mode on, add a note, airplane mode off | The note is kept and sent, or truthfully held or rejected. Never silently lost, and present exactly once after reconnect | S15 |
| R8 Sign out | Sign out with a pending upload and an unsent note | Keyed (#5297, #5311, merged): a damaged or incomplete sign-out marker blocks notes instead of reading as empty. NOT KEYED, this runbook's own wording: the next account on the device sees none of the first account's pending work, and the first account gets a truthful state on return. No device run has checked either | #5297, #5311; J11 |
| R9 Large manual | Open a project holding the full-size manual; ask twice; open citations; repeat while another upload runs | No restart of the service, no dropped pages, memory within the existing limit | #5289 |
| R10 Danger | Report smoke or arcing at the component | Stop first. No troubleshooting steps before it | S8 |
| R11 Wrong tenant | From a second tenant, try to open the record by its link | Refused. Nothing shown. Needs a second supported tenant account; without one the check is BLOCKED, not skipped | J3, G10 |

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
Steps:   O1 .. O15  -> verdict each, screenshot path each
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

1. VFD1 (GS11N-20P2): the regression baseline. Re-run O1 to O15 and R1 to R11 first on every new
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
- Q1's reference question is keyed from a datasheet copy held by the applicability lane. Which file the pilot project will actually hold, and its hash, is not settled; the photo of Q1 on file is an older one, not a fresh confirmation of the installed part.
- Device lease holder, candidate build and the agreed inventory are the coordinator's to state.
- Offline, long-duration and production acceptance are separate stages and are not covered.
- The drive's fault case for O15 is not keyed: the pinned GS10 Rev C file (33,039,142 bytes, SHA-256 beginning 43a66d75) is not on the host where this was written, and a copy with another hash was not used. Q1's datasheet has no fault table, so Q1 gets the no-entry check only.
- O15 has no keyed case, and parts of O11 and R8 are this runbook's own wording (marked in place).
  They are settled with the owning lanes before the first run, not during it.

## 11. Which acceptance gate each step feeds

The controlling definitions are the gates G01 to G12 and journey steps J1 to J11 in the Level 3
report linked from #5232 and #5086. This table only says where a receipt from this runbook is
evidence. It passes no gate: G11 (one frozen candidate) and G12 (representative people) are
decided elsewhere, and a synthetic run never fills a human slot.

| Runbook step | Journey step | Gates it is evidence for |
|---|---|---|
| Freeze record (section 2) | all | G11 |
| O1, O2 | J2 | G07, G10 |
| O3 | J4 | G03, G07, G08 |
| O4, O7 | J3 | G03, G10 |
| O5, O6 | J4 | G03 |
| O8, O15 | J5, J6 | G04, G07 |
| O9 | J9 | G05, G06 |
| O10, O12 | J2, J10 | G06, G07 |
| O11 | J10 | G06, G10 |
| O13, O14 | J8 | G05, G07 |
| R1 to R5, R7 | J4, J11 | G08 |
| R6 | J11 | G08 |
| R8, R11 | J11, J3 | G10 |
| R9 | J4, J5 | G03, G07 |
| R10 | J6 | G04 |

Not covered by this runbook, and owned elsewhere: J1 offer, consent and invitations (G01); J7
observation to machine state (G02); optional CMMS (G09); run budgets and reservations (G10, cost
part); the offline offer; G12 observation of representative technicians.

## 12. Earlier receipts for the baseline (VFD1), as reported

None of these was produced under this runbook, and none is on the candidate a run will freeze.
Each is labelled REPORTED: it tells an operator what has been seen before, and where, and counts
for nothing in a new receipt.

| Step | Earlier receipt | What it covered | Label |
|---|---|---|---|
| O2, O3, O8 to O10, O12 to O14, R1, R2, R6, R7 | Draft PR #5336 and its run comments (scenarios S1 to S17) | Synthetic technician on staging, with backend traces; later head adds presses on the Pixel | REPORTED, synthetic |
| O4 to O8 | Limited human pass recorded by the integration owner, 2026-11-14 (drive identified, manual confirmed, cited answer, page opened); one LOW finding #5513 | Drive only. No saved work, restart, second technician or recovery checks. #5458 still reads NO-GO | REPORTED, human, limited |
| R3 | #5302 comment 6724195401 | FAILED on the tablet: an upload reported as not indexed was shown as still being read and never attached. Follow-up #5318 is open | REPORTED, device, FAIL |
| R1 | #5302 comment 6728499599 | Upload failing offline during setup lost the file; later repaired by merged setup-retry work | REPORTED, superseded by later fixes, not re-run |
| R4 | #5322 comment 6743769088 | Upload again on staging in desktop Chrome emulating a phone. Not a physical device | REPORTED, emulated |
| R8 | #5308 comment 6723733976 | Unit-level proof on main of the sign-out marker rule. No device run | REPORTED, tests only |
| O11, O15, R5, R9 to R11 | none found | | NOT TESTED |

## 13. Component workflow verification loop (build with PR 5504, from `eab62164d`)

Sections 4 to 6 were written before a conversation could be pointed at one component. This loop is
the same acceptance run on a build that has the component checklist. It replaces nothing: O1 to O15
and R1 to R11 still apply, and a V step names the O or R step whose receipt it extends. The labels
quoted here are the ones on the screen at `eab62164d`; if a label differs on the candidate, record
the label seen and do not guess.

Scope agreed for the pilot: the drive (VFD1) and the supply relay (hand label MLC, schedule tag Q1)
on Conveyor 1. The coordinator is the integration owner named in `DELIVERY.md`.

| # | What a technician does | Expected | Evidence |
|---|---|---|---|
| V1 | Signed in, with no project open, find the machine by its plant name ("Conveyor 1"), not by the project's title: drawer Search, then the machine list in New project. | The machine is found by the plant name in at most two actions; a project titled differently is still reachable from it. If only the project title finds it, that is a FAIL, not a note. | screenshot of the query and the result |
| V2 | Open "Components". Read the row for VFD1 and for MLC. | Each inventoried component has one row with a status and its evidence. A row is never shown as ready while its status is "identity not confirmed" or "not described yet". | screenshot of both rows |
| V3 | Open MLC's confirmation card. Compare "What the label says" with the catalog fields. | The label is shown as written. Manufacturer, family, catalog number, serial, revision and local tag are separate. A field marked not sure is empty, not filled in. A look-alike number shows the differing character and is not taken as the identity. | screenshot of the card |
| V4 | With MLC still unconfirmed, press "Ask about this" and ask the reference question (section 5). | A held turn: the screen says the identity is not confirmed, reads no manual and shows no citation. This is the correct refusal. An answer with a citation here is a FAIL. | screenshot; the turn's text |
| V5 | Confirm MLC against the physical label (a person at the bench; the record of section 3 is the source). Ask the reference question again. | The header reads "Asking about" MLC. The answer carries the datasheet's values with a citation, or a refusal that names what is missing. Record which. | screenshot; values compared with section 5 |
| V6 | Open the citation. | The cited page of the cited file opens, in the device's own viewer; record the PDF page and the printed page number. Not verified by any earlier receipt for a component-scoped turn. | screenshot of the page; file id and page |
| V7 | Switch the conversation to VFD1 with the picker and ask its reference question. Then ask MLC's question without switching. | The first answer is scoped to VFD1. The second is held with "Switch" and "Stay" offered; the selection does not change by itself, and no value from the other component's document is shown. | screenshots of both turns |
| V8 | Save a job with a note and a photo while MLC is selected (O10, O11). Close the browser or app fully, reopen, sign in. | Same machine, same job, note and exactly one photo; the header shows the stored selection or says none is selected. It must not show a different component. | screenshots before and after |
| V9 | Stale selection: on a second screen (or second signed-in tab) correct or re-select the component. On the first screen, with a typed draft and an attached photo not yet sent, press Send. | The turn is not answered under the old selection. The screen says the selection changed. The typed draft and the attachment are still there and can be sent after choosing. Losing either is a FAIL. | screenshots of both screens; whether draft and attachment survived |
| V10 | After any refusal in V4 or V7, use the offered action to go back to the component. | A button does it; no phrase has to be typed. | screenshot |
| V11 | Open the drawer at phone width with a project open and press New project, Search and a project row. | Each control answers the first press in its middle. | issue 5546 is open against this at `eab62164d`; record PASS or FAIL per control |

Dependencies that stay open and must be written on every receipt until they are closed:

- Second technician (R8, R11): needs a second real person's account in the same tenant. Invitations
  go by email. NOT TESTED until performed; a second browser tab under the same account is not a
  second technician.
- Large manual (O6, R10): the drive's manual is blocked by issue 5289. The drive's V5 to V7 answers
  cannot be accepted on a manual that was cut down to get past it.
- Send on a phone: on 2026-11-14 a scripted tap on Send did not reach the app on a Pixel 9a on the
  previous build. Sends that worked on a tablet in another session say nothing about that phone.
  Until a person presses Send on the phone on the candidate and records the result, V4 to V7 on a
  phone are NOT TESTED.
- V5 needs a person at the bench to confirm identity. A synthetic run may confirm only against the
  recorded photo and must say so on the receipt.

What a synthetic run may claim for this loop: V1 to V4, V7 to V11 in a browser, labelled synthetic,
with the build and the viewport. It may not fill the human columns of section 8.

## 14. Factory-scale cases (prepared, not run)

The bench has one conveyor. A plant does not. These cases check that the same screens stay correct
and usable when the lists are long and the names repeat. They are about navigation, isolation and
behaviour under delay. They do not measure the database: a screenshot or one timed click is not a
performance result, and none of these cases may be reported as one.

Shape of the data set (synthetic, clearly named as such, never a customer's):

- Tenant A, site 1: 8 lines, 50 machines per line, 50 components per machine: 400 machines and
  20 000 components.
- Every machine has a component with local tag `MLC` and one with `VFD1`. So each tag occurs 400
  times in one tenant.
- Identical models: on every line, machines 1 to 10 carry the same drive catalog number and the
  same relay catalog number; serial numbers differ.
- Tenant A, site 2: one line with the same line and machine names as site 1, line 1.
- Tenant B: one line with the same names and tags as tenant A, and one document that only tenant B
  uploaded.
- Unplaced equipment: 25 machines with no line, and 25 components attached to no machine record.
- Shared utilities: one compressed-air unit and one control-power supply that serve all 8 lines,
  each recorded once, not once per line.

Where the data may live is the coordinator's decision. Default until told otherwise: a disposable
local PostgreSQL built from the repository's migrations plus a generator kept with this lane's
tests, and nothing written to staging. Rows are created through the application's own store
functions or routes, not by hand-written inserts, so the fixtures cannot hold a state the product
could never produce.

| # | Case | Expected | Not acceptable |
|---|---|---|---|
| S1 | Find "Conveyor 1" on line 3 by plant name. | Results show line and site for each hit, so the right one can be chosen without opening each. | Fifty indistinguishable "Conveyor 1" rows |
| S2 | Search the tag `MLC`. | Hits are grouped or labelled by machine; the count is bounded and says when more exist. | A list that silently stops at a page size |
| S3 | Open the Components list of a 50-component machine and reach row 50. | Every row is reachable; a status is shown for each; the list says how many there are. | Rows beyond a page that cannot be reached, or a count that disagrees with the rows |
| S4 | Select `MLC` on line 1 machine 7, ask; then open line 2 machine 7 and ask. | Each answer is scoped to its own component, although tag and model are identical. The header names the machine as well as the tag. | A header that reads only "MLC" in both |
| S5 | Two machines with the identical drive model: confirm one. | Only that component becomes confirmed. | The sibling changing status |
| S6 | Tenant B searches for a name, tag and document that exist only in tenant A; and the reverse with tenant B's own document. | Nothing of the other tenant appears in search, lists, counts, citations or error text. | Any count or name from the other tenant |
| S7 | Site 2's "Line 1, Conveyor 1" against site 1's. | The two are told apart on every screen that lists them. | Opening the wrong one from a list that does not show the site |
| S8 | Unplaced machine and unplaced component. | Both can be found and are labelled as not placed; neither is silently attached to a line. | An invented line or machine |
| S9 | Shared utility opened from line 2 and from line 6. | The same record, with the same history, from both. | Two diverging copies |
| S10 | Delay every response by 3 s, then by 15 s, and repeat S1, S3 and S4. Then drop one response in each. | A visible waiting state; no double submit on a second press; a truthful error and a retry after the drop; the selection never changes while a request is pending. | A blank screen, a duplicated row, or an answer under the previous selection |
| S11 | From a component deep in line 8: browser Back, then reopen from Recent, then restart and reopen. | Back returns one level at a time and does not leave the app mid-way; reopening lands on the same machine and component. | Landing on a different machine with the same name |
| S12 | Page through all 400 machines forwards and backwards. | No machine is skipped or shown twice; the order is stable between visits. | Duplicates or gaps at page boundaries |

Each case is recorded as PASS, FAIL or NOT TESTED with the build, the data-set seed and a
screenshot. Cases S1 to S5 and S7 to S12 need the data set; S6 additionally needs two accounts.
Until the data set exists and its owner is agreed, all twelve are NOT TESTED.
