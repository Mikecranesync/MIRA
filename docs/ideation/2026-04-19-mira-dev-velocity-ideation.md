---
date: 2026-04-19
topic: mira-dev-velocity
focus: code speed + accuracy + implementation throughput for a 1-2 engineer team
mode: repo-grounded
---

# Ideation: MIRA Dev-Velocity Improvements

## Grounding Context (Codebase + External Research)

**MIRA dev state:** 4 contributors (Mike primary 441 commits, Harper 186, CharlieNode 184, Michael 18); ~1–2 commits/day; 30 commits in 15 days. Python + TypeScript monorepo; 11 modules; ~40k source files.

**Dev infrastructure today:**
- **CI (GitHub Actions):** `ci.yml`, `ci-evals.yml`, `dependency-check.yml`, `prompt-guard.yml`, `release.yml`. Runs ruff + pyright + gitleaks + bandit + semgrep + license audit + offline eval. Unit tests and SAST run **sequentially**. No selective test runs (full suite every push). No Docker cache `type=gha`.
- **CD:** Manual — SSH through Charlie over Tailscale to DO VPS. **No auto-deploy on merge.** Orphan-container bug once silently no-op'd prod deploys.
- **Pre-commit:** gitleaks-only (shell hook in settings.json). **No pre-commit ruff/pyright/bandit.**
- **Testing/eval:** 76 offline tests in 7 regimes + 51 YAML eval scenarios with LLM-judge (Groq + Claude routing). 54/57 stable baseline; 3 stochastic Q-trap failures. chromadb/starlette version conflict blocks 3 test suites (known-issue). Nightly eval slow; no <60s local eval loop.
- **Local dev:** `doppler run -- docker compose up -d`. **Multi-compose overlay complexity** (core + observability + pathb + saas + per-service). NeonDB SSL `channel_binding` broken on Windows → integration tests require SSH to macOS (Alpha/Charlie). Doppler-over-SSH keychain dance on Bravo/Charlie (`token-storage file`, `DOCKER_CONFIG=/tmp/docker-config`, `docker cp`).
- **Spec/plan surface:** 50+ `.md` files in `docs/superpowers/plans/` + `docs/superpowers/specs/` with no index. Session resumption loses 10–20 min per "where were we."
- **Plugins live:** compound-engineering (26 agents / 23 cmds / 13 skills, just installed), superpowers, feature-dev, context7, codex, code-simplifier. Custom `.claude/skills/` has 12 files.
- **Locked constraints:** Doppler-only secrets, MIT/Apache licenses only, no LangChain/TF/n8n, Anthropic API + NeonDB only cloud, macOS keychain quirks, 1–2 engineer team.

**External velocity signals (2025–2026):**
- Claude Code = 80.9% SWE-bench Verified, 5.5× fewer tokens than Cursor on equivalent tasks.
- Compound Engineering (Every Inc., Jan–Feb 2026): 80/20 ratio — plan+review is 80%, execute is 20%. First attempts ~95% garbage, 2nd ~50% — treated as process, not failure.
- **Subagents = context GC, not parallelism.** Win conditions: work-to-overhead > 3:1, >5 files, read-heavy. Antipatterns: <10k-input-token dispatch (cold-start tax), vague dispatch prompts, loading all agent descriptions upfront.
- Context rot documented across 18 frontier models; `.claudeignore` + `.claudemd` + plan mode solve ~80% of context-management problems.
- CI maturity ladder: (1) tests on PR, (2) auto-staging-deploy on main, (3) prod deploy with rollback — teams frequently stall at (1) for months.
- `pytest-xdist -n auto` = free parallelism; Docker cache `type=gha` = 3–4 min → 30–60s on warm cache.
- Eval gate ladder: pre-commit smoke (15–20 cases, <2min); pre-merge regression (100–200 × 3 runs, <15min); pre-release deep — 93% of evals happen pre-deployment.
- Golden set: start 20–50 cases, don't scale past 100 before metric-outcome fit (>95% alignment with human judgment).
- SpaceX Raptor: 2-day test-fire cadence, integrated full-system testing as routine. 17k software deploys/day enabled by emulator-tested auto-approval.
- F1 pit crew: eliminate errors, don't target speed. 24-race rotation to prevent fatigue mistakes.
- Newsroom assignment editor as orchestrator — bottleneck is routing, not execution.
- ER triage: pre-agreed protocol eliminates real-time decision-making.

