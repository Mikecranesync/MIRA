# PRD: Alignment — Ship the Proof, Then the Moat

> **Status:** Proposed — awaiting Mike. **Tracking issue:** #4158. **Date:** 2026-09-30.
> Top-level plan; keeps `2026-09-19-customer-ready-three-surfaces-prd.md` as the Phase 0 definition of done.

## Problem Statement
**Mike, as the owner:**
- The project no longer does what its own strategy says. NORTH_STAR says to lead with the maintenance-context layer, with Drive Commander as the first sellable wedge. In practice nearly all effort goes into a general technician chat app. The newest docs pitch "ChatGPT parity", which is the copilot framing NORTH_STAR rejects.
- Work that lands on main doesn't reach technicians: prod lags main, staging is gone, and the release chain is blocked on migrations and deploy decisions.
- The differentiator (live machine context bound to an asset) runs only on a bench.
- The only goal with a date, 10 paying logos by July 2026, lapsed. Nothing replaced it, so no measure tells anyone whether a week's work mattered.
- The backlog (840 open issues, ~37% unlabeled; 100 open PRs, 75% drafts), the six PRD locations and the 37 ADRs (two duplicate numbers) make it impossible for Mike or the agent fleet to know what to work on next.

**A plant technician:** can't use MIRA on the floor today. Two things are missing:
- The version they'd get isn't the one that was tested.
- It can't see the machine, can't work offline, can't take voice, and can't finish the job (hand off to the next shift, escalate, close the work order with evidence).

**A maintenance manager evaluating a purchase:** has nothing to buy. There's no pilot offer, no onboarding path for a plant, and no evidence of weekly use.

## Solution
One PRD, one roadmap and one metric bring the project back to NORTH_STAR, without throwing away the chat app. The technician app becomes the **official delivery vehicle for the context layer**: the agent is the proof, and the context is the product.

**North-star metric:** **paying pilot plants** — plants paying for MIRA whose technicians use it every week. Target: **3 by 2026-12-31** (the date is a proposal; Mike to confirm).

Work proceeds in four phases. Each phase ends with a walk on real surfaces, never with a CI badge:

| Phase | Goal | Exit proof |
|---|---|---|
| **0. Ship what exists** (weeks 0–2) | main reaches prod through a restored staging; the Golden Conversation passes on all three surfaces; Gemini is gone from every production path; planning is cut to one roadmap | a stranger completes the Golden Conversation on mobile, Hub `/v3` and the public demo in prod |
| **1. Pilot-ready** (weeks 2–6) | one plant can be onboarded in a day; technicians can finish a job; pilot usage is measured | first pilot plant signed and live; weekly-use dashboard populated |
| **2. Drive Commander as a task mode** (weeks 4–10) | fault codes resolve inside the one brain from shared drive packs; a nameplate photo identifies the drive | a tech photographs a drive nameplate, enters a fault code, and gets a cited, pack-validated answer on a phone |
| **3. One live machine** (weeks 8–12) | one read-only live snapshot producer feeds a cited answer with freshness shown | at a pilot plant (or on the bench if no pilot is live yet), a question about a running asset is answered from live values, with the reading's source and freshness shown |

**Governance thread (runs through every phase):**
- A single roadmap and a PRD index.
- NORTH_STAR amended to name the app as the delivery vehicle.
- A decision on ADR-0033.
- A burn-down of backlog triage.
- A work-in-progress cap on draft PRs.
- A weekly **alignment check** comparing where effort went with the roadmap.

## User Stories

### Technician (on the floor)
1. As a technician, I want the app I install to be the same build that passed release proof, so that what I'm told works actually works.
2. As a technician, I want to ask a troubleshooting question about a specific asset and get an answer that cites the exact manual passage, so that I can trust it and verify it.
3. As a technician, I want every citation to open the real page, so that I can check the answer in seconds.
4. As a technician, I want MIRA to say plainly when it lacks the evidence to answer, so that I never act on a guess.
5. As a technician, I want safety-critical conditions (LOTO, energized work, arc flash) to be stated clearly every time and never softened by a document someone uploaded, so that the tool never makes me less safe.
6. As a technician, I want to photograph a drive's nameplate and have MIRA identify the drive model, so that I don't have to type part numbers with gloves on.
7. As a technician, I want to enter a VFD fault code (numeric or mnemonic, e.g. `oC`) and get its meaning plus first checks from a validated drive pack, so that I can start troubleshooting immediately.
8. As a technician, I want MIRA to tell me when a fault code isn't in its validated packs rather than invent a meaning, so that I'm not misled.
9. As a technician, I want to see the live values of the machine I'm asking about, with how old each reading is, so that the diagnosis reflects the machine's actual state.
10. As a technician, I want MIRA to warn me when live data is stale or of bad quality, so that I don't diagnose from a frozen reading.
11. As a technician, I want MIRA to be strictly read-only toward the machine, so that nothing I ask can change a setpoint or start a motor.
12. As a technician, I want to see what fixed this asset last time, so that I don't repeat a diagnosis someone already did.
13. As a technician, I want to leave a shift handoff note on an asset from the conversation, so that the next shift picks up where I stopped.
14. As a technician, I want to escalate a conversation to my supervisor with the evidence attached, so that I get help without retyping everything.
15. As a technician, I want to draft a work order from the conversation and close it with the evidence I gathered, so that paperwork doesn't eat my shift.
16. As a technician, I want my work orders to queue when I lose signal and sync when I'm back, so that dead zones on the floor don't lose my work.
17. As a technician, I want the app to state clearly which features need connectivity, so that I'm not surprised mid-diagnosis.
18. As a technician, I want the same conversation on my phone and on the shop PC, so that I can switch devices without starting over.
19. As a technician, I want to answer "did that fix it?", so that the next technician benefits from my outcome.
20. As a technician, I want large touch targets and a layout that works with gloves on, so that I can use it at the machine.

