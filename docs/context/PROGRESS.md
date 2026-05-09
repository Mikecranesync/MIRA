# MIRA — Progress Log
**Last Updated:** 2026-05-05

This is the file that **updates every session**. Top of the file is current state; below the divider is an append-only log written by the stop hook (`.claude/hooks/stop.sh`). Keep the top section short — if it grows past one screen, prune it into a section below the divider.

---

## Current state (top section — edit in place)

### Phase
**90-day MVP** (locked window: **2026-04-19 → 2026-07-19**).
Source of truth: `docs/plans/2026-04-19-mira-90-day-mvp.md`. Read its "Currently in-flight" section + run the 3-command coordination check before claiming new work.

### Where we are right now (2026-05-05)
- **Main branch tip:** `3637023 docs(wiki): eval-fixer run 2026-05-05`.
- **Recent shipped:** Open CMMS button on all asset-scan pages (CRA-20, 2026-05-04). Magic-link JWT fix (CRA-22, CRA-21, 2026-05-04). nginx routes `/sample` + `/activated` to mira-web (2026-04-26).
- **In-flight branches:** `feat/mvp-unit-4-exports`, `feat/mvp-unit-9a-landing` (per memory `project_mira_state`).
- **Eval pass rate:** 77 % (last recorded — stale per memory, re-run after retrieval/prompt changes).
- **Anthropic removal:** complete (PR #610 + #649); `mira-bots/shared/inference/router.py` cascades Groq → Cerebras → Gemini. Do not reintroduce.
- **mira-sidecar:** still legacy; OEM migration to Open WebUI KB is the cutover gate (issue #195).

### What's done — broad strokes
- Engine: Supervisor + workers + guardrails + InferenceRouter cascade (PII default-on).
- Adapters: Telegram (polling singleton), Slack (Socket Mode), pipeline (`/v1/chat/completions`).
- Knowledge: ~25,219 chunks (NeonDB pgvector); hybrid retrieval Unit 6 behind kill switch.
- Atlas CMMS: 4 containers wired; mira-mcp brokers REST + 7 CMMS MCP tools across 4 providers.
- Hub: mira-hub `v1.1.0` shipped 2026-04-24 (OAuth + full platform shell).
- Web: PLG funnel live; magic-link JWT fixed; PostHog optional.
- Knowledge graph schema: `kg_entities / kg_relationships / kg_triples_log` with RLS (#791) — runtime extraction not yet wired.

### What's next (top of backlog)
- **Auto-PM pipeline #1:** Extract PM schedules from manuals → structured JSON → auto-create PM work orders → push to downstream CMMS. Without this, the flywheel doesn't close.
- **Triple extractor at runtime:** Wire conversation → KG triples to feed GraphRAG.
- **Eval ratchet:** Pass rate 77 % → ≥ 90 %; refresh with current cascade.
- **mira-sidecar sunset:** Migrate ChromaDB OEM corpus to Open WebUI KB; cut `mira-web` to `mira-pipeline` (PR #197).
- **mira-pipeline test coverage:** 0 → ≥ 5 unit tests (currently grade F).
- **Funnel digest weekly automation:** wire Cowork Sunday 02:00 to Discord `#weekly-review`.

### Active decisions and constraints
- LLM cascade is **non-negotiable** Groq → Cerebras → Gemini. No single-provider calls; no Anthropic.
- Doppler `factorylm/prd` is the only legitimate secret store.
- Anyone touching `mira.db` from outside `mira-bridge` must use WAL retry pattern (`Supervisor._ensure_table()`).
- Magic-inbox PDF flow: relevance gate behind `RELEVANCE_GATE_ENABLED`; fail-open on Groq errors.
- mira-hub uses a **custom internal Next.js fork** — read `node_modules/next/dist/docs/` before assuming.

### Blockers
- Eval pass rate stale; until refreshed we can't trust regression signal.
- Triple extractor at runtime is a known gap — KG schema exists with no writer wired.
- mira-pipeline has zero unit tests (graded F per `docs/QUALITY_SCORE.md`).

### Pointers for the next agent
- `docs/specs/SPEC_INDEX.md` — every module's contract.
- `docs/context/RULES.md` — non-negotiable constraints.
- `docs/context/ARCHITECTURE.md` — layer map + container topology.
- `wiki/hot.md` — wiki entrypoint (read at session start).
- `docs/plans/2026-04-19-mira-90-day-mvp.md` — 90-day plan, currently in-flight section.

---

## Session log (append-only — written by `.claude/hooks/stop.sh`)

> Format per entry:
>
> ```
> ### YYYY-MM-DD HH:MM session — <branch>
> **Changed:** files / one-line summary
> **In progress:** what is still WIP
> **Blocked:** any blockers + cause
> **Next:** the next action
> ```

<!-- BEGIN AUTOLOG -->

### 2026-05-06 05:28 UTC — `docs/comprehensive-specs`
**Last commit:** b9bfc8a docs(specs): add per-module specs, context system, session stop hook
**Changed (vs. fork point):**
- .claude/hooks/stop.sh
- .claude/settings.json
- docs/context/ARCHITECTURE.md
- docs/context/FILE_STRUCTURE.md
- docs/context/PROGRESS.md
- docs/context/PROJECT_BRIEF.md
- docs/context/RULES.md
- docs/context/TECH_STACK.md
- docs/specs/SPEC_INDEX.md
- docs/specs/agentic-os-spec.md
- docs/specs/auth-tenancy-spec.md
- docs/specs/deployment-spec.md
- docs/specs/dialogue-state-tracker-spec.md
- docs/specs/hub-mobile-spec.md
- docs/specs/ignition-exchange-spec.md
- docs/specs/knowledge-graph-spec.md
- docs/specs/mira-bots-spec.md
- docs/specs/mira-bridge-spec.md
- docs/specs/mira-cmms-spec.md
- docs/specs/mira-core-spec.md
**Working tree:** clean
**Next:** _set by next session_

### 2026-05-09 12:36 UTC � `feat/mira-scan-monday-webhook-and-builder`
**Last commit:** 45bd95e7 security: bind all saas ports to loopback � prevent Docker UFW bypass
**Changed (vs. fork point):**
- .claude/hooks/stop.sh
- .claude/rules/karpathy-principles.md
- .claude/settings.json
- .claude/skills/youtube-transcript.md
- .enum-drift-allowlist.txt
- .githooks/pre-commit
- .github/pull_request_template.md
- .github/workflows/deploy-vps.yml
- .github/workflows/enforcement-audit.yml
- .gitignore
- .warp/MCP_SETUP.md
- .warp/README.md
- .warp/workflows/cluster-ssh.yaml
- .warp/workflows/mira-enum-drift.yaml
- .warp/workflows/mira-eval.yaml
- .warp/workflows/mira-logs.yaml
- .warp/workflows/mira-pr-review.yaml
- .warp/workflows/mira-rebuild-service.yaml
- .warp/workflows/mira-smoke-remote.yaml
- .warp/workflows/mira-smoke-test.yaml
**Working tree:**
- M .claude/settings.json
- ?? .claude/settings.local.json
- ?? .claude/skills/audit-site/
- ?? .playwright-cache/
- ?? docs/ideation/2026-05-07-trade-show-strategy-automate-tampa.md
- ?? "docs/promo-screenshots/(Mike)Screenshot 2026-05-03 040306.jpg"
- ?? mira-hub/dom-crawl-app.mjs
- ?? mira-hub/dom-crawl.mjs
- ?? mira-hub/tests/e2e/reaudit-2026-05-04.spec.ts
- ?? mira-hub/tools/
- ?? mira-hud/
- ?? test-results/
- ?? tools/web-review-runs/2026-05-03-pr-940-proof/desktop${name}.png
- ?? tools/web-review-runs/2026-05-04-reaudit/
**Next:** _set by next session_

### 2026-05-09 12:36 UTC � `feat/mira-scan-monday-webhook-and-builder`
**Last commit:** 45bd95e7 security: bind all saas ports to loopback � prevent Docker UFW bypass
**Changed (vs. fork point):**
- .claude/hooks/stop.sh
- .claude/rules/karpathy-principles.md
- .claude/settings.json
- .claude/skills/youtube-transcript.md
- .enum-drift-allowlist.txt
- .githooks/pre-commit
- .github/pull_request_template.md
- .github/workflows/deploy-vps.yml
- .github/workflows/enforcement-audit.yml
- .gitignore
- .warp/MCP_SETUP.md
- .warp/README.md
- .warp/workflows/cluster-ssh.yaml
- .warp/workflows/mira-enum-drift.yaml
- .warp/workflows/mira-eval.yaml
- .warp/workflows/mira-logs.yaml
- .warp/workflows/mira-pr-review.yaml
- .warp/workflows/mira-rebuild-service.yaml
- .warp/workflows/mira-smoke-remote.yaml
- .warp/workflows/mira-smoke-test.yaml
**Working tree:**
- M .claude/settings.json
-  M docs/context/PROGRESS.md
- ?? .claude/settings.local.json
- ?? .claude/skills/audit-site/
- ?? .playwright-cache/
- ?? docs/ideation/2026-05-07-trade-show-strategy-automate-tampa.md
- ?? "docs/promo-screenshots/(Mike)Screenshot 2026-05-03 040306.jpg"
- ?? mira-hub/dom-crawl-app.mjs
- ?? mira-hub/dom-crawl.mjs
- ?? mira-hub/tests/e2e/reaudit-2026-05-04.spec.ts
- ?? mira-hub/tools/
- ?? mira-hud/
- ?? test-results/
- ?? tools/web-review-runs/2026-05-03-pr-940-proof/desktop${name}.png
- ?? tools/web-review-runs/2026-05-04-reaudit/
**Next:** _set by next session_

### 2026-05-09 12:41 UTC � `feat/mira-scan-monday-webhook-and-builder`
**Last commit:** 45bd95e7 security: bind all saas ports to loopback � prevent Docker UFW bypass
**Changed (vs. fork point):**
- .claude/hooks/stop.sh
- .claude/rules/karpathy-principles.md
- .claude/settings.json
- .claude/skills/youtube-transcript.md
- .enum-drift-allowlist.txt
- .githooks/pre-commit
- .github/pull_request_template.md
- .github/workflows/deploy-vps.yml
- .github/workflows/enforcement-audit.yml
- .gitignore
- .warp/MCP_SETUP.md
- .warp/README.md
- .warp/workflows/cluster-ssh.yaml
- .warp/workflows/mira-enum-drift.yaml
- .warp/workflows/mira-eval.yaml
- .warp/workflows/mira-logs.yaml
- .warp/workflows/mira-pr-review.yaml
- .warp/workflows/mira-rebuild-service.yaml
- .warp/workflows/mira-smoke-remote.yaml
- .warp/workflows/mira-smoke-test.yaml
**Working tree:**
- M .claude/settings.json
-  M docs/context/PROGRESS.md
- ?? .claude/settings.local.json
- ?? .claude/skills/audit-site/
- ?? .playwright-cache/
- ?? docs/ideation/2026-05-07-trade-show-strategy-automate-tampa.md
- ?? "docs/promo-screenshots/(Mike)Screenshot 2026-05-03 040306.jpg"
- ?? mira-hub/dom-crawl-app.mjs
- ?? mira-hub/dom-crawl.mjs
- ?? mira-hub/tests/e2e/reaudit-2026-05-04.spec.ts
- ?? mira-hub/tools/
- ?? mira-hud/
- ?? test-results/
- ?? tools/web-review-runs/2026-05-03-pr-940-proof/desktop${name}.png
- ?? tools/web-review-runs/2026-05-04-reaudit/
**Next:** _set by next session_

### 2026-05-09 12:44 UTC � `feat/mira-scan-monday-webhook-and-builder`
**Last commit:** 45bd95e7 security: bind all saas ports to loopback � prevent Docker UFW bypass
**Changed (vs. fork point):**
- .claude/hooks/stop.sh
- .claude/rules/karpathy-principles.md
- .claude/settings.json
- .claude/skills/youtube-transcript.md
- .enum-drift-allowlist.txt
- .githooks/pre-commit
- .github/pull_request_template.md
- .github/workflows/deploy-vps.yml
- .github/workflows/enforcement-audit.yml
- .gitignore
- .warp/MCP_SETUP.md
- .warp/README.md
- .warp/workflows/cluster-ssh.yaml
- .warp/workflows/mira-enum-drift.yaml
- .warp/workflows/mira-eval.yaml
- .warp/workflows/mira-logs.yaml
- .warp/workflows/mira-pr-review.yaml
- .warp/workflows/mira-rebuild-service.yaml
- .warp/workflows/mira-smoke-remote.yaml
- .warp/workflows/mira-smoke-test.yaml
**Working tree:**
- M .claude/settings.json
-  M docs/context/PROGRESS.md
- ?? .claude/settings.local.json
- ?? .claude/skills/audit-site/
- ?? .playwright-cache/
- ?? docs/ideation/2026-05-07-trade-show-strategy-automate-tampa.md
- ?? "docs/promo-screenshots/(Mike)Screenshot 2026-05-03 040306.jpg"
- ?? mira-hub/dom-crawl-app.mjs
- ?? mira-hub/dom-crawl.mjs
- ?? mira-hub/tests/e2e/reaudit-2026-05-04.spec.ts
- ?? mira-hub/tools/
- ?? mira-hud/
- ?? test-results/
- ?? tools/web-review-runs/2026-05-03-pr-940-proof/desktop${name}.png
- ?? tools/web-review-runs/2026-05-04-reaudit/
**Next:** _set by next session_

### 2026-05-09 13:04 UTC � `feat/mira-scan-monday-webhook-and-builder`
**Last commit:** 45bd95e7 security: bind all saas ports to loopback � prevent Docker UFW bypass
**Changed (vs. fork point):**
- .claude/hooks/stop.sh
- .claude/rules/karpathy-principles.md
- .claude/settings.json
- .claude/skills/youtube-transcript.md
- .enum-drift-allowlist.txt
- .githooks/pre-commit
- .github/pull_request_template.md
- .github/workflows/deploy-vps.yml
- .github/workflows/enforcement-audit.yml
- .gitignore
- .warp/MCP_SETUP.md
- .warp/README.md
- .warp/workflows/cluster-ssh.yaml
- .warp/workflows/mira-enum-drift.yaml
- .warp/workflows/mira-eval.yaml
- .warp/workflows/mira-logs.yaml
- .warp/workflows/mira-pr-review.yaml
- .warp/workflows/mira-rebuild-service.yaml
- .warp/workflows/mira-smoke-remote.yaml
- .warp/workflows/mira-smoke-test.yaml
**Working tree:**
- M .claude/settings.json
-  M docs/context/PROGRESS.md
- ?? .claude/settings.local.json
- ?? .claude/skills/audit-site/
- ?? .playwright-cache/
- ?? docs/ideation/2026-05-07-trade-show-strategy-automate-tampa.md
- ?? "docs/promo-screenshots/(Mike)Screenshot 2026-05-03 040306.jpg"
- ?? mira-hub/dom-crawl-app.mjs
- ?? mira-hub/dom-crawl.mjs
- ?? mira-hub/tests/e2e/reaudit-2026-05-04.spec.ts
- ?? mira-hub/tools/
- ?? mira-hud/
- ?? test-results/
- ?? tools/web-review-runs/2026-05-03-pr-940-proof/desktop${name}.png
- ?? tools/web-review-runs/2026-05-04-reaudit/
**Next:** _set by next session_

### 2026-05-09 13:20 UTC � `feat/mira-scan-monday-webhook-and-builder`
**Last commit:** b52ae6e9 fix(hub): add og:image to /login metadata + fix QA spec (CRA-115/113/126)
**Changed (vs. fork point):**
- .claude/hooks/stop.sh
- .claude/rules/karpathy-principles.md
- .claude/settings.json
- .claude/skills/youtube-transcript.md
- .enum-drift-allowlist.txt
- .githooks/pre-commit
- .github/pull_request_template.md
- .github/workflows/deploy-vps.yml
- .github/workflows/enforcement-audit.yml
- .gitignore
- .warp/MCP_SETUP.md
- .warp/README.md
- .warp/workflows/cluster-ssh.yaml
- .warp/workflows/mira-enum-drift.yaml
- .warp/workflows/mira-eval.yaml
- .warp/workflows/mira-logs.yaml
- .warp/workflows/mira-pr-review.yaml
- .warp/workflows/mira-rebuild-service.yaml
- .warp/workflows/mira-smoke-remote.yaml
- .warp/workflows/mira-smoke-test.yaml
**Working tree:**
- M .claude/settings.json
-  M docs/context/PROGRESS.md
- ?? .claude/settings.local.json
- ?? .claude/skills/audit-site/
- ?? .playwright-cache/
- ?? docs/ideation/2026-05-07-trade-show-strategy-automate-tampa.md
- ?? "docs/promo-screenshots/(Mike)Screenshot 2026-05-03 040306.jpg"
- ?? mira-hub/dom-crawl-app.mjs
- ?? mira-hub/dom-crawl.mjs
- ?? mira-hub/tests/e2e/reaudit-2026-05-04.spec.ts
- ?? mira-hub/tools/
- ?? mira-hud/
- ?? test-results/
- ?? tools/web-review-runs/2026-05-03-pr-940-proof/desktop${name}.png
- ?? tools/web-review-runs/2026-05-04-reaudit/
**Next:** _set by next session_

### 2026-05-09 13:58 UTC � `feat/mira-scan-monday-webhook-and-builder`
**Last commit:** b52ae6e9 fix(hub): add og:image to /login metadata + fix QA spec (CRA-115/113/126)
**Changed (vs. fork point):**
- .claude/hooks/stop.sh
- .claude/rules/karpathy-principles.md
- .claude/settings.json
- .claude/skills/youtube-transcript.md
- .enum-drift-allowlist.txt
- .githooks/pre-commit
- .github/pull_request_template.md
- .github/workflows/deploy-vps.yml
- .github/workflows/enforcement-audit.yml
- .gitignore
- .warp/MCP_SETUP.md
- .warp/README.md
- .warp/workflows/cluster-ssh.yaml
- .warp/workflows/mira-enum-drift.yaml
- .warp/workflows/mira-eval.yaml
- .warp/workflows/mira-logs.yaml
- .warp/workflows/mira-pr-review.yaml
- .warp/workflows/mira-rebuild-service.yaml
- .warp/workflows/mira-smoke-remote.yaml
- .warp/workflows/mira-smoke-test.yaml
**Working tree:**
- M .claude/settings.json
-  M docs/context/PROGRESS.md
- ?? .claude/settings.local.json
- ?? .claude/skills/audit-site/
- ?? .playwright-cache/
- ?? docs/ideation/2026-05-07-trade-show-strategy-automate-tampa.md
- ?? "docs/promo-screenshots/(Mike)Screenshot 2026-05-03 040306.jpg"
- ?? mira-hub/dom-crawl-app.mjs
- ?? mira-hub/dom-crawl.mjs
- ?? mira-hub/tests/e2e/reaudit-2026-05-04.spec.ts
- ?? mira-hub/tools/
- ?? mira-hud/
- ?? test-results/
- ?? tools/web-review-runs/2026-05-03-pr-940-proof/desktop${name}.png
- ?? tools/web-review-runs/2026-05-04-reaudit/
**Next:** _set by next session_

### 2026-05-09 15:24 UTC � `feat/mira-scan-monday-webhook-and-builder`
**Last commit:** b52ae6e9 fix(hub): add og:image to /login metadata + fix QA spec (CRA-115/113/126)
**Changed (vs. fork point):**
- .claude/hooks/stop.sh
- .claude/rules/karpathy-principles.md
- .claude/settings.json
- .claude/skills/youtube-transcript.md
- .enum-drift-allowlist.txt
- .githooks/pre-commit
- .github/pull_request_template.md
- .github/workflows/deploy-vps.yml
- .github/workflows/enforcement-audit.yml
- .gitignore
- .warp/MCP_SETUP.md
- .warp/README.md
- .warp/workflows/cluster-ssh.yaml
- .warp/workflows/mira-enum-drift.yaml
- .warp/workflows/mira-eval.yaml
- .warp/workflows/mira-logs.yaml
- .warp/workflows/mira-pr-review.yaml
- .warp/workflows/mira-rebuild-service.yaml
- .warp/workflows/mira-smoke-remote.yaml
- .warp/workflows/mira-smoke-test.yaml
**Working tree:**
- M .claude/settings.json
-  M docs/context/PROGRESS.md
- ?? .claude/settings.local.json
- ?? .claude/skills/audit-site/
- ?? .playwright-cache/
- ?? docs/ideation/2026-05-07-trade-show-strategy-automate-tampa.md
- ?? "docs/promo-screenshots/(Mike)Screenshot 2026-05-03 040306.jpg"
- ?? mira-hub/dom-crawl-app.mjs
- ?? mira-hub/dom-crawl.mjs
- ?? mira-hub/tests/e2e/reaudit-2026-05-04.spec.ts
- ?? mira-hub/tools/
- ?? mira-hud/
- ?? test-results/
- ?? tools/web-review-runs/2026-05-03-pr-940-proof/desktop${name}.png
- ?? tools/web-review-runs/2026-05-04-reaudit/
**Next:** _set by next session_

### 2026-05-09 16:26 UTC � `feat/mira-scan-monday-webhook-and-builder`
**Last commit:** b52ae6e9 fix(hub): add og:image to /login metadata + fix QA spec (CRA-115/113/126)
**Changed (vs. fork point):**
- mira-hub/package.json
- mira-hub/src/app/login/page.tsx
- mira-hub/tests/e2e/audit-fixes-2026-05-09.spec.ts
**Working tree:**
- M .claude/settings.json
-  M docs/context/PROGRESS.md
- ?? .claude/settings.local.json
- ?? .claude/skills/audit-site/
- ?? .playwright-cache/
- ?? docs/ideation/2026-05-07-trade-show-strategy-automate-tampa.md
- ?? "docs/promo-screenshots/(Mike)Screenshot 2026-05-03 040306.jpg"
- ?? mira-hub/dom-crawl-app.mjs
- ?? mira-hub/dom-crawl.mjs
- ?? mira-hub/tests/e2e/reaudit-2026-05-04.spec.ts
- ?? mira-hub/tools/
- ?? mira-hud/
- ?? test-results/
- ?? tools/web-review-runs/2026-05-03-pr-940-proof/desktop${name}.png
- ?? tools/web-review-runs/2026-05-04-reaudit/
**Next:** _set by next session_
<!-- END AUTOLOG -->
