# Sprint Log — 2026-08-31 autonomous window

Append-only. One entry per slice/event. This file (plus each slice's own `.fleet/HANDOFF.md`
and PR) is the durable record — not chat transcript.

## Pre-window state (carried in, not part of this window's work)

- **FLEET-001** — PR #3517, HELD, PASS. Persist safety marker in `evidence[]`.
- **FLEET-002** — PR #3518, HELD, PASS (after one correction round: machine-replay/
  visual-observation cards gated on `!safetyNotice`; MINOR finding noted — safety-stop text
  lingers in the LLM history window, correctly deferred as pre-existing/out of scope).
  Built by a parallel real Bravo/Charlie node pair on `fleet/chatui-safety-render-02`.
- **Collision note:** this coordinator independently built an equivalent FLEET-002 (PR #3519,
  branch `fleet/chatui-slice-02`) in parallel, ~3 min later and less thorough. Closed as
  duplicate, branch deleted. Lesson applied below.

## 13:2x — Priority 1 check

FLEET-002 (PR #3518) reconfirmed HELD/OPEN/PASS, head unchanged since last check
(`6f4914629`). **No work needed — Priority 1 already satisfied going into this window.**
Moving directly to Priority 2.

## 13:2x — Priority 2 investigation

Read PR #3514 (PRD+ADR-0038/0039, both **Proposed**, not accepted — Phase-1 assistant-ui
rewrite explicitly out of scope for this window) and PR #3516 (mobile ChatV2 — mature, HELD,
own governance, off-limits per collision-avoidance). Grepped `AssetChat`/`NodeChat` routes:
confirmed they have safety-keyword detection (`matchSafetyStop`, `scanBoth`/`handleSafetyAlert`
— a *different*, pre-existing, untyped safety-alert system, #2542) but a full parity build vs.
Notebook chat's typed contract is under-scoped for a live build this window — documented as a
future candidate, not attempted now.

**Selected FLEET-003:** close the MINOR finding PR #3518's own review surfaced and correctly
deferred — `historyFromTurns()` doesn't exclude a safety-stop turn from the conversation history
sent back to the LLM, so the `SAFETY_STOP` prose can re-enter context on a later turn. Small,
additive, well-scoped, same file family, no ADR/lane dependency, "regression tests for a
previously discovered defect" per the charter's own example category.

## 13:2x — FLEET-003 dispatched

Branch `fleet/chatui-slice-03` pushed (base: `fleet/chatui-safety-render-02` @ `6f4914629`,
task commit `084c6b1b7`). Collision-checked fresh immediately before push (fetch + `gh pr list`
+ `git ls-remote` — clean). Assigned to a `developer`-profile Bravo worker via CAO `assign`
(isolated worktree, terminal `3bb57f0c`). Awaiting completion — CAO delivers to this
coordinator's inbox automatically on idle; no polling.

## Documented candidates for the queue after FLEET-003 (not yet built — scoped only)

Recorded here so the loop has a primed queue without re-deriving this each wake, and so
progress is legible even if the window ends before reaching them.

- **Candidate A — NodeChat/AssetChat safety-parity scoping (investigation slice, not a build).**
  Both routes already detect safety phrases via a *different*, pre-existing system
  (`@/lib/agents/safety-alert`, `matchSafetyStop`/`scanBoth`/`handleSafetyAlert`, the H4
  gap-admission net #2542) — untyped `data: {content}` SSE, not the Notebook chat's typed
  `NotebookSafetyFrame`/`SafetyNoticeEntry` contract. Before building anything: does either
  route persist enough on the turn row to distinguish a safety-alert turn on reload today? If
  not, is the additive-`evidence[]`-marker pattern from FLEET-001 portable to their persistence
  model, or does it need a materially different approach? This needs a dedicated read-only
  investigation pass before any code — do not build live without it.
- **Candidate C — regression-test sweep for previously-discovered, still-undertested defects**
  in the Notebook chat stack. Check `docs/known-issues.md` and closed-but-related issues
  (#2542, #3453/#3454 streaming prerequisites, STRM-2 lineage #3450/#3452) for anything fixed
  in code but never pinned by a test — the safest possible category per the charter's own
  blocked-work fallback, usable as a filler task if a build slice stalls.

## 14:1x — FLEET-003 reviewed and closed out

Bravo (terminal `3bb57f0c`) reported completion at commit `4a5cd15f5`. Independent review in
Bravo's own worktree: re-ran vitest (38/38, matches), targeted tsc grep (empty, matches), full
tsc (32 errors / 58 lines, both metrics independently confirmed, no regression), broader sweep
(333/333, 21/21 files, net +1 exactly). Adversarial hunt: `safetyNotice` null/undefined edge case
safe, no collision with the unrelated server-side `ChatHistoryTurn`, traced `route.ts`'s
`sanitizeHistory` to confirm no parallel server-side leak (client fix closes the loop at the
single source of truth). **Zero findings — clean PASS.**

Pushed `.fleet/REVIEW-FINAL-003.md`, pushed the branch, opened **PR #3521**
(`fleet/chatui-slice-03`, stacked on #3518), HELD. `delete_terminal(3bb57f0c)`. (PR #3520 seen in
the numbering gap was unrelated — `chore/promo-director` — no collision.)

## 14:2x — FLEET-004 dispatched (investigation, not a build)

Before committing to a build for the NodeChat/AssetChat candidate (documented above), did a
bounded direct-grep investigation myself: confirmed both routes already share the SAME safety
classifier as Notebook chat (`matchSafetyStop`/`SAFETY_STOP` from `@/lib/safety-classifier`) plus
a separate existing H4 gap-admission net (`@/lib/agents/safety-alert`, #2542) — detection is
unified, only wire format/persistence differ. But `AssetChat`'s route persists to
`decision_traces` (a materialized-evidence/audit table, not obviously a reload store) and
`NodeChat`'s route has **zero persistence writes found** — meaning it may not support
reload/hydration at all today. This confirmed the gap is architecturally deeper than FLEET-001's
shape, not safely buildable blind this window.

Also did a quick targeted check on the CMPS-2 Retry path's interaction with a safety-stop turn
(does Retry misfire on a safety-stop response?) — **clean, no gap**: a safety-stop is a normal
non-throwing 200 SSE completion, never enters the failure/retry branch at all.

Dispatched **FLEET-004** as a read-only investigation task (branch
`fleet/chatui-slice-04-scoping`, base `origin/main`, standalone — not stacked on the FLEET-00{1,2,3}
chain since it doesn't touch Notebook chat code) to a Bravo worker (terminal `2bd2a766`). Explicit
no-code-edits constraint in the task. Deliverable: an evidence-backed scoping doc, not a fix —
matches the charter's "document an evidence-backed implementation plan for the next slice"
fallback category, and directly informs whatever FLEET-005 becomes.

## 14:3x — FLEET-004 reviewed and closed out (with a correction to my own earlier premise)

Bravo (terminal `2bd2a766`) reported completion at `257c178c0`. **Important: the investigation
overturned my own prior premise.** I had written FLEET-004's task spec asserting NodeChat's zero
server-side DB writes meant it likely had no reload capability at all. That was wrong — I'd
conflated "server doesn't persist" with "surface doesn't reload" and never checked for a
client-side mechanism. Both AssetChat and NodeChat already reload past turns from browser
`localStorage`, and a past safety hard-stop already renders distinctly there (the `isSafetyStop`
flag round-trips through localStorage before the persist `useEffect` runs). I independently
spot-checked every material claim in the document against the actual code (not just trusted it) —
line-by-line: the localStorage mechanics, the `isSafetyStop` ordering, `decision_traces`' shape
(confirmed as a single-record audit lookup, not a conversation store, by tracing its only
consumer), and the H4 `safetyAlertSseChunk` discriminator gap. Every claim held up. **Clean PASS**,
and I'm logging my own miss here rather than quietly absorbing the correction.

Pushed `.fleet/REVIEW-FINAL-004.md`, pushed the branch, opened **PR #3522**
(`fleet/chatui-slice-04-scoping`), docs-only, HELD. `delete_terminal(2bd2a766)`.

**Real gap confirmed, correctly deferred:** true safety-persistence parity (server-durable,
cross-device history for AssetChat/NodeChat) needs a schema/design decision — flagged for Mike,
NOT attempted this window, per the charter's forbidden-actions list.

**Real gap found, in scope, dispatched as FLEET-005:** the H4 gap-admission safety-alert SSE frame
(`safetyAlertSseChunk`, #2542 — separate from the hard-stop mechanism) is emitted as an
undiscriminated `content` chunk and silently swallowed into the ordinary assistant bubble in both
`AssetChat.tsx` and `NodeChat.tsx` (literal asterisks show too, since neither renders markdown).
Small, additive, no schema change.

## 14:3x — FLEET-005 dispatched

Fresh collision check before push (fetch + `gh pr list` + `git ls-remote`) surfaced PR #2550
(merged 2026-07-07, "H4 parity" KB-gap admission wording) — read it, confirmed unrelated (touches
`kb-gap.ts`/`route.ts` for a different H4 concern, never `safety-alert.ts` or the chat components)
— no collision, proceeded. Branch `fleet/chatui-slice-05` pushed (base `origin/main`, task commit
`466a4269f`). Dispatched to a Bravo worker (terminal `0f64354c`).

<!-- Further entries appended below as the window progresses -->
