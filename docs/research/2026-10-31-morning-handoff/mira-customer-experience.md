# MIRA customer experience

## The experience we are building toward

**Target state for Mike Harper and the FactoryLM product team**\
31 October 2026

We want an unfamiliar technician or researcher to open MIRA, bring one maintenance problem, and reach a better next decision without Mike explaining how to use it. They should be able to inspect the evidence, correct the record, and see exactly what reached the maintenance system. This is a product vision and acceptance contract, not a claim that these capabilities have shipped.

The test is practical: **does MIRA help someone reach a correct, safe, source-supported next decision faster than working without it, repeatedly on unfamiliar cases?** A justified stop, request for missing evidence, or escalation can be the right answer. A confident diagnosis is not required.

### What we want the evaluator to feel

An evaluator such as Jeanne McClure, a local AI collaborator, or a manufacturing researcher should not need to appreciate the architecture before finding the value. The first impression should be: “I know where to start.” After the first exchange: “It understood the job, and that question matters.” At the answer: “I can check why it said that.” After saving: “I know what changed, and the next person can pick this up.”

A technician is giving MIRA scarce attention during a real shift. We earn that attention by using the information already available, asking fewer useful questions, and avoiding another round of clerical work. The experience should feel like a capable colleague who keeps good notes, knows the limits of the evidence, and does not bluff.

### Opening the link

The first screen explains the job in ordinary language:

> **Get to the next maintenance decision**\
> Describe what happened. MIRA will use the available records, show what supports its answer, and help prepare the work note.\
> **Try a sample case** · **Use my asset**

The sample opens immediately. A persistent label reads: **“Sample data · isolated sandbox · no real work orders.”** Its evidence and any CMMS activity remain in that sandbox. “Use my asset” retains sign-in, tenant boundaries, and role checks; it never borrows the demo’s access. A visitor can understand the workflow before connecting anything. No CMMS or live PLC connection is required to get a useful answer and export a work note.

### The product contract

MIRA must make the next decision clear, expose the evidence and its limits, and preserve the technician’s control over consequential actions. It must not turn an inference into a fact, an uploaded file into an applicable manual, or a saved note into a confirmed CMMS update. When evidence or authority runs out, the interface says what is missing and offers the next safe way forward.

Safety screening precedes diagnostic model or tool execution where a hazard requires it, even if asset lookup fails or the equipment name is invalid. A hazardous request produces a clear stop and appropriate site escalation. MIRA never assumes isolation, permission to operate, or permission to bypass safeguards. The user should not have to discover a safety control to receive that protection.

<!-- PAGE BREAK -->

## One maintenance job from the first exchange

### A clearly labeled sample case

The illustrative job is a pump with a recurring low-flow indication. All assets, records, and routing rules in this example are synthetic sample data. There are no manufacturer instructions, invented manual pages, numerical limits, or established equipment faults. The task uses existing observations only.

The sample opens on a short case, not an empty chat box:

> **Sample Pump 17**\
> The event log shows a recurring low-flow indication with a run command. The shift note reads “pump running, low flow,” without confirming delivered flow. No applicable equipment manual is attached.\
> **Review this case** · **Change the reported problem**

The technician can type or speak: **“What should I put on the work order? I don’t want to call this a bad pump without evidence.”**

MIRA responds before asking for an account-wide setup:

> “The records support a recurring low-flow indication, but they do not establish a failed pump or confirm actual flow loss. I can help separate those facts and prepare the note. First, let’s make sure these records belong to the right asset.”

### Establish identity without losing momentum

An asset strip shows the tenant, location, asset ID, equipment identity, and how that match was obtained. The user confirms **“This is the pump, not its motor.”** A photo can help identify it, but an uncertain match stays uncertain. A correction rebinds the case only after an authorized tenant-scoped match; it does not carry another asset’s conclusions across silently.

The source strip distinguishes **available**, **applicable**, and **missing** material. A real manual must match the model or serial range, relevant configuration, and revision; a filename is insufficient. Citations open the actual passage on the correct page and revision. The sample shows **“Applicable manual unavailable.”** Its explicitly synthetic site routing rule assigns disagreement between a low-flow indication and a same-event independent flow record to instrumentation review. That rule permits a review request, not equipment work.

### Ask one question that earns its place