## Ranked Ideas

### 1. Auto-Deploy to Staging on Green Main Merge + One-Click Prod Promote
**Description:** GitHub Actions workflow triggered on `push:main` that runs the 76 offline tests + 15-case smoke eval, then (if green) SSHes via deploy key through Charlie to Bravo, runs `docker compose pull && up -d --remove-orphans`, tags image with `git-sha`, and writes `/healthz` before marking green. Prod deploy stays manual via `workflow_dispatch` on a tagged commit — one click, no terminal ritual.
**Rationale:** Manual SSH-through-Charlie is the #1 recurring time tax and the hidden root cause of the orphan-container silent-fail pattern. CI-maturity-ladder step (2) is where MIRA is stuck; shipping 2–5× more often with less anxiety is the single biggest velocity lever for a 1–2 eng team.
**Downsides:** Requires deploy-key plumbing through Charlie (Tailscale + macOS keychain = the exact gotcha this repo has hit). Staging stack must be isolated from prod or rollback becomes scary. Risk: staging drift from prod as auto-deploys bake in shortcuts.
**Confidence:** 90%
**Complexity:** Medium
**Status:** Unexplored

### 2. Impact-Graph CI: pytest-xdist + Selective Tests + Docker gha Cache + Parallel SAST
**Description:** Single PR that (a) adds `-n auto` to pytest invocation, (b) adds `pytest --testmon` or `tools/impact.py` that maps changed files → affected services → required test suites (skipping untouched regimes on feature branches), (c) adds `cache-from: type=gha` to all Docker build steps, and (d) splits SAST (gitleaks/bandit/semgrep/license) into its own parallel GitHub Actions job. Full matrix still runs on `main` merges.
**Rationale:** Grounding confirms pytest-xdist is free parallelism; Docker `type=gha` cache drops 3–4 min → 30–60s on warm cache; selective runs cut 40–60% of CI on feature branches. Compounds per-push, every engineer, forever. Nothing controversial; zero architectural risk.
**Downsides:** `pytest --testmon` needs a baseline capture; first few runs are full. Impact graph requires a dependency map that must be maintained (or auto-derived from imports + compose deps). Parallel SAST might hit GitHub Actions free-tier concurrency limits on busy days.
**Confidence:** 95%
**Complexity:** Low
**Status:** Unexplored

### 3. Pre-Commit + On-Save Smoke Eval (15 Offline Cases, <2min) + SAST Parity
**Description:** Two shifts left: (1) Pre-commit hook that runs ruff + pyright + gitleaks + bandit + 15 handpicked eval cases (one per regime + the 3 Q-trap cases) using offline judge only — no Groq roundtrip. (2) A filesystem watcher on `mira-bots/shared/prompts/` and `mira-pipeline/` prompts runs a 10-case subset inline on every save. Full 39-case judged eval still runs in CI on PR.
**Rationale:** Compound-engineering eval ladder says pre-commit smoke catches 80% of regressions at 1/10 the cost. Today every prompt tweak is tested manually in Open WebUI and the result is lost on /clear. Turning prompt engineering from guess-and-push into a REPL is a 10–100× diagnosis-window compression. Also ends the "pushed, went to lunch, came back to red" anti-pattern.
**Downsides:** Must keep the 15-case smoke set truly fast — if it creeps to 3min, engineers disable it. Watch-loop risks eval flakes interrupting flow unless calibrated. Needs a clean offline-judge path (no Groq flakes in the loop).
**Confidence:** 85%
**Complexity:** Medium
**Status:** Unexplored

