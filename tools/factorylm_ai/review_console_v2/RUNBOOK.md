# Review Console v2 — Wake-Up Runbook

Good morning, Mike. Here's everything you need in 2 minutes.

## What this is

The dataset review tool got rebuilt overnight. v2 runs as a small server on the
PLC laptop instead of a single browser tab, which means:

- Open it from **any device** on your Tailscale network — phone, laptop, whatever.
- Everything saves **on the server the moment you tap it**. Closing the tab,
  losing signal, or rebooting your phone loses nothing.
- No file pickers, no uploading anything. The 133 records are already loaded.

## How to open it

On any browser (phone or desktop):

```
https://laptop-0ka3c70h.tail136e43.ts.net:8443/?k=54e83da769bd350429c97655
```

Bookmark that exact link — the `?k=` part is your access key. Without it the
page refuses to load. Don't share the link outside the tailnet.

## What's already in there

- **Your 23 decisions from yesterday are preloaded.** You are not starting over.
- The gate meter at the top shows live progress toward the thresholds
  (100 records, 20 lineages, 20 valued, 15 safety, both sources).

## The 3 cards that need one redo

The old tool had an export bug that **destroyed the corrected text** on your
three "correct" decisions:

- **ps-style-017**
- **drive-046**
- **drive-001**

The decision itself (that they need correction) survived — only the replacement
text you typed was wiped. v2 shows a banner listing these three cards. Open
each one and **retype the corrected answer** in the correction box. That's the
only rework.

## About the old browser tab

- **If you applied the DevTools fix I gave you** in the old tab: do **one last
  Export from the old tab first** (the fixed export preserves your correction
  text), save that file to Downloads, THEN close the tab. That can rescue the
  3 correction texts so you can copy-paste instead of retyping.
- **If you did NOT apply the DevTools fix**: the 3 correction texts exist
  nowhere — no export can recover them. Just close the old tab and retype the
  three corrections in v2. Nothing else is lost.

Either way, after that the old tab is dead weight — everything lives in v2 now.

## How to review a card

1. Tap a card from the list (or use Prev/Next to walk through in order).
2. Read the question, the answer, and "the evidence says" line. If there's a
   source snapshot image, pinch-zoom to check it.
3. Pick one:
   - **Approve** — answer is right as-is.
   - **Correct** — answer needs fixing; type the corrected answer in the box.
   - **Reject** — record shouldn't be in the dataset; say why.
   - **Hold out** — keep it out of training but don't judge it.
   - **Clear** — undo your decision on this card.
4. Give a reason — tap a preset chip or type your own (no length limit).

## Comments and replies

- Every card has a **comment box**. Type anything — a doubt, a question, a note
  to me. No length limit.
- **I (Claude) am watching the server live.** I see every decision and comment
  as it lands, and I can write replies back. Replies show up on the card within
  about 10 seconds — no refresh needed. A small badge marks cards with unread
  replies.
- So if you're unsure about a card, just leave a comment and keep moving — I'll
  answer on that card.

## Export

Tap **Export** in the header. The server generates `decisions.jsonl` and your
browser downloads it. This file is built server-side in the exact format the
importer requires — the bug that ate your corrections cannot happen here.
Export as often as you like; it's always the current state.

## If something looks wrong

Leave a comment on any card (or a general comment with no card) — I'll see it
live and respond. Worst case: the server keeps an append-only log of every
action, so nothing you do can be lost.
