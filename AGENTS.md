# FactoryLM / MIRA — Project Map (provider-neutral)

This is the root bootloader for **every** coding agent — Claude, Codex, or a future provider.
It is a map, not an encyclopedia: each line points at the canonical document; nothing here is
the only copy of anything. Claude loads it through root `CLAUDE.md` (`@AGENTS.md`); Codex reads
it directly. Provider files may add behavior; they may not redefine what is written here.

## What this is

**FactoryLM** is the maintenance-context layer that makes messy factory data trustworthy for AI
on any Unified Namespace. **MIRA** is the grounded diagnostic agent that proves it — every answer
cites the customer's own manuals, tags, and work orders. Lead with the context platform; the
copilot is the proof. Not a generic chatbot, not a SCADA or CMMS replacement, **read-only toward
plant equipment**. Version = the latest `v*` git tag (`docs/versioning.md`); there is no VERSION file.

## Start here (read in this order, then stop reading)

1. `NORTH_STAR.md` — canonical wedge, commercial flywheel, the ProveIt 2027 demo runbook.
2. `docs/THEORY_OF_OPERATIONS.md` — what MIRA is, how it works, why. Primary doctrine.
3. `docs/agent-standard/FLEET_STANDARD.md` — how agents work here (boot sequence, ownership,
   worktrees, evidence, stop conditions). Then your provider adapter under
   `docs/agent-standard/providers/` and your node overlay under `docs/agent-standard/nodes/`.
4. `wiki/hot.md` — where to resume; current cross-project state. **Update it at session end.**
5. The active task contract (issue, PR, or `docs/plans/…`) and only the ADRs it references.

Do not read six months of history "just in case." Deeper context is listed at the bottom.

## Product state and direction

- **Beta gate** — "a stranger uploads their own manual and gets a cited answer with no manual
  fix." Retrieval path: MET, CI-enforced (`.github/workflows/beta-gate.yml`). Product surface:
  see `docs/known-issues.md` § Beta Gate and `wiki/hot.md` for the live status.
- **Train before deploy** — the Command Center (`mira-hub`) builds and validates; Ignition/HMI
  consumes approved intelligence only. `.claude/rules/train-before-deploy.md`,
  `docs/specs/asset-agent-validation-spec.md`.
- **Master plan** — `docs/plans/2026-06-01-mira-master-architecture-plan.md` governs all current
  development. Unified UI cutover: `docs/architecture/convergence/UNIFIED_UI_CUTOVER.md`.

## Architecture (authoritative pointers)

- Layer map and dependency rules: `docs/ARCHITECTURE.md`. Per-module contexts: `CONTEXT-MAP.md`
  (each module has its own `CLAUDE.md` — read it as the module map regardless of provider).
- Modules: `mira-bots/` (adapters + the Supervisor engine, `shared/engine.py`), `mira-hub/`
  (Command Center, Next.js), `mira-pipeline/` (chat API), `mira-mcp/`, `mira-crawler/` (KB
  ingest), `mira-relay/` (factory→cloud tags), `mira-web/`, `mira-cmms/`, `mira-bridge/`,
  `simlab/`, `plc/`, `wiki/`, `docs/`, `tests/`, `tools/`. Deferred/archived modules and how to
  restore them: `docs/known-issues.md`.
- Decisions: `docs/adr/`. Specs: `docs/specs/`. Convergence registry and change gates:
  `docs/architecture/FACTORYLM_MIRA_ARCHITECTURE_CONVERGENCE.md` + `convergence/REGISTRY.yaml`.
- Containers, ports, networks: `docs/environments.md § Container Map` — generated from the compose
  files by `tools/gen_container_map.py` and drift-locked in CI; never hand-edit. Nodes and IPs:
  `deployment/network.yml`.

## Hard constraints (PRD §4 — non-negotiable)

