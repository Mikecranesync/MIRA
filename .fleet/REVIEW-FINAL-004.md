# FLEET-004 — FINAL Review (independent spot-check of an investigation)

**Commit reviewed:** `257c178c0f1fd02b67158bfd846ff761278855e1` on branch
`fleet/chatui-slice-04-scoping` (2 commits ahead of `origin/fleet/chatui-slice-04-scoping`, not
pushed by Bravo). Reviewed in Bravo's own worktree (`.cao/worktrees/2bd2a766`).

## What's being reviewed

Not a code change — a read-only scoping document
(`docs/plans/2026-08-31-notebook-asset-node-chat-safety-parity-scoping.md`). `git diff --stat`
confirms zero source files touched, 2 files changed (the doc + `.fleet/HANDOFF.md`), matching
the task's read-only constraint.

## Correction to my own premise, first

**I was wrong.** FLEET-004's task spec, which I wrote, asserted "NodeChat's route has NO
persistence writes... the whole notion of persistence parity may not apply." That grep-based
conclusion was accurate as far as it went (the route genuinely has zero DB writes) but I
conflated "the server doesn't persist" with "the surface doesn't reload" — I never checked
whether the *client* had its own persistence mechanism. It does: `localStorage`. This
investigation caught a real gap in my own prior analysis before it could turn into wasted build
effort on a premise ("these surfaces render nothing distinct on reload") that was false. Adopting
this correction, not defending the original premise, based on independently re-verified evidence
below.

## Independent spot-check (re-verified every material claim against the actual code, not trusted)

**AssetChat.tsx:**
- `storageKey = \`mira_chat_${assetId}\`` — confirmed.
- `useState` initializer reads `localStorage.getItem(storageKey)` with a `typeof window ===
  "undefined"` guard and try/catch — confirmed, matches the doc's line citations closely (exact
  line numbers drift by 1-2 depending on view window, but the code is verbatim as described).
- `useEffect` persists `messages.slice(-40)` on every change — confirmed, **40-message cap** is real.
- `clearHistory()` removes the key — confirmed.
- `isSafety = res.headers.get("X-Safety-Stop") !== null` — confirmed.
- The `finally` block sets `isSafetyStop: true` on the last assistant message when `isSafety` —
  confirmed, and this **does** run before the persist `useEffect` (React commits the state update,
  which re-triggers the effect watching `[messages, storageKey]`) — the ordering claim holds.
- `MessageBubble` branches on `msg.isSafetyStop`: red background/border, `AlertTriangle` vs `Bot`
  icon, suppresses `nextCheck` and `WhyMiraThinksThis` (`!isSafety` guards on both) — confirmed,
  verbatim.
- The SSE parse loop's `if (parsed.content) { ...append verbatim... }` has no discriminator check
  — confirmed. This is the same code path both the render-parity claim (§1/§2 of the doc) and the
  H4 gap-admission bug claim (§4) depend on, and it's accurately described in both places.

**NodeChat.tsx:**
- Line 5 header comment literally says "Cloned from components/AssetChat.tsx" — confirmed
  verbatim, strong direct evidence for the "mechanical carry-over, not a fresh design decision"
  conclusion in §2.
- `storageKey` branches on `docId` (`mira_node_chat_${nodeId}_doc_${docId}` vs
  `mira_node_chat_${nodeId}`) — confirmed, and the doc/folder-chat separation is real, not
  invented.
- Identical `useState`/`useEffect`(40-cap)/`clearHistory` pattern to AssetChat — confirmed.
- Route has exactly one handler (`POST`), zero matches for `INSERT`/`pool.query`/`db.query` beyond
  the one context-lookup `SELECT` — confirmed, matches both my original finding and the doc's
  independent re-confirmation of it.

**`decision_traces` is not a reload source:**
- The `INSERT INTO decision_traces` in `assets/[id]/chat/route.ts` is preceded by the comment "so
  this answer can be explained via the 'Why MIRA Thinks This' panel. Best-effort" — confirmed.
- `src/app/api/decision-trace/[id]/route.ts`'s `GET` queries `WHERE trace_id = $1 AND tenant_id =
  $2` — a single-record lookup by a random `trace_id`, not a list-by-asset/conversation query —
  confirmed verbatim, including the doc-comment explaining the tenant-scoping choice. This is the
  central piece of evidence for "`decision_traces` cannot serve as a conversation-reload source,"
  and it holds up.

**H4 gap-admission frame (`safetyAlertSseChunk`):**
- `mira-hub/src/lib/agents/safety-alert.ts` — the function returns `data:
  ${JSON.stringify({content: block})}\n\n` with **no discriminator field** — confirmed verbatim,
  including the exact markdown-formatted block content (`⛔ **SAFETY ALERT**`, etc.). Combined with
  the AssetChat SSE loop check above, the claim that this text renders as literal asterisks (no
  markdown renderer in `MessageBubble`) and lands in the same undifferentiated content stream is
  well-supported.

## Assessment

Every claim I chose to spot-check — including the "checkout doesn't have Notebook chat's current
code" disclosure at the top, which is itself an honest, useful piece of self-awareness rather than
silently asserting something unverifiable — held up against direct evidence. Line numbers are
close enough to be useful (off by 1-2 in a few places due to file drift between when the doc was
written and when I re-read it, never wrong about content). No fabricated symbols, no invented file
paths, no unverified claims presented as fact. The reasoning connecting the evidence to the
recommendation (build the H4 frame's client render now; defer true persistence parity as a Mike
decision) is sound and appropriately conservative — it does not attempt to sneak a schema decision
past the "no Mike decision" constraint.

## Findings

None. This is a documentation deliverable and its content is accurate.

## Disposition

- Pushing this branch and opening a **docs-only HELD PR** — durable record of the corrected
  understanding, supersedes the wrong premise in `.fleet/TASK.md` (left as-is, since it's the
  historical record of what was asked; the correction lives here and in the doc itself).
- **FLEET-005** (the H4 gap-admission SSE frame client render, precisely scoped in §5 of the doc)
  is the next dispatch — see `.fleet/SPRINT-LOG.md`.
- **Not attempting** true persistence parity for AssetChat/NodeChat this window — correctly flagged
  for Mike per the charter's forbidden-actions list (schema/migration decisions).

---

**VERDICT: PASS** (investigation accepted as accurate; recommendation adopted)
