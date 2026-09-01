# Scoping: safety-persistence parity for AssetChat / NodeChat vs. Notebook chat

**Status:** Investigation only — no code changed. FLEET-004, read-only worker.
**Base:** `origin/main` @ `8447737c5` (branch `fleet/chatui-slice-04-scoping`).
**Author note:** FLEET-001/002/003 (PRs #3517/#3518/#3521) live on sibling branches
(`origin/fleet/chatui-slice-01`, local `fleet/chatui-slice-02`/`-03`) that are **not merged
into `origin/main`** and are therefore **not present in this checkout**. Their commits exist
in the repo's object graph (verified with `git log --oneline --all --grep`) but
`git merge-base --is-ancestor <sha> HEAD` returns false for all three core commits
(`995d3d5f0`, `e0baa6e1e`, `93f5f0bac`). Everything below about **Notebook chat's current
behavior** is therefore sourced from the task's provided background (already verified by
Charlie) plus the one Notebook-chat commit message I could read directly
(`git show 93f5f0bac`), not from re-reading `NotebookChat.tsx` on a branch that has it —
`ADR-0038`, referenced in that commit message, does **not exist as a file** in this
checkout's `docs/adr/` (confirmed: `find docs/adr -iname "*0038*"` → empty). Treat any
Notebook-side claim below as inherited context, not independently re-verified here.
Everything about **AssetChat/NodeChat** is verified directly against this checkout.

---

## TL;DR

1. **AssetChat.tsx and NodeChat.tsx both already reload/hydrate past turns** — but from
   **browser `localStorage`**, not from any server call. Neither route has a `GET` handler.
2. **A past safety hard-stop turn already renders distinctly on reload for both surfaces**,
   because the `isSafetyStop` flag is set into React state before it's written to
   `localStorage`, and `MessageBubble` already branches styling on it. **The premise that
   these surfaces have zero safety-render-on-reload is false for the hard-stop path.**
3. The real gap is architectural, not cosmetic: Notebook chat's persistence is
   **server-side, durable, cross-device** (a DB-backed turn table). AssetChat/NodeChat's is
   **client-side, per-browser, capped at 40 messages, wiped on `localStorage.clear()`**.
   Bringing AssetChat/NodeChat to genuine parity with Notebook's persistence model is a
   **schema/design decision — out of scope for this window, flagged for Mike.**
4. **A real, distinct, and separate bug exists on the live path**: the H4 gap-admission
   safety-alert SSE frame (`safetyAlertSseChunk`) is emitted as an undiscriminated `content`
   chunk and swallowed into the ordinary assistant bubble in both `AssetChat.tsx` and
   `NodeChat.tsx` — no distinct render, and (because neither component renders markdown) the
   `**bold**` markers show as literal asterisks. This is the same *class* of bug FLEET-002
   fixed for Notebook's hard-stop frame, but it's a **different mechanism** (the gap-admission
   alert, not the hard stop) and it's **small, additive, and independently buildable** — a
   good FLEET-005 candidate.
5. **Recommendation:** build FLEET-005 (item 4) now — it needs no schema change. Do **not**
   attempt true persistence parity (item 3) in this window; it needs a design decision from
   Mike.

---

## 1. Does `AssetChat.tsx` reload/hydrate past turns?

**Yes — from `localStorage`, not from any server endpoint.**

- `mira-hub/src/components/AssetChat.tsx:91` — `storageKey = \`mira_chat_${assetId}\``.
- `AssetChat.tsx:93-101` — initial `messages` state is read via
  `localStorage.getItem(storageKey)` inside the `useState` initializer (client-only guard:
  `typeof window === "undefined"` returns `[]`).
- `AssetChat.tsx:110-118` — a `useEffect` writes `messages.slice(-40)` back to the same key on
  every change. **Capped at 40 messages**; older history silently drops off.
- `AssetChat.tsx:125-131` — `clearHistory()` calls `localStorage.removeItem(storageKey)`.