### Maintenance manager / buyer
21. As a maintenance manager, I want a clear pilot offer (scope, price, duration, success criteria), so that I can get approval to buy.
22. As a maintenance manager, I want my plant onboarded in a day (users, roles, asset list, manuals), so that the pilot starts producing value in week one.
23. As a maintenance manager, I want to bulk-upload or have MIRA discover the manuals for my assets, so that answers are grounded in my equipment.
24. As a maintenance manager, I want to see weekly active technicians, questions asked, the cited-answer rate and work orders closed, so that I can judge whether the pilot is working.
25. As a maintenance manager, I want my plant's data isolated from every other tenant, so that I can clear IT and security review.
26. As a maintenance manager, I want roles that match my plant (technician, manager, admin), so that access is simple and correct.
27. As a maintenance manager, I want to know what data leaves the plant and which AI providers process it, so that I can answer my IT department.
28. As a maintenance manager, I want pilot results summarized at the end of the pilot, so that I can decide whether to convert to a paid rollout.

### Plant IT / OT engineer
29. As an OT engineer, I want the live-data connection to be read-only by construction, so that I can approve it without a change-control fight.
30. As an OT engineer, I want to allowlist exactly which tags MIRA may read, with unknown tags refused, so that exposure is minimal.
31. As an OT engineer, I want the live adapter to work on top of our existing UNS or Ignition, so that I don't install a parallel data stack.

### Mike (owner / sole merge authority)
32. As the owner, I want one roadmap document that is the only source of what's being worked on and why, so that I stop reconciling six PRD locations.
33. As the owner, I want every open issue to carry a phase label or a closing reason, so that the backlog reflects the plan.
34. As the owner, I want a cap on concurrent draft PRs, so that work finishes instead of piling up.
35. As the owner, I want a weekly alignment report (effort share by phase against the roadmap, prod lag, pilot count), so that I can see drift within a week, not a quarter.
36. As the owner, I want prod never more than a set number of days behind main, with an alert when it is, so that shipped work reaches users.
37. As the owner, I want staging restored and required before prod, so that deploys stop failing closed on surprises.
38. As the owner, I want NORTH_STAR amended to name the technician app as the delivery vehicle and to retire "ChatGPT parity" as a pitch (it stays as a UX quality bar), so that strategy and product say the same thing.
39. As the owner, I want a decision on ADR-0033 (one technician brain), so that Drive Commander and live-state work build on an accepted contract.
40. As the owner, I want every item that needs my decision listed in one place with a default, so that I can clear them in one sitting.
41. As the owner, I want banned providers (Gemini) made impossible in production code paths, not just discouraged, so that Hard Constraint #2 holds by construction.

### Agent fleet / contributors
42. As an agent lane, I want each work item tagged with its phase and exit proof, so that I pick the highest-value unblocked work.
43. As an agent lane, I want a Definition of Done that requires on-surface proof for user-facing changes, so that I don't declare victory on unit tests.
44. As a reviewer, I want every chat route to go through one evidence contract, so that I review one path instead of three near-duplicates.
45. As a contributor, I want one drive-pack registry shared by the engine and the web product, so that a pack fix lands everywhere at once.
46. As a contributor, I want superseded PRDs and plans clearly marked, so that I don't build against stale intent.
47. As the fleet operator, I want fleet and agent-infrastructure work frozen except for health fixes during Phases 0–1, so that capacity goes to shipping.

### Learning loop / dataset (the mission)
48. As the product, I want every resolved conversation (question, evidence, answer, outcome) captured from the current system, so that the dataset grows from real work.
49. As the product, I want technician corrections kept and fed into evals, so that the same mistake is caught before the next release.
50. As the product, I want anonymization and ingestion to run on a schedule against current data, so that the learning loop isn't a manual chore against a legacy store.

