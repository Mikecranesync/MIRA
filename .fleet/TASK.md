# FLEET-002 — render the persisted safety-stop marker (ADR-0038 item 3, part 2)

## Your identity
You are the Bravo implementation worker in the FactoryLM CAO fleet.
Base branch: `fleet/chatui-slice-02` (cut from `fleet/chatui-slice-01`, which is
HELD PR #3517 — the data-layer slice). Work ONLY in your assigned worktree.
Do NOT push to `main`. Do NOT push to `fleet/chatui-slice-01` (that PR is closed
to further commits except review evidence). Commit locally; do NOT push until
told to — Charlie reviews independently before anything is pushed, same as FLEET-001.

## Background (already established — do NOT redo this archaeology)

FLEET-001 (PR #3517, HELD, verdict PASS) closed the **server-side** half of a
safety-persistence gap: a LOTO/arc-flash safety hard-stop now persists as
`evidence: [{kind:"safety_notice", trigger}]` instead of `evidence: []`, and
`persistedTurns()` in `mira-hub/src/components/equipment/notebook-chat-utils.ts`
surfaces it as `HydratedTurn.safetyNotice`. That type and the hydration path
already exist on your base branch — read them first
(`splitEvidence`, `persistedTurns`, `SafetyNoticeEntry`,
`isSafetyNoticeEntry` in `mira-hub/src/lib/notebook-chat-types.ts`).

**What FLEET-001 explicitly did NOT do (verified by grep, not assumed):**
Neither the LIVE path nor the RELOAD path currently renders anything distinct
for a safety turn:

- `mira-hub/src/components/equipment/notebook-chat-utils.ts` —
  `readNotebookStream()` (the client SSE parser) switches on `frame.kind` for
  `sources` / `evidence` / `followups` / `content` / `status`. There is **no
  branch for `frame.kind === "safety"`** — the `NotebookSafetyFrame` the route
  already emits (`mira-hub/src/app/api/equipment-notebooks/[id]/chat/route.ts`,
  `safetyStopResponse()`) is silently dropped on the client today. This is
  **deliberate, documented graceful-degradation** (see the comment on
  `safetyStopResponse`): the safety warning text is *also* sent as ordinary
  `content` frames (the `SAFETY_STOP` prose), so a client that ignores the
  `safety` frame still shows a complete, correct answer. **Preserve that
  guarantee** — the badge you add is additive, never load-bearing for
  correctness.
- `mira-hub/src/components/equipment/NotebookChat.tsx` has **zero** references
  to "safety" anywhere in the file (confirmed by grep). `ChatTurn` has no
  `safetyNotice` field. `Bubble()` has no render branch for it.

So: right now, LIVE and RELOADED safety turns both render as plain prose with
no visual distinction from an ordinary answer. Your job is to add that visual
distinction, sourced from the SAME field on BOTH paths.

## Your slice

1. **`StreamResult` (`notebook-chat-utils.ts`)** — add
   `safetyNotice: SafetyNoticeEntry | null` (mirror `machineEvidence` /
   `visualEvidence`, which already follow this exact null-default pattern).
2. **`readNotebookStream()`** — add an `else if (frame.kind === "safety")`
   branch that sets `out.safetyNotice = { kind: "safety_notice", trigger: frame.trigger }`
   (or reuse `isSafetyNoticeEntry` if you shape it as one — your call, but it
   must satisfy `SafetyNoticeEntry`/`isSafetyNoticeEntry` so the SAME render
   branch in `NotebookChat.tsx` works for both live and hydrated turns).
3. **`NotebookChat.tsx`**:
   - `ChatTurn` gets `safetyNotice?: SafetyNoticeEntry` (mirror the
     `machineEvidence?`/`visualEvidence?` doc-comment style already there).
   - The call site around line ~316 (`const { content, citations, status, basis,
     followups, machineEvidence, visualEvidence } = await postNotebookChat(...)`)
     destructures `safetyNotice` too and sets it on the turn exactly like
     `machineEvidence`/`visualEvidence` are set (lines ~339-340).
   - `persistedTurns()`'s hydrated `HydratedTurn.safetyNotice` (already exists)
     needs to flow into the SAME `ChatTurn.safetyNotice` field wherever hydrated
     turns are mapped into `ChatTurn[]` for the component — find that mapping;
     do not create a second field.
   - `Bubble()` gets a new render block for `turn.safetyNotice`, modeled on the
     existing `turn.machineEvidence`/`turn.visualEvidence` blocks (lines ~133-171)
     for structure, but **visually distinct as a STOP/warning, not a citation
     chip** — this is a safety escalation, not evidence. Use FactoryLM UI-style
     tokens (`.claude/rules/ui-style.md`): red/danger state color for the
     fault/stop state, never decorative, muted otherwise. `data-testid="safety-notice-badge"`.
     Content: something like an icon + "Safety stop — {trigger}" — keep it short,
     the full explanation is already in the answer prose above it.
4. **Do not touch**: `mira-hub/src/app/api/equipment-notebooks/[id]/chat/route.ts`
   (server already emits/persists correctly — FLEET-001's job, done),
   `mira-hub/src/app/labs/**` (another lane owns it), anything under
   `mira-mobile/` (that's PR #3516's lane, not this one), the `SAFETY_STOP`
   prose text itself, or terminal-status (`answer_status`) semantics.

## Hard constraints

- Do NOT weaken evidence, citation, persistence, streaming-truth, or safety
  behaviour. Do NOT mark a truncated stream complete.
- The badge must render identically (same component/props/testid) whether the
  turn came from the live stream or from `persistedTurns()` hydration — one
  render path, two producers. If you find yourself writing two different badge
  components for live vs. hydrated, stop — that's the wrong shape.
- `safetyNotice` is never a citation: no `docId`, never enters
  `sources.citations`/`sourceSnapshot`, and must not be swept into whatever
  code renders the citations list.
- If `safetyNotice` is absent/null, render exactly as before (no layout shift,
  no empty wrapper).
- Do NOT run migrations, deploy, merge, or push to `main` or to
  `fleet/chatui-slice-01`.
- Keep the diff minimal and reviewable — this is a presentation-layer slice on
  top of an already-persisted field, not a redesign.

## Required outputs

1. Code change in your assigned worktree only.
2. Tests: extend `mira-hub/src/components/equipment/notebook-chat-utils.test.ts`
   for the new `readNotebookStream` `safety` frame handling (prove a `safety`
   SSE frame produces `StreamResult.safetyNotice` and is never treated as a
   citation), and `mira-hub/src/components/equipment/NotebookChat.test.tsx`
   for the render (prove the badge renders for a turn with `safetyNotice` set —
   live-shaped AND hydrated-shaped — and does NOT render when absent). Run
   the relevant test files and record the ACTUAL output.
3. Run `cd mira-hub && npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E "notebook-chat-utils.test|NotebookChat.test"` —
   must be empty before you claim done (this is exactly the class of bug
   FLEET-001's BLOCKING finding was — green vitest missed 6 tsc errors that
   would have failed `next build` / hub-e2e.yml).
4. `git add` + `git commit` on branch `fleet/chatui-slice-02` (do NOT push).
5. Write `.fleet/HANDOFF.md` (overwrite the FLEET-001 one — this branch's own
   copy) containing: objective, files changed, decisions made, failed
   approaches, tests run + results (real output, not a paraphrase), tsc grep
   output, current commit SHA, blockers, next action.
6. Do NOT self-approve. Charlie reviews independently, same adversarial
   process as FLEET-001 (see that branch's `.fleet/CORRECTIONS.md` for the
   kind of finding to expect if something's off — tsc errors in touched test
   files were the exact miss last time).
7. When done, `send_message` back with: the commit SHA, the absolute path to
   your worktree, and the real test + tsc output pasted inline (not just
   "tests pass").

## Test commands

```
cd mira-hub && bun install --frozen-lockfile   (if node_modules missing)
cd mira-hub && bun run vitest run src/components/equipment/notebook-chat-utils.test.ts src/components/equipment/NotebookChat.test.tsx
cd mira-hub && npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E "notebook-chat-utils.test|NotebookChat.test"
```

Start by reading `mira-hub/src/lib/notebook-chat-types.ts`,
`mira-hub/src/components/equipment/notebook-chat-utils.ts` (`readNotebookStream`,
`persistedTurns`, `splitEvidence`), and `mira-hub/src/components/equipment/NotebookChat.tsx`
(`ChatTurn`, `Bubble`, the `postNotebookChat` call site). The archaeology above
is already verified — don't redo it, just confirm line numbers against your
checkout before editing (they may have drifted slightly).