**No server-side read path exists.** `mira-hub/src/app/api/assets/[id]/chat/route.ts` defines
exactly one handler: `export async function POST` at line 211
(`grep -n "^export async function" ...route.ts` returns only that one line — no `GET`).

**`decision_traces` is NOT a turn-history/reload source — it's a per-answer audit record.**

- `route.ts:680-700` — `INSERT INTO decision_traces (trace_id, tenant_id, platform,
  user_question, manual_evidence, recommendation, citations_present, confidence, outcome,
  model_used, latency_ms) VALUES (...)`, preceded by the comment at `route.ts:665-666`:
  *"Persist a decision trace so this answer can be explained via the 'Why MIRA Thinks This'
  panel. Best-effort: never block/break the stream."*
- The only consumer is `mira-hub/src/app/api/decision-trace/[id]/route.ts:15` (`export async
  function GET`), which queries `WHERE trace_id = $1 AND tenant_id = $2`
  (`decision-trace/[id]/route.ts:35-40`) — a **single-record lookup by `trace_id`**, not a
  list-by-asset or list-by-conversation query. It's fetched client-side only when a specific
  `msg.traceId` is already known (`AssetChat.tsx:84`:
  `{msg.traceId && !isSafety && <WhyMiraThinksThis traceId={msg.traceId} />}`), which itself
  only exists because the SSE stream handed it back live (`AssetChat.tsx:198-208`). There is no
  code path that lists `decision_traces` rows for an asset to reconstruct a conversation.
- `decision_traces` is schematically an audit/explainability table (one row per *answer*,
  keyed by a random `trace_id`), not a turn/conversation table (which would need role, ordering,
  and a conversation identifier). Extending it into a turn store would be a real schema change,
  not a query change — see §3.

**Does a safety-stop turn currently render distinguishably on reload? Yes — already.**

- On the live path, `route.ts:263-285` is the safety gate: `matchSafetyStop(lastUser.content)`
  short-circuits with a streamed canned response and header `"X-Safety-Stop": trigger` — **this
  return happens before any retrieval or the `decision_traces` INSERT**, so a safety-stop turn
  writes **zero rows anywhere** server-side.
- Client-side, `AssetChat.tsx:165` — `isSafety = res.headers.get("X-Safety-Stop") !== null` —
  and the `finally` block at `AssetChat.tsx:239-249` sets `isSafetyStop: true` on the last
  (assistant) message in React state.
- Because that state update happens **before** the `useEffect` at `AssetChat.tsx:110-118`
  serializes `messages` to `localStorage`, the `isSafetyStop` flag round-trips through
  `localStorage` like any other message field.
- `MessageBubble` (`AssetChat.tsx:32-88`) already branches on `msg.isSafetyStop` at lines 34 and
  54-70 — red background, red border, `AlertTriangle` icon instead of `Bot` icon, and (line 84)
  suppresses the `WhyMiraThinksThis` trace panel for safety turns.
- Confirmed by test: `mira-hub/src/components/AssetChat.test.tsx:37-49` renders
  `isSafetyStop: true` directly through `MessageBubble` and asserts on its behavior (omits
  `nextCheck`); the styling itself isn't asserted by a snapshot, but the component code path
  is exercised and the flag is proven to reach the bubble.

