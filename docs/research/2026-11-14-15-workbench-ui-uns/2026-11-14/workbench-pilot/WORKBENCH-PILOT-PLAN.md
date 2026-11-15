# FactoryLM / MIRA — Full-workbench pilot, starting with MLC

> Publication note (2026-11-15): archived research and observations from the date stated below, not a current release-status report or new authorization. See the [collection index](../../README.md) and [private-evidence policy](../../PRIVATE-EVIDENCE.md).


**Current scope update, November 14 at approximately 5:22 PM ET:** the immediate pilot is **drive + MLC only**, and CHARLIE Codex CLI is now the recorded integration coordinator. Remaining installed components are the expansion roadmap; disputed full-bench membership does not block this increment. #5504 is merged and on staging. Local combined candidate982f8aa4b remains held for the newer5510findings and exact-candidate qualification. Use the [latest status snapshot](STATUS-2026-11-14-1722-ET.md) for current heads, reviews and evidence; the earlier planning tables below preserve their original snapshots.

Planning draft · November 14, 2026 · America/New_York · Four handoffs received; BRAVO Claude Fable 5.2 handoff pending

**Direction from Mike:** the drive pilot is accepted as the baseline for moving forward. The next program is the full workbench, developed one component at a time, starting with the device locally called MLC. The purpose is to reconstruct a trustworthy digital representation of an existing machine through the FactoryLM context-building process and use MIRA to make that context useful.

This document proposes scope and work packages. It does not dispatch agents or grant implementation, spending, migration, equipment, merge, or deployment authority. Preserve the accepted drive evidence and use a small regression set when shared code changes. Do not restart the entire drive pilot as the default next task.

## Product outcome

A technician can add one real component through a repeatable workflow, verify its identity and evidence, connect it to the existing machine, and leave behind reusable structured context. Another technician and another authorized software consumer can use that context without reconstructing it from the original chat.

The first increment is **drive + MLC + their supported relationship**, not completion of the entire bench. PLC output identity is a boundary dependency when used; this increment need not onboard every PLC feature.

For each component, the process is:

**Observe → identify → attach applicable evidence → propose relationships → human review → persist approved context → expose state/events → use in MIRA and another consumer → record corrections and outcomes.**

Documents and photographs reconstruct the known configuration. Read-only observations establish state. Behavior models, prediction, and automatic control require separate evidence; they do not follow automatically from a completed asset model.

## Research basis and limits

This is a broad review of Reynolds's core public UNS guidance, a published transcript about industrial AI, his namespace-design explanation, and recent official knowledge-graph and transformation episode descriptions. It is not a claim to have reviewed every recording, paid course, or unpublished opinion. The 2025 transcript has transcription errors; no technical vendor/API claim is adopted from its wording without separate verification. Recent episode descriptions are identified as show notes, not full transcripts. A supplemental transcript provider required organization-admin terms and was not used.

No source establishes Walker Reynolds's approval of FactoryLM. The assessment below is engineering interpretation of published principles.

