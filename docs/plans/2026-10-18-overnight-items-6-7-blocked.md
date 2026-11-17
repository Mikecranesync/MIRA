# Overnight 2026-10-17 prod-test items 6 and 7 — BLOCKED, with the work mapped

**Date:** 2026-10-18 · **Session:** overnight run on CHARLIE, worktree `.claude/worktrees/overnight-1017`
**Base:** `main` `8ca0b52b` · **Siblings:** items 1–5 and 8 shipped as drafts #4484, #4485, #4486, #4487, #4488, #4489

Items 6 and 7 of the goal are **blocked by the same rule, on the same ownership
lane, and they unblock on the same event** — so they are written up together
rather than as two PRs that would say the same thing twice. That is a judgment
call against the goal's "own PR per item", made because splitting it adds noise
without adding information; everything specific to each item is below.

Neither item was partially built. No file in the blocked lane was edited,
staged, or pre-built.

---

## The blocker

`.claude/rules/factorylm-unified-ui-cutover.md` makes these four roots **one
indivisible one-writer lane**:

```
packages/factorylm-theme/**   packages/factorylm-interaction/**
packages/factorylm-ui/**      apps/factorylm-ui-lab/**
```

> ❌ Edit, stage, or pre-build in any of [those four] while another shared-core
> writer is active. Those four roots are one indivisible ownership lane, **even
> when proposed files do not overlap**. A second writer waits for the prior
> claim to be `RELEASED` or `COMPLETE`.

**PR #4474 holds that lane, `Status: ACTIVE`** — "header New chat on the shared
notebook conversation shell" — and its changed files include
`packages/factorylm-ui/src/FactoryLMShell.tsx`, `ThreadHeader.tsx`, `shell.css`
and two of its test files.

Claim namespace re-read before stopping, as the multi-session protocol requires:
issue #3626's markers (latest: *"[WORK-CLAIM] update (packages lane, #4443):
**Status: COMPLETE.** The lane is free."*, 2026-10-15) plus every open PR body
carrying a `[WORK-CLAIM]`. The 10-15 release is superseded by #4474's own active
claim, which is newer and names the lane.

Both items are **majority presentation work in that lane**: a status line, two
buttons, a list, and a document viewer are all rendered by the shared shell.
There is no version of them that is honest *and* avoids those four roots.

---

## Item 6 — the three parts, and what already exists

> *"an immediate 'Searching the <manual> manual… / Checking…' status (keep the
> answer check, no raw token streaming), Worked/Didn't-work buttons wired to
> `decision_trace_feedback`, and a per-machine Not-found list."*

### 6a. The "Searching the <manual> manual…" status — blocked (client), server trivial

