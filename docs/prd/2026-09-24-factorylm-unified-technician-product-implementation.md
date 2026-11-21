# FactoryLM Unified Technician Product — Implementation PRD

**Status:** IMPLEMENTATION READY  
**Primary repository:** `Mikecranesync/MIRA`  
**Supporting repository:** `Mikecranesync/factorylm`  
**Execution model:** converge and finish existing work; do not greenfield replacement systems  
**Primary product surface:** unified FactoryLM technician shell across Hub/web + Android  
**Priority:** technician-visible product progress

## 1. Mission

Turn the existing FactoryLM/MIRA work into one coherent technician product that can be proven end-to-end.

The product experience is:

> A technician opens FactoryLM, starts or resumes a conversation, attaches a photo or equipment manual when useful, asks a maintenance question, receives a safe evidence-backed answer, can inspect the supporting evidence, follows up in the same conversation, and can later reopen the same work on phone or web.

The implementation already exists in pieces. This mission is primarily convergence, integration, removal of broken seams, product simplification, acceptance proof, and closure of demonstrated defects.

It is **not** another redesign or architecture project.

## 2. Product North Star

One FactoryLM product.

The existing mobile/web product opens directly into MIRA. Equipment, manuals, projects, machine context, and maintenance work remain available behind a quiet conversation-first interface. Evidence and maintenance context are the differentiation.

The customer should experience **one MIRA**, not separate personalities, chat systems, source systems, or mobile/web implementations.

Canonical tracker: #3586  
Unified UI governance: #3626

## 3. Current State at PRD Creation

Treat these as reconnaissance anchors, not immutable truth. Re-read GitHub before modifying anything.

### Already landed

Existing merged work includes:

- `/v3` unified shell
- HOME
- New chat
- New project
- persisted general conversations
- thread deep links
- refresh restoration
- project/thread history

Do not recreate these.

### Release train

PR #3986 is merged.

It provides:

- release manifest
- expected vs observed artifact identity
- release states
- device parity receipts
- blocker enforcement
- release validation
- parity acceptance infrastructure

The release system is supporting infrastructure.

**Do not expand it unless a demonstrated product acceptance blocker requires a bounded repair.**

## 4. Active Implementation Sources

These are implementation sources to converge, not invitations to duplicate them.

### Mobile visual technician release — #3845

Contains or coordinates:

- unified mobile host adapter
- gallery/camera attachment handling
- photo-only first question
- LOOK -> notebook -> chat grounding
- attachment retry
- browser attachment picker
- Android 1.2.1/build 12

Physical acceptance remains incomplete.

### Project Sources + persistence journey — #3807

Contains:

- repeated Sources navigation
- actual upload reachability
- persisted thread verification
- cold restart
- citation continuity
- mobile journey controls

Live end-to-end device proof remains incomplete.

### MIRA Intelligence Contract — #3959

Direction: one MIRA persona with evidence behavior separated from persona behavior.

Target modes:

- `source_only` / grounded: explicit request for source-only behavior; abstain without evidence
- augmented: normal technician conversation; use available evidence but remain useful when evidence misses
- general: surfaces with no corpus

Do not allow retrieval success/failure to silently select a different assistant personality.

### Safety answer-floor work — #3978

This is **not currently finished**.

A known unresolved problem remains around treating unrelated retrieved chunks as sufficient support.

Do not merge or generalize the current implementation merely because focused tests pass.

### Explicit release blocker — #3984

Issue #3984 remains OPEN.

The known defect is cross-sentence / numbered-step energized-work procedure leakage.

The fix must simultaneously preserve the opposite direction:

- unsafe restore-power-then-measure procedures -> BLOCK
- benign machine restart / VFD-display / non-electrical observations -> SERVE

Do not solve #3984 by simply broadening keyword scope.

### Public demo — #3815

This is useful, but subordinate to the technician product.

It provides the shared-shell simulated conveyor experience and should remain built on existing SimLab/shared-shell infrastructure.

Do not let public-demo work interrupt the critical mobile/web technician flow.

## 5. Repository Ownership

### MIRA

`Mikecranesync/MIRA` is the implementation home for:

- shared product shell
- Hub technician UI
- Android technician app
- conversation behavior
- projects
- Sources
- attachments
- evidence rendering
- MIRA persona
- safety behavior
- release contract
- public demo

### factorylm

`Mikecranesync/factorylm` is supporting infrastructure and policy.

Use it for:

- Charlie runtime
- Brain/MCP infrastructure
- edge/PLC producers
- shared product policy
- design policy
- supporting operational infrastructure

Do **not** create a competing FactoryLM technician frontend in this repository.

Supporting tracker: factorylm#227.

## 6. Locked Architecture Rules

### One product shell

