# Release verification — P0 New Chat thread identity, live on production

**Parity authority:** `docs/architecture/convergence/CHATGPT_PARITY_CONTRACT.md` §5 Gap 1
**Policy:** `docs/ux/VISUAL_EVIDENCE_POLICY.md`
**Date:** 2026-09-12 (verification executed ~23:50–23:58 UTC)

## What was broken (P0)

On production, tapping **New chat** displayed the notebook's entire prior
history instead of a blank conversation. Root cause (proven, two independent
analyses): production lacked **both** migration 087
(`notebook_turns.thread_id`) **and** all server-side threadId code — the
column *and* the `normalizeNotebookThreadId` / `listTurns` filter /
`listThreads` grouping shipped together in #3741.

## Fix carrier and ordering

1. Migration `087_notebook_thread_identity.sql` applied **schema-first** via
   `apply-migrations.yml` (dry-run → apply, staging → production) *before*
   any code merged — the additive NULL column is invisible to old code,
   while new code without the column would have broken every turn insert.
2. Code: PR #3741 (branch commit `faeb3e8f9`, squash `47590dd72` on main).
3. Production deploy: `deploy-vps.yml` run `34726333629`, success,
   2026-09-12 23:47 UTC. **Deployed main SHA at verification: `47590dd72`.**

## Live production verification (raw API, app.factorylm.com)

Notebook `7c6ee71c-4fff-40e4-9793-815e9013ff8c`, fresh client id
`thrd_relverify1g22bbx9`:

| Step | Result |
|---|---|
| List turns for fresh threadId before sending | **0 turns** |
| POST chat with the fresh threadId | **200**, streamed answer |
| List turns for fresh threadId after sending | **exactly 1 turn**, threadId stored verbatim |
| List threads | fresh thread present, `turnCount: 1`, first-question title |
| List legacy turns (`legacy` → `thread_id IS NULL`) | **still exactly 3 turns**, fresh turn absent |

Isolation holds in both directions: the new thread sees none of the legacy
history, and the legacy view does not absorb the new turn.

## UI confirmation frame

`docs/promo-screenshots/2026-09-12_release-p0-newchat-clean_mobile.png`

- **Surface/build:** live `mira-mobile` dev build at `http://localhost:5199/`
  proxying **production** `app.factorylm.com` (magic-link session)
- **Deployed backend SHA:** `47590dd72`
- **Viewport:** Playwright Chromium **412×915**
- **Route/state:** notebook "Test" → drawer → **New chat** → blank
  conversation: greeting ("What can I help you with?"), grounding line,
  suggestion chips, empty composer — **zero turn elements in the DOM**
  (previously this screen rendered the notebook's full history)
- **Reproduction:** sign in → unified pref → open notebook → ☰ → New chat
- *Limitation (recorded per policy): no Android emulator on this host —
  this is real production app content at mobile viewport, not a device
  screencap.*

## Verdict

- P0 fresh-New-Chat isolation: **PASS on production** (API + real-render UI
  at browser viewport).
- Physical Pixel smoke: **UNVERIFIED** — remains the explicit condition on
  final release approval.