## Implementation Decisions

**Modules** (deep modules marked ★, each with a small stable interface and tested in isolation):

1. **★ Inference Seam.** There is exactly one source of the production provider list: Groq → Cerebras → Together. Every production chat and report path gets its providers from it. The seam is on by default, and the flag that switches it off is removed. Inline cascades and legacy lists are deleted, including the legacy equipment-notebooks list kept "byte-identical" on purpose. Carrier: #3702, rebased again, plus a follow-up for the legacy list.

2. **★ Evidence Contract Assembler** (ADR-0029 / ADR-0033). One interface:
   - **Input:** tenant, asset or notebook scope, question, attachments, `task_mode`.
   - **Output:** an ordered list of typed evidence items, each carrying kind, source reference, provenance, confidence and freshness, plus a readiness verdict.
   - Retrieval, machine memory and history, drive packs, vision observations and live snapshots are all **producers** that feed it. None of them answers the technician directly.
   - The asset chat, node chat and notebook chat routes all call it. The oversized notebook chat route breaks down into three parts: assemble evidence, call the policy, run post-checks.

3. **Task modes.** `task_mode` is metadata on the common contract (ADR-0033): general, drive (Drive Commander), visual, live-state, and work-order. There are no per-product personalities or prompt identities.

4. **★ Drive Pack Evidence Producer.**
   - Interface: `resolve(drive identity, fault code) → evidence | not-in-pack`.
   - One pack registry, consumed by both the engine and the web product. The web-only G120 copy is merged into it.
   - The pack schema accepts mnemonic codes as well as numeric ones.
   - Coverage order: GS10, then PowerFlex 40/525, then G120, then Magnetek G+ Mini (which needs its source manual).
   - Nameplate LOOK output feeds drive identity.

5. **★ Live Snapshot Producer.**
   - One adapter per producer; transports are only renderings of it (the NORTH_STAR "one evidence shape" rule).
   - Read-only by construction, with a fail-closed tag allowlist.
   - Quality is banded to good/bad/stale/uncertain, and a freshness summary is attached.
   - Replayed data never counts as live.
   - The first target is a Micro820 + GS10 bench or the first pilot's Ignition/UNS, whichever arrives first.

6. **★ Golden Conversation Harness.**
   - One automated walk per surface: sign up → upload a manual → ask → get a cited answer → open the citation. The surfaces are mobile (device/emulator), Hub `/v3` and the public demo.
   - Each walk emits the proof artifact the three-surfaces PRD defines.
   - It is a **required release gate** between staging and prod. Unit tests and IR passes remain inputs.

7. **Release Train restoration.**
   - Staging is restored as a real host and required before prod.
   - A deploy is manifest-driven, with an approved RC SHA and a check that the running build reports the approved SHA.
   - A **prod-lag SLO** (proposed: prod no more than 7 days behind main) raises an alert.
   - Migrations are applied through the train, never by hand.

8. **Pilot Plant Kit.**
   - Tenant provisioning, with the real roles only (technician, manager, admin); aspirational roles stay hidden.
   - Asset list import.
   - Bulk manual ingest and discovery.
   - A pilot dashboard: weekly active technicians, questions, cited-answer rate, insufficient-evidence rate, work orders closed.
   - A pilot data and provider disclosure page.
   - Pilot offer terms are Mike's decision. Billing uses the existing payment integration.

9. **Workflow closure (minimum).**
   - Draft a work order from a conversation, and close it with attached evidence.
   - An asset shift-handoff note.
   - Escalation to a supervisor with the thread attached.
   - Offline: the existing work-order queue stays; chat states its connectivity requirement explicitly. Offline chat is out of scope.

10. **Learning loop.**
   - Anonymize, ingest and capture run on a schedule against current decision traces and turns, not the legacy Open WebUI store.
   - Technician outcome and correction signals flow into eval sets.

11. **Safety floor.**
   - The 2026-09-27 "banner, don't block" hazard policy needs live acceptance before pilot exposure.
   - LOTO and energized-work statements have a floor that no retrieved document, prompt injection, or policy change can remove. (This closes the poisoned-document class of issue.)

12. **Governance.**
   - **One roadmap file** that the PRD index points to. Superseded PRDs and plans get a superseded-by header.
   - **NORTH_STAR amendment** (story 38).
   - **ADR-0033**: an accept-or-revise decision.
   - Duplicate ADR numbers are renumbered.
   - **Issue triage**: every open issue gets a phase label (`phase-0` … `phase-3`) or is closed with a reason. Bot-generated drafts older than 14 days are auto-closed.
   - **Draft-PR cap** (proposed: at most 15 open drafts).
   - A **weekly alignment report** covering effort share by phase, prod lag, pilot count, and the draft/issue trend.
   - A **freeze** on new fleet and agent infrastructure during Phases 0–1, except health fixes such as #4050 and fleet-gateway uptime.

