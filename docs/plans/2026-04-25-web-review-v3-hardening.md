# Web Review — v3 Hardening Plan

**Status:** draft
**Date:** 2026-04-25
**Owner:** maintenance-side AI infra
**Predecessors:** PR #626 (skill v1), PR #627 (P0 batch fixes), issues #613–#625

---

## Context

The `web-review` skill (PR #626) shipped a layered design but only Layers 1–3 + 5 (Playwright passive, Lighthouse, security-headers, edge-probes). Iteration-1 evals against `factorylm.com` produced 13 real issues — but the eval harness also surfaced an uncomfortable truth: **the structural skill scored 74.2 % vs a no-skill baseline at 91.7 %** (delta −17 pp). The baseline runs found bugs the skill missed:

- ToS checkbox is decorative (`handleSignup()` ignores `f-terms`) → legal exposure
- `/api/register` has no rate limiting + open CORS → signup-flood / SMTP-bomb vector
- No analytics installed anywhere → PLG funnel flying blind
- Product naming inconsistent across surfaces (FactoryLM vs MIRA vs Mira)
- HEAD returns `Content-Length: 0` on a 34 KB body → breaks Slack/LinkedIn unfurls

These were caught because the baseline agent **read the page source and reasoned about its purpose**. The structural skill ran its checklist faithfully and missed them all.

v3 closes this gap and adds the heavier gated layers we deliberately deferred from v1.

---

## Goals

1. **Make the skill outperform the baseline on the iteration-1 eval set** (target: ≥ 92 % pass rate, vs 74 % today).
2. **Add behavioral / strategic finding capability** so future audits catch ToS-bypass-class bugs without a human.
3. **Add the gated heavy layers** (`--persona`, `--security`, `--ux`) so monthly deep audits become a one-command operation.
4. **Schedule a daily noon canary** that surfaces regressions within 24 h of landing.

Non-goal for v3: a fully autonomous fix-and-PR loop. Findings still propose, humans still approve.

---

## v2 changes (skill-only, no new dependencies)

These ship independently of the gated layers and address the eval-1 underperformance.

### v2.1 — "Read the source" pass (new Pass 6)

Before the agent calls Playwright, instruct it to **fetch and skim the HTML/JS/CSS source** of the page being reviewed and call out three categories of bug that structural checks can't see:

| Category | Examples to look for |
|---|---|
| **Form/handler mismatch** | `handleSignup()` reads only some inputs; `required` attrs on inputs not wrapped in a `<form>`; submit button `onclick` instead of `type="submit"` |
| **Endpoint exposure** | Public endpoints with no auth/rate-limit on the proxy side; `Access-Control-Allow-Origin: *` on auth-touching paths; secrets in `<script>` blocks |
| **Strategic gap** | No analytics tag; no SEO `<meta>` for a key route; broken or absent canonical; product naming inconsistency across surfaces |

Implementation: extend `SKILL.md` with a "Pass 6 — Read the source" section, plus a checklist file `references/source-bug-patterns.md` cataloguing 20+ real-world patterns with examples. The agent reads the page once with `curl -s` (faster than Playwright for source) and applies the checklist.

### v2.2 — Soften the recipe

The current `SKILL.md` reads as "run these 5 passes in this order." Change to "**these are the categories of bugs that exist on real pages; choose which passes apply to the prompt**." Same checks, but the agent decides which to run instead of grinding through every pass.

Why: prompts like "what's the worst thing about example.com?" don't need Lighthouse or 5 perturbation passes — they need a sharp single answer. The agent should be free to skip passes that don't serve the prompt.

### v2.3 — `filing: off` clause

When the user explicitly says "don't file" / "not our repo" / "just summarize", the skill skips Output Protocol §B (the propose-filing prompt) entirely and explicitly notes filing was suppressed. Today the skill improvises around the absence of a docs section for this; v2.3 documents it.

### v2.4 — Result-URL validation

After `browser_navigate <url>`, run a one-line check: `result.url` must include the requested host. Today, a stale tab from a prior session can let `browser_evaluate` return data from a different page; v2.4 catches this immediately with a clear error and re-navigation.

### v2.5 — Iteration-2 eval

Re-run the same 3 test prompts from `evals/evals.json` against v2-skill. Target pass rate: ≥ 92 %. The eval-1 baseline outputs are kept as the golden answer set for ToS bug detection, /api/register flood, and naming inconsistency — v2 must catch these.

---

## v3 changes (new dependencies, gated)

These add real cost (compute time, API tokens, Docker images) and ship behind explicit flags. Each is one-command-installable; one-command-skipped if the dep isn't present.

### v3.1 — `--persona` via browser-use

Wrap `browser-use` (`browser-use/browser-use`, an LLM-driven Playwright agent) and define personas in `personas.yml`:

```yaml
mobile-tech:
  viewport: 375x812
  ua: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)..."
  journey: |
    You are a maintenance technician on the shop floor with greasy
    hands and an iPhone 13. Find the QR scanner page, scan a QR code,
    file a guest report. Note every friction point you encounter.

plant-manager:
  viewport: 1440x900
  ua: "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0)..."
  journey: |
    You are a plant manager evaluating MIRA for a 3-site rollout. Find
    pricing, understand what $97/mo includes vs $297/mo, and decide if
    you'd put a credit card down. Note hesitations.

returning-user:
  cookie_jar: returning-user.json   # persisted from previous run
  journey: |
    You logged in last week. Land on the home page and try to resume
    your last task. Note any login-state confusion.
```

Findings: per-persona "friction events" (clicks-to-success, dead-end signals, error rate). Severity: P1 if completion < 50 %, else P2.

Time budget: 1–5 min per persona/journey. Token cost: ~50 K tokens per journey at current Sonnet pricing. Default cap: 3 personas per run.

Setup: `pip install browser-use`; needs `ANTHROPIC_API_KEY` (already in Doppler `factorylm/dev`).

### v3.2 — `--security` via OWASP ZAP

Docker-based DAST scan:

```bash
docker run --rm -t -v $(pwd):/zap/wrk owasp/zap2docker-stable \
  zap-baseline.py -t https://factorylm.com -J zap.json
```

`zap-baseline.py` is **passive** — safe against prod. `--aggressive` switches to `zap-full-scan.py` which **submits forms with payloads** — must be allowlisted to local/staging only via `--allow-host`.

Lift each ZAP `Risk: High` alert to P0, `Medium` to P1, `Low` to P2. Use the same fingerprint+dedup machinery so re-running doesn't spam.

Time budget: 5–30 min. No API tokens (runs locally). Image size: ~600 MB.

### v3.3 — `--ux` via UXAgent

UXAgent (Amazon Science) generates qualitative friction reasoning + video replays per task. Give it a list of tasks (`"Sign up for the beta"`, `"Find the pricing"`, `"Submit a guest report"`); it runs each as a simulated user and produces:
- Task-completion rate
- Time-on-task vs. expected
- Interview-style friction reasoning ("I couldn't tell where to click after step 3")
- MP4 replay of the session

Lift each task with completion < 80 % or duration > 2 × expected to a P1/P2 finding; attach video link in issue body.

Time budget: 10+ min per task. Token cost: high (research-grade tool). Verify install path before treating as load-bearing — flagged in v1 as needing this verification.

### v3.4 — CI integration

`.github/workflows/web-review.yml` runs the skill on every PR that touches `mira-web/public/**` or the `cmms.html`. Mode: `--ci --comment-on-pr`. If the PR introduces a P0 or P1 regression, the workflow blocks merge until it's resolved or explicitly waived (`web-review-waive` label).

### v3.5 — Cross-machine orchestration

Heavy layers can run on the VPS / Bravo (which already have Docker + Tailscale + the right hardware):
- Lighthouse on `alpha` (this Mac mini)
- Browser-use on the dev mac (Playwright + Chrome already wired)
- ZAP on `factorylm-prod` (Docker, persistent)
- UXAgent wherever has GPU if the model wants one

A central orchestrator (running in this Claude session) collects findings from all machines, dedups, ranks, and proposes filing. Implementation: SSH + JSON-over-stdout; no new daemon.

---

## Routine: daily 12:00 noon canary

Independent of v2/v3 work — schedule today via the `schedule` skill:

- **Cadence:** every day at 12:00 local (16:00 UTC)
- **Command:** `/web-review --sitemap https://factorylm.com/sitemap.xml --max 5 --auto-comment-only`
- **Behavior:**
  - Crawls top 5 sitemap URLs by priority
  - Default fast core: Layers 1–3 + 5
  - **`--auto-comment-only`** (new flag) — fingerprint-dedups against existing issues:
    - If a finding's fingerprint matches an open issue → comment "seen again on YYYY-MM-DD"
    - If it matches a *closed* issue → reopen + comment "regressed; closed previously in #N"
    - If no match → write to a "candidate issues" markdown report; do NOT auto-create
  - This makes the canary safe to leave running indefinitely — it never spams the tracker, only confirms regressions and surfaces *new* candidates for human triage.
- **Output:** appends a row to `wiki/reviews/<date>-<host>.md` (vault Stop-hook auto-commits → diffable history).

The `--auto-comment-only` flag is part of v2.6 — small addition to `file_issues.py`.

---

## Sequencing

| Phase | Work | Gates merge of |
|---|---|---|
| **v2 batch 1** | v2.1 (source-reading pass) + v2.2 (soften recipe) + `references/source-bug-patterns.md` | re-run iteration-1 eval; if pass rate ≥ 92 %, ship |
| **v2 batch 2** | v2.3–v2.5 + v2.6 (`--auto-comment-only`) + scheduled canary live | v2 batch 1 ships |
| **v3 batch 1** | v3.1 personas (the highest-leverage gated layer) | v2 fully shipped |
| **v3 batch 2** | v3.2 ZAP + v3.3 UXAgent | v3.1 ships |
| **v3 batch 3** | v3.4 CI integration + v3.5 cross-machine | all gated layers ship |

Each batch is one PR. v2 batches are days of work; v3 batches are weeks (mostly setup + verification, not code).

---

## Open questions

1. **UXAgent install path** — paper exists, but verify the GitHub repo + setup before treating it as load-bearing. Flagged in v1.
2. **Browser-use API surface** — confirm Claude Code SDK integration story. The package supports it per docs, but verify before wiring `--persona` to it.
3. **Where do persona credentials live?** Returning-user persona needs a saved cookie jar — Doppler? Local file? Vault?
4. **Cost ceiling for daily canary?** v3-mode would burn substantial tokens at noon every day. Default is fast-core only (no personas/UX/ZAP); deep audits stay manual.

---

## Verification (after v3 ships end-to-end)

Re-run the same 3 test prompts from `evals/evals.json` plus 3 new ones (an auth'd page, a form-fuzz target on staging, a multi-step purchase journey). Targets:
- `web-review` pass rate ≥ baseline pass rate on every test
- All P0s from issues #613–#625 still detected (regression test)
- New P0 introduced into a staging branch is caught within one canary cycle

---

_See `.claude/skills/web-review/SKILL.md` for the v1 implementation and `references/severity.md` for the rubric._
