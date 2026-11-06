# CV-101 guided first-user implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A navigable six-workflow CV-101 guide inside the existing FactoryLM
shell, with working safe practice and separate evidence-backed live blockers.

**Architecture:** One bounded Hub adapter dialog launched by the existing
account footer. Reuse source viewing, Work Packet record controls and the
Living Sheet event reducer/print renderer. Tutorial-local state never enters
real jobs, chat, equipment or Atlas; pinned real receipts stay read-only.

**Tech Stack:** Existing React19/TypeScript, shared FactoryLM tokens, Vitest,
existing browser proof tooling. No new dependency or framework.

**Spec:** `docs/superpowers/specs/2026-11-06-cv101-guided-first-user-design.md`

## Global constraints

- Branch from211e5c78e; preserve PR5241's exact head/body.
- Own only CV101 adapter files, bounded footer launcher, tests, Hub minor
  metadata, and new docs/proof/journal. Do not touch active shared-core/host/
  WorkPacketPanel owners.
- Practice makes no service calls. No Atlas, configuration, equipment, source,
  auth or production writes. No merges/deployments/purchases.
- Synthetic/historical/live/proposed claims and statuses remain distinct.
- Stop live testing at missing owner identity, reader identity or freshness.

## Review focus

- Practice completion must never change the fixed live acceptance statuses.
- A user switching accounts must not see another user's practice notes.
- Corrupt or denied storage must not masquerade as a saved/recalled job.
- A prepared answer/source must never be labelled a live MIRA retrieval.
- Phone navigation, nested source view and Escape/Back must retain focus and
  leave the real notebook/job untouched.

### Task 1: practice model and fixed evidence

**Files:** Create `mira-hub/src/factorylm-ui/cv101-walkthrough-model.ts` and
`cv101-walkthrough-model.test.ts`.

**Interfaces:** `CV101_WORKFLOWS`, `CV101_COMPONENTS`, `CV101_EVIDENCE` contain
pinned evidence and explicit source state. `newPractice`, `updatePracticeRecord`,
`finishPractice`, `parsePractice`, `practiceView` reuse existing packet/record/
event types. No fetch or server imports. Status derivation is practice-only;
live results are immutable dated evidence.

- [x] Write failing tests for event replay/chronology, no inherited execution,
  finish prerequisites and duplicate finish, corrupted/mismatched/oversized
  persisted envelopes, viewer scoping and fixed live statuses.
- [x] Run the focused model suite and capture red output.
- [x] Implement bounded synthetic fixtures and adapters over existing record
  functions/validators/reducer; no canonical store or speculative abstraction.
- [x] Run focused tests to green and inspect generated event output.

### Task 2: actual UI and launcher

**Files:** Create `CV101Walkthrough.tsx`, `CV101Architecture.tsx`,
`CV101PracticeInspection.tsx`, `CV101Walkthrough.test.tsx`; modify only the
bounded `HubAccountFooter.tsx` launcher and its relevant tests; extend
`LivingSheetPrint.tsx` with an optional inline preview that never mounts a
print portal or global print CSS. Default callers remain unchanged.

**Interfaces:** `CV101Walkthrough` receives viewer scope and close callback;
renders six workflow panels and case study/live-evidence views. Reuse
`SourceViewer` for OEM reference, existing Work Packet controls and
`LivingSheetPrint` for the synthetic inspection and recall.

- [ ] Add rendering tests asserting all six instructions, expected/actual/
  evidence/status labels, persistent demo disclaimer, unchanged real blockers
  and no false live/provider/acceptance labels.
- [ ] Build accessible native dialog, numbered navigation, previous/next,
  responsive visual relationship diagram and source/status cards with tokens.
- [ ] Wire practice selection→component/source exploration→sample replay→
  prepared citation→inspection/checkoffs/notes/finish→reload/recall.
- [ ] Handle denied/quota storage and viewer-scope changes visibly; do not
  advance a saved/recall result on failure. Keep source close inside dialog.
- [ ] Mount from existing footer without touching shared-core or host owners.
- [ ] Run focused and adjacent footer/record/reducer/print regressions and
  scoped lint/type checks. Update meaningful Hub minor metadata per doctrine.

### Task 3: browser proof and reviewable dependent draft

**Files:** Own `docs/proofs/cv101-guided-first-user/**`, promo screenshots and
`wiki/hot.d/2026-11-06-cv101-guided-first-user-charlie-task3.md`.

- [ ] Use the existing product component in the existing test/preview patterns;
  never create a separate demo product or bypass authentication.
- [ ] Execute every practice step, open source viewer/original reference,
  record a note/checkoffs, finish, reload and retrieve the same demo job.
- [ ] Capture actual desktop1440×900/mobile412×915 screenshots of all six
  workflows, actual results/statuses, browser errors/requests and timings.
- [ ] Verify no service mutation, reader/LLM/Atlas request or horizontal
  overflow. Exercise offline/denied storage, corrupt reload and viewer change.
- [ ] Save reproducible acceptance checklist/evidence, mark all real
  authentication/reader/freshness/job/recall/Atlas gaps explicitly.
- [ ] Recheck ownership/remote state; open one dependent draft against the
  preserved5241 branch; run independent exact-base/head/body delta review and
  applicable checks. Do not imply a non-main base clears release gates.
- [ ] Freeze reviewed head/body; report working practice separately from
  blocked live acceptance, exact revision and remaining human actions.