**Net for AssetChat:** reload works, and a past hard-stop turn already renders distinctly. The
only gap is that this reload is **per-browser** (no server durability, no cross-device sync, a
40-message cap, and it's wiped by a cleared cache/incognito session/different device).

---

## 2. Does `NodeChat.tsx` reload/hydrate past turns? Is the route's zero-persistence finding correct?

**Charlie's finding is confirmed: the route has zero DB writes.** But the component still
reloads/hydrates — via the identical `localStorage` mechanism as AssetChat, inherited by direct
code clone.

- `NodeChat.tsx:5` — module header comment: *"Cloned from components/AssetChat.tsx..."* — this
  is explicit, in-file evidence that the localStorage architecture was **copied**, not
  independently designed for NodeChat.
- `NodeChat.tsx:128-140` — identical pattern: `storageKey` is `mira_node_chat_${nodeId}` or,
  when scoped to one document, `mira_node_chat_${nodeId}_doc_${docId}` (line 128-130, so a
  folder-chat and a single-document chat on the same node keep separate histories); `useState`
  reads `localStorage.getItem(storageKey)` at line 132-140.
- `NodeChat.tsx:149-156` — `useEffect` writes `messages.slice(-40)` back on every change (same
  40-message cap as AssetChat).
- `NodeChat.tsx:162-168` — `clearHistory()` removes the key.
- **Route confirmed zero-write:** `mira-hub/src/app/api/namespace/node/[id]/chat/route.ts`
  defines exactly one handler, `export async function POST` at line 191 — no `GET`. The only
  database interaction in the entire file is a `SELECT` inside `withTenantContext` at line
  283-294 (`fetched = await withTenantContext(ctx.tenantId, async (c) => { const nodeRes =
  await c.query(\`SELECT name, uns_path::text AS uns_path FROM kg_entities WHERE id = $1 AND
  tenant_id = $2 AND approval_state = 'verified' LIMIT 1\`, ...) ...})`) — a node-context
  lookup, not a write. `grep -n "INSERT\|pool\.query\|db\.query"` across the file returns
  nothing beyond this one read (matches the background's claim exactly). No `decision_traces`
  write exists for NodeChat at all, unlike AssetChat.

**Does a safety-stop turn render distinguishably on reload?** Yes, by the same mechanism as
AssetChat — `NodeChat.tsx:202` reads the `X-Safety-Stop` header, `NodeChat.tsx:259-268` sets
`isSafetyStop: true` on the message before the localStorage-write `useEffect` runs, and
`MessageBubble` (`NodeChat.tsx:76-123`, lines 78/98-114) branches identically to AssetChat's.

**Is the localStorage-only design deliberate or an unexamined gap?**

**Undetermined-leaning-toward-unexamined.** I found no ADR, spec, or code comment anywhere in
the repo declaring that AssetChat/NodeChat conversation state is intentionally ephemeral or
device-local:

- `grep -rn "localStorage\|ephemeral\|session-only\|browser-only"` in both component files
  turns up only the implementation lines themselves — no rationale comment.
- Searched `docs/plans/2026-08-10-chat-with-any-manual-design.md`,
  `docs/specs/uns-node-centric-knowledge-spec.md`, `docs/known-issues.md`,
  `docs/specs/why-mira-thinks-this-spec.md` for `localStorage`/`persist`/`reload`/`ephemeral`
  — no hits discussing AssetChat/NodeChat's persistence model specifically.
- `git log --follow -- mira-hub/src/components/AssetChat.tsx` traces the pattern back to its
  origin, PR #574 (`3506efaa8 feat(hub): asset-scoped chat — GSDEngine streaming + safety
  gate (#574)`) — the commit title gives no indication of a deliberate ephemeral-by-design
  choice, just "streaming + safety gate."
- NodeChat's own header comment (`NodeChat.tsx:5`) frames it as a **clone**, not a fresh design
  decision — so even if AssetChat's localStorage choice had been deliberate (undetermined),
  NodeChat's inheriting it was mechanical, not re-examined for the node/folder-chat context.

**Conclusion:** call this an unexamined carry-over, not a documented design choice. It's not
provably "wrong" — for a first cut of an asset-scoped chat, per-browser convenience storage is
a reasonable MVP shortcut — but nothing in the repo asserts it was chosen deliberately over
server persistence, and nothing distinguishes AssetChat's case (which does have an
audit-adjacent table already) from NodeChat's (which has literally no DB trace of any turn ever
happening).

---

## 3. What would "safety-persistence parity" concretely mean for each surface?

Reframing is necessary: the task's background (correctly, given what was known) assumed these
surfaces might have **zero** safety-stop render-on-reload, the same gap FLEET-001 closed for
Notebook. That specific gap **does not exist here** — see §1/§2. So "parity" cannot mean "add
the missing badge"; that badge is already there. Given the *actual* architecture:

### AssetChat

- **What already has parity with Notebook's outcome (a safety-stop turn is visually
  distinguishable after reload):** done, today, at the localStorage layer.