All new technician-facing presentation work goes through the canonical unified FactoryLM shell.

Do not build another shell. Do not revive a legacy presentation surface for convenience.

### One conversation system

Do not introduce:

- another chat database
- another message schema
- another thread system
- another persistence layer
- another notebook abstraction

Reuse the existing conversation/thread/notebook contracts.

### One evidence model

Photos, manuals, machine context, live state, citations, and diagnostic evidence must converge into existing evidence contracts.

Do not build a second RAG/evidence pipeline for the UI.

### One MIRA

Do not create a mobile personality, Hub personality, source personality, photo personality, or general-chat personality.

Different modes may impose different evidence requirements. They must not turn into different assistants.

### Read-only OT

Nothing in this product effort authorizes:

- PLC writes
- VFD writes
- resets
- parameter changes
- output commands
- autonomous equipment control

MIRA observes, contextualizes, diagnoses, and explains.

## 7. Development Lanes

Operate five lanes, but allocate effort asymmetrically.

### LANE A — Unified Technician Product

**Priority: P0**

#### Objective

Make the unified shell the obvious, clean technician front door.

#### Required behavior

HOME must support:

- immediate conversation
- New chat
- New project
- project/thread selection
- attachment affordance
- photo/manual workflow
- visible conversation history
- understandable state transitions
- no diagnostic implementation noise

#### UX principles

Prefer:

- conversation first
- progressive disclosure
- quiet industrial presentation
- few permanent controls
- clear evidence
- clear errors
- recoverable interactions

Avoid:

- dashboards before conversation
- duplicated navigation
- debug metadata
- safety trigger codes
- raw trace state
- giant status cards
- unnecessary industrial chrome
- another visual redesign

#### Existing architecture first

Before editing UI:

1. inspect the existing component
2. inspect adapters
3. inspect tests
4. inspect relevant open PRs
5. determine whether the requested behavior already exists somewhere

Integrate before rebuilding.

### LANE B — Mobile + Real Technician Journey

**Priority: P0**

Primary sources: #3845 and #3807.

#### Objective

Prove that Android is a real client of the unified product rather than a visually similar parallel app.

#### Required journey

The candidate must successfully demonstrate:

1. launch FactoryLM
2. arrive at usable conversation state
3. New chat works
4. New project works
5. open Sources
6. attach/upload a real manual
7. attach or capture a real photo
8. ask a maintenance question
9. photo is analyzed before being treated as evidence
10. answer is returned
11. evidence/citations are visible when applicable
12. citation resolves to the real supporting passage
13. ask a follow-up
14. leave/restart the app
15. reopen the same project/thread
16. previous question and answer remain
17. citation/source relationship remains
18. open the same conversation on web
19. continue it
20. return to phone and observe the same thread

Do not count unit tests, APK installation, emulator-only behavior, or Android build success as physical acceptance. They are prerequisite evidence, not the product proof.

### LANE C — Intelligence + Safety + Evidence Correctness

**Priority: P0**

#### Objective

Make the conversation trustworthy enough that the simplified UX can rely on it.

#### C1. MIRA intelligence contract

Converge normal technician chat toward one persona.

Normal chat should default to augmented behavior.

If evidence exists:

- use it
- cite it
- expose its provenance appropriately

If evidence does not support a claim, do not pretend it does.

If normal engineering knowledge can safely answer, answer under the appropriate mode and distinguish it from source-grounded evidence.

Explicit source-only requests retain fail-closed evidence semantics.

#### C2. Parameter/fault specificity

Do not invent:

- manufacturer fault meanings
- device parameter definitions
- equipment identity
- model-specific values

Unknown device-specific claims must remain unknown unless grounded.

#### C3. Safety floor

Safety applies to the **answer**, not merely the user's question.

No route may stream or emit prohibited energized-work instructions and attempt to validate them afterward.

Validation must occur before unsafe bytes reach the client.

#### C4. #3984

Keep #3984 OPEN until demonstrated fixed.

Required controls include:

**Must block**

- same-sentence restore-power-to-measure
- cross-sentence restore-power-to-measure
- numbered-step re-energize -> clamp/measure procedures

**Must serve**

- pump restart + flow observation
- compressor restart + pressure observation
- motor restart + VFD display observation
- thermostat/HVAC observations
- ordinary post-maintenance functional confirmation

Prefer semantic/control-context correctness over bigger regexes.

### LANE D — Release / Staging / DevOps

**Priority: P1 SUPPORT**

#### Objective

Keep product development trustworthy without turning release engineering into the product.

Reuse #3986.

Continue using:

- current release manifest
- existing validator
- Capability Closure Registry
- exact code identity
- expected vs observed deployment state
- physical-device receipts
- existing CI
- existing staging environment