| Published principle | Application to this pilot | Proof we should produce |
|---|---|---|
| A shared operational architecture lets applications consume common information and be replaced without rebuilding every integration. Reynolds also describes lightweight, edge-driven, report-by-exception communication. [Interview transcript, especially 21:01–23:56 and 41:01–42:51](https://element8.co.za/Resources/the-role-of-the-unified-namespace-with-walker-reynolds/) | FactoryLM should integrate with the factory's existing namespace and own its maintenance-context contribution. Separate acquisition, modeling, and presentation. | MIRA and an independent authorized consumer obtain the same component identity, approved relationships, and observation metadata. |
| Reynolds distinguishes descriptive, functional, informative, and ad-hoc namespaces and describes models reused across consumers. [His July 2024 explanation](https://www.linkedin.com/posts/walkerdreynolds_unifiednamespace-digitaltransformation-activity-7219339644834832384-2-__) | Separate equipment identity, maintenance workflow, and technician display. A change to the display must not rename equipment or invalidate its history. | One model supports the component card and an external view; a second installed instance reuses catalog knowledge without copying installation facts. |
| The UNS supplies operational information flow; a knowledge graph supplies relationships and meaning. [September 2026 official episode description](https://www.iiot.university/podcasts/4-0-solutions-podcast/episodes/2149251997) | Represent the workbench hierarchy and the cross-component electrical/control relationships distinctly. | MIRA explains the drive–MLC relationship using approved edge evidence, not merely nearby names in a document. |
| Industrial knowledge graphs connect equipment, processes, materials, and operational data. [October 2026 official episode description](https://www.iiot.university/podcasts/4-0-solutions-podcast/episodes/2149267468) | Grow a connected asset model with typed, directed, sourced relationships. | Every asserted edge has endpoints, meaning, source/revision, review status, and a correction path. |
| Connect/collect/store precedes advanced agentic applications; industrial software should consume and contribute information. Reynolds also calls for visible agent decision records. [May 2025 transcript, 6:17 and approximately 1:02–1:07](https://www.iiot.university/podcasts/4-0-solutions-podcast/episodes/2149022217) | Persist observations and maintenance outcomes outside chat. Publish approved derived facts and audit events through authorized integration contracts. | A trace links the question, selected asset/component, evidence versions, observation times/quality, answer, concise rationale, and human correction. Do not depend on hidden model reasoning. |
| Transformation suffers when stakeholders and vendors pursue disconnected agendas. [August 2026 official episode description](https://www.iiot.university/podcasts/4-0-solutions-podcast/episodes/2149241488) | Keep one workbench outcome, one shared data contract, and one decision owner across the four agents. | One accepted scenario and a dependency map; no competing component frameworks or separate definitions of “done.” |
| Infrastructure health matters alongside SCADA, MES, and the UNS. [November 2026 official episode description](https://www.iiot.university/podcasts/4-0-solutions-podcast/episodes/2149282300) | A reachable page must not imply fresh device data. | Disconnect/reconnect and restart tests show stale/unknown states honestly and preserve ordering and provenance. |

These principles do not require FactoryLM to replace a customer's broker, historian, MES, CMMS, or ERP. Open integration and replaceable applications are the design goals. “One UNS” is a logical shared architecture, not a requirement for one physical broker or only open-source products.

## MLC identity and evidence contract

The current bench record calls the installed device **Q1/MLC** and identifies it as **Schneider Electric TeSys CA3KN22BD**. Schneider identifies that catalog item as a control relay with a 24 V DC coil and 2 NO + 2 NC contacts. [Manufacturer product page](https://shop.se.com/pro/ae/en/product/ca3kn22bd-control-relay-tesys-k-4p-2no-2nc-690v-24v-dc-standard-coil/)

Keep the familiar MLC label in the UI, while storing separately:

- Stable installed-component identity, tenant, parent machine, and local tag Q1/MLC.
- Manufacturer/catalog identity and the applicable catalog revision.
- Installed role and observed terminal/wiring relationships.
- Source-backed specifications, with conditions and units.
- Confirmation author/time, evidence hash/page/photo, and revision history.
- Current observations and historical events, each with source, timestamp, quality, and simulated/real classification.

The repository's [device record](https://github.com/Mikecranesync/MIRA/blob/c6581cc1c95ad7670f007b655a481797db547f2c/plc/conv_simple_electrical/model/devices.yaml#L93) contains both historical confirmation statements and remaining field-verification notes. Resolve them at the claim level. A document-level “verified” flag must not promote every sentence to verified fact.

Do not infer suitability for the installed switching duty from a thermal-current number. Record installation suitability and any safety function as distinct engineering determinations. This pilot models the equipment as found and exposes unresolved facts; it does not authorize energized testing or changing the circuit.

The initial relationship map should cover the recorded PLC-output→MLC-coil and MLC-contact→drive-supply relationships only to the extent supported by current evidence. A diagram is not proof of the as-built circuit. Reuse canonical relationship types after checking existing contracts; the descriptions here are semantic requirements, not proposed database enum names.

**State distinction:** PLC output asserted, coil energized, contact closed, and voltage present at the drive are different observations. The first must not silently establish the other three. Where feedback is absent, expose “not observed.”

## Reuse the current architecture

The [current strategy](https://github.com/Mikecranesync/MIRA/blob/c6581cc1c95ad7670f007b655a481797db547f2c/NORTH_STAR.md) already places trusted maintenance context at the center. The [June Walker-aligned demo](https://github.com/Mikecranesync/MIRA/blob/c6581cc1c95ad7670f007b655a481797db547f2c/docs/demos/walker-aligned-bench-flywheel-demo.md) is a useful historical scenario, but its live/pending claims and old namespace examples are not current proof. The earlier [MES ADR](https://github.com/Mikecranesync/MIRA/blob/c6581cc1c95ad7670f007b655a481797db547f2c/docs/adr/0012-mes-architecture-walker-uns-framework.md) should be reconciled with the context-platform strategy rather than used to expand this pilot into a full MES build.

CodeGraph inspection at main `20fda901e` confirms reusable code exists:

- [Collector](https://github.com/Mikecranesync/MIRA/blob/c6581cc1c95ad7670f007b655a481797db547f2c/ignition/webdev/FactoryLM/api/tags/collector.py#L93): typed values, quality bands, allowlisted readings, and signed outbound batches.
- [Tag differences/history](https://github.com/Mikecranesync/MIRA/blob/c6581cc1c95ad7670f007b655a481797db547f2c/mira-relay/tag_diff_logger.py#L341): state comparison and persisted changes.
- [Approval transition helpers](https://github.com/Mikecranesync/MIRA/blob/c6581cc1c95ad7670f007b655a481797db547f2c/mira-bots/shared/proposal_transition.py#L29): explicit proposal/approval projections. Their presence does not establish complete approval lifecycle correctness.

The [collector guide](https://github.com/Mikecranesync/MIRA/blob/c6581cc1c95ad7670f007b655a481797db547f2c/docs/integrations/ignition-tag-collector.md) describes timer-based HTTPS batches and bounded retries, with no local buffering. Thus source existence does not prove end-to-end report-by-exception, replay, or outage recovery. Measure these on the selected route before claiming them. Keep an edge device's native polling needs distinct from downstream change publication and heartbeat freshness.

Preserve CV-101's established asset key and operational path from [ADR-0035](https://github.com/Mikecranesync/MIRA/blob/c6581cc1c95ad7670f007b655a481797db547f2c/docs/adr/0035-cv101-canonical-uns-path.md#L34): `cv_101` and `enterprise.home_garage.conveyor_lab.conveyor_1`. Add component identity through the canonical model; do not rename historical telemetry to make a prettier tree.

The [November graph audit](https://github.com/Mikecranesync/MIRA/issues/5518) identifies identity, approval, supersession, reader-direction, and trace risks. Triage the subset exercised by MLC before treating graph output as trusted. In particular, a changed factual revision must not retain approval merely because it reused a database row.

## Current evidence and critical path

The supplied names now identify five sessions across the two computers: BRAVO Codex, BRAVO Claude Fable 5.2, CHARLIE Claude Fable 5.2, CHARLIE Claude Opus 5.5, and CHARLIE Codex CLI. Four handoffs have been supplied; BRAVO Claude Fable's handoff is being written. Track these sessions separately until the final four-agent operating allocation is reconciled; do not assume that one session replaced another. CHARLIE Claude Fable owns ontology validation; CHARLIE Claude Opus owns the component workflow; CHARLIE Codex CLI owns the existing #5415 local refresh and completed a bounded independent #5500 audit. BRAVO Claude's ownership and next assignment remain pending its handoff. This planning session is not claiming the staging coordinator's lease or another session's integration lane.

| Candidate | Verified current state | Consequence for the MLC increment |
|---|---|---|
| [#5504 component workflow](https://github.com/Mikecranesync/MIRA/pull/5504), `e649880b1` | Draft, unmerged. [Review iteration 5](https://github.com/Mikecranesync/MIRA/pull/5504#issuecomment-6879505997) confirms F7 fixed but leaves F9 and F10 HIGH. The checked route only resolves saved scope when the request contains a component selection. | First blocker to a trustworthy drive↔MLC workflow. Recommend the server-side scope contract below. Handoff reports rehearsal revision 7 NOT READY; staging/tablet untouched; migration 115 remains proposed. |
| [#5510 applicability](https://github.com/Mikecranesync/MIRA/pull/5510), `593d29b7d` | Draft, unmerged. BRAVO handoff's published head/body match the inspected candidate. [Latest review](https://github.com/Mikecranesync/MIRA/pull/5510#issuecomment-6879363355) finds two HIGH scope-admission gaps after the original Units-column issue was fixed. | Close inherited-model scope and extracted-table contradiction gaps before declaring MLC evidence trustworthy. Use fresh uploads; preserve the owner's source/body freeze and action limits. |
| [#5530 ontology validation](https://github.com/Mikecranesync/MIRA/pull/5530), `c7a21990b` | Draft, unmerged. All returned PR workflow runs succeeded. The author reports 48 checks, validator 113/113, 42/42 shape fixtures and zero skips; exact-head cheap review passes and explicitly did not run tests. Governed Codex/human review remains unrun. | A useful validation foundation, not completion of runtime graph integrity. Keep draft pending the required review; do not interpret green CI as all known defects fixed. |
| [#5500 catalog-identifier matching](https://github.com/Mikecranesync/MIRA/pull/5500), `21b32cad0` | Live PR remains draft and unmerged at the audited head. The [independent execution receipt](https://github.com/Mikecranesync/MIRA/pull/5500#issuecomment-6875828054) records 99/99 executed and passed, no skips, preserved 67 new cases and 32 controls, restricted networking and zero-fetch checks. Local PostgreSQL 18.6 differs from hosted CI's 16. | Reuse this bounded SQL/execution evidence; do not repeat the audit without a changed candidate or new concern. It does not replace reviews, full migration/RLS coverage, or deployed acceptance. Its repair remains with its existing owner. |
| [#5415 safety-reminder attribution](https://github.com/Mikecranesync/MIRA/pull/5415) | Live published head is still `621bb8f73`, open/unmerged. The [local readiness packet](../../PRIVATE-EVIDENCE.md) records refreshed candidate `b4de24e42` on base `20fda901e`, 203 focused passes, 16,323 suite passes/53 skips versus main's 16,314/same 53, no new TypeScript diagnostics, successful build and 12 Chromium component checks. | Separate quality repair, explicitly outside the prior bounded pilot and not an established MLC prerequisite. Preserve honest generic-reminder versus manual-warning attribution in the acceptance cases. The refreshed candidate is local only; old review GREEN does not transfer. |

For #5415, the readiness packet records provisional version 2.62.5, #5500's reserved 2.62.4, an outstanding version-order acknowledgment, and #5504's acknowledgment that the route hunks do not overlap. Future integration still requires revalidation on the combined candidate. Fresh reviews, publication and new-head hosted CI remain outstanding under that session's existing limits. Its Chromium checks are component/browser evidence, not actual application login, PDF viewer, model, physical-device or technician acceptance. This planning review inspected the packet and published audit receipt; it did not rerun their tests.

The [inventory at #5530's head](https://github.com/Mikecranesync/MIRA/blob/c7a21990b391af70e62e4656a7cccc5b6cb4f01c/ontology/SHAPE-INVENTORY.md) classifies 4 shapes as runtime, 35 as offline only, and 3 as not done by the application. Even the four have limited coverage: the assertion check covers the approval-state vocabulary, not all evidence requirements; fault scoping covers drive-pack answers, not the graph; the live-diagnosis check covers lost communications, not age-based freshness. These are code contract results, not deployment attestation.

The runtime tests deliberately retain strict expected failures for #5519 (reader/writer relationship vocabulary), #5520 (model-specific fault identity), and #5523 (superseded facts remain verified). An unexpected pass forces their owner to update the test and mapping after repair; it does not mean those repairs are included in #5530. Three additional expected failures document ontology limitations. #5519 currently checks TypeScript source text, not the executing Hub path. #5530 also changes four ontology shapes, so its reviewer must assess rule semantics as well as fixture coverage. External-standard crosswalks remain unstarted.

**Recommended #5504 design direction: option A, with explicit acceptance conditions.** Every new question must identify the conversation and the scope the technician saw, including an explicit whole-machine choice and a comparable version/revision. Missing, stale, or unknown scope must not silently widen retrieval. The server validates the expected scope and binds the accepted scope to that turn's history, retrieval, answer attribution, and retry replay. Define what happens if a selection changes while a turn is being admitted; do not re-read a different selection halfway through the answer.

A successful GET is not proof that a disconnected PUT has finished. Resolve an uncertain mutation using its original idempotent request identity or an equivalent authoritative completion protocol before releasing the pending-change gate. Reject stale callbacks from a previous conversation. These are requirements, not new API field names or a prescription to replace the existing store.

Acceptance must execute the lost-response → old-state GET → delayed commit → immediate Send ordering, including Send while the commit remains pending; A→B navigation with late A responses; a second screen changing scope; explicit whole-machine selection; and retry/reload attribution. Assert the allowed result is the technician's accepted, labelled scope or an explicit refusal, with no provider call under an unintended scope. Preserve draft text and attachments on refusal. Retain the F7 regression and existing safety-stop precedence. Real tablet/network behavior remains a separate acceptance step after code review.

Prepare the four reported follow-ups as explicit dispositions before staging readiness: migration 115 tenant ownership constraints, whole-machine questions inheriting selected-component history, the parked medium finding, and whether machine-level observed readings are allowed in component turns. The next increment should explicitly distinguish contextual machine observations from evidence about the selected component. Do not silently carry unresolved items into a factory-readiness claim.

## Session register and proposed work packages

The table preserves all named sessions while the requested four-agent operating allocation is reconciled. BRAVO Claude Fable's assignment awaits its handoff. Existing claims govern file ownership. No assignment below transfers another session's active work.

| Seat | Next deliverable | Acceptance and handoff |
|---|---|---|
| CHARLIE Claude Opus — component workflow | Prepare the bounded #5504 server-scope repair and its acceptance cases; then MLC onboarding and drive↔MLC navigation in the existing shared shell. Reuse #5517 print-set work where applicable. Another push/review is not authorized by this plan. | Correct visible component matches the accepted server scope across switches, unresolved writes, retries, and reloads. Return the exact build and rehearsal sheet to the existing acceptance coordinator. |
| BRAVO Codex — applicable evidence | Finish its owned #5503/#5510 review response, then qualify MLC model/variant evidence using the same ingestion and retrieval contracts. | Supported answers and sibling/contradictory-source negatives pass through real upload/storage/retrieval. Keep #5500 with its separate owner. Preserve the handoff's freeze and push/review limits. |
| CHARLIE Claude Fable — ontology and runtime contracts | Preserve #5530 as a reviewable candidate. Map the MLC scenario to the existing shape/runtime inventory and identify the minimum runtime protections needed at admission, approval, read, and supersession. Coordinate dependencies with the existing #5519/#5520/#5523 owners. | Executed application-path evidence for approved relationship visibility, installation/model identity separation, and correction/supersession. No blanket “42 runtime interlocks” claim and no takeover of another issue's repair. |
| BRAVO Claude Fable 5.2 — handoff pending | Establish its current owned slice, candidate, remaining gates and limits from the forthcoming handoff before choosing its next MLC responsibility. | Preserve existing ownership; do not assume it owns integration, #5500 or graph repairs based only on its host/model label. |
| CHARLIE Codex CLI — #5415 repair and bounded independent audit | Preserve the completed #5500 audit and #5415 local candidate. Reconcile version order, then follow the existing repair's publication/review sequence when authorized. A later independent acceptance role can be considered after its ownership is settled. | Keep local candidate `b4de24e42` distinct from published `621bb8f73`; new-head review and hosted CI are required for release. Its own #5415 implementation evidence is not independent review of that repair. No integration takeover. |

The integration/acceptance responsibility still needs a named owner coordinated with the current lease holder: one candidate manifest, a small drive regression, the MLC rehearsal, a second authorized consumer, and read-only observation freshness/recovery evidence. Assign it after reconciling the remaining handoff and session count, rather than inferring authority from the computer name.

Do not make this increment wait for unrelated platform expansion. Use the smallest existing supported component/notebook workflow that meets the acceptance contract. If it cannot retain identity or relationships correctly, repair that path before adoption; do not call an untested fallback accepted.

## Acceptance ladder

| Milestone | Required outcome | Measures |
|---|---|---|
| 0 — retain the drive baseline | Identify the build, device, sources, and tasks Mike accepted. Keep a compact representative regression set. | No reopening of the whole prior pilot; no unaccounted regression from shared changes. |
| 1 — onboard MLC | A technician confirms the installed item, attaches applicable evidence, and corrects ambiguity through supported UI. | Time to a usable record; number of assistance interventions; identity accuracy; unresolved fields visible. |
| 2 — demonstrate two-component understanding | MIRA answers MLC questions and explains its supported relationship to the drive. | All predeclared critical identity/applicability/citation/safety cases pass. Track useful supported answers and honest refusals separately. |
| 3 — persist and share | The record, approved relationships, corrections, and job evidence survive reopening and are consumable independently of the original chat. | Same IDs/revisions in MIRA and a second consumer; no tenant leakage; no copied installation facts between two same-model instances. |
| 4 — establish current state | Read-only observations join the correct components, with quality and time; disconnect and replay are explicit. | Agreed freshness threshold, measured delivery latency, duplicate/out-of-order behavior, outage recovery, and command-versus-feedback controls. Simulations remain labeled. |
| 5 — repeat the method | Add the next selected bench component through the same workflow. | Lower or bounded onboarding effort; no bespoke one-off parser or hard-coded machine answer. |

MLC question families should include identity/coil/contact facts, applicability to the exact catalog item, documented relationship to the drive, evidence for the current observation, an unsupported suitability question, wrong-component references, a disputed connection, and recall after restart. Ground-truth answers must be set from sources and technician confirmation before model execution.

An MLC manual-assistance pass can precede milestone 4, but it must be labeled accordingly. A connected-UNS demonstration includes both useful evidence and independently verified state/publication behavior.

After MLC, choose the next component based on the dependency revealed by the work: the PLC output boundary, 24 V supply, or a sensor. Expand to the full bench, then to a different machine whose installation facts were not pre-seeded. Template reuse applies to catalog knowledge; each physical installation still needs its own identity and evidence.

## Industry 5.0 outcomes and factory-readiness

Industry 5.0 adds human-centricity, sustainability, and resilience to the digital foundation. [European Commission definition](https://research-and-innovation.ec.europa.eu/research-area/industrial-research-and-innovation/industry-50_en)

For this program, measure technician effort and ability to challenge/correct an answer; recovery and honest stale-state behavior; and documented reductions in avoidable rework, unnecessary replacement, or energy waste where evidence permits. Do not invent energy savings from an uninstrumented relay.

Before recommending this to a factory, require a replayable two-component demonstration, a genuinely independent consumer, clear data ownership/export, access and tenant isolation, install/support/recovery instructions, and a repeat on unfamiliar equipment. This is the evidence package to bring to Reynolds or another industrial architect for critique. Architectural alignment is supportable now; his endorsement and customer recommendation are not established.

**Proposed sequence:** retain the accepted drive baseline; settle the component-scope contract and MLC ground truth; resolve the workflow/applicability blockers and the graph defects actually exercised by the chosen path; obtain required exact-candidate reviews; assemble one staging candidate under the existing coordinator; perform the two-component rehearsal; then demonstrate independent consumption and read-only state. Do not make MLC document onboarding wait for unrelated ontology completeness, and do not label it a connected UNS pilot before the state/publication evidence exists.

**Outstanding planning input:** reconcile BRAVO Claude Fable 5.2's forthcoming handoff, reconcile the five named sessions with the requested four-agent operating allocation, and name the MLC increment's integration owner. The four supplied handoffs support the work packages above. Existing dollars are purpose-bound: BRAVO Codex's reported unused $1.50 device/rerun allowance is not a review budget; CHARLIE Opus reports the review-round allowance exhausted and another push/review requiring a new decision; CHARLIE Fable reports approximately $0.27 of a $1 allowance, including estimated automatic-check costs. CHARLIE Codex's local #5415 refresh has no fresh paid-review/publication authority; its historical reviews cover the older snapshot. Estimates are not receipts and none of these balances transfers between lanes. This plan neither spends nor grants authority.