The notebook route's SSE grammar is documented at the top of
`mira-hub/src/app/api/equipment-notebooks/[id]/chat/route.ts`, and a transient
status frame precedent already exists: `manual_search_status`
(`manualSearchStatusFrame`, T2/#4189), emitted before the answer and rendered
by the shell. A `retrieval_status` frame would be ~15 server lines beside it.

**Why it was not shipped anyway:** a frame no client renders is not the feature,
and the renderer is in the blocked lane. Existing clients ignore unknown kinds,
so emitting it early would be dead weight that still has to be re-reviewed when
the lane frees. Deferred deliberately, not forgotten.

### 6b. Worked / Didn't-work — ⚠️ THE SERVER HALF ALREADY EXISTS. Do not rebuild it.

This is the most important finding in this document.

| What the goal asks for | What is already on `main` |
|---|---|
| a `decision_trace_feedback` store | **`mira-hub/db/migrations/055_decision_trace_confidence_and_feedback.sql`** — table exists, RLS enabled, indexed on `trace_id` and `tenant_id`; tenant typing corrected by `070_decision_traces_tenant_text.sql` |
| an endpoint to write it | **`mira-hub/src/app/api/decision-trace/[id]/feedback/route.ts`** — `POST`, validates `verdict`, inserts and returns `feedback_id` |
| the verdict vocabulary | `CHECK (verdict IN ('good', 'bad', 'missing_context', 'needs_review'))` |

So "Worked" → `verdict: "good"` and "Didn't work" → `verdict: "bad"` on the
**existing** endpoint. **No migration, no new table, no new route.** What is
missing is only the two buttons and the `traceId` the shell must already hold —
the notebook route emits it on the `trace` frame (`NotebookTraceFrame`).

Anyone picking this up: the whole of 6b is a client change in the blocked lane.
Writing a second feedback table or endpoint would be the duplicate-build
mistake, and this row exists so that cannot happen by accident.

### 6c. Per-machine "Not found" list — blocked (client), server needs one read

Every abstention already persists as a turn with
`answerStatus = "insufficient_evidence"` and its asset snapshot
(`equipmentEntityId` / `assetUnsPath`, kept point-in-time and never
backfilled). So "what has this machine been asked that MIRA could not answer"
is a single `SELECT` over `equipment_notebook_turns` — no new write path and no
new column. The surface that shows it is in the blocked lane.

---

## Item 7 — citation tap opens the cited page, highlighted

> *"open a phone PDF viewer on the cited page and highlight the passage by text
> match. Quoted numbers must match the manual exactly."*

Blocked twice over, and the second reason is the more interesting one.

### 7a. The lane

The viewer and the citation chip's tap target are shared-shell presentation.
Same #4474 block.

### 7b. `commodity-before-custom` — this needs an escalation note, not a night of code

`.claude/rules/commodity-before-custom.md` is explicit that MIRA does **not**
own "the mechanics of pinch-to-zoom, lightboxes, file opening, PDF viewing",
and that writing ~50+ lines of custom interaction logic for a commodity
behaviour "is a STOP sign". The rule's own trigger incident (#3427/#3429) was a
hand-rolled gesture engine that took a multi-session arc to make a Close button
work.

A PDF viewer with page navigation **and** text-match highlighting is exactly
that shape. The rule requires, before any implementation: alternatives
evaluated, why rejected, maintenance impact, accessibility impact, platform
compatibility (Capacitor/Android WebView **and** iOS), bundle impact, licence
(Apache-2.0/MIT only), test burden, expected longevity. That is a design
decision with Mike in it, not something to improvise overnight.

What the server already provides, so the viewer has everything it needs:
- `EvidenceCitation` carries `page`, `fileId` (the byte-serving door),
  `originFileId` (the canonical original, #4315/085), `sourceUrl` for
  library-hosted manuals, and `quote`.
- `#4478` makes the **printed** page label citable (`p.2-15`), which matters
  here: a chapter-section label is not a PDF page index, so "open on the cited
  page" needs the integer `page` for navigation and the label for display. A
  viewer that navigates by the printed label would land on the wrong page.
- `quote` is already the claim-centred window (`supportingQuote`, #4315), which
  is the string a text-match highlight should search for — **not** a re-derived
  one.

### 7c. "Quoted numbers must match the manual exactly" — partly shipped tonight

That requirement is the same invariant as item 5 (#4488), from the other end:
#4488 refuses an answer whose value is absent from the page it cites. A viewer
that highlights by text match is the *visible* proof of the same property. The
two should be reviewed together.

---

## Unblock sequence

1. #4474 reaches `RELEASED` or `COMPLETE` and the packages lane is free.
2. Re-read the whole `[WORK-CLAIM]` namespace (#3626, every open PR, any issue
   carrying the marker) and post a claim for the lane *before* editing.
3. Item 6 in one slice: the `retrieval_status` frame + its renderer, the two
   buttons against the **existing** feedback endpoint, the not-found read.
4. Item 7 only after a commodity-before-custom decision on the viewer library.

## Not claimed

No staging or device verification; nothing enabled; no production change. This
document is the deliverable for items 6 and 7 — not a partial implementation
presented as progress.