- **What does NOT have parity:** the *mechanism*. Notebook's reload is server-durable
  (`persistedTurns()` from a DB-backed turn table via `GET
  /api/equipment-notebooks/[id]/`, confirmed at
  `mira-hub/src/app/(hub)/equipment/[id]/page.tsx:55-69`: `fetch(...); setInitialTurns(...)`,
  consumed by `NotebookChat`'s `initialTurns` prop and `hydrateTurns()`). AssetChat's reload is
  a client-only convenience that: (a) doesn't survive a different device/browser/session, (b)
  doesn't survive a cleared cache, (c) caps at 40 messages, (d) means a technician who reports
  "MIRA told me to stop, look" to a colleague has nothing server-side to point at except the
  fire-and-forget `agent_events` compliance log (`safety-alert.ts:284-289`, written only for the
  H4 gap-admission path, not the hard-stop path — see §4), which has no chat-UI surface at all
  (only consumer: `mira-hub/src/app/api/agents/safety-events/route.ts`, an ops/admin feed, not
  wired into AssetChat or NodeChat).
- **To close that mechanism gap** would require: a new (or repurposed) schema object shaped as
  a turn/conversation table (asset-chat turns aren't decision_traces — decision_traces is
  keyed by a random `trace_id` per *answer*, has no ordering/role/conversation-id columns, and
  per `.claude/rules/materialized-evidence.md` rule 15 and `.claude/rules/karpathy-principles.md`
  simplicity-first, repurposing an audit table into a chat-turn store rather than designing a
  proper one is exactly the kind of decision that needs deliberate sign-off, not an autonomous
  guess); a new `GET` route; a client refactor from localStorage-as-source-of-truth to
  server-fetch-as-source-of-truth (with localStorage demoted to optimistic/offline cache, if
  kept at all); and RLS/tenant wiring for the new table. This is schema + architecture work —
  **substantial** by `.claude/rules/multi-session-protocol.md` §5's own definition (migrations,
  schema changes). **Out of scope for this window.**

### NodeChat

- Same localStorage-layer parity already exists (§2).
- The mechanism gap is **larger than AssetChat's**, not smaller: AssetChat at least has
  `decision_traces` as a per-answer audit trail an admin could dig through by `trace_id`;
  NodeChat has **no server-side record of any turn, safety or otherwise, ever** (confirmed
  zero writes, §2). So "parity" for NodeChat isn't just "match Notebook's durability" — it's
  "introduce *any* server-side conversation record at all," a strictly bigger lift than
  AssetChat's.
- Same conclusion: **out of scope for this window**, and the underlying design question (should
  node-chat, which is often anonymous/folder-scoped rather than asset-scoped, even get a
  durable per-conversation record — and if so, keyed on what: node id? tenant + node + session?)
  is a genuine product decision, not something to infer from the code.

**Bottom line for §3:** for both surfaces, there is no additive, FLEET-001-sized slice that
closes the *mechanism* gap without a schema decision. The render-parity half of "safety
persistence parity" is already satisfied; the durability half is blocked on Mike.

---

## 4. Live-path parity: the H4 gap-admission safety-alert SSE frame

This is a **separate, smaller, real, and independently fixable finding** — not part of the
persistence question above.

**Two distinct safety mechanisms exist on the `AssetChat`/`NodeChat` server routes, and only
one gets client-side render treatment:**