> **MIRA:** “Is there an existing independent flow record for this same event? I’m asking because it could distinguish a delivery problem from a disagreement in the records, which changes the review queue.”\
> **Technician:** “Yes. This independent flow record reports normal flow throughout the alarm interval. I’ve attached it.”\
> **MIRA:** “The record matches this asset and event. That changes the next step: the sample routing rule points to instrumentation review, not a pump replacement decision.”

The match must be checked, not assumed from an upload. “I don’t know” remains valid: without that record, MIRA keeps actual flow loss unresolved and prepares a general review request. It accepts corrections, photos, voice, and existing structured measurements without restarting. Transcriptions and units are reviewable; new measurements require the applicable procedure, authorization, and safety conditions.

<!-- PAGE BREAK -->

## An answer the technician can use and challenge

### The decision card

The answer is short enough to use at the job, with evidence one click away. This is the proposed sample UI copy, not an equipment diagnosis:

> **Next decision**\
> Request instrumentation review of the disagreement between the low-flow indication and the same-event independent flow record, as directed by the sample routing rule. Do not select pump replacement or record a confirmed instrument fault from this evidence.\
>
> **What we know**\
> The event log records a low-flow indication with a run command. The independent flow record reports normal flow throughout that same interval. The shift note says “pump running,” but the log establishes only a command.\
>
> **What remains open**\
> The discrepancy is established in the sample records; its cause is not. An indication problem, an error in the independent flow record, or an unrecognized difference in timing or operating context remain possible. Actual operation is not independently verified.\
>
> **What would change this decision**\
> A corrected independent flow record or evidence that it describes a different event would remove the basis for this routing decision. Applicable equipment instructions and authorized review are required before selecting equipment-specific checks or repair.\
>
> **Evidence**\
> Sample event log · shift note · independent flow record · synthetic site routing rule. Open each original and its supporting entry. **Applicable manual unavailable. No equipment-specific procedure is authorized here.**\
>
> **Add existing evidence** · **Correct a fact** · **Prepare work note**

The card separates observation, inference, and unknowns. It shows source origin, timestamp, document revision where applicable, and which claim each source supports. There is no arbitrary “90 percent confident” badge. If a passage is unavailable or inapplicable, the answer says so.

**Inspect this decision** expands the supporting evidence, question purpose, changed facts, and concise decision rationale, with system or model version and timestamps. Researchers can inspect what happened without exposing hidden reasoning, internal prompts, or secrets; technicians need not open this view to use the answer.

### Record what actually happened

The technician says: **“I requested instrumentation review. No repair was performed. Also, change ‘pump running’ in the shift note to ‘run command present.’”**

MIRA replies: **“Corrected in this case. That removes the only report of actual operation; operating state remains unknown. The original wording remains in history. I’ve recorded your review request, not a repair or completed work order.”** The source shift log is not silently edited.

The note includes the unresolved question and a next owner or queue only when one has actually been selected. A user-reported outcome is labeled as such, not independently verified.

<!-- PAGE BREAK -->

## From the conversation to an approved work record

### Review the exact change

MIRA prepares a readable work note from the conversation. The preview identifies the tenant, asset, destination work order, acting user, and action. It shows the proposed addition beside the existing record, with the observations, decision, unresolved items, reported outcome, source references, and relevant document revisions intact.

For this sample, the action is **“Append this note to the sandbox work order.”** The preview says: **“Status, assignment, priority, and completion fields will not change.”** The user can edit, discard, or approve the draft before transmission. Selecting a real work order requires an authorized match in the user’s own tenant.

> **Technician:** “That’s right. Add the note.”\
> **MIRA:** “Approved for this note only. Sending to the sandbox CMMS.”

### Every status tells the same truth on both sides

The user can see the evidence-saving status separately from the CMMS delivery status. These states are the product contract, including during slow or failed requests.

| User-visible state | Required backstage truth |
| --- | --- |
| **Saved to MIRA** | Evidence or case changes are durably saved in MIRA. Nothing here implies a CMMS write. |
| **Draft work note** | A proposed record exists. It has not been sent. |
| **Awaiting approval** | The exact action, destination, and proposed change need an authorized reviewer. |
| **Queued** | The approved action is waiting for delivery. No CMMS confirmation exists. |
| **Sent** | The request was transmitted. Receipt or success response alone is not independent verification. |
| **Confirmed by CMMS readback** | A separate authorized read retrieved the destination record and matched the intended change, with external record ID and verification time. |
| **Failed or conflict** | Delivery failed, the result is uncertain, or the record changed incompatibly. The interface shows which condition applies and the recovery action. |