### 4. Auto-Mint Regression Evals From Every `fix:` PR
**Description:** A `/ce-compound`-style post-merge hook parses each `fix:` PR, extracts the failing input and expected behavior from the diff/commit message, and appends a scenario to `tests/eval/` with an LLM-judge rubric generated from the PR description. Merge blocked if the new eval case doesn't pass on the fixed code.
**Rationale:** Today every fix solves one case and evaporates. In 6 months the eval set grows from 51 → 200+ without any dedicated eval-writing time. The golden set becomes a byproduct of shipping (compound engineering's 20% lesson-codification) rather than a chore. Directly protects against the exact class of regressions the team has already paid to learn about.
**Downsides:** Auto-generated rubrics can be lax; human review of the minted eval is still needed before merge. Risks eval-set bloat past the 100-case metric-outcome-fit threshold if every fix mints a case — needs periodic pruning/consolidation.
**Confidence:** 80%
**Complexity:** Medium
**Status:** Unexplored

### 5. Prompt Registry + CI Eval-Diff Gate on Change
**Description:** Extract every system prompt, safety-keyword list, and tool schema from mira-pipeline / mira-bots / mira-mcp / mira-web into a versioned `prompts/` directory (YAML, content-hashed). CI auto-runs the 51-scenario eval on any PR that touches a registered prompt and posts a diff table (pass@1, judge-score delta per scenario) as a PR comment. Phase 2: publish as a shared `mira-shared` workspace package so cross-service prompt changes are one PR.
**Rationale:** Prompt drift across 4 services already caused the P0 pipeline regression #380 (JSON envelope leak). A registry + gate catches that class of regression before merge, enables prompt A/B history for free, and makes prompt engineering a measured experiment instead of seat-of-pants. Cross-cuts with idea #3 (eval infrastructure).
**Downsides:** Extraction refactor is invasive — touches 4 services. Risk of over-engineering the registry schema before usage patterns settle. Content-hash identity may make prompt diffs hard to read in PR review.
**Confidence:** 85%
**Complexity:** Medium
**Status:** Unexplored

### 6. Frontmatter-Tagged Spec/Plan Index + Semantic Grep via nomic-embed
**Description:** Auto-generate `docs/superpowers/INDEX.md` from frontmatter (`status: active|shipped|abandoned`, `last-touched`, `owner`, `linked-PR`). Pre-commit hook fails if a plan/spec lacks frontmatter. Weekly job opens a stale-PR for >30-day-untouched `active` docs. Phase 2: ingest all 50 spec files + `docs/adr/` + `wiki/` into a local embedding index (reusing `nomic-embed-text:v1.5` on Bravo per the knowledge-ingest pipeline), exposed via a `/mira ctx <query>` slash-command returning top-5 snippets with paths.
**Rationale:** Session resumption is 10–20 min of `Grep` archaeology. A queryable decision corpus means every planning session starts where the last one ended, prevents contradicting prior ADRs, and turns sprawl from liability into asset. Reuses existing MIRA infra (nomic-embed + NeonDB pgvector is already running).
**Downsides:** Retrofitting frontmatter across 50 existing files is a one-time slog. Semantic grep quality depends on chunking strategy (well-understood in MIRA — reuse `chunker.chunk_blocks()`). Stale-PR might become noise if too many active-but-parked plans exist.
**Confidence:** 90%
**Complexity:** Low
**Status:** Unexplored

### 7. Unified Devcontainer + Compose Profiles + Doppler Default-Shell
**Description:** Three-in-one dev-environment rewrite: (a) `.devcontainer/` pinned to Linux userland that proxies Doppler via mounted token file, uses `channel_binding=disable` shim for Neon, pre-warms Docker BuildKit cache; (b) collapse the 5+ compose overlays into a single `compose.yaml` with `profiles:` (`core`, `obs`, `pathb`, `saas`) wrapped in `mira up <profile>`; (c) SessionStart hook exports Doppler env vars once so `docker compose up` works without `doppler run --` prefix. Works identically on Windows, Travel Laptop, Bravo, Charlie.
**Rationale:** Today Mike SSHes to a Mac to run integration tests because Windows NeonDB SSL fails. One codified environment kills the SSH hop, the keychain dance, and "works on my machine" triage. Compose profiles end the overlay maze and the orphan-container bug. Doppler default-shell removes the `doppler run --` keystroke tax. Three recurring weekly time sinks, one ~1-week project.
**Downsides:** Devcontainer migration touches every developer's flow — short-term pain. Claude Code hook for Doppler requires careful scope (don't leak env vars to logs). macOS keychain quirks on Bravo/Charlie may force a hybrid approach (devcontainer on laptops, existing token-file on Mac Minis).
**Confidence:** 75%
**Complexity:** Medium-High
**Status:** Unexplored

## Cross-Cutting Enablers (Not Survivors, but Multipliers)