**Architecture constraints kept:**
- Apache/MIT licenses only; Doppler for secrets.
- Groq → Cerebras → Together, with no Anthropic model in diagnosis.
- No LangChain or n8n.
- UNS/ISA-95 conformance.
- Promotion order dev → staging → prod.
- OT stays read-only.

## Testing Decisions
- **What makes a good test here:** it asserts externally visible behavior through the module's interface. Examples: which providers can be reached, which evidence items appear and with what provenance and freshness, what a fault code resolves to or that it's refused, and whether a surface walk yields a resolving citation. Never internal call order or private helpers.
- **Automated tests** (the default: Mike didn't choose a subset):
  - **Inference Seam.** Guard tests enumerate every production chat and report path and fail if any path can reach a banned provider or bypass the seam. Prior art: the existing no-Gemini production-routes guard test.
  - **Evidence Contract Assembler.**
    - Contract tests per producer: the item shape, provenance present, freshness banded, and the readiness verdict.
    - Route-level tests prove all three chat routes use the assembler.
    - Prior art: the approved-context readiness tests; the answer-validation gate tests; the safety-classifier parity tests (Hub ↔ Python).
  - **Drive Pack Evidence Producer.**
    - Table-driven tests over each pack.
    - Mnemonic-code acceptance.
    - Unknown code → `not-in-pack`, never invented.
    - Engine and web read the same registry.
    - Prior art: pack grading reports and provenance files; the drive-pack fault-code eval baselines.
  - **Live Snapshot Producer.**
    - Field-by-field agreement between renderings.
    - Allowlist fails closed.
    - Stale or bad quality is banded.
    - Replay is excluded from live.
    - No write path exists.
    - Prior art: the Ignition gateway live-snapshot rendering-agreement test; the fieldbus read-only rule.
  - **Golden Conversation Harness.** The harness itself is tested: it fails on a missing citation, an unresolvable citation, or an insufficient-evidence reply. It then runs as a release gate. Prior art: the retrieval-acceptance workflow, Hub e2e, the synthetic release gate, and the capture matrix.
- **Proven on the surface rather than by tests:** workflow closure, the pilot kit and the dashboard, the safety floor (plus the existing adversarial safety evals), and every phase exit (a walk, with screenshots and trace).

## Out of Scope
- Parts, inventory and procurement.
- New chat channels (Teams, WhatsApp) and new products (PrintSense expansion).
- Offline chat and on-device inference.
- iOS App Store release. Mike decides; Android remains the pilot device.
- Any write path to PLCs or drives.
- Factory I/O adapter.
- New fine-tuned adapters or model-training programs.
- New fleet/agent orchestration features during Phases 0–1.
- Cross-asset root-cause reasoning in answers. The KG stays as it is until Phase 3 exits.

## Further Notes
- **Evidence baseline (2026-09-27 to 09-30):**
  - Prod runs only hub, web and ask; the other services are deferred.
  - Prod is behind main because of the 088/089 migration block (#3878, #3879).
  - Staging is gone.
  - The Hub still uses an inline cascade that includes Gemini by default.
  - Drive packs: GS10 and PF40/525 are in the engine; G120 is web-only; Magnetek is at 0%.
  - Live data exists on the bench only.
  - Handoff, escalation and parts are missing; offline covers work orders only.
  - 840 open issues; 100 open PRs, 75 of them drafts.
- **Existing carriers to fold in:**
  - Phase 0: #3702 (Gemini out; needs another rebase per mira-84) and #3878–#3882 (the release chain).
  - Safety: #3790 (poisoned document), #3852/#3845 (negation), #4122 (isolation vs LOTO).
  - Knowledge coverage: #4151 (crawler model numbers), #4147 (PDFs truncated at page 300).
  - Health: #4050 (fleet lanes).
- **Mike's decisions, each with a default:**
  1. Pilot target date (default 2026-12-31).
  2. Pilot price and terms.
  3. Accept ADR-0033 (default: accept).
  4. Accept the 09-27 safety policy after live acceptance (default: yes, with the LOTO floor).
  5. iOS (default: defer).
  6. Draft-PR cap (default 15).
  7. Prod-lag SLO (default 7 days).
- **Relationship to existing PRDs:** this PRD **supersedes as the top-level plan**, while keeping 2026-09-19 "Customer-Ready on Three Surfaces" as the Phase 0 definition of done. Superseded as roadmap: the 90-day MVP plan (expired), the 2026-06-01 master architecture plan's sequencing, and the ChatGPT-parity framing docs (demoted to a UX bar).
