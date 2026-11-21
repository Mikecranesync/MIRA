# Rethink how technicians encounter machines in the Hub

> Publication note (2026-11-15): archived research and observations from the date stated below, not a current release-status report or new authorization. See the [collection index](../../README.md) and [private-evidence policy](../../PRIVATE-EVIDENCE.md).


Author: MIRA Beta Orchestrator, prepared for Mike Harper
Date: 2026-11-14
Status: EGM working hypothesis, before Goldfish review. No design approval, implementation, migration, delivery freeze or independent technician validation is implied.

## Overview

**Recommendation:** pause expansion of the current project/component navigation long enough to test a clearer machine-and-work experience. Continue completing the evidence, identity, scope and reliability protections already underway. The current tablet path demonstrates useful backend behavior, but it is not yet a persuasive technician workflow.

The working hypothesis is that a technician should be able to find a machine or resume a job, see which equipment a question concerns, and ask or record work from that context. Machines should have a stable shared home; components belong to that machine, conversations and jobs refer to it, and projects optionally group work across machines. Keep a direct general/document question path for users who do not yet know the machine.

This is a product hypothesis based on an agent-operated physical tablet run and existing product requirements. No technician interviews or comparative usability study were performed. Predicted likes and dislikes below are hypotheses, not customer findings. EGM's fresh-context Goldfish reviewers have **NOT RUN**; the skill requires confirmation of this anchored hypothesis before dispatch.

## Analysis

### What the tablet actually established

Source: [physical tablet receipt](../workbench-pilot/tablet-first-proof/RESULT.md), staging 3.452.0 / eab62164db37b18c824a47de897e89fa6fce1f01.

1. A correct manual answer with an inspectable page citation was useful and worked.
2. Saving an unconfirmed component, refusing unsupported component answers, preserving context on reload, and rejecting a stale selection worked in the exercised cases.
3. The normal New project flow encountered Conveyor 1's existing notebook. A new General project could answer from a datasheet, but could not start a machine job without returning to the existing notebook.
4. That unbound General project nevertheless displayed **Whole machine — no component selected**. This makes two different situations look like one: no machine identified, and an identified machine viewed as a whole.
5. The user's hard-to-find ZZ-BENCH project was present deep in a navigation list containing many expanded conversations and test projects. Presence in the database did not establish findability.
6. Floating controls overlapped the source drawer. Job-sheet text was nearly white on white. A selection error and Retry control initially sat outside the visible screen.
7. After a selection change, Retry correctly used the new Whole machine scope, but the preserved question still said “selected component.” The answer supplied a datasheet value without clarifying that no component was selected. Transport correctness alone does not settle the meaning of the exchange.
8. No physical label was checked, no technician completed an actual job, and no equipment was operated. Those remain separate proof obligations.

### What technicians are likely to appreciate or resist

| Likely to appreciate | Likely to resist | Evidence boundary |
|---|---|---|
| Asking a plain-language question and opening the exact source page | Having to create and name a project before a simple equipment question | Source flow observed; preference inferred |
| A direct route back to the same machine and unfinished job | Searching through long lists of chat titles, test fixtures and repeated machine names | Navigation clutter observed; preference inferred |
| Honest unknowns and preserving a question after an error | An error that appears offscreen, or a generic connection-error heading for a scope conflict | Error behavior observed |
| One checked equipment identity reused until it changes | Being made to re-enter identity fields, or confirm a manual's model as though it proves the installed part | Repeated setup risk is a hypothesis; no physical confirmation occurred |
| A quick photo/note and a clear saved/offline state | Unclear distinctions among Project, Machine, Whole machine, component, Prepare job and Job sheet | Vocabulary and fragmented routes observed; offline behavior not tested here |
| Seeing the last relevant maintenance finding and its source | Reading raw conversations to discover what another technician actually did | Proposed task need, not measured in this run |