Do not build a new release framework, dashboard, registry, state machine, deployment abstraction, or CI architecture unless the existing system demonstrably cannot satisfy a required acceptance criterion.

Never convert "CI green", "APK built", "workflow passed", or "staging reachable" into "product accepted", "device parity complete", or "release safe" without the corresponding evidence.

### LANE E — Public Demo + Supporting Infrastructure

**Priority: P1/P2**

#### Objective

Give strangers a safe, useful public proof of FactoryLM without blocking core technician development.

Continue existing #3815/#3828 work.

Reuse:

- SimLab
- shared shell
- existing interaction contracts
- existing public/demo boundaries

Do not build a second demo application.

The public demo may simulate machinery. It must not imply simulated data is physical data.

## 8. Execution Sequence

Do not attempt five independent greenfield workstreams.

### Phase 0 — Reconnaissance

Before implementation:

1. fetch latest `origin/main`
2. record exact main SHA
3. list active worktrees
4. list uncommitted changes
5. list relevant open PRs
6. inspect active `[WORK-CLAIM]` ownership
7. identify branch collisions
8. inspect #3845
9. inspect #3807
10. inspect #3959
11. inspect #3978
12. inspect #3984
13. inspect #3815
14. inspect #3626
15. inspect current deployed/staging identity only if needed

Do not assume this PRD's observed SHAs remain current.

Required output:

| Area | Existing implementation | Active owner/PR | Missing behavior | Action |
|---|---|---|---|---|
| Unified shell | | | | REUSE/CONNECT/FINISH/REPAIR |
| Mobile | | | | |
| Sources | | | | |
| Photo | | | | |
| Threads | | | | |
| Evidence | | | | |
| Persona | | | | |
| Safety | | | | |
| Release | | | | |
| Demo | | | | |

No implementation until this matrix exists.

### Phase 1 — Prove the Canonical Golden Conversation

Select one realistic technician scenario.

Use one real equipment manual.

The acceptance question must require evidence from that manual.

Record the expected passage before running the test.

Journey:

**manual/photo -> question -> evidence-backed answer -> citation -> follow-up -> persist -> reopen**

First prove on the lowest-cost supported environment. Then prove on web. Then prove on Pixel for the hardware-dependent flow.

Do not expand scope until this journey exposes a specific gap.

### Phase 2 — Repair Only the Gaps Found by the Journey

For every failure:

1. identify owning subsystem
2. find existing implementation
3. write a failing regression/control
4. repair the smallest responsible layer
5. prove opposite-direction behavior
6. rerun the Golden Conversation

Examples:

- upload control unreachable -> repair navigation seam
- attachment lost -> repair adapter
- stale thread after restart -> repair hydration
- citation points to wrong passage -> repair evidence relationship
- MIRA changes personality when a source is selected -> repair intelligence contract
- unsafe generated answer leaks -> repair pre-emission answer floor

Do not respond to a failed journey by redesigning unrelated screens.

### Phase 3 — Cross-Surface Continuity

Prove:

```
Phone
  ↓
same thread
  ↓
Web
  ↓
same thread
  ↓
Phone
```

The following identities must remain stable where the current architecture supports them:

- project
- thread
- notebook/context binding
- user message
- assistant answer
- evidence/citation relationship

Do not fabricate identity mappings merely to make the test pass.

### Phase 4 — Safety Adversarial Pass

Run bounded adversarial cases against the same product path.

At minimum:

1. energized work request
2. numbered energized procedure
3. safe VFD-display observation
4. unrelated manual present
5. device-specific unknown fault code
6. source miss
7. source-only miss
8. photo with no reliable identity

For each result record:

- input
- selected mode
- evidence available
- answer emitted or withheld
- reason
- citation state
- uncertainty state

Observation-path failures must not be mislabeled as product failures. Product failures must not be mislabeled as observation failures.

### Phase 5 — Release Candidate Evidence

Only after the product journey passes:

1. run required CI
2. confirm current-head identity
3. validate release manifest
4. compare expected vs deployed staging identity
5. create real device evidence where required
6. run the parity acceptance path
7. preserve #3984 until its clearing conditions are actually proven

Do not weaken gates to obtain green.

### Phase 6 — Public Demo

After the technician path is stable:

1. converge #3815 against accepted shared-shell behavior
2. prove SimLab preview
3. verify simulated provenance is explicit
4. verify anonymous boundary
5. connect real conversion destination through #3828
6. do not expose internal grader/rubric data

## 9. Definition of Done

The implementation milestone is complete only when the following can be demonstrated.

### Technician experience

A technician can:

- start a conversation
- create/select a project
- attach a manual
- attach/capture a photo
- ask a useful question
- receive a coherent answer
- inspect evidence
- follow up
- reopen the conversation

### Evidence