An uncertain result says **“Outcome unknown · checking before retry”**, rather than asserting failure or success. Evidence can remain safely saved in MIRA while CMMS delivery is unresolved.

### Show the result in the system that owns it

Only after readback may the interface say: **“Confirmed in Atlas sandbox. Open the CMMS record to inspect the appended note.”** It displays the actual returned reference and verification time, never a made-up sample ID presented as a live receipt. The evaluator opens Atlas independently and sees the same note on the correct work order.

Approval to add this note does not authorize closure, maintenance signoff, a change in asset status, or physical actuation. If the configured connector cannot append a note, MIRA keeps the draft and offers a supported export or authorized alternative. It does not quietly overwrite the description to simulate append support.

<!-- PAGE BREAK -->

## The backend must preserve the promise

### A work record with traceable meaning

The canonical record carries tenant and asset identity; the actor and authorization context; event and recording times; source IDs and document revisions; observations; the decision and its rationale; unresolved questions; reported outcome; and references to the case and external work record. Evidence, hypotheses, approvals, and confirmed external changes remain distinguishable. A copied answer without these relationships is insufficient.

The user sees one maintenance workflow. Behind it, FactoryLM preserves asset memory and provenance-bound events that can be coordinated through the unified namespace, or UNS. A hypothesis can be shared as a hypothesis; it cannot become an authoritative asset condition merely because MIRA produced it. Corrections supersede earlier statements with an attributable history. MIRA does not turn these events into automatic PLC commands.

### Bound every write

The connector enforces configured role and action authority, not just a button. Initial writes require a specific preview and approval; authority is rechecked immediately before queued delivery. An organization may separately authorize low-risk observation logging to stream within a narrow policy naming the actions and fields. That permission never silently extends to status changes, closure, signoff, or equipment operation.

Drafts remain editable or discardable before sending. Any later correction uses a supported, authorized amendment with an audit trail; the UI must not promise an undo that the destination cannot perform. High-impact changes require their own approval and appropriate authority.

### Handle retries and competing edits honestly

Each approved intent has a stable idempotency identity. Delivery attempts reuse it. If a timeout leaves the outcome unknown, MIRA checks for the original write before creating another. The goal is one intended business effect through idempotency and reconciliation, not an unconditional exactly-once delivery guarantee. If an adapter cannot establish the outcome safely, it pauses for reconciliation instead of risking a duplicate.

Writes are field-scoped patches or supported append operations. Omitted fields are not cleared. All asset, work-order, and readback lookups are tenant-scoped. A stale version or a technician’s manual CMMS edit triggers a reread and comparison; incompatible changes require renewed review. Duplicate delivery, delayed synchronization, and conflicting edits must never silently overwrite someone else’s work.

Readback verifies the intended fields and record identity, not merely that some record exists. The history retains the approved change, each attempt, the returned references, and the observed destination result. If confirmation cannot be obtained, the case stays visibly unconfirmed.

### Prove Atlas first without promising every vendor

Atlas is the first CMMS testbed for the complete round trip. It proves the experience only for the tested actions and conditions. The same canonical contract can support later adapters, but each adapter declares its actual capabilities: lookup, append, field updates, conflict detection, idempotency, and readback. Unsupported operations remain visible and unavailable. Every new adapter needs its own acceptance evidence; a successful Atlas demonstration is not proof of universal CMMS compatibility.

<!-- PAGE BREAK -->

## A useful handoff on the next shift

### Resume the job without retelling it

Another authorized technician opens the asset and sees the concise summary: low-flow indication conflicts with the same-event independent flow record; instrumentation review was requested; cause and actual operating state remain unverified; no repair was reported. “Run command present” is current; the earlier wording remains inspectable. They can open the supporting records, see what was approved, and follow the confirmed CMMS reference.

MIRA starts with: **“This is where the last shift left it. Has any new evidence or outcome been recorded?”** It does not repeat answered questions or treat an old hypothesis as a current fact. New evidence is checked for asset identity, event time, and applicability before the decision changes. Access is reevaluated for the returning user; shared history does not mean shared access across tenants.

### Stay honest when conditions are imperfect