| Mechanism | Trigger | Server behavior | Client render |
|---|---|---|---|
| Hard stop (`matchSafetyStop`) | User message matches a LOTO/arc-flash/etc. pattern | Short-circuits the whole turn before retrieval; canned refusal streamed; `X-Safety-Stop` response header set (`route.ts:263-285` for assets, `:234-255` for node) | **Distinct** — `isSafetyStop` flag, red bubble, alert icon (§1/§2) |
| Gap-admission alert (`scanBoth` / H4, #2542/#797) | Either the user question *or* the full assembled model answer contains a safety keyword, checked *after* the answer is generated | `scanBoth(userText, fullResponse, id)` (assets: `route.ts:659`; node: `route.ts:427`) → if matched, `controller.enqueue(enc.encode(safetyAlertSseChunk(safetyAlert)))` (assets: `route.ts:661`; node: `route.ts:429`) and fire-and-forget `handleSafetyAlert(...)` which logs to `agent_events` (assets: `route.ts:662`; node: `route.ts:430`) | **None** — see below |

`safetyAlertSseChunk` (`mira-hub/src/lib/agents/safety-alert.ts:262-271`):

```ts
export function safetyAlertSseChunk(alert: SafetyAlert): string {
  const block = [
    "",
    `---`,
    `⛔ **SAFETY ALERT** — ${alert.keyword.toUpperCase()}`,
    `**${alert.recommendation}**`,
    `Contact your safety officer before proceeding.`,
  ].join("\n");
  return `data: ${JSON.stringify({ content: block })}\n\n`;
}
```

It emits **only** a `content` field — no `kind`, no discriminator of any kind. Both clients'
SSE parse loops treat every `parsed.content` chunk identically:

- `AssetChat.tsx:186-197` — `if (parsed.content) { ... next[next.length-1] = {...last, content:
  last.content + parsed.content} ... }` — appends verbatim to the assistant bubble's `content`.
- `NodeChat.tsx:235-244` — identical append logic.

So the alert block lands inside the *same* `MessageBubble` as the rest of the answer, styled
identically (`isSafety` stays `false` — it's only ever set from the `X-Safety-Stop` *header*,
which the hard-stop path sets, not this one). Two additional, compounding effects:

- **The markdown doesn't render.** Neither `MessageBubble` in `AssetChat.tsx` (lines 64-74) nor
  `NodeChat.tsx` (lines 108-118) uses a markdown renderer — plain
  `<div className="whitespace-pre-wrap">{msg.content}</div>`. (Contrast: Notebook chat's
  `Bubble()` explicitly renders `AnswerMarkdown` — confirmed from the code excerpt at
  `NotebookChat.tsx:118-122`, which is present in *this* checkout since it predates the
  FLEET-00x branches.) So `**SAFETY ALERT**` and `**${recommendation}**` show as literal
  asterisks to the technician, not bold text.
- **It's genuinely mid-stream content, not a separate turn** — it's appended to whatever answer
  text already streamed, so on reload (via localStorage, §1/§2) the alert text is preserved
  as part of the ordinary assistant message's `content` string, equally undifferentiated then.

**This is the same class of bug** the task named: an SSE frame carrying safety-relevant
information that the client doesn't specially recognize, so it renders (and re-renders on
reload) as ordinary text. It is **not** the same bug FLEET-002 fixed (that was the hard-stop
`kind:"safety"` frame specifically, and only for Notebook chat, which — per
`safety-alert.ts:1-13`'s own module doc, "Wired into asset chat route" — never even calls
`scanBoth`/`handleSafetyAlert` at all; confirmed by `grep -n "scanBoth\|handleSafetyAlert\|
safetyAlertSseChunk" .../equipment-notebooks/[id]/chat/route.ts` returning nothing). It's a
**parallel, previously-unfixed instance of the same defect class**, in a mechanism unique to
AssetChat/NodeChat.

---

## 5. Recommendation