When an answer claims source grounding:

- a citation exists
- the user can open it
- it resolves to the real supporting passage
- the source belongs to the user's permitted context
- unrelated retrieved material is not treated as proof

### Cross-surface

One persisted conversation survives:

- Android cold restart
- web continuation
- return to Android

### Intelligence

Normal use exposes one recognizable MIRA.

Selecting a source must not silently turn the assistant into a different personality.

### Safety

Unsafe energized-work procedural guidance never reaches the client.

Safe observational alternatives remain usable.

### Provenance

The acceptance packet records:

- exact code SHA
- environment
- Android package/version when relevant
- artifact identity
- evidence identity
- physical vs simulated source
- test/proof timestamps

## 10. Evidence Package

Every implementation slice closes with evidence rather than adjectives.

Required format:

### CURRENT STATE

Exact main SHA and relevant deployed SHA.

### WHAT CHANGED

Files/components and behavior.

### WHY

Observed product failure being repaired.

### TESTS

Focused tests and broader affected suite.

### NEGATIVE CONTROL

What intentional defect causes the test/gate to fail.

### LIVE PROOF

Actual observed journey and environment.

### STILL BLOCKED

Anything not genuinely proven.

### NOT CLAIMED

Explicitly state things such as:

- no production deploy
- no physical-device proof
- no release approval
- no #3984 closure

when applicable.

### BEST NEXT ACTION

Exactly one next action.

## 11. Working Rules for Codex

### Do

- use an isolated worktree
- start from current GitHub truth
- inspect existing implementation before coding
- reuse current architecture
- preserve existing user data and identities
- use red-first regression tests for demonstrated defects
- use opposite-direction controls
- report exact SHAs
- use the smallest proof path
- update existing PRs when ownership safely permits
- create a new bounded PR only where no current carrier exists

### Do not

- overwrite another active work claim
- force-push someone else's branch
- silently combine unrelated PRs
- create another UI shell
- create another RAG stack
- create another chat store
- create another evidence contract
- create another release framework
- build a new simulator
- make OT write-capable changes
- treat a synthetic Pixel/device result as real
- declare acceptance from CI alone
- close #3984 without the actual clearing proof

## 12. Collision Protocol

Before editing any file:

1. search open PRs touching it
2. search active work claims
3. inspect current branch owner
4. inspect current shared-core ownership

If another active lane owns the file:

- do not edit it
- integrate around it
- wait for/mainline its accepted result
- or explicitly report the collision

Shared-core should have one writer.

## 13. Human Boundaries

Stop for Mike only when genuinely required for:

- merge authorization where repo policy requires it
- production deploy
- OTA publish
- physical Pixel interaction that cannot be automated safely
- credentials unavailable to the execution environment
- changing repository protection/required-check configuration
- a product decision with two materially different viable UX outcomes
- destructive migration
- OT/network/security change outside existing approved workflow

Do not stop merely because implementation is difficult.

## 14. Non-Goals

Not part of this PRD:

- new CMMS product
- new mobile architecture
- another design system
- another chat framework
- new LLM provider cascade
- predictive maintenance ML
- autonomous maintenance
- PLC/VFD control
- whole-factory autodiscovery
- hardware redesign
- general fleet-management expansion
- new release-management platform
- replacing Ignition
- replacing existing historian infrastructure

## 15. Priority Order

If work competes for time, use this ordering:

1. **Technician Golden Conversation**
2. **Mobile/web persistence and cross-surface continuity**
3. **Safety/evidence correctness**
4. **Unified MIRA intelligence behavior**
5. **Release/staging support needed by 1–4**
6. **Public demo**
7. **Everything else**

Infrastructure exists to support the product.

Do not reverse that dependency.

## 16. First Implementation Task

Begin with reconnaissance, then drive this exact proof:

> On the current unified product, create/open a project, attach one real equipment manual, ask one question whose answer is present on a known page, receive a cited answer, open the citation, ask a follow-up, cold restart Android, confirm the same conversation, open the same thread on web, continue it, and return to Android.

Use that journey to identify the **smallest actual missing product behavior**.

Fix that first.

Do not begin by inventing another roadmap.

## 17. Completion Report

When the milestone closes, report only:

### CURRENT STATE
Exact main/deployed/device identities.

### GOLDEN CONVERSATION
PASS / FAIL per step with evidence.

### CHANGES LANDED
PRs and SHAs.

### SAFETY
#3984 state and exact proof status.

### MOBILE
Physical Pixel evidence status.

### WEB
Cross-surface continuity status.

### RELEASE
RC state and unresolved blockers.

### DEMO
Current #3815/#3828 status.

### STILL BLOCKED
Concrete unresolved items only.

### BEST NEXT ACTION
Exactly one.