1. Licenses: Apache 2.0 or MIT only.
2. Cloud LLMs: **Groq → Cerebras → Together** cascade, free-tier, OpenAI-compatible. NeonDB for
   persistence. **No Anthropic in the diagnostic cascade** (removed #610; sole carve-out is
   PrintSynth print-vision, #2661). Gemini is banned.
3. No LangChain, TensorFlow, n8n, or any framework that abstracts the LLM call.
4. Secrets only via Doppler, env-scoped `factorylm/{dev,stg,prd}`. Never commit `.env`; never
   paste prod values into a dev shell.
5. One container per service, `restart: unless-stopped`, healthcheck, pinned images.
6. Conventional Commits — the merge title drives the auto-tag (`docs/versioning.md`).
7. UNS compliance: every asset row carries a `uns_path` or entity FK. `.claude/rules/uns-compliance.md`.
8. Environments are separated and promoted dev → staging → prod. Doctrine: `docs/environments.md`.

## Environment and deployment safety

`docs/environments.md` is the law. The three hard NEVERs, enforced by `tools/hooks/prod-guard.sh`:
no raw SQL against prod NeonDB from a session; no direct `docker compose`/restart on the VPS
(use `deploy-vps.yml`); no feature-branch traffic to the prod Telegram bot. Migrations go
dev → staging → prod via `apply-migrations.yml`; engine/RAG/classifier changes pass the staging
gate first. Plant equipment is read-only: `.claude/rules/fieldbus-readonly.md`.

## Code navigation: CodeGraph is the sole authority

Run `tools/codegraph-preflight.sh` before non-doc code work; trust call-graph results only on a
READY index. Symbol-shaped questions go to CodeGraph before grep. Rules and blind spots:
`.claude/rules/codegraph-usage.md`; reference `wiki/references/codegraph.md`. Graphify is
excluded from code navigation (`.claude/rules/graphify-excluded.md`).

## Durable memory: the Obsidian wiki

`wiki/` is project memory — runbooks, gotchas (`wiki/gotchas/`), node notes (`wiki/nodes/`),
references, lessons. Schema `wiki/SCHEMA.md`. Chat history is context, never project state: a
discovery that lives only in a transcript is not recorded.

## Task workflow and ownership

- Claim before building; one task = one worktree = one branch = one writer; never touch another
  session's branch, worktree, stash, or dirty checkout. `.claude/rules/multi-session-protocol.md`.
- Write in an owned worktree, never the shared canonical checkout; whoever creates a worktree
  removes it. `.claude/rules/subagent-worktree-isolation.md`.
- Merge and deploy are human gates. Independent exact-SHA review before merge; a verdict on a
  previous head is stale. Max three autonomous review rounds, then escalate.
- Architecture-affecting work needs an R0 rollback point and the convergence gates
  (`docs/architecture/FACTORYLM_MIRA_ARCHITECTURE_CONVERGENCE.md`).
- Issues: GitHub `Mikecranesync/MIRA` (`docs/agents/issue-tracker.md`); triage labels
  `docs/agents/triage-labels.md`; defect workflow `docs/agents/subagent-development-handbook.md`.

## Verification and evidence

- Done = deterministic proof: the test ran, the endpoint answered, the screenshot exists. Never
  claim fixed/tested/green/merged/deployed without it; a green badge on a stale SHA is not green.
- A capability is done only when connected, tested by a named CI job, enabled somewhere real, and
  proven — or explicitly closed in `docs/architecture/convergence/CAPABILITY_CLOSURE.yaml`.
- Tests: `tests/` five-regime framework, golden cases `tests/golden_*.csv`, eval `tests/eval/README.md`.
  Mobile: `tools/mobile-e2e/` on an emulator by default. Smoke after deploy: `install/smoke_test.sh`.
- UI changes ship screenshots to `docs/promo-screenshots/` (`YYYY-MM-DD_feature_viewport.png`,
  desktop 1440×900 + mobile 412×915; append-only). UI style: `.claude/rules/ui-style.md`.
- Automated PR review: `.github/workflows/code-review.yml` + `.ast-grep-rules/`; pre-commit gate
  `.githooks/pre-commit` (`git config core.hooksPath .githooks` is per-clone — verify it, it fails open).
- Closeout uses the schema in `docs/agent-standard/FLEET_STANDARD.md` §10.

## Stop conditions (report instead of improvising)

Another worker owns the worktree or session · the change would touch production, deploy, OTA,
or a version file · a secret would enter Git or cross machines · a PLC/VFD write, forced I/O, or
motion command · required authority is unclear · canonical sources materially disagree · a
review, CI run, or tool is missing or broken (fail closed, report PARTIAL/BLOCKED) · a
destructive command whose resolved target you have not printed and confirmed
(`.claude/rules/dangerous-commands-safety.md`).

## Where to obtain deeper context

- Agent standard, node overlays, provider adapters: `docs/agent-standard/` (rollout: `rollout.md`).
- The detailed rule corpus: `.claude/rules/` — Claude loads it automatically; other providers read
  the rule a task touches. A rule that exists only there is provider drift to report, not to copy.
- Skills: `.agents/skills/` (neutral), `.claude/skills/` (Claude). Env vars: `docs/env-vars.md`.
- Quality and tech debt: `docs/QUALITY_SCORE.md`, `docs/tech-debt/`. Observability: `docs/observability/`.
- Programs in flight (read only when your task names them): unification/"one technician brain"
  `docs/prd/2026-07-30-mira-unification-program.md` (ADR-0033, not yet ratified); materialized
  evidence `docs/architecture/materialized-evidence.md` (ADR-0029); zero-token spend law
  `.claude/rules/zero-token-architecture.md`; SimLab `docs/simlab/README.md`; kiosk/AskMira
  `docs/runbooks/kiosk-askmira-deploy-and-verify.md`; Ignition module
  `docs/RESUME_2026-06-14_maintenance-intelligence-module.md`.
- History: `docs/CHANGELOG.md` (frozen archive), GitHub Releases, `git log`.

This file targets 100–150 lines. If a fact needs more than a line, it belongs in the document
the line points at. Audit it when `docs/agent-standard/` changes.
