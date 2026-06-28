---
name: qa
description: Use when running a Playwright/E2E QA spec against a deployed environment — confirms the latest commit is actually live FIRST, then runs the spec, reports pass/skip/fail counts, and updates the linked GitHub issue. Prevents the recurring false "QA failed" that is really "the deploy hadn't landed yet". Triggers on "run QA", "run the Playwright spec", "verify the deploy", "regression check the live site".
---

# qa

Run an E2E/Playwright spec against a deployed environment **without** the recurring false negative where the spec fails only because the deploy hadn't landed. The fix is one extra step at the front: prove the build is live before you trust a failure.

## Why this exists

QA specs were repeatedly diagnosed as "VPS not deployed" — the spec ran against stale prod, failed, and the failure looked like a regression. A failure against a stale deploy is **inconclusive**, not a finding (see `.claude/rules/debugging-conventions.md` §2).

## The loop

1. **Confirm the build is live FIRST.** Before running any assertion:
   - Get the expected commit: `git rev-parse --short HEAD` (or the PR's merge sha).
   - Probe prod for it — a `/api/health` version field, image age, or a behavioural marker unique to this change.
   - If the live build is older than the change under test → **stop**. The deploy hasn't landed; trigger/await it (see `ship`) before running the spec. Do NOT report the spec result as a regression.
2. **Run the spec against the deployed URL** (not localhost — localhost can't catch deploy regressions):
   - Hub proof specs: `mira-hub/tests/e2e/proof-pr-<N>.spec.ts` (pattern: `reference_hub_proof_spec_pattern`).
   - mira-web visible surfaces: prefer `design-ship-routine`'s `bun run verify:live`.
   - AskMira / kiosk: use the `askmira-tester` skill's regression bake.
   - Windows note: Playwright CDP/websocket handshake is blocked by Defender on this host — use the documented fallback (`chrome --headless=new --screenshot=...` or the playwright MCP) rather than connectOverCDP.
3. **Report pass / skip / fail counts** explicitly — not "looks good". Quote failing assertions verbatim.
4. **Capture evidence** — screenshot of the green (or red) state to `tools/web-review-runs/<date>-pr-<N>/` or `docs/promo-screenshots/` per the screenshot rule.
5. **Update the linked GitHub issue** — `gh issue comment <N>` with counts + evidence path. Cross-link the PR ↔ issue both directions.

## Done-when

The spec ran against a confirmed-live build, counts are reported, evidence is saved, and the linked issue is updated.

## What NOT to do

- ❌ Run the spec before confirming the build is live, then call a stale-deploy failure a regression.
- ❌ Verify against localhost and call the deploy verified.
- ❌ Report "QA passed" without the pass/skip/fail counts and a screenshot.
- ❌ Use `connectOverCDP` on this Windows host (Defender blocks it).
