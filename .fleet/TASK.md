# FLEET-001 — ChatGPT-class UI: close the safety-frame persistence gap

## Your identity
You are the Bravo implementation worker in the FactoryLM CAO fleet.
Worktree: ~/Mira-worktrees/fleet-run-01   Branch: fleet/chatui-slice-01
Base: origin/main @ 583cda81a. Work ONLY in this worktree.

## Background (already established — do NOT redo this analysis)
The ChatGPT-class conversational UI program has three HELD PRs (fetched locally as
branches pr-3514 / pr-3515 / pr-3516). #3514 = PRD + ADR-0038/0039. #3515 = hub spike
(owned by ANOTHER lane — do not touch labs/chat-spike). #3516 = mira-mobile ChatV2.

A verified defect was found and is NOT yet fixed on main:

  A SAFETY HARD-STOP DOES NOT SURVIVE RELOAD.

The hub emits a typed `{kind:"safety", trigger}` SSE frame (see
mira-hub/src/lib/notebook-chat-types.ts, type NotebookSafetyFrame) when a turn is refused
for safety reasons. But the turn is PERSISTED as an ordinary `answer_status='answered'`
row with no safety marker. So on reload/hydration the safety identity is lost and a
LOTO/arc-flash refusal renders as a normal assistant answer. That is the exact failure
mode `mira-industrial-safety` exists to prevent.

## Your slice (small, bounded, high value)
Persist the safety marker server-side so hydration can restore it.

Approach (already decided in ADR-0038 item 3 — do not redesign):
- Persist a `{kind:"safety_notice", trigger}` entry INSIDE the turn's existing `evidence[]`
  JSONB, exactly the way `machine_evidence` and `visual_observation` already ride there.
- NO database migration. NO change to the `answer_status` CHECK constraint.
- Add a type + type guard next to `isMachineEvidenceEntry` / `isVisualObservationEntry`.
- Make sure every existing `evidence[]` reader SKIPS it (it is NOT a citation: no docId,
  never in sources.citations or sourceSnapshot).
- Ensure the hydration/read path surfaces it so a reloaded safety turn is distinguishable.

## Hard constraints
- Do NOT weaken evidence, citation, persistence, streaming-truth or safety behaviour.
- Do NOT mark a truncated stream complete. Do NOT alter terminal-status semantics.
- Do NOT touch mira-hub/src/app/labs/** (another lane owns it).
- Do NOT run migrations, deploy, merge, or push to main.
- Keep the diff minimal and reviewable.

## Required outputs
1. Code change in this worktree only.
2. Tests: add/extend unit tests proving a safety turn round-trips (live -> persisted ->
   hydrated) and is NOT mistaken for an ordinary answer. Run the relevant test file(s)
   and record actual output.
3. `git add` + `git commit` on branch fleet/chatui-slice-01 (do NOT push).
4. Write `.fleet/HANDOFF.md` containing: objective, files changed, decisions made,
   failed approaches, tests run + results, current commit SHA, blockers, next action.
5. Do NOT self-approve. Charlie reviews independently.

## Test commands
cd mira-hub && bun install --frozen-lockfile   (if node_modules missing)
cd mira-hub && bun run vitest run <the test files you touched>

Start by reading mira-hub/src/lib/notebook-chat-types.ts and the notebook chat route's
persistence path. Keep archaeology tight — the diagnosis above is already verified.
