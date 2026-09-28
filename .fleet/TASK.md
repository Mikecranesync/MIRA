# FLEET-002 — Render persisted `safetyNotice` in every applicable client

## Identity
Bravo implementation worker. Worktree ~/Mira-worktrees/fleet-run-02,
branch `fleet/chatui-safety-render-02`, based on `fleet/chatui-slice-01` (FLEET-001,
already independently verified PASS and now HELD PR #3517).

## The defect to eliminate
A safety hard-stop now PERSISTS correctly (FLEET-001 put
`{kind:"safety_notice", trigger}` into the turn's `evidence[]`, and `splitEvidence` /
`persistedTurns` surface it as `HydratedTurn.safetyNotice`). **But no client reads it.**
So a LOTO / arc-flash refusal still RELOADS looking like an ordinary assistant answer.

Product requirement:
> A LOTO, arc-flash, or other industrial-safety refusal must remain UNMISTAKABLY a safety
> hard-stop after persistence, hydration, reload and navigation — recognisable without
> reading the prose.

## Investigate FIRST (do not assume one surface)
Find EVERY client surface that renders persisted assistant turns, then decide scope:
- mira-hub `src/components/equipment/NotebookChat.tsx` (web notebook chat) — consumes
  `persistedTurns`; does its local `ChatTurn` type carry safetyNotice? (FLEET-001 review
  said no.)
- mira-hub `readNotebookStream` in `notebook-chat-utils.ts` — the LIVE path currently has
  no `else if (frame.kind === "safety")` branch, so live safety identity is dropped too.
- mira-mobile `src/screens/NotebookScreen.tsx` + `src/lib/sse.ts` — legacy mobile chat on
  main; check whether it has any safety reader on either the live or persisted path.
- Any other surface that renders persisted turns (NodeChat / AssetChat use a DIFFERENT
  untyped dialect and may not receive safety frames at all — verify before touching them).

NOTE: the mira-mobile ChatV2 surface lives in HELD PR #3516 and is NOT on this branch.
Do not try to modify it here. If mobile work belongs to that PR, say so in the handoff.

## Acceptance requirements
- Persistence: unchanged from FLEET-001 (do not regress it).
- Hydration: reload restores the safety identity.
- Rendering: a persisted safety turn renders as a DISTINCT safety notice, not a normal answer.
- Visual distinction: recognisable without interpreting prose.
- No ordinary-answer affordances: do not show citation chips / grounded-answer badges /
  follow-up chips / "answered" affordances on a safety turn unless genuinely valid.
- Live + reloaded consistency: same semantic meaning both ways.
- Backward compatibility: OLD persisted turns with no marker must still load safely.
- Streaming truth: do NOT regress STRM-2 terminal-status / truncation rules.
- Evidence: do not break citation persistence or Notebook grounding.
- Reuse existing safety styling/components if any exist; do not clean-room a new one.

## Tests required (run them, paste REAL output)
- targeted safety persistence + rendering + hydration tests
- broader UI/adapter sweep:
  cd mira-hub && npx vitest run src/app/api/equipment-notebooks src/components/equipment
- TYPE CHECK (mandatory — FLEET-001's blocking defect was found here, not by vitest):
  cd mira-hub && npx tsc --noEmit -p tsconfig.json
  Separate NEW touched-file errors from the 32 PRE-EXISTING baseline errors.
- If you change mira-mobile: cd mira-mobile && npx vitest run <files> and npx tsc --noEmit.
  Do NOT claim device proof — no Pixel is attached to this run.

## Deliverables
1. Code in THIS worktree only. NOTE: this machine has NO bun — use `npx`.
2. Commit on `fleet/chatui-safety-render-02` (do NOT push).
3. `.fleet/HANDOFF.md`: task ID, branch, worktree, commit, files changed, behaviour
   implemented, tests run + REAL results, type-check results (new vs pre-existing),
   known limitations, decisions, failed approaches, next action.
4. Do NOT self-approve. Charlie reviews independently.