- **Parallel worktree harness** (`mira wt spawn` — provisions worktree + isolated docker stack on offset port range + isolated Postgres/ChromaDB volumes + tmux layout). Unlocks 3× parallelism ceiling — 3 Claude agents shipping simultaneously instead of 1. Complements survivor #7.
- **AI-director `/ship <issue-url>` macro** (wires compound-engineering + superpowers + feature-dev into one flow: reads issue, drafts plan, spins worktree, writes code, runs tests/evals, opens PR, self-applies review comments, merges on green). Strategic reframe — practical once survivors #1, #2, #3 are in place. This is Mike's path from implementer to director.
- **Speedcubing skill "algs"** (`wiki/algs/` — named, parameterized recipes for recurring subtasks: add-a-new-bot-adapter, add-a-new-MCP-tool, swap-a-Doppler-secret, add-a-new-eval-fixture). Each a Claude Code skill invocation. Converts the repetitive 40% of commits into muscle memory.
- **Smart-commit expansion** (msg + CHANGELOG + KANBAN status + PR body in one pass from the staged diff). Kills 4 separate "remember to update X" chores per commit.
- **PR-review catches → `.claude/rules/*.md` auto-ingest** (`/ce-review-harvest` scans merged PR reviews, clusters recurring catches, proposes new rules). Reviewer gets monotonically stricter without effort.
- **Session-surprise capture skill** (`/surprise` writes a dated one-pager to `wiki/lessons/` with file paths touched, re-embeds into the knowledge index). Tribal knowledge survives `/clear`; next agent in that module inherits the scar tissue for free.
- **Per-module maintainer agents** (`.claude/agents/<module>-maintainer.md`, auto-invoked via PreToolUse hook when Claude touches files in that path). Module context loads only when needed — preserves main-session tokens; ends "Claude forgot mira-mcp uses NullPool."

## Rejection Summary

| # | Idea | Reason Rejected |
|---|------|-----------------|
| 7 | Centralize prompts into shared package | Merged into #5 as Phase 2 |
| 8 | Encode Q-trap + chromadb/starlette as CI gate | Overlaps #3 — pin in pyproject and handle flake via `@pytest.mark.flaky`; fold into #3's scope |
| 10 | Smart-commit expansion | Cross-cutting enabler, narrower than top 7 |
| 11 | Auto-generate spec files from issue | Covered by AI-director enabler + survivor #6 (spec structure) |
| 14 | Self-updating `wiki/hot.md` | Subsumed by Session-surprise capture enabler + auto-derivable from git log |
| 17 | AI drafts every PR, human reviews | Too strategic for ideation — lives as AI-director enabler |
| 18 | Specs as commit-time byproducts | Strategic reframe; not a concrete shippable improvement |
| 20 | One PR per plan file, not per module | Already mostly true in MIRA |
| 21 | Rolling worktrees, no main branch | Too risky for pre-PMF; covered partially by #1 + worktree enabler |
| 23 | CLAUDE.md writes itself | Subsumed by Session-surprise capture + PR-review→rules |
| 24 | Terminal-free daily driver | Strategic, lives in AI-director enabler |
| 25 | Five surfaces → one thin core | Architectural refactor, out of scope for velocity |
| 28 | Session-surprise capture | Cross-cutting enabler |
| 29 | Parallel worktree harness | Cross-cutting enabler |
| 30 | Shared python+ts test harness + Docker base | Substrate for #2 and #7; defer as enabler |
| 31 | PR-review catches → rules | Cross-cutting enabler |
| 33 | Spec/ADR index with semantic grep | Merged into #6 as Phase 2 |
| 34 | Mise-en-place nightly prep-chef | Subsumed by AI-director enabler |
| 35 | Crop rotation for modules | Process overhead for 1–2 eng; better handled by Dependabot + auto-batch PRs |
| 37 | Incident Command System for shipping | Process overhead; 80% covered by #1 + compound-engineering workflow |
| 38 | Surgical timeout pre-deploy checklist | Subsumed by #1 auto-deploy + healthcheck |
| 40 | Portfolio rebalancing for eval flakes | Good pattern but lives inside #3 flake handling |
| 41 | Speedcubing algs | Cross-cutting enabler |
| 42 | Headless Claude as always-on janitor | AI-director enabler variant |
| 43 | One executable spec file | Too bold; #6's semantic grep gives most of the value |
| 44 | Per-module maintainer agents | Cross-cutting enabler |
| 45 | Ten worktrees always live | Subsumed by parallel worktree enabler |
| 46 | Evals-as-tests; delete 60% unit assertions | Evolution of #4+#5; revisit in 6 months |
| 49 | Compound-engineering drives whole dev loop | AI-director enabler — same category as #17 |