| Situation | What the technician experiences |
| --- | --- |
| Weak connection or offline work | A local draft is labeled **“On this device · not yet saved to MIRA.”** Only durable server acknowledgement permits **“Saved to MIRA.”** Reconnection resumes without duplicate notes. |
| Poor photo or ambiguous label | The uncertain characters are visible. MIRA asks for the missing identity detail or keeps the case unbound; it does not guess a serial number. |
| Missing or wrong manual | MIRA preserves useful observations, withholds unsupported equipment-specific advice, and explains which applicable source is needed. |
| Wrong asset or conflicting evidence | The affected conclusion is withdrawn or narrowed. The correction and disagreement remain visible rather than being averaged into false certainty. |
| CMMS unavailable | The approved note remains saved or queued with a clear destination and status. Export is available if supported. The screen never says the external record is updated. |
| A new user returns | The case resumes only within their authorized scope, with current evidence, corrections, unresolved work, and independently verified sync status. |

Mobile use must preserve these distinctions. A dropped upload must not look attached, and a voice transcript must not silently become a confirmed observation. Recovery should reuse the case and saved draft instead of requiring the technician to repeat the story.

### Demonstrate usefulness beyond the sample

The sample teaches the workflow; it does not establish effectiveness. Evaluation must include unfamiliar cases with sufficient evidence, missing evidence, wrong sources, contradictory observations, and conditions that require a stop. Compare the time and quality of the next decision with working without MIRA, including correction effort and appropriate escalation. Record unsupported recommendations, wrong-asset matches, false completion claims, and unnecessary questions as failures to investigate.

The desired result is a recurring advantage on real maintenance work without trading away safety or evidence quality. We should be able to explain where MIRA helped, where it stopped appropriately, and where it added friction. A polished answer on a rehearsed pump case is not enough.

<!-- PAGE BREAK -->

## Blind review acceptance checklist

Give the evaluator a link and no narration. Use a fresh browser. Run the labeled sample, then a permitted unfamiliar case with the evaluator’s own evidence. For CMMS tests, use an isolated authorized test tenant. Record the observed result and supporting evidence for each check; a hidden operator rescue does not count as a pass.

| Check | What must be observable to pass |
| --- | --- |
| **1 Open and start** | The evaluator understands the purpose and reaches a useful first response without founder guidance. Demo isolation is unmistakable; the real-asset route retains authentication and tenant guards. |
| **2 Establish the right context** | Asset identity and source applicability are visible. Try the wrong asset or revision. MIRA narrows or blocks the affected advice rather than accepting a plausible filename. |
| **3 Inspect the evidence** | Open a citation in the unfamiliar case. It reaches the actual supporting passage on the correct page and revision. Missing sources are reported as missing, not replaced with invented links. |
| **4 Understand the question** | The evaluator can explain why the clarification matters. “I don’t know,” a correction, and an existing photo or measurement preserve progress without fabricating facts. |
| **5 Reach the right decision** | A qualified reviewer can assess whether answering, asking, or escalating is justified. Observations, inferences, alternatives, and remaining uncertainty are distinguishable. Test a hazardous request with an invalid asset; the safety stop still occurs. |
| **6 Correct and preserve** | Correct “running” to “run command present.” The current answer and draft update. The original statement and correction remain attributable in history; the change does not silently alter an approved external note. |
| **7 Approve a bounded write** | Review the exact destination and proposed change. Approving a note changes only that authorized content. No implicit closure, signoff, unrelated field clearing, or equipment command occurs. |
| **8 Verify in the CMMS** | Open the destination independently. See the exact new record or note on the correct asset and work order. MIRA shows confirmation only after a separate matching readback. Saving evidence alone never looks complete. |
| **9 Break delivery safely** | Exercise timeout, duplicate delivery, stale state, a manual CMMS edit, outage, and an unsupported action. No duplicate or silent overwrite occurs. Unknown outcome, conflict, and capability limits remain explicit until reconciled. |
| **10 Resume and repeat** | Return on mobile and as another authorized user. The correct history resumes, interrupted uploads are honest, and another tenant’s records stay inaccessible. Repeat with unfamiliar cases and compare decision quality and time against the unaided workflow. |

### The acceptance boundary

This checklist defines the experience we want to earn. It is not evidence that MIRA, FactoryLM, Atlas, or a future adapter already passes. Acceptance requires observed behavior, inspectable records, and repeatable results. The demonstration is complete only when the evaluator can account for the decision and the destination record without taking our word for either.