The relevant usability principles are visible system status, familiar terminology, recognition rather than recall, and recovery near the failed action. These principles support the critique, but do not replace testing with maintenance technicians. [Nielsen Norman Group](https://www.nngroup.com/articles/ten-usability-heuristics/).

As a comparison, Microsoft's Field Service documentation organizes mobile usage around assigned work, recording service, inspections, asset identification and handoff/reporting. It distinguishes administrator setup from technician use. This supports considering work and assets as entry points; it does not prove that its interface is the right design for MIRA. [Microsoft Field Service overview](https://learn.microsoft.com/en-us/dynamics365/field-service/mobile/overview). Its barcode documentation also records platform limitations, so a proposed scan path must have a tested search/manual fallback. [Barcode scanning](https://learn.microsoft.com/en-us/dynamics365/field-service/mobile/scan-barcode-technician).

### The core format problem

The visible product currently asks users to understand its containers before they can use the equipment knowledge. The name Project is serving as both a collaboration organizer and the doorway to a machine notebook. A standalone document conversation can look machine scoped even when it is unbound. Machine jobs then expose the hidden distinction late in the journey.

The September approved PRD already says a machine in a project is a link to a canonical asset, and that the same asset may appear in multiple projects. It also preserves project-scoped hypotheses until promotion. Today's observed one-notebook binding guard may be appropriate for its backend seam, but that seam should not dictate the whole visible meaning of Project. This is a design-versus-experience gap, not proof that the uniqueness constraint should simply be removed.

References: [machine semantics and context](https://github.com/Mikecranesync/MIRA/blob/c6581cc1c95ad7670f007b655a481797db547f2c/docs/prd/factorylm-unified-interaction-v1/part-2-users-and-experience.md#L126), [approved direction](https://github.com/Mikecranesync/MIRA/blob/c6581cc1c95ad7670f007b655a481797db547f2c/docs/prd/2026-09-06-factorylm-unified-interaction-v1.md), [locked decisions and acceptance](https://github.com/Mikecranesync/MIRA/blob/c6581cc1c95ad7670f007b655a481797db547f2c/docs/prd/factorylm-unified-interaction-v1/part-5-acceptance-decisions-references.md).

### Proposed everyday experience

Keep one shared interaction shell. Offer three obvious starting actions: **Continue work**, **Find equipment**, and **Ask a question**. Prioritize assigned/recent work and pinned equipment for a returning technician. Search works when there is no QR code, and a general document question remains available without asset registration.

Opening an identified machine should show a stable equipment view inside that shell. The machine name/tag, location and photo support recognition. The current question's scope stays visible near the composer, including while the keyboard is open. The primary action is asking or continuing work. Components, manuals and work history are available without turning each into a separately created project.

Conceptual tablet layout — illustrative, not implemented:

```text
Conveyor 1                              Home Garage / Conveyor Lab
[Equipment photo]                      Current condition: unknown

Continue work                          Ask about Conveyor 1

Question applies to: Conveyor 1 > MLC   [Change]
MLC identity needs checking             [Check label]

[Question / answer / cited page / relevant observation]

Components     Manuals & prints     Work history
VFD1 — Drive
MLC  — Control relay — identity not checked

[Ask a question…]   [Photo / file]   [Send]
```

The machine and selected part remain visible when an inspector opens. Controls belong in the shared layout rather than floating over drawers. A component list can start with two parts; a complete machine inventory is not required to ask a bounded question. A photograph or diagram could later supplement the list, but a digital twin canvas is not a prerequisite.

### Three scopes must look different

| Situation | Proposed visible label | What the answer can claim |
|---|---|---|
| No installed machine identified; document selected | Document question · CA3KN22BD datasheet | Facts about the document's model, explicitly not verification of the installed part |
| Confirmed machine, no component selected | Conveyor 1 · Entire machine | Machine evidence within its verified identity and source boundaries |
| Machine and component selected | Conveyor 1 · MLC | Applicable component evidence, subject to its identity and source checks |

An unknown component may still receive help reading a label, recording an observation or explaining general terminology. It must not receive an installed-model answer by silently falling back to a whole-machine/document context. The model must not certify the equipment's identity itself.

When another screen changes scope, preserve the draft and attachments, show the old and new scope next to the composer, and require a clear user choice before resending. Proposed choices are to keep the intended equipment after reloading its current identity, or explicitly use the new scope. The server remains the authority and can refuse again if context changes. Do not restore stale client state to make Retry appear successful.

### Keep knowledge, installed identity and live observations distinct

A catalog part is not an installed component. A machine can contain two instances of the same drive model. A verified datasheet fact does not prove how either instance is wired, whether it is energized, or what its current feedback says. A RUN command is not evidence of motion; a missing signal remains unknown.

The default screen should communicate only the distinctions needed for the current action. Source revision, confirmation history, signal timestamp and quality belong in inspectable details. Avoid a single green “Verified machine” badge that conflates identity, documentation, measurements and safe operating condition.

This is consistent with the broader UNS ambition: durable asset identity and relationships should survive changes to projects, chats and screens. Namespace details can live in an engineering inspector. Do not force technicians to browse a UNS tree to reach a known machine. No endorsement by Walker Reynolds or proof of an Industry 5.0 system is claimed.

### Setup is different from use

For a known machine, reuse its authoritative record and verified component identity; start a new conversation or job from it. Show existing work before inviting a duplicate. For an unknown item, allow a photo/document question first and clearly label what is not tied to installed equipment. A steward or permitted technician can reconcile the record later.

Make essential identity checks timely and small. Do not require a serial number merely to answer a manufacturer-model question when the policy and evidence do not need it. Preserve unknown fields. This proposal does not relax server checks or decide which identity fields each answer class requires; that must be specified and tested.

Jobs refer to equipment and retain observations, evidence and handoff state. Chat can help capture a job, but conversation text alone must not become a completed repair or approved machine memory. Existing CMMS/work records should be linked through supported seams rather than duplicated in a new workflow engine.

## Goals vs. non-goals

In scope: a machine's recognizable home; component context; general/document scope; fast access to applicable manuals; quick work capture/resumption; visible save and connectivity state; understandable refusal and recovery; the relationship between projects and equipment; a formative usability comparison on the actual tablet.

Out of scope for this decision: implementing a new UI, changing database uniqueness or ownership, migrating production records, rebuilding chat/evidence/identity/CMMS, new OT controls, a full 19-component inventory, a visual digital twin, new review budgets, release authority, or changing agent ownership. No stop or freeze has been sent to the other development sessions.

## Alternatives weighed

| Option | Benefit | Strongest objection | Preliminary position |
|---|---|---|---|
| Keep project/chat navigation and fix the CSS | Fastest delivery; preserves familiar chat | Does not resolve unbound “Whole machine,” asset findability or late machine-binding surprise | Necessary immediate repairs, insufficient as the full solution |
| Make an equipment tree/dashboard the mandatory home | Clear hierarchy for installed plant equipment | Adds navigation tax for quick questions, unknown parts and people already entering through a work order; risks another separate Hub UI | Do not mandate it for every task |
| One shared shell with machine/work entry and optional projects | Reuses chat and safeguards while making equipment context explicit | Requires disciplined scope semantics and migration design; can still become cluttered if every status becomes a badge | Preferred hypothesis to test |
| Start with a full visual twin or 19-row bench configuration | Potential visual context | Large setup burden and new interaction work before basic find/ask/save usability is known | Defer |

These are the assistant's preliminary judgments, not choices approved or rejected by Mike or by Goldfish reviewers.

## Key decisions and staging for next steps

### Recommended pause boundary

Pause expansion of the current navigation/component format and broad factory-readiness claims. Continue fixing known incorrect answers, isolation, persistence, source admission and migration/review issues. Reuse completed engineering work. This is a recommendation, not an issued instruction to the active agents.

Do a bounded design and technician-learning step before integrating more UI into the pilot. Any eventual UI work belongs in the existing canonical shared shell under the [cutover charter](https://github.com/Mikecranesync/MIRA/blob/c6581cc1c95ad7670f007b655a481797db547f2c/docs/architecture/convergence/UNIFIED_UI_CUTOVER.md); do not introduce another parallel Hub frontend or treat the older PRD as permission to rewrite its approved decisions without review.

### Proposed next proof

Build a small disconnected prototype only after the design direction is agreed. Compare it with the current staging flow using the same two-part bench. Recruit three representative maintenance users if available, including someone unfamiliar with MIRA. This is formative feedback, not a statistical adoption claim. Separate participants or counterbalance order to reduce learning effects.

Ask each person, without coaching, to:

1. Find Conveyor 1 from the task they were given; resume existing work if there is any.
2. Find MLC, distinguish its confirmed/unconfirmed identity, and ask a bounded question.
3. Open the cited source and explain whether it proves a catalog fact or an installed condition.
4. Record an observation/photo without claiming a repair or approving it as machine truth.
5. Resume after interruption and understand the save/connectivity state.
6. Recover when another screen changes the selected part; explain which equipment the pending question will address.

Record wrong turns, help required, completion time, scope comprehension, recovery success, and whether they can distinguish a proposed finding from verified evidence. Treat correct machine/component identification before a specific answer as non-negotiable. Initial target: no coaching or wrong-scope sends on these bounded tasks. Any numerical time targets should be set after measuring the current baseline, not presented as established industry benchmarks.

### EGM continuation configuration

Workflow: `egm-brainstorm`, initial clarification/anchored hypothesis stage. Target: this brief and the stated product decision. Goldfish status: **NOT RUN — awaiting the user's readiness confirmation required by the skill**.

Once confirmed, use the installed personas with fresh conversation context, in bounded concurrent batches: design, codebase details, zoom-out, comprehension, implementation readiness, structural, inventive catalyst. Require review of the actual tablet receipt and approved product constraints; allow reviewers to challenge the preferred hypothesis. Do not pass the parent conversation or claim reviewer agreement before actual completion. Keep reviews and artifacts local, with no paid external-review invocation or publication as a side effect.

The anchored hypothesis for confirmation is: **Keep one shared Hub shell, but make machines and current work directly accessible, with components inside their machine and projects optional for organizing work. Preserve quick general/document questions and all server-owned trust checks; test whether this makes find → ask → record → resume understandable before broadening the pilot.**
