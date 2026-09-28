# Scoping: Stop-control parity for AssetChat / NodeChat vs. Notebook chat

**Status:** Investigation only — no code changed. FLEET-008, read-only worker.
**Base:** `origin/main` @ `583cda81a` (branch `fleet/chatui-slice-08-scoping`, HEAD `5b7551ee6`).
**Author note (inherited caveat, re-verified):** FLEET-005/006/007 (PRs #3523/#3524/#3525,
which add `hasSafetyAlert`, an exported `NodeChat` `MessageBubble` + tests, and a design-token
color fix to these same two files) exist in the repo's object graph but are **not merged into
`origin/main`** — `git merge-base --is-ancestor c972a3379 HEAD` returns false. Everything below
about `AssetChat.tsx` / `NodeChat.tsx` is read from the current checkout (`origin/main`), which
does **not** include those three PRs' changes. Once they merge, re-verify line numbers before
building anything from this doc.

---

## TL;DR

1. **Neither `AssetChat.tsx` nor `NodeChat.tsx` renders any Stop/cancel control, visible or
   otherwise, while `streaming` is true.** The submit-button slot shows a disabled, non-clickable
   spinner (`Loader2`) during streaming in both files — it is not a Stop button, it does nothing
   on click (it's `disabled`), and no other control appears anywhere in either component during
   streaming.
2. **The only way to reach `abortRef.current?.abort()` in either file is `clearHistory()`**,
   which is gated behind the header's "Clear" button (only rendered once `messages.length > 0`)
   and, in the same call, unconditionally wipes the entire message array and localStorage key.
   There is no code path that aborts *only* the in-flight turn while preserving prior turns —
   the task's premise that "an abort mechanism exists internally" is correct, but it is coupled
   1:1 to full-thread deletion, not exposed as an independent action.
3. **This is a real, non-mitigated gap.** The upstream provider cascade (Groq → Cerebras →
   Together) gives each provider its own 30s fetch timeout before falling through to the next
   (`route.ts:103`, `AbortSignal.timeout(30_000)`, inside a `for (const provider of providers)`
   loop at `route.ts:625`) — so a technician can wait up to ~90s before the first token even
   arrives, with no client-side cap once streaming starts. During all of that, the technician's
   only recourse is to navigate away or hit Clear and lose the whole conversation.
4. **Notebook chat (`NotebookChat.tsx`, merged via #3452/#3450) already ships the exact contract
   this gap is missing** — a visible Stop button (`Square` icon, `aria-label="Stop generating"`,
   replaces the Send button while `busy`), a `stopped: true` flag that keeps partial content but
   marks the turn as not-an-answer, a "Stopped" caption, and exclusion of stopped turns from the
   history sent to the model on the next turn. Its own code comments explicitly frame the abort
   mechanism as *cloned from* AssetChat/NodeChat's pattern (`NotebookChat.tsx:274`: "Stop
   generation (STRM-2) — same pattern as AssetChat / NodeChat") — i.e. the primitive these two
   files pioneered was never finished into a user-facing control here, only in Notebook.
5. **This is small and additive, not schema/persistence-adjacent** — unlike FLEET-004's finding
   for safety-persistence parity. AssetChat/NodeChat have **zero server-side turn persistence**
   today (confirmed unchanged: still exactly one `POST` handler in each route, no `GET`), so a
   client-only `stopped` flag riding the existing `localStorage`-backed `ChatMessage` state is a
   complete, self-contained fix — it doesn't need a server contract like Notebook's
   `persistedTurns()`/`answer_status='error'` half, because there is no server reload to keep in
   sync with in the first place.
6. **Recommendation: buildable now, both files, same shape as FLEET-005/006** — add a visible
   Stop button, a `stopped` flag on `ChatMessage`, a "Stopped" caption in `MessageBubble`, and
   exclude stopped turns from the `apiMessages` history built for the next send. No Mike decision
   needed; scoped below.

---

## 1. Does `AssetChat.tsx` render any Stop/cancel control while `streaming` is true?

**No visible control exists.** Confirmed by reading the full 410-line component, not just the
already-known parts.

- `streaming` state: `AssetChat.tsx:104` — `const [streaming, setStreaming] = useState(false);`.
- `abortRef`: `AssetChat.tsx:108` — `const abortRef = useRef<AbortController | null>(null);`.
- **The header** (`AssetChat.tsx:276-302`) renders exactly one interactive control besides the
  logo/title: the "Clear" button at `AssetChat.tsx:292-301`, gated by `messages.length > 0`
  (line 292) — nothing there is gated on `streaming`, and nothing in the header changes
  appearance or adds a control during streaming.
- **The input row** (`AssetChat.tsx:368-407`, the `<form>`):
  - `textarea` (`:373-390`) is `disabled={streaming}` (line 378) — this *disables* the input, it
    doesn't offer a stop action.
  - `Button` (`:391-406`, `type="submit"`) is `disabled={!input.trim() || streaming}` (line 394)
    — during streaming this button is **inert** (disabled, no `onClick` override, native
    `disabled` blocks all click/keyboard activation). Its icon swaps to `Loader2` with
    `animate-spin` (lines 401-405) purely as a busy indicator — clicking it while streaming does
    nothing.
  - No other button, icon, or interactive element appears anywhere else in the render tree
    (confirmed by reading lines 1-410 in full — the only other buttons are the "Clear" button
    above and the suggested-prompt chips at `:344-364`, which are hidden once `messages.length >
    0`, i.e. exactly when streaming would ever be happening).
- `grep -n "onClick\|<button\|abort()"` inside the file confirms only two `onClick` handlers
  exist total: `clearHistory` (line 294) and the suggested-prompt setter (line 353) — neither is
  conditioned on `streaming`, and `abort()` is called from exactly one place, inside
  `clearHistory` (line 126).

**What the mere-existing abort mechanism actually does, and what it does NOT do:**

- `clearHistory` (`AssetChat.tsx:125-131`):
  ```
  abortRef.current?.abort();
  setMessages([]);
  setError(null);
  setStreaming(false);
  try { localStorage.removeItem(storageKey); } catch { }
  ```
  It aborts the in-flight fetch **and, in the same synchronous call, wipes every message** —
  there is no branch that aborts only the current turn.
- On the fetch side, an abort throws inside the read loop and is caught at `AssetChat.tsx:225-226`:
  ```
  } catch (err) {
    if ((err as Error).name === "AbortError") return;
  ```
  This is a bare early `return` — it does **not** set any `stopped`/`isSafetyStop`-style flag on
  the last assistant message, does not add a caption, and does not distinguish an aborted turn
  from a still-in-progress one in any rendered way. Whatever partial `content` had already
  streamed into the assistant bubble via the earlier `setMessages` calls (lines 188-197) remains
  in state at the moment of abort — but this is moot in practice, because `clearHistory` calls
  `setMessages([])` synchronously in the same tick, immediately discarding it.
- **Net: a technician cannot interrupt a single answer.** The only interruption path (Clear)
  destroys the whole conversation, is only reachable once at least one message already exists
  (`messages.length > 0` gate — on the very first turn of a session there is no Clear button to
  press at all), and gives no acknowledgment that the abort happened differently from a normal
  clear.

## 2. Same question for `NodeChat.tsx`

**Identical finding — no visible Stop/cancel control, same structural pattern.** `NodeChat.tsx`'s
own header comment (`NodeChat.tsx:5`) states it is "Cloned from `components/AssetChat.tsx`" — this
absence is inherited, not independently re-decided.

- `streaming`/`abortRef`: `NodeChat.tsx:143`, `:147` — same shapes as AssetChat.
- Header (`:292-333`): same single "Clear" button (`:323-332`), gated on `messages.length > 0`
  (line 323), nothing gated on `streaming`.
- Input row (`:372-413`): `textarea` `disabled={streaming}` (line 383); submit `Button`
  `disabled={!input.trim() || streaming}` (line 399), `Loader2` spinner (lines 406-410) — same
  inert-during-streaming shape as AssetChat, byte-for-byte the same pattern.
- `clearHistory` (`:162-168`) — identical shape to AssetChat's: `abortRef.current?.abort();
  setMessages([]); setError(null); setStreaming(false); localStorage.removeItem(...)`.
- Catch block (`:250-251`) — identical bare `if ((err as Error).name === "AbortError") return;`,
  no `stopped` flag, no caption.
- `grep -n "onClick\|<button"` again returns exactly two handlers: `clearHistory` (`:325`) and
  the (in NodeChat's case, non-existent — NodeChat has no suggested-prompt chips block at all;
  `grep -n "Common faults\|PM checklist"` returns nothing in this file) — so NodeChat has even
  *fewer* interactive elements than AssetChat, but the Stop-control finding is the same: none.

**Conclusion for both:** the task's own background was accurate on this specific point — an abort
mechanism exists internally in both files, and it is unknown-until-now whether a technician can
reach it mid-stream. **They cannot.** The only trigger is Clear, and Clear is a full-thread wipe,
not a per-turn stop.

## 3. Is the missing Stop control a real gap, or is there a mitigating factor?

**Real gap. No mitigating SLA, timeout, or design rationale found.**

- **No client-side cap on stream duration.** The `while (true) { const { done, value } = await
  reader.read(); ... }` loop (`AssetChat.tsx:173-224`, `NodeChat.tsx:210-249`) has no timeout of
  its own — it runs until the server closes the stream, the fetch errors, or `abort()` is called.
  Nothing in either component imposes a ceiling.
- **The server-side cap that does exist is per-provider-attempt, not per-request, and its
  worst case is materially longer than a technician would tolerate waiting with no way to
  interrupt.** `mira-hub/src/app/api/assets/[id]/chat/route.ts:103` —
  `signal: AbortSignal.timeout(30_000)` — inside `streamFromProvider`, called once per provider
  in the cascade loop at `route.ts:625`, `for (const provider of providers) { ... served = await
  streamFromProvider(provider, ...); if (served) { ...; break; } }`. Per root `CLAUDE.md`
  ("Inference: `INFERENCE_BACKEND=cloud` → Groq → Cerebras → Together"), that loop can try up to
  three providers in sequence before giving up — so in the worst case (each provider stalls to
  its full 30s timeout before failing over) a technician can be staring at "MIRA is thinking…"
  for up to ~90 seconds before a single token streams, and once tokens do start, there is no
  further cap (point above). `mira-hub/src/app/api/namespace/node/[id]/chat/route.ts:103` has the
  identical `AbortSignal.timeout(30_000)` at the identical call shape.
- **No documented design rationale for the omission.** `grep -rn "stop\|abort\|cancel"
  --include="*.md" docs/` was scanned for AssetChat/NodeChat-specific context;
  `docs/plans/2026-08-10-chat-with-any-manual-design.md`,
  `docs/specs/uns-node-centric-knowledge-spec.md`, and `docs/known-issues.md` were checked
  (per FLEET-004's precedent search) and none discuss a deliberate decision to omit a Stop
  control from these two surfaces. No ADR references it.
- **The ChatGPT-class UI PRD treats this as baseline, not optional.**
  `docs/prd/2026-08-30-chatgpt-class-ui-prd.md` §10.9 (on HELD branch
  `feat/chatgpt-class-ui-phase0`, PR #3514 — Proposed/inventory-stage, read for context only, not
  implemented from) lists Stop/cancellation as an expected baseline chat behavior; Notebook chat
  already ships it (see below), which makes AssetChat/NodeChat the outliers, not the norm.
- **The technician's only recourse today is: wait it out, navigate away (leaving the fetch to
  run to completion in the background with no UI consuming its result, or to error silently), or
  hit Clear and lose every prior turn in the thread just to stop one bad answer.** None of these
  is a reasonable substitute for a Stop button.

**Plain statement:** this is a real, user-facing gap. There is no timeout, SLA, or documented
design choice that mitigates it.

## 4. Scoped recommendation (small, additive — matches FLEET-005/006's shape)

This is buildable the same way FLEET-005 (`hasSafetyAlert`, ~27/~26 lines across the two files,
no server/schema changes) and FLEET-006 (exported `MessageBubble` + tests) were scoped and built
in this sprint — same two files, same "add a field, add a render branch, add a filter" shape, no
new state machinery beyond what `NotebookChat.tsx` already proves out as a client-only pattern.

### Why no persistence/schema change is needed here (unlike FLEET-004's safety-persistence finding)

FLEET-004 found that true reload-durability parity with Notebook needs a server-side turn table
— out of scope, flagged for Mike. **Stop-control parity does not have that dependency**, because:

- AssetChat/NodeChat have **no server-side turn persistence at all** today (still exactly one
  `POST` handler per route, confirmed above in §1/§2 evidence and re-checked directly:
  `grep -n "^export async function" .../chat/route.ts` returns only `POST` in both files). There
  is nothing server-side to keep in sync with a `stopped` flag.
- Their entire persistence layer is the client `localStorage` `useEffect` already writing
  `messages.slice(-40)` on every state change (`AssetChat.tsx:111-118`, `NodeChat.tsx:149-156`).
  A new `stopped?: boolean` field on the existing `ChatMessage` interface rides that same
  mechanism for free — exactly the same "the flag round-trips through localStorage like any
  other message field" reasoning FLEET-004 already established for `isSafetyStop`.
- Notebook's *server*-side half of STRM-2 (`answer_status='error'` + partial `answer_text`,
  `notebook-chat-utils.ts:316-341` `persistedTurns()`) exists **only because Notebook has a
  server turn table to reconcile on reload**. AssetChat/NodeChat have no such table, so there is
  nothing to reconcile — the client-only half of the contract (`stoppedTurn`-equivalent state,
  the caption, and history exclusion) is the *entire* contract these two surfaces need.

### Concrete scope

**Files:** `mira-hub/src/components/AssetChat.tsx`, `mira-hub/src/components/namespace/NodeChat.tsx`
(and their respective test files, `AssetChat.test.tsx` — exists — and `NodeChat.test.tsx` — does
not yet exist in this checkout's `origin/main` base, though it may land with FLEET-006's PR
#3524; a test-engineer building this should check whether #3524 has merged first, since a second
add of that file would conflict).

**Per file (both get the identical shape):**

1. **`ChatMessage` interface** — add `stopped?: boolean;` alongside the existing
   `isSafetyStop?: boolean;` (`AssetChat.tsx:13` / `NodeChat.tsx:28`). Mirrors
   `NotebookChat.tsx:60`'s field exactly (`stopped?: boolean` with the STRM-2 doc comment).

2. **A new `stopGeneration` callback**, separate from `clearHistory` — aborts the in-flight
   request *without* wiping the message array:
   ```
   const stopGeneration = useCallback(() => {
     abortRef.current?.abort();
   }, []);
   ```
   (Matches `NotebookChat.tsx:396`: `const stop = useCallback(() => abortRef.current?.abort(),
   []);` — exactly this shape, nothing more.)

3. **Catch-block change** — replace the bare `if ((err as Error).name === "AbortError") return;`
   (`AssetChat.tsx:226` / `NodeChat.tsx:251`) with a branch that marks the last assistant
   message `stopped: true` instead of silently returning, e.g.:
   ```
   if ((err as Error).name === "AbortError") {
     setMessages((prev) => {
       const next = [...prev];
       const last = next[next.length - 1];
       if (last && last.role === "assistant") {
         next[next.length - 1] = { ...last, stopped: true };
       }
       return next;
     });
     return;
   }
   ```
   This preserves whatever partial `content` had already streamed in (already true today per
   §1 — it's just discarded downstream by `clearHistory`'s wipe; with a dedicated stop path
   there's no wipe to discard it).

4. **`MessageBubble` render branch** — add a "Stopped" caption when `msg.stopped`, styled like
   Notebook's (`NotebookChat.tsx:123-127`, `data-testid="stopped-caption"`), e.g. directly under
   the existing bubble `<div>` in `AssetChat.tsx:64-85` / `NodeChat.tsx:108-121` — same slot
   FLEET-005 used for `hasSafetyAlert`'s "Safety alert included above" line, so this is a proven
   insertion point in this exact file shape.

5. **Visible Stop button** — while `streaming`, replace the submit button's disabled spinner
   with an enabled Stop control in the same slot (`AssetChat.tsx:391-406` /
   `NodeChat.tsx:396-411`), mirroring `NotebookChat.tsx:500-510`'s `busy ? <StopButton> :
   <SendButton>` branch:
   ```
   {streaming ? (
     <Button type="button" size="sm" onClick={stopGeneration} className="h-9 w-9 p-0 flex-shrink-0 rounded-xl" aria-label="Stop generating">
       <Square className="w-4 h-4" />
     </Button>
   ) : (
     <Button type="submit" ... /* existing Send button, unchanged */ />
   )}
   ```
   Requires adding `Square` to each file's `lucide-react` import line (`AssetChat.tsx:4`,
   `NodeChat.tsx:13`) — `lucide-react` already ships `Square` (used identically in
   `NotebookChat.tsx:8`), so this is not a new dependency, just a new named import.

6. **History-exclusion filter** — the `apiMessages` array built at send-time
   (`AssetChat.tsx:146-149`, `NodeChat.tsx:183-186`) currently has no filter at all:
   `[...messages, userMsg].map((m) => ({ role: m.role, content: m.content }))`. Add a `.filter((m)
   => !m.stopped)` before the `.map(...)`, mirroring
   `notebook-chat-utils.ts:218-222`'s `historyFromTurns` (`.filter((t) => t.content && !t.stopped
   && ...)`) — a stopped turn is "not an answer" and must not enter what the model sees on the
   next turn, same STRM-2 rule Notebook already enforces.

**What this does NOT need, and should not attempt in this pass:**

- No server route change (`route.ts` files untouched — the abort is purely a client-side
  `fetch` cancellation, already true today).
- No schema/migration (no persisted-turn table exists for either surface; nothing to alter).
- No change to the `X-Safety-Stop` / `isSafetyStop` path, or (if #3523 lands first) the
  `hasSafetyAlert` path — those are orthogonal flags on the same message shape and don't
  interact with `stopped`.
- Notebook's server-side "stop-generation persists partial turn" half (#3450) has **no
  equivalent need here** per the reasoning in the "Why no persistence/schema change" section
  above — do not build a server persistence layer as part of this; that would be new
  architecture and belongs in a separate, Mike-scoped slice if AssetChat/NodeChat ever get
  real server-side turn persistence (which is exactly FLEET-004's flagged, deferred item).

**Expected diff shape:** in the same order of magnitude as FLEET-005's actual diff (`+27
insertions` in `AssetChat.tsx`, `+26` in `NodeChat.tsx`, 0 lines in any route/schema file) —
this recommendation adds slightly more (a new callback, a new button branch, a filter) but stays
within the same "two component files only, no server touch" envelope; a reasonable estimate is
roughly 35-50 added/changed lines per file.

## 5. Is there a subset safely buildable in this window without a Mike decision?

**Yes — the entire scope in §4 is buildable without a Mike decision.** Unlike FLEET-004's
finding (where true persistence parity needed a schema/architecture call), this gap has no
schema dependency: both files already have the `abortRef`/`streaming` machinery to hang the
fix off of, matching the "small and additive" bar the task asked about, and the fix is
symmetric across both files (no per-surface divergence needed, since AssetChat and NodeChat are
structurally identical clones on this point).

**Name it precisely:** build a single FLEET-00N slice titled "Stop-control parity for
AssetChat/NodeChat (STRM-2 client-only)" covering exactly the 6 numbered changes in §4, applied
identically to both `AssetChat.tsx` and `NodeChat.tsx` (plus their test files). No design
decision, no server change, no data-model change — a same-day build, same shape as FLEET-005/006.

**One dependency to flag, not a blocker:** if FLEET-006's PR #3524 (which adds
`NodeChat.test.tsx` and exports `NodeChat`'s `MessageBubble`) merges before this slice starts,
the test-file scope in §4 should build on top of that exported `MessageBubble`, not duplicate
it. If it hasn't merged yet, the slice can still proceed against `AssetChat.test.tsx`'s existing
pattern and add `NodeChat.test.tsx` fresh — just check `git log --oneline --grep=3524` (or the
PR's merge state) before starting, per this sprint's own multi-session collision-avoidance
practice.

---

## Evidence index (file:line)

| Claim | Evidence |
|---|---|
| No visible Stop control, AssetChat | `AssetChat.tsx:104,108,276-302,368-407,394,401-405` |
| No visible Stop control, NodeChat | `NodeChat.tsx:143,147,292-333,372-413,399,406-410` |
| Abort only reachable via full-thread Clear | `AssetChat.tsx:125-131,292-301`; `NodeChat.tsx:162-168,323-332` |
| AbortError swallowed with no `stopped` flag | `AssetChat.tsx:225-226`; `NodeChat.tsx:250-251` |
| No client-side stream-duration cap | `AssetChat.tsx:173-224`; `NodeChat.tsx:210-249` |
| Per-provider 30s timeout, 3-provider cascade | `mira-hub/src/app/api/assets/[id]/chat/route.ts:103,625`; `.../namespace/node/[id]/chat/route.ts:103` |
| Notebook's shipped STRM-2 contract (button) | `NotebookChat.tsx:8,500-510` |
| Notebook's shipped STRM-2 contract (state/caption) | `NotebookChat.tsx:58-60,123-127,274-275,296,346-351,396` |
| Notebook's history-exclusion rule | `notebook-chat-utils.ts:218-222,316-341,344-352` |
| No server persistence exists to reconcile (unchanged since FLEET-004) | `grep -n "^export async function"` on both route.ts files → `POST` only, no `GET` |
| FLEET-005's actual diff shape (precedent for scale) | `git diff 8447737c5 fleet/chatui-slice-05 -- AssetChat.tsx NodeChat.tsx` → +27/+26 lines, 2 files only |
| PRD baseline expectation | `docs/prd/2026-08-30-chatgpt-class-ui-prd.md` §10.9 (HELD PR #3514, read-only reference) |
