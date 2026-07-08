# Tester Baseline — Hank (Hermes maintenance-manager persona) — 2026-06-17

## Purpose

First baseline entry for the Hermes-driven maintenance-manager dogfood tester
("Hank"), running on node CHARLIE. Establishes scope, what's testable today, and
the working agreement so future sessions start warm instead of cold.

Persisted alongside this: Hermes persistent memory (lean pointers) + the
`mira-tester` skill (full playbook). Read those at session start.

## Scope understood

- Product: **MIRA / FactoryLM** — AI industrial-maintenance diagnostic platform.
- Repo: `Mikecranesync/MIRA`, ~1,940 files / ~25k symbols (codegraph).
- Customer surfaces: `mira-web` (factorylm.com funnel/Stripe), `mira-hub`
  (app.factorylm.com, ~55 routes), `mira-cmms` (Atlas CMMS), Telegram/Slack
  bots, ConvSimpleLive Ignition screen.
- Customer journey under test: factorylm.com → signup/login → `/quickstart` →
  Hub workflows (work orders, assets/QR, knowledge upload→retrieval, ask MIRA, scan).

## Testable today vs blocked

| Surface | State | Notes |
|---|---|---|
| factorylm.com funnel (mira-web) | ✅ testable | unauthenticated; existing lighthouse web-reviews in `wiki/reviews/*-factorylm.com.md` |
| Hub login / signup / magic-link | ✅ testable | front door only |
| Hub authenticated routes (~55) | 🔴 blocked | needs login — **#2013 (P0)** |
| `/command-center` live picker | 🔴 blocked | needs login — #2013; feature #2014 |
| ConvSimpleLive Ignition screen | ✅ testable | Tailscale fallback `http://100.72.2.99:8088/data/perspective/client/ConvSimpleLive`; ~2h Perspective trial |

## Working agreement (lessons logged)

1. **Pre-flight before every bug** — grep `docs/known-issues.md`, search GH
   issues, grep `wiki/hot.md`. (I filed dup #2064 by skipping this; #2064 is a
   documented known Ignition behavior with workaround `evaluateIgnitionDisplay()`.)
2. **Reuse the existing harness** — `tests/` 7 regimes, `tests/eval/` 51
   fixtures + judge, `tests/qa_regression*`, `golden_*.csv`. Don't reinvent.
3. **Codegraph trust model** — symbol lookup OK; call-graph only after
   `tools/codegraph-preflight.sh` passes; verify blast radius with grep.
4. **Evidence over assertion** — real tag values, URLs, screenshots, HTTP codes.
   No claiming Hub coverage I couldn't actually exercise.
5. **Never touch `main`** — branch + PR, Mike approves what ships.

## Findings this session

- None new. This session was recon + memory/system setup, not bug hunting.
- Self-correction: #2064 should be treated as a duplicate of a documented known
  issue (annotating it this session).

## Next actions (pending #2013 unblock)

- Full authenticated customer-journey pass through the Hub.
- Run the existing eval harness as a ground-truth sanity check.
- Continue funnel + Ignition coverage that doesn't require login.