**Buildable now, no Mike decision needed — propose as FLEET-005:**

> Give the H4 gap-admission safety-alert SSE frame a distinct client render in AssetChat and
> NodeChat, so a mid-answer safety caution is visually differentiated from ordinary assistant
> text, live and on reload.

Precise shape (small, additive, comparable in size/risk to FLEET-001):

1. **`mira-hub/src/lib/agents/safety-alert.ts`** — `safetyAlertSseChunk` (line 262): add a
   discriminator to the emitted SSE payload alongside the existing `content` field (e.g.
   `{content: block, safetyAlert: true}` or `{content: block, safetyAlert: {keyword,
   severity}}`) — additive JSON key, keeps `content` unchanged so nothing that already reads
   `content` breaks.
2. **`mira-hub/src/components/AssetChat.tsx`** — extend `ChatMessage` (line 9-16) with e.g.
   `hasSafetyAlert?: boolean` (a distinct field from `isSafetyStop`, since this is an alert
   *appended to* a real answer, not a hard refusal that replaces one); in the SSE parse loop
   (~line 186-223) branch on the new discriminator and set the flag on the streaming message;
   `MessageBubble` (line 32-88) renders a small inline badge/icon near the alert text rather
   than recoloring the whole bubble (the bubble also contains a real, useful answer — don't
   hide that).
3. **`mira-hub/src/components/namespace/NodeChat.tsx`** — the identical change (it's a clone;
   keep both in lockstep, per the existing pattern in this file's own header comment).
4. Optional, low-risk, same-slice: pass the safety-alert block through a lightweight
   inline-markdown renderer (or just strip the `**`/`⛔` formatting server-side into plain
   emphasis-free text) so it doesn't show literal asterisks — worth deciding at build time, not
   blocking.
5. No migration, no schema change, no new table — `agent_events` logging is untouched.

**Not buildable in this window — flag for Mike:**

> True safety-persistence parity for AssetChat/NodeChat (server-durable, cross-device
> conversation history matching Notebook chat's model) requires a design decision: does either
> or both surfaces get a real turn-history table (new schema + migration + `GET` route + client
> refactor away from localStorage-as-source-of-truth), and if so keyed how (per-asset? per-node?
> per-tenant-session?), and is `decision_traces` extended or left alone as a separate
> audit-only table? This is squarely "substantial" work per
> `.claude/rules/multi-session-protocol.md` §5 (schema changes, migrations, cross-cutting data
> model decisions) and needs Mike's sign-off before any implementation session — including one
> scoped narrowly to "just AssetChat" — begins.

---

## Evidence index (files touched by this investigation, all read-only)

- `mira-hub/src/components/AssetChat.tsx`
- `mira-hub/src/components/AssetChat.test.tsx`
- `mira-hub/src/components/namespace/NodeChat.tsx`
- `mira-hub/src/app/api/assets/[id]/chat/route.ts`
- `mira-hub/src/app/api/namespace/node/[id]/chat/route.ts`
- `mira-hub/src/app/api/decision-trace/[id]/route.ts`
- `mira-hub/src/lib/agents/safety-alert.ts`
- `mira-hub/src/lib/safety-classifier.ts` (existence/shared-use confirmed, not read in full)
- `mira-hub/src/app/(hub)/equipment/[id]/page.tsx` (Notebook's server-hydration call site, for
  contrast)
- `mira-hub/src/components/equipment/NotebookChat.tsx` (as it exists on `origin/main`, i.e.
  *before* FLEET-001/002/003 — used only to confirm the markdown-rendering contrast in §4)
- `docs/plans/2026-08-10-chat-with-any-manual-design.md`, `docs/known-issues.md`,
  `docs/specs/uns-node-centric-knowledge-spec.md`, `docs/specs/why-mira-thinks-this-spec.md`
  (searched, no relevant hits, §2)
- `docs/adr/` directory listing (confirmed no ADR-0038 file present in this checkout)
