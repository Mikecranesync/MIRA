# MIRA / FactoryLM SDLC v1 — Proposal

**Status:** PROPOSAL — not ratified. Nothing in this document changes CI, branch protection,
CLAUDE.md, environments, or repository policy until Mike approves it. Where this document and a
live workflow disagree, the live workflow on `main` wins until the change is made deliberately.
**Date:** 2026-10-03 · **Reconnaissance base:** `origin/main` @ `32bcaa67e88fc2338103dd0b77b61e9ad3d76e57`
**Authors:** Claude (design + recon), Codex (independent challenge, §8) · **Owner:** Mike
**Related:** `docs/environments.md`, `docs/adversarial-review-workflow.md`, `docs/review-cheap-lane.md`,
`docs/versioning.md`, `.claude/rules/multi-session-protocol.md`,
`docs/architecture/FACTORYLM_MIRA_ARCHITECTURE_CONVERGENCE.md`,
`docs/architecture/convergence/{CAPABILITY_CLOSURE,RELEASE_TRAIN,REGISTRY}.yaml`

---

## 0. One-paragraph summary

MIRA already runs a PR-gated, trunk-based lifecycle with an unusually strict production path: six
required status contexts with strict up-to-date, an exact-SHA staging deploy that leaves a receipt
artifact, and a production deploy that refuses to run without that receipt, a passing Staging Gate on
the PR head, and zero migration drift. What it lacks is not machinery but **formal shape**: no
written lifecycle, no risk tiering (the only classifier is the binary "substantial" in the
multi-session protocol), gates whose evidence lives in prose rather than named artifacts, several
governance docs that describe automation that no longer exists, and zero lifecycle metrics. SDLC v1
therefore **names** the lifecycle that is already running, assigns each step an existing mechanism
and an evidence artifact, adds four risk classes so documentation PRs stop inheriting R3 ceremony,
and proposes exactly three small additions (an `incident` label, a risk-class field in the PR
template consumed by the existing path filter, and a read-only DORA script). Everything else is
REUSE, CONNECT, or REPAIR of what exists.

---

## 1. Current-state lifecycle map (what actually runs on `main` today)

Legend: **ENFORCED** = a workflow, hook, branch rule, or test fails when violated. **DOCTRINE** = a
written rule relying on human/agent discipline. **STALE** = the doc describes something the code no
longer does. File references are to `origin/main` @ `32bcaa67e`.

### 1.1 Intake → design

| Step | Mechanism today | Status | Evidence artifact |
|---|---|---|---|
| Idea / defect intake | GitHub Issues via `gh` (`docs/agents/issue-tracker.md`); 5 triage labels live (`needs-triage` 220, `ready-for-agent` 98, `ready-for-human` 38, `needs-info` 5 issues) | ENFORCED (tracker) / DOCTRINE (triage) | Issue number |
| Mission | One program uses a mission ID (`FACTORYLM-UNIFIED-UI-CUTOVER-001`, issue #3626); a second name (`FLM-UI-4000`) exists for related work. No general scheme | DOCTRINE, one-off | — |
| PRD + acceptance criteria | Two unreconciled tracks: 18 files in `docs/prd/` (header convention drifted after 2026-09, no template file) and 14 issues titled `PRD: …` (e.g. #4160 accumulates owner decisions as numbered comments). `grep "Acceptance Criteria" docs/prd` = 0 hits | DOCTRINE | PRD file or issue thread |
| ADR when required | 40 MADR files in `docs/adr/`; README index lists 13/40; ~9 are Draft/Proposed ("awaiting Mike"); numbering collisions at 0014 and 0037. Convergence doc defines Gates 0–11 + R0/R1 checkpoints but nothing mechanical checks "ADR exists" or "R0 recorded" | DOCTRINE | ADR file, `CU-*.md` unit record (8 exist) |
| Risk classification | Binary "substantial" (`.claude/rules/multi-session-protocol.md` §5). S0–S5 is a *safety consequence* scale (handbook §16.2), not change risk. `R0/R1` already mean rollback checkpoints in the convergence doc | DOCTRINE | None |
| Work claim | `[WORK-CLAIM]` block, post-claim re-read, earliest-ACTIVE wins (§2 of the protocol). Only `tools/ui_surface_lifecycle_guard.py:1662` reads the literal, as a text boundary | DOCTRINE | Issue/PR comment |

### 1.2 Implementation → review

| Step | Mechanism today | Status | Evidence artifact |
|---|---|---|---|
| Short-lived branch off current main | `.claude/rules/session-discipline.md`; `feat/fix/chore/ops` prefixes | DOCTRINE (reality: 40 open PRs, ~25 drafts, oldest 2026-09-13) | Branch |
| Local gates | `ruff format --check && ruff check && pytest -q`; `.githooks/pre-commit` (shellcheck, gitleaks, debug-artifact, actionlint, agent-symbol check warn-only). `core.hooksPath` is per-clone and was found unset 2026-08-09 | DOCTRINE (hook is opt-in; fails open when a tool is missing) | None durable |
| Developer verification | PR template `Test plan` + `Acceptance criteria verified` checkbox (`.github/pull_request_template.md`); hazard ledger (global CLAUDE.md only; 1 repo hit) | DOCTRINE | PR body prose |
| Property / mutation / adversarial / eval | Hypothesis: 2 files (`tests/test_fsm_properties.py`, `tests/test_guardrails_properties.py`). Source mutation tooling: **none**; manual "mutation check" is step 6 of `.claude/skills/defect-workflow/SKILL.md`. Eval: 51 scenario fixtures run by Celery on the VPS (hourly/nightly), `deepeval-ci.yml` on PR (path-filtered), `eval-replay-gate.yml` **inert** (replay store never recorded) | Mixed; eval-on-PR is path-gated, mutation is manual | CI logs, `tests/eval/runs/*.md` |
| Cheap review lane (required by owner decision 2026-10-03) | `tools/gate7_review.py <PR> --paid --post` → `[CHEAP-REVIEW]` comment; cost to `.planning/review-costs.jsonl` (gitignored). Head SHA captured once at fetch, not re-read before posting | DOCTRINE (not a required status context) | PR comment |
| Independent exact-head Codex review | `git show origin/main:scripts/adversarial-review-trusted.sh \| bash -s -- <PR> --review-only`; exact-SHA re-verify before review and before GREEN; 3-round budget counted from the GitHub ledger; `ADV_REVIEW_HUMAN_AUTHORIZED=1` post-cap | ENFORCED when run; *running it* is DOCTRINE (owner say-so) | `[CODEX-ADVERSARIAL-REVIEW]` comments, `scripts/adversarial-review-ledger.mjs` |
| Claude-reviews-Claude carve-out | `.claude/rules/multi-session-protocol.md:152-180`, self-expired **2026-09-13**, still present verbatim | STALE | — |

### 1.3 Merge

| Step | Mechanism today | Status | Evidence artifact |
|---|---|---|---|
| Required status contexts | Classic protection on `main`: `staging-gate`, `Hub E2E (command-center + onboarding)`, `mira-web pack tests`, `CI Gate`, `hold-gate`, `Shared UI contract (bun 1.4.0)`; `strict: true`; `enforce_admins: true`; required approving reviews **0**; ruleset 17097034 adds PR-required + non-fast-forward + `staging-gate` (read live 2026-10-03) | ENFORCED | GitHub check runs on the head SHA |
| `CI Gate` aggregator (`ci.yml` `ci-gate`) | 16 jobs must literally `success` (actionlint, precommit-hook-tests, migration-order-check, shared-line-guard, lint-and-type-check, mira-hub-unit, turn-lifecycle-reconciliation, manual-search-quota-pg, mobile-unit-tests, mira-web-pack-tests, architecture-check, license-check, sast-semgrep, sast-bandit, capability-closure, docs-fault-codes); `test-unit`/`bench-harness-tests` required only when `changes.code == true`. **Not gated:** `secrets-scan` (gitleaks action), `docker-build-check` (Trivy), `simlab-gate`, `module-suites` (in `needs`, result only echoed), `ocr-recall-gate`, `drive-pack-extract-tests`, and `test-eval-offline` — the broadest `pytest tests/` sweep in the file | ENFORCED (listed set) | `ci-gate` check |
| Legacy UI lifecycle guard | `tools/ui_surface_lifecycle_guard.py` via `ui-lifecycle-guard.yml`; registry-driven path allowlist; rejects placeholder rationale | ENFORCED as a status, **not** in the required set (binding is an unperformed admin action, #3657) | Check run + PR body field |
| Conventional Commit title | No commitlint; `version-tag.yml` hard-fails **post-merge** if the subject cannot be parsed | ENFORCED late | Tag or red run on `main` |
| Human merge | Branch protection requires 0 approvals; merge authority is a standing owner decision (strict up-to-date serialises one PR per sitting) | DOCTRINE | Merge commit |

### 1.4 Release → staging → production → observation

| Step | Mechanism today | Status | Evidence artifact |
|---|---|---|---|
| Version + rollback checkpoint | `version-tag.yml` on every push to `main`: `v<X.Y.Z>` from the Conventional Commit type + `rollback/<date>-v<X.Y.Z>` + GitHub Release (`tools/release/next_version.py`). 1,119 `v*` tags, 1,077 rollback tags. `release.yml` (component tags) dormant since 2026-04-10 | ENFORCED | Tag, Release |
| Staging deploy | `deploy-staging.yml`, `workflow_dispatch` only, `approved_rc_sha` (40-hex) validated against the API, `environment: staging-deploy`; co-hosted on the prod host (#3930) with 7 safeguards; asserts runtime `gitSha == approved_rc_sha` for hub and web; writes `staging-receipt-<sha>` (schema `factorylm.deploy-receipt/1`, 90-day retention) | ENFORCED | Receipt artifact |
| Staging acceptance | `retrieval-acceptance.yml` fires on successful staging deploy; resolves the SHA **actually running** from `/api/health`, provisions a stranger tenant, runs 6 live scenarios + capture accounting, re-reads the SHA at verdict time (SUPERSEDED on drift), uploads trace-bearing JSON | ENFORCED for staging; **not consumed** by prod authorization | JSON artifact + Langfuse trace ids |
| PR-time Staging Gate | `staging-gate.yml` on every PR: engine in-process against staging Neon, 10–15 rubric questions; skips (green) for docs/wiki/.github/.claude-only PRs and Dependabot | ENFORCED (required context) | Check run |
| Migrations | `apply-migrations.yml` (`dry-run`/`apply`/`seed-ledger`, `content_sha256` ledger, hard-fail on content drift); `migration-verify.yml` auto-applies PR migrations to staging; `deploy-vps.yml` `migration-drift` job fails prod deploy on any drift. Ordering staging-before-prod is DOCTRINE (nothing blocks `target=prod` first) | ENFORCED at the prod boundary | Ledger rows, drift job log |
| Production deploy | `deploy-vps.yml`, `workflow_dispatch` only ("AUTO-DEPLOY stays DISABLED (#3800)"). `authorize-source` rejects any `skip_*` input, requires Staging Gate `completed:success` on the PR head of the merge, requires an unexpired verified `staging-receipt-<sha>`; `deploy` records `PRIOR_SHA/PRIOR_TAG` as the rollback anchor, asserts zero tree drift, built-image == running-image, runtime `gitSha == approved_rc_sha`, writes `production-receipt-<sha>`, strict nginx `sites-enabled` allowlist. Default rebuild set `mira-hub mira-web mira-ask` | ENFORCED | Production receipt artifact |
| Hotfix path | Docs describe `skip_staging_gate=true` / `skip_reason` dispatch + 24h follow-up PR (`docs/environments.md:87-90`, `docs/runbooks/deploy-to-production.md:126-145`). The live workflow **rejects** those inputs. 24h rule enforced nowhere | STALE + DOCTRINE | — |
| Rollback | Redeploy a prior SHA through the same gated `deploy-vps.yml`; `rollback/*` tags are the anchors; `apply-migrations.yml` has no down mode (Neon snapshot or in-file rollback block). `docs/runbooks/hubv3-rollback.md` uses a `-f ref=` input that does not exist. **No recorded exercise** of a rollback | ENFORCED path exists; STALE runbook; unexercised | Tag + receipt |
| Production observation | Canaries: provider-health (6h → `provider-incident` issue), oauth-redirect (hourly → `oauth-incident` issue), embedding-coverage (daily → Telegram), proposal-state (nightly → failure email), web-review (daily → wiki report), dogfood-judge-heartbeat (6h → Telegram + red). `smoke-test.yml` on push to `main` against live prod (advisory on PR). `beta-probe-prod.yml` manual, Mike-only. `mira-ops/` listed in the repo map **does not exist** | ENFORCED (cadence) / three disjoint alert channels | Issues, Telegram, wiki |
| Failure → regression | 118 test files cite 142 distinct `#NNNN` issues; `tests/bot_regression.py` is the named "never break" file; nightly active-learning opens draft fixture PRs from 👎 feedback; `qa-regression.yml` and `mira-benchmark-weekly.yml` file labelled issues. No repo-local rule says "a production failure becomes a test". `docs/incidents/` has one file (2026-06-02) | DOCTRINE (culture), partly automated | Test docstring citing the issue |
| Capability closure / release identity | `CAPABILITY_CLOSURE.yaml` (12 capabilities, `review_by` expiry and provenance **CI-enforced**); `RELEASE_TRAIN.yaml` (`DEV→RC→STAGING_PARITY→DEVICE_PARITY→RELEASED`, drift-checked, blockers block RELEASED; currently `RC`) | ENFORCED | YAML + CI job |

### 1.5 Where the docs and the automation disagree (all verified against the files)

| # | Doc says | Code does | Files |
|---|---|---|---|
| D1 | Merge → smoke → auto prod deploy via `workflow_run` | `deploy-vps.yml` is `workflow_dispatch` only; auto-deploy disabled by design | `docs/environments.md:84`, `docs/runbooks/deploy-to-production.md:45-58`, `smoke-test.yml:27,182` vs `deploy-vps.yml:23-41` |
| D2 | Hotfix via `skip_staging_gate=true -f skip_reason=…` | Inputs rejected: "Gate-bypass input … is no longer allowed" | `docs/environments.md:87-90`, `deploy-to-production.md:126-140` vs `deploy-vps.yml:71-81` |
| D3 | Default rebuild set is 7 services | Default is `mira-hub mira-web mira-ask` | `deploy-to-production.md:74-77` vs `deploy-vps.yml:478` |
| D4 | Rollback dispatch uses `-f ref=<tag>` | Only `approved_rc_sha` exists | `docs/runbooks/hubv3-rollback.md` |
| D5 | `docs/review-cheap-lane.md` routes the agentic lane through `tools/review_router/router.py` | File does not exist on `main` (PR #4202 open); only `prices.json` is present | `docs/review-cheap-lane.md:5-6,61` |
| D6 | Gate 7 default provider is the free Groq→Cerebras→Together cascade / "No OpenAI" | Required gate is the paid OpenAI lane; Cerebras archived 2026-09-29; `--adjudicate` still calls only the free cascade | `FACTORYLM_MIRA_ARCHITECTURE_CONVERGENCE.md:331`, `.claude/commands/gate7-review.md` vs `docs/review-cheap-lane.md`, `tools/gate7_review.py:1206` |
| D7 | `CLAUDE.md:3` "Version: see `/VERSION`" | `/VERSION` deleted 2026-08-02 (#3064); same file says so at line 247 | `CLAUDE.md:3` vs `:247,:332` |
| D8 | Claude-reviews-Claude carve-out "expires 2026-09-13" | Still present verbatim on 2026-10-03 | `.claude/rules/multi-session-protocol.md:152-180` |
| D9 | CI step named "ast-grep" runs the `.ast-grep-rules/` set | Step installs `@ast-grep/cli` then runs hand-written `rg` regexes for IPs/secrets only; three rules never execute anywhere | `.github/workflows/code-review.yml:85-156` |
| D10 | Repo map lists `mira-ops/` (Prometheus/Grafana) | Directory absent | `CLAUDE.md` repo map |
| D11 | `docs/agents/domain.md` "16 ADRs", monday.com scope lock through 2026-07-19 | 40 ADRs; lock date passed | `docs/agents/domain.md:44` |
| D12 | `docs/environments.md:38` "No bypass inputs"; `staging-environment-spec.md:171` "`skip_staging_gate=true` preserved" | Code matches the first, not the second | both docs |
| D13 | `staging-environment-spec.md:24` "No staging mira-hub, no staging Atlas, no staging nginx" | `deploy-staging.yml` health-checks Hub, Atlas and Web and emits receipts | `deploy-staging.yml:413-490` (Codex 1.4) |
| D14 | `CLAUDE.md` "prod-guard.sh enforces #1–#3" (prod SQL, VPS compose, prod bot token) | `PROD_HOST` matcher lists the old VPS IPs and `.factorylm.com`, not `40.160.141.61`; no pattern for prod DB URLs or the prod bot token; fails open (with a stderr line) on an empty payload | `tools/hooks/prod-guard.sh:62-66,86,123-136` vs `deploy-vps.yml:383-384` (Codex 1.5) |
| D15 | `docs/runbooks/charlie-codex-claude-peer-review.md:123-130` accepts a `[CODEX-REVIEW] PASS` packet | The lifecycle guard's parser accepts only the `[CODEX-ADVERSARIAL-REVIEW]` envelope with `reviewed_sha` + `reviewed_body_sha256` + `status: GREEN`; a `[CHEAP-REVIEW]` comment satisfies neither | `tools/ui_surface_lifecycle_guard.py:635-646` (Codex 1.6, 1.11) |
| D16 | `CLAUDE.md:28` "Apache 2.0 or MIT ONLY" | `license-check` is an allowlist only for `asyncpg`; the general check is a denylist (`GPLv3; AGPLv3; UNKNOWN`) | `ci.yml:1304-1313` (Codex 1.9) |
| D17 | PR template checklist "CHANGELOG entry added" | `docs/CHANGELOG.md` is frozen and the Shared-Line Guard rejects edits without `shared-line-ok` | `pull_request_template.md:91` vs `ci.yml:185-203` (Codex 1.10) |
| D18 | `apply-migrations.yml` dry-run "no execution" | Dry-run still executes `CREATE TABLE IF NOT EXISTS schema_migrations` before the preview | `apply-migrations.yml:149-170` (Codex 1.13) |
| D19 | `.githooks/pre-commit:327-328` calls the CI symbol check a "blocking backstop" | `code-review.yml` folds the symbol-check result into a comment and never fails | `code-review.yml:153-169` (Codex 1.8) |
| D20 | `enforcement-audit.yml` nightly job commits and pushes directly to `main` | Branch protection should reject it; failure is swallowed as "non-fatal", so the step is dead code that contradicts "PR-gated main" | `enforcement-audit.yml:131-140` (Codex 1.12) |

---

## 2. Gaps (what the lifecycle requires that nothing provides today)

Each gap is stated as a fact about what is absent, with the evidence line, and classified by what
would close it: **DOC** (write it down), **CONNECT** (wire two existing things), **REPAIR** (fix a
broken existing thing), **ADD** (new, small).

| # | Gap | Evidence | Closure type |
|---|---|---|---|
| G-01 | No written lifecycle or gate definitions; the only end-to-end description is the stale promotion section of `docs/environments.md` | §1.5 D1–D4 | DOC (this document) |
| G-02 | No change-risk tiering; "substantial" is binary, so a typo PR and a migration PR face the same written ceremony, while in practice the ceremony is skipped ad hoc | `multi-session-protocol.md` §5; 0/15 sampled merged PRs carry any label | DOC + small CONNECT |
| G-03 | Acceptance criteria are not a structured field anywhere (PRD files, PRD issues, PR template all free prose); nothing links a PR to the criterion it satisfies except a `#NNNN` in prose | 0 grep hits for "Acceptance Criteria" in `docs/prd/`; PR template "Spec reference" unused in 15/15 sampled PRs | DOC (one required line in the PR body) |
| G-04 | Cheap-lane verdict is not SHA-rebound before posting and is not a status context, so "the required review ran on this head" is not machine-checkable | `tools/gate7_review.py:706,721,1388` | REPAIR (small) |
| G-05 | Codex lane is run on owner say-so with no written trigger rule per risk class | `docs/review-cheap-lane.md:5-8` | DOC |
| G-06 | Staging acceptance (`retrieval-acceptance.yml`) is produced but **not consumed** by `deploy-vps.yml` `authorize-source` | `deploy-vps.yml:132-227` checks Staging Gate + receipt only | CONNECT |
| G-07 | Hotfix path exists only in stale docs; the live workflow has no fast path other than a narrower `services` list; the 24h follow-up rule is unenforced | D2; `deploy-vps.yml:71-81` | DOC (define hotfix = narrower `services`, same gates) |
| G-08 | Rollback never exercised; migration rollback has no automation; runbook references a non-existent input | §1.4 Rollback | DOC + one drill |
| G-09 | No incident taxonomy: labels `provider-incident`, `oauth-incident`, `qa-regression`, `benchmark-regression`, `bug` exist; no `incident`, `hotfix`, or `regression-promoted` label; `docs/incidents/` has one file | `gh label list` (103 labels) | ADD (labels only) |
| G-10 | No DORA computation; ingredients exist (runs, receipts, PR timestamps, tags) | `grep -rli dora` = 0 hits | ADD (read-only script) |
| G-11 | Security tooling present but not gating or not running: `secrets-scan` and Trivy outside `ci-gate`; `.ast-grep-rules/` never executed; AI security review comment-only; pip-audit covers 3 of ~8 Python roots; Dependabot omits `mira-hub`, `mira-mobile`, `mira-cmms`, `mira-pipeline`, `mira-bridge`; no JS/TS CVE audit; no `SECURITY.md`; no SBOM | `ci.yml:275-340,1393-1463`, `code-review.yml:85-156`, `dependency-check.yml`, `.github/dependabot.yml` | CONNECT (gate what exists) + DOC |
| G-12 | Mutation testing exists only as a manual step; property tests cover 2 modules; `eval-replay-gate.yml` is inert | §1.2 | DOC (scope by risk class) — no tooling ADD in v1 |
| G-13 | Local pre-commit layer is opt-in and silently absent when `core.hooksPath` is unset; several tools fail open | `CLAUDE.md` "Automated Code Review Pipeline"; `.githooks/pre-commit` | DOC (the server-side CI is the gate; local is a convenience) |
| G-14 | Governance text has expired or contradictory blocks (D5–D8, D11, D12) | §1.5 | REPAIR (docs) |
| G-15 | Branch protection binds `staging-gate` and `hold-gate`, but `Legacy UI Lifecycle Guard` is not required and `hold-gate` relies on a label/title heuristic | live protection read; `hold-gate.yml` header | CONNECT (admin action, already tracked #3657) |
| G-16 | Claims and closeouts are prose with no registry; no PR in the sample emitted the SESSION CLOSEOUT block | §1.1; `grep "SESSION CLOSEOUT"` = rule file only | DOC (scope closeout to R3 only) |
| G-17 | Branch longevity: 40 open PRs, ~25 drafts, oldest 2026-09-13 — "short-lived" is not current practice | `gh pr list` 2026-10-03 | DOC (WIP policy) + metric |
| G-18 | `deploy-vps.yml` PR association falls back to the **first** PR associated with the commit when exact merge-commit matching fails, so the Staging Gate check can bind to the wrong PR head | `deploy-vps.yml:144-148` (Codex) | REPAIR (small) |
| G-19 | `retrieval-acceptance.yml` verdict-time SHA re-read exits 0 with a warning when the health endpoint is unreachable, i.e. fails open on the one check that makes the verdict SHA-bound | `retrieval-acceptance.yml:165-174` (Codex) | REPAIR (small) |
| G-20 | `code-review.yml` `auto-fix` job uses `pull_request_target`, checks out the PR head repository, and runs `scripts/pr_self_fix.sh` from that checkout with provider secrets and a write-capable token (gated only by a maintainer applying the `auto-fix` label) | `code-review.yml:16-56` (Codex) | REPAIR (security) |
| G-21 | `tools/hooks/prod-guard.sh` host matcher predates the OVH move; the current prod host is not in `PROD_HOST` | `prod-guard.sh:86` vs `deploy-vps.yml:383-384` (Codex) | REPAIR (small) |
| G-22 | `gate7_review.py` returns exit 0 for PASS, BLOCK, UNKNOWN and even when posting fails; callers that treat exit 0 as "gate passed" are wrong | `tools/gate7_review.py:1364-1401` (Codex) | DOC (callers read the comment, not the exit code) |
| G-23 | `RELEASE_TRAIN.yaml` blockers (e.g. #3984) stop the `RELEASED` label but do not stop `deploy-vps.yml` | `tools/release_train.py:81-88`, `deploy-vps.yml:305-310` (Codex) | DOC in v1 (G3 criterion), CONNECT later |
| G-24 | Smoke alerts are muted for 10 minutes around any prod deploy, and missing alert secrets only warn; a defect introduced in that window loses the signal | `smoke-test.yml:159-179` (Codex) | DOC (observation window starts after smoke, not at receipt) |
| G-25 | Staging and production rebuild images separately with `--no-cache --pull`; source SHA identity is proven, binary identity is not | `deploy-staging.yml:372-379`, `deploy-vps.yml:525-540` (Codex) | DOC (state the claim narrowly; SLSA-era fix deferred) |

---

## 3. SDLC v1 — the proposal

### 3.1 Principles (what v1 is and is not)

1. **Formalize, don't re-tool.** Every gate below names the existing mechanism that satisfies it.
   No Jira, no GitFlow, no new CI platform, no new agent framework, no second registry.
2. **A gate is passed when a named artifact exists for the exact SHA.** Prose in a PR body is a
   pointer to evidence, never the evidence. The repo already has the right artifact shapes:
   status check runs, `[CHEAP-REVIEW]` / `[CODEX-ADVERSARIAL-REVIEW]` comments, `v*` and
   `rollback/*` tags, `staging-receipt-<sha>` / `production-receipt-<sha>`, YAML registries.
3. **Risk class decides ceremony.** Four classes (§3.2). R0 gets exactly what CI already imposes.
   R3 gets everything. The default when unsure is one class up, never down.
4. **Live automation outranks doctrine; doctrine outranks nothing.** A documented rule with no
   enforcer is a *target*, labelled as such, and is either connected to an enforcer or dropped.
5. **Claude implements, Codex reviews read-only, CI decides, Mike authorizes.** Unchanged from
   `.claude/rules/multi-session-protocol.md` §6 and `docs/review-cheap-lane.md`.
6. **Trunk-based, short-lived.** One branch per slice, cut from current `origin/main`, merged or
   closed within the WIP policy (§3.9), squash or rebase merge, never long-lived integration branches.

### 3.2 Risk classes

Assigned at G0 by the implementer, recorded as one line in the PR body (`Risk: R2 — retrieval
ranking change`), challenged by any reviewer, and **escalated one class on any disagreement**. The
path signals below are the ones that already exist in the repo (`ci.yml` `changes` filter,
`REGISTRY.yaml` guarded paths, `kg-write-guard.yml` paths, `migration-verify.yml` paths,
`safety-reviewer`/`security-reviewer` trigger lists). They are a classification *aid*, not an
exhaustive rule; the written class in the PR body is authoritative.

| Class | Scope | Path / content signals (existing) | What it does NOT include |
|---|---|---|---|
| **R0 — documentation / internal** | Docs, wiki, comments, screenshots, promo assets, `.planning/` fragments, test-only changes that add coverage without changing behavior, tooling with no CI or deploy consequence | `ci.yml` `changes.code == false` (docs/wiki/*.md/.claude paths); `staging-gate.yml` scope-skip list | Any file under `.github/workflows/`, `tools/hooks/`, `.claude/rules/`, `CLAUDE.md` (those are R3-governance) |
| **R1 — low-risk product** | Isolated UI copy/layout inside canonical shells, a single-module bug fix with a red→green test, new non-shared code behind a flag that is off, non-retrieval API additions, scripts under `tools/` that do not run in CI or deploy | Code change outside every R2/R3 signal below | Anything touching the engine answer path, retrieval, prompts, persistence of customer data |
| **R2 — behavioral / retrieval / model / data** | `mira-bots/shared/engine.py` and `shared/**` answer path, `inference/router.py`, prompts (`mira-bots/prompts/**`), retrieval (`neon_recall.py`, `mira-hub/src/lib/manual-rag.ts`, BM25/embedding code), ingest writers to `knowledge_entries`, KG writers, eval fixtures/graders/golden CSVs, classifier/intent, Hub notebook turn pipeline, mobile unified-shell behavior, dependency bumps of runtime libraries | `deepeval-ci.yml` paths, `eval-replay-gate.yml` paths, `kg-write-guard.yml` paths, `beta-gate.yml` paths, `prompt-guard.yml` path, `photo-e2e-verify.yml` paths, `enforcement-audit.yml` paths | Safety wording, auth, tenant filters, migrations (R3) |
| **R3 — safety / security / auth / tenant / migration / production-control** | `guardrails.py` + `SAFETY_KEYWORDS` + hazard/safety banners and judges; auth/session/middleware (`mira-hub/src/lib/session.ts`, NextAuth routes); tenant scoping (`knowledge_entries` read/write filters, RLS, `TenantScopedSession`); DB migrations (`mira-hub/db/migrations/**`, `mira-core/mira-ingest/db/migrations/**`); secrets handling; `.github/workflows/**`, `tools/hooks/**`, `.githooks/**`, `tools/ui_surface_lifecycle_guard.py`, deploy scripts, `docker-compose*.yml`, nginx, OTA/native release; PLC/fieldbus/Ignition code; governance (`CLAUDE.md`, `.claude/rules/**`, `REGISTRY.yaml`, `CAPABILITY_CLOSURE.yaml`, `RELEASE_TRAIN.yaml`); guarded legacy UI paths | `REGISTRY.yaml` LEGACY entries; `migration-verify.yml` paths; `safety-reviewer.md` / `security-reviewer.md` trigger lists; `multi-session-protocol.md` §5 "substantial" list | — |

**Relationship to existing vocab.** "Substantial" (protocol §5) = R2 ∪ R3. S0–S5 (handbook §16.2)
remains the *safety-consequence* scale used inside R3 safety reviews. The convergence doc's
R0/R1 *checkpoints* are renamed in prose to **CP-before / CP-after** in this document to avoid the
collision; the convergence doc itself is not edited in v1 (see §6).

### 3.3 Lifecycle and gates

```
Idea/defect ─► Issue ─► [PRD + acceptance criteria]* ─► [ADR]* ─► Risk class ─► claim
   ═══ G0 Ready to Build ═══
Branch off origin/main ─► implement test-first ─► local gates ─► cheap lane (saturate)
   ═══ G1 Ready for Review ═══
CI required contexts green on head ─► [Codex exact-head PASS]* ─► human merge
   ═══ G2 Ready to Merge ═══  (merge; version-tag.yml tags + rollback checkpoint automatically)
deploy-staging(approved_rc_sha) ─► receipt ─► retrieval-acceptance ─► [migrations staging→prod]*
   ═══ G3 Ready for Production ═══
deploy-vps(approved_rc_sha) ─► production receipt ─► smoke ─► canaries clean ─► closure records
   ═══ G4 Closed / Observed ═══
production failure ─► `incident` issue ─► regression test citing the issue ─► back to G0
```
`*` = required only for some risk classes (tables below).

#### G0 — Ready to Build

| Criterion | R0 | R1 | R2 | R3 | Existing mechanism / evidence |
|---|---|---|---|---|---|
| Issue exists (or PR *is* the issue for R0/R1 one-liners) | opt | ✔ | ✔ | ✔ | GitHub Issues, `docs/agents/issue-tracker.md`; triage labels |
| Acceptance criteria written as checkable statements | — | 1+ in issue/PR | ✔ in PRD (file or `PRD:` issue) | ✔ in PRD | `docs/prd/` or `PRD:` issue thread (both accepted; see §3.4 DoR) |
| ADR when the change alters a dependency direction, canonical identity, shared contract, or module boundary | — | — | if architectural | if architectural | `docs/adr/` MADR; convergence Gate 1–3; `CU-*.md` for convergence units |
| Risk class declared | ✔ (implicit R0) | ✔ | ✔ | ✔ | One `Risk:` line in PR body (ADD-1, §5) |
| Work claim posted when another session could plausibly overlap | — | opt | ✔ | ✔ | `[WORK-CLAIM]`, protocol §2 |
| Rollback checkpoint recorded (CP-before) | auto | auto | auto | ✔ explicit: base SHA + schema state + Neon snapshot id for migrations | `rollback/*` tags exist for every merge (auto); R3 adds the explicit record in the PR body / `CU-*.md` |
| Branch cut from current `origin/main` | ✔ | ✔ | ✔ | ✔ | `git log HEAD..origin/main` empty; strict up-to-date enforces at merge anyway |

#### G1 — Ready for Review

| Criterion | R0 | R1 | R2 | R3 | Existing mechanism / evidence |
|---|---|---|---|---|---|
| Local gates green (`ruff`, full `pytest -q`, pre-commit) | — | ✔ | ✔ | ✔ | `CLAUDE.md` "Local Gates Before Push"; `.githooks/pre-commit` (convenience; CI is the gate) |
| Red→green test for the behavior changed, test docstring cites the issue | — | ✔ | ✔ | ✔ | Existing practice (142 issues cited from `tests/`); `tests/bot_regression.py` pattern |
| Eval / golden case added or updated | — | — | ✔ when the answer path changes | ✔ when applicable | `tests/eval/fixtures/`, `tests/golden_*.csv`, `deepeval-ci.yml` |
| Property test for new invariants | — | — | recommended | ✔ for new state machines / parsers | `tests/test_fsm_properties.py` pattern (hypothesis already installed in `test-eval-offline`) |
| Mutation check (break the fix, confirm red, restore) stated in PR body | — | — | ✔ | ✔ | `.claude/skills/defect-workflow/SKILL.md` step 6 (manual; no tooling in v1) |
| Specialist review agent run (read-only) | — | — | `conversation-reviewer` for answer-path changes | `safety-reviewer` and/or `security-reviewer` | `.claude/agents/*.md` |
| Hazard ledger (every noticed-but-unfixed item dispositioned) | — | — | ✔ | ✔ | Global CLAUDE.md practice; lands in PR body |
| Cheap review lane saturated (a round with no new real findings) | — | ✔ (1 round min) | ✔ | ✔ | `tools/gate7_review.py <PR> --paid --post` → `[CHEAP-REVIEW]` comment bound to head |
| PR body: Summary, `Risk:`, acceptance-criteria mapping, test evidence, hazard ledger | ✔ (Summary + Risk) | ✔ | ✔ | ✔ | `.github/pull_request_template.md` (REPAIR-3 trims it; §5) |

#### G2 — Ready to Merge

| Criterion | R0 | R1 | R2 | R3 | Existing mechanism / evidence |
|---|---|---|---|---|---|
| Six required contexts green **on the current head**, strict up-to-date | ✔ | ✔ | ✔ | ✔ | Branch protection (`CI Gate`, `staging-gate`, `hold-gate`, `Hub E2E…`, `mira-web pack tests`, `Shared UI contract`); `tools/pr-merge-blocker.sh` |
| Legacy UI lifecycle guard green | ✔ | ✔ | ✔ | ✔ | `ui-lifecycle-guard.yml` (advisory today; CONNECT-2 makes it required, already tracked #3657) |
| Independent exact-head Codex PASS on the merge candidate SHA | — | — | ✔ when Mike names it or the cheap lane disputed a finding (current policy) | ✔ always | `scripts/adversarial-review-trusted.sh … --review-only` from `origin/main`; ledger comments; ≤3 rounds |
| Codex PASS SHA == head SHA at merge time | — | — | ✔ | ✔ | Re-read `gh pr view --json headRefOid` in the same turn as merging |
| Human merge | ✔ standing authority | ✔ standing authority | ✔ standing authority after PASS | **Mike or explicitly delegated** | Protocol §7; `feedback_merge_authority_is_standing` |
| Conventional Commit title (`feat/fix/chore/docs/…(scope): …`) | ✔ | ✔ | ✔ | ✔ | `version-tag.yml` hard-fails post-merge today; checked by eye pre-merge (no commitlint in v1) |

#### G3 — Ready for Production

| Criterion | R0 | R1 | R2 | R3 | Existing mechanism / evidence |
|---|---|---|---|---|---|
| Version + rollback tag exist for the merge | n/a | ✔ | ✔ | ✔ | `version-tag.yml` (automatic) |
| Staging deploy of the exact RC SHA succeeded; receipt verified | n/a | ✔ (batched) | ✔ | ✔ | `deploy-staging.yml` `approved_rc_sha` → `staging-receipt-<sha>` |
| Staging acceptance passed for that SHA | n/a | ✔ (batched) | ✔ | ✔ | `retrieval-acceptance.yml` artifact (CONNECT-1 makes `deploy-vps.yml` check it; §5) |
| Migrations applied to staging then prod via the ledgered workflow, `dry-run` then `apply`, drift = 0 | n/a | n/a | n/a | ✔ when migrations present | `migration-verify.yml` (staging, automatic on PR), `apply-migrations.yml`, `deploy-vps.yml` `migration-drift` |
| Device evidence when mobile native/OTA is in the release | n/a | — | ✔ if mobile | ✔ if mobile | `RELEASE_TRAIN.yaml` `device_parity` receipts; `ota-release.yml` handset-evidence job |
| Mike authorizes the production dispatch | n/a | ✔ | ✔ | ✔ | `deploy-vps.yml` is `workflow_dispatch` only; `environment: production` |

#### G4 — Closed / Observed

| Criterion | R0 | R1 | R2 | R3 | Existing mechanism / evidence |
|---|---|---|---|---|---|
| Production receipt exists for the SHA | n/a | ✔ | ✔ | ✔ | `production-receipt-<sha>` artifact |
| Post-deploy smoke green | n/a | ✔ | ✔ | ✔ | `smoke-test.yml` (push) or `bash install/smoke_test.sh`; screenshots per the Screenshot Rule when UI changed |
| Observation window clean (no new `*-incident`, `qa-regression`, `benchmark-regression` issue attributable to the deploy) | n/a | 24 h | 24 h | 72 h | Existing canaries (§1.4) + `incident` label (ADD-2) |
| Feature actually proven on, not merely deployed | n/a | — | `CAPABILITY_CLOSURE.yaml` state advanced when a capability/flag is involved | ✔ | `finish-capability` skill; `tools/capability_closure.py` |
| Release identity recorded | n/a | — | — | `RELEASE_TRAIN.yaml` observed_* updated when the release train applies | `tools/release_train.py --drift` |
| Any failure in the window → `incident` issue → regression test | n/a | ✔ | ✔ | ✔ | §3.7 |
| Session closeout block posted | — | — | — | ✔ | Protocol §9 (scoped to R3 only in v1; it is unused today) |

### 3.4 Definition of Ready (entry to implementation = G0 passed)

A slice is Ready when all of the following are true for its risk class:

1. **A durable requirement record exists**: an issue (R1+), and for R2/R3 a PRD. v1 accepts both
   PRD forms already in use: a file in `docs/prd/YYYY-MM-DD-slug.md` **or** a GitHub issue titled
   `PRD: …`. Whichever form, it must contain a section literally headed **`## Acceptance criteria`**
   with numbered, checkable statements (the grep that returns zero hits today).
2. **Risk class is written down** and nobody who has read the diff plan disagrees with it.
3. **Design is settled at the level the class needs**: R3 architecture changes have an ADR (status
   may be Proposed; "Proposed ≠ authorized" stays as the convergence doc says) and, for convergence
   units, a `CU-*.md` record with CP-before.
4. **The slice is claimed** when overlap is plausible (protocol §2) and the claim re-read confirmed it.
5. **The implementer can name the test** that will go red first and the eval/golden case (R2) that
   will prove the behavior.
6. **No open `review_by` expiry in `CAPABILITY_CLOSURE.yaml`** is about to block CI for the whole
   repo during the slice (check the dates before a queue day).

### 3.5 Definition of Done (= G4 passed)

A change is Done — and may be reported as done — only when, for the exact SHA:

1. Merged to `main` through the required contexts (G2) with the review evidence its class requires.
2. A `v*` tag and `rollback/*` tag exist for the merge.
3. For R1+: deployed to staging with a verified receipt and a passing acceptance run; deployed to
   production with a verified receipt (or explicitly batched into a named later RC, recorded on the
   issue).
4. The acceptance criteria in the requirement record are each marked met with a pointer to the
   evidence (test name, check run, screenshot path, receipt artifact, trace id).
5. The observation window elapsed with no attributable incident, or the incident is filed and linked.
6. For capabilities behind flags: `CAPABILITY_CLOSURE.yaml` reflects the real state read from
   Doppler, not the compose default (`finish-capability` skill).
7. The hazard ledger has no undispositioned row.
8. "Merged" is not "done" (`CLAUDE.md` § Capability closure). "Green CI" is not "tests ran" — the
   named new tests appear in the CI log (`feedback_verify_the_gate_not_the_badge`).

### 3.6 Hotfix path (production degraded, normal flow too slow)

The live `deploy-vps.yml` has **no gate bypass** and v1 keeps it that way. A hotfix is therefore the
normal path with the queue cleared, not a different path:

1. Open the fix PR as **R3 (production-control)** regardless of the diff size, title prefixed `fix(hotfix):`.
2. G1: cheap lane one round; Codex review may be **deferred post-merge** only for a hotfix, with
   Mike's explicit say-so recorded on the PR, and must still complete within 24 h (the existing
   24-hour follow-up rule, now attached to a visible artifact: the `[CODEX-ADVERSARIAL-REVIEW]`
   comment on the merged PR).
3. G2: required contexts must still be green (strict up-to-date applies; nothing else merges meanwhile).
4. G3: `deploy-staging.yml` then `deploy-vps.yml` with the narrowest `services` list that contains
   the fix. The receipt and migration-drift gates apply unchanged.
5. G4: an `incident` issue (ADD-2) is opened before or during the hotfix and links the PR; the
   regression test is part of the hotfix PR or a follow-up PR within 24 h.
6. The stale `skip_staging_gate` / `skip_reason` prose is removed from `docs/environments.md` and
   `docs/runbooks/deploy-to-production.md` (REPAIR-1).

### 3.7 Rollback path

Rollback is a **forward deploy of a known-good SHA** through the same gates, plus a data decision:

| Layer | Mechanism (exists) | v1 rule |
|---|---|---|
| Code / containers | Re-dispatch `deploy-vps.yml` with `approved_rc_sha=<PRIOR_SHA>` printed as the rollback anchor by the failed run; the `rollback/<date>-vX.Y.Z` tag names the candidate | The prior SHA must itself have a staging receipt (it will, if it was deployed before) — if the receipt expired (90 days), re-run `deploy-staging.yml` first. Never bypass. |
| Database | `apply-migrations.yml` has no down mode. Options: the in-file rollback block of the migration, or restore the Neon branch snapshot | R3 migration PRs record the Neon snapshot/branch id and the rollback SQL block in the PR body at G0 (CP-before). Migrations are additive-first (expand/contract) so code rollback never requires schema rollback within the observation window. |
| Mobile / OTA | `ota-release.yml promote` re-points the manifest; native builds are `mobile-release-distribute.yml` | Roll back by promoting the previous signed manifest; the handset-evidence job applies to the rollback too. |
| Docs | `docs/runbooks/hubv3-rollback.md` (stale `-f ref=` input) | REPAIR-2: generalize into `docs/runbooks/rollback.md` with the real inputs. |
| Drill | Never exercised | One scheduled **staging** rollback drill (deploy previous SHA to staging, verify receipt) before v1 is declared adopted; record the run id in this document's changelog. |

### 3.8 Failure → regression workflow

1. **Detect**: canary issue (`provider-incident`, `oauth-incident`, `qa-regression`,
   `benchmark-regression`), smoke alert, Telegram heartbeat, user report, or eval regression.
2. **Record**: one GitHub issue labelled **`incident`** (ADD-2) with: first-seen time, the deploy SHA
   in production at the time (from the latest `production-receipt-*`), impact, and the restoring
   action + time. The existing `*-incident` canary issues get the `incident` label added rather than
   a second issue. `docs/incidents/` stays for narrative RCAs when the cause is non-obvious.
3. **Restore**: §3.6 or §3.7.
4. **Promote to regression**: the fix PR adds a test whose docstring cites `#<incident issue>`
   (the established pattern: 142 issues already cited from `tests/`), and for answer-path
   regressions a fixture under `tests/eval/fixtures/` (the nightly active-learning loop already
   drafts these from 👎 feedback — promote rather than duplicate). Closing the incident issue
   requires the test to be merged; the issue body links the test path.
5. **Rule**: second occurrence of the same failure class = a new rule or guard, not just a test
   (Cluster Law 6, already doctrine; `feedback_lock_in_chronic_ops_bugs`).

### 3.9 Branch and WIP policy (short-lived means something measurable)

- A branch is one slice. Target: merged or closed within **5 working days**; a draft older than
  **14 days** is either rebased and re-scoped or closed with a note on its issue.
- Open-PR count and median PR age are reported in the metrics (§3.11). Today's baseline: 40 open,
  oldest 2026-09-13.
- Stacked PRs (base ≠ `main`) are discouraged because they receive no CI here
  (`feedback_a_clean_check_board_can_mean_no_checks_ran`).
- Rebase onto `origin/main` before requesting Codex review; strict up-to-date voids a PASS otherwise.

### 3.10 Security and safety integration (NIST SSDF + IEC 62443-4-1, mapped to what exists)

Only existing controls are listed as satisfied. "Target" rows are v1 commitments that CONNECT
existing tooling; nothing here introduces a new platform.

| SSDF | 62443-4-1 | Control today | Status | v1 action |
|---|---|---|---|---|
| PO.1 / PO.3 | SM, SR | `.claude/rules/security-boundaries.md`, Doppler-only secrets, env separation (`docs/environments.md`), `prod-guard.sh` | Doctrine + hook | Keep; this document becomes the SM index |
| PS.1 | SM | Branch protection (strict, admins enforced), ruleset non-fast-forward, `git-state-guard.sh`, `rm-guard.sh` | Enforced | Keep; tighten ruleset to match classic layer (CONNECT-3) |
| PS.2 | SI | gitleaks pre-commit (fail-open locally), `secrets-scan` job in CI (**not gated**) | Partial | CONNECT-4: add `secrets-scan` to `ci-gate` `require_success` |
| PS.3 | SUM | `version-tag.yml` releases; receipts record built vs running image ids | Enforced | Keep. SBOM/SLSA deferred (explicitly out of v1) |
| PW.1 | SD | `docs/mira-ignition-secure-architecture.md`, `fieldbus-readonly.md`, read-only OT tests (`test_drive_packs_readonly.py`, `test_no_customer_write_paths.py`) | Doctrine + tests | Keep; R3 class routes these paths to `security-reviewer`/`safety-reviewer` |
| PW.4 / SUM | SUM | Dependabot (pip ×4 dirs, npm `mira-web`, docker, actions); `dependency-check.yml` pip-audit ×3 dirs weekly | Partial | REPAIR-4: extend `dependabot.yml` to `mira-hub`, `mira-mobile`, `mira-pipeline`, `mira-cmms`, root `pyproject.toml`; add a `bun audit`/`npm audit` step to `dependency-check.yml` |
| PW.6 | SI, SVV | Semgrep (ERROR, required), Bandit (high, required), Trivy image scan (**not gated**), `.ast-grep-rules/` (**never executed**), AI review (comment-only) | Mixed | CONNECT-5: run `sg scan` in `code-review.yml` static-analysis step (the rules and the CLI install already exist); decide gating after one week of findings. Trivy: gate when `docker-build-check` runs (CONNECT-4) |
| PW.7 | SVV | `security-reviewer` / `safety-reviewer` agents; Codex exact-head review | Doctrine | R3 makes them mandatory (§3.3 G1) |
| PW.9 | SD | RLS, `knowledge_entries` read law, `TenantScopedSession`, `kg-write-guard.yml`, `qa-rbac-inspect` (runs on BRAVO, not CI) | Enforced at runtime / partially in CI | Keep; record the BRAVO RBAC run as G4 evidence for tenant-touching R3 changes |
| RV.1 / RV.2 | DM | Canaries → issues; `dependency-check.yml` → `security` issue | Enforced | ADD-2 `incident` label unifies; add a `SECURITY.md` pointing to the issue tracker (DOC) |
| RV.3 | DM | Cluster Law 6/7 (rule creation), `docs/incidents/` | Doctrine | §3.8 step 5 |
| — | SG | Customer-facing security guidance for the Ignition module | Absent (D9 checklist item unchecked) | Out of v1 scope; tracked in the secure-architecture doc |

**Safety (product) controls** are part of R3 and unchanged: `SAFETY_KEYWORDS` phrase tests, hazard
banner tests (`mira-bots/tests/test_safety_flag_banner.py`), the 2026-09-27 owner decision that
safety flags never withhold an answer, and the S0–S5 consequence scale inside safety reviews.

### 3.11 Metrics — DORA plus MIRA-specific, all derived from artifacts that already exist

All four DORA numbers are derivable from GitHub data the lifecycle already produces; none is computed
today. ADD-3 is a single read-only script (`tools/dora.py`, zero inference, `gh api` only) that
prints the table below weekly; it introduces no new data source.

| Metric | Definition for MIRA | Source already present |
|---|---|---|
| Deployment frequency | Successful `deploy-vps.yml` runs per week, de-duplicated by `approved_rc_sha` | `gh run list --workflow deploy-vps.yml`; `production-receipt-*` artifacts |
| Lead time for changes | PR merged → first production receipt whose SHA contains the merge commit (median, p90) | `gh pr list --state merged --json mergedAt`, receipts |
| Change failure rate | Deploys followed within 72 h by an `incident`-labelled issue naming that SHA, or by a rollback redeploy ÷ total deploys | ADD-2 label; `deploy-vps.yml` run history |
| Time to restore | `incident` issue opened → production receipt of the restoring SHA (median) | Issue timestamps + receipts |
| **MIRA: review rounds to GREEN** | Codex rounds per PR (ledger `review_iteration`) and cheap-lane cycles to a clean round | `scripts/adversarial-review-ledger.mjs`; `[CHEAP-REVIEW]` comments |
| **MIRA: review cost per PR** | USD from `.planning/review-costs.jsonl` (gitignored) summarized weekly | `tools/gate7_review.py` cost log |
| **MIRA: eval pass rate** | 51/57-fixture nightly pass count with the documented σ≈2.46 noise band | `tests/eval/runs/*.md`, `wiki/hot.md` |
| **MIRA: staging acceptance pass rate** | `retrieval-acceptance.yml` conclusions per RC | Run history + JSON artifacts |
| **MIRA: regression promotion** | Closed `incident` issues with a merged test citing them ÷ closed incidents | Issue links + `grep -r "#NNNN" tests/` |
| **MIRA: WIP** | Open PR count, median age, drafts > 14 days | `gh pr list` |
| **MIRA: capability closure** | Capabilities per state in `CAPABILITY_CLOSURE.yaml`; expiring `review_by` in 14 days | `tools/capability_closure.py` |

Baseline captured 2026-10-03 (n=30 merged PRs, 17 days of deploys): PR lead time median 0.51 h,
mean 2.55 h; prod deploy runs 7 success / 22 failure / 1 skipped with 4 distinct successful days;
staging deploys 29/30 success; 20 releases in <2 days. Change failure rate and MTTR: not derivable
until ADD-2 exists.

### 3.12 Responsibility split

| Responsibility | Mike | Claude (implementer sessions) | Codex (reviewer) | CI / automation |
|---|---|---|---|---|
| Decide risk class disputes, approve R3 merges, authorize prod dispatch, approve ADRs, approve exceptions | **Owner** | proposes | may object | — |
| Write PRD/acceptance criteria, ADR drafts, claims | reviews | **does** | — | — |
| Implement, red→green tests, eval fixtures, hazard ledger, PR body | — | **does** | never edits the branch | — |
| Cheap lane run and saturation | — | **runs** | — | posts `[CHEAP-REVIEW]` |
| Independent exact-head review, evidence-backed findings, PASS/FAIL bound to SHA | authorizes agentic rounds | remediates findings | **does (read-only)** | ledger in PR comments |
| Required contexts, SAST, license, architecture contracts, capability-closure validity, lifecycle guard, staging gate | — | fixes red | — | **decides** (branch protection) |
| Staging deploy, acceptance, migrations dry-run/apply | authorizes `apply` to prod | dispatches staging; prepares prod dispatch | — | receipts, drift checks |
| Production deploy | **dispatches** (or explicitly delegates) | prepares exact SHA + evidence packet | — | `authorize-source` enforces |
| Observation, incident filing, regression promotion | triages | files `incident`, writes test | — | canaries open issues |
| Metrics | reads | runs `tools/dora.py` weekly | — | (optional later: scheduled run) |

### 3.13 Exceptions and escalation

1. **Exceptions are recorded, never silent.** Any gate waived is written in the PR body as
   `Exception: <gate> — <reason> — approved by Mike <date/comment link>`. There is no label-based
   bypass for any gate (the PR template already says so for the lifecycle guard; v1 generalizes it).
2. **Who may grant**: only Mike, in a GitHub comment. Standing authorizations already granted
   (merge on IR PASS + green; Codex after cheap-lane saturation; post-cap Codex after main-merge)
   remain and are listed in this document's appendix so they are not re-asked.
3. **Escalate to Mike when**: a risk-class disagreement survives one exchange; Codex reaches 3
   rounds; a required context is red for a reason outside the PR (compare against `main` head and
   report, never bypass); an `incident` is open longer than 4 h; a `review_by` expiry will block CI;
   a rollback would require a schema rollback.
4. **Never**: merge through red required checks, dispatch prod without a staging receipt, edit
   another session's branch, simulate a review, rewrite shared history, run prod SQL from a session
   (`prod-guard.sh`), or weaken a gate to pass it.
5. **Carve-outs expire.** Any time-boxed exception carries an end date and is deleted on that date
   or re-decided in writing (the expired Claude-reviews-Claude block is the example of what not to
   leave in place).

---

## 4. REUSE / CONNECT / REPAIR / ADD matrix

**REUSE** = already satisfies the requirement, use as-is. **CONNECT** = exists but is not wired to
the step that should consume it. **REPAIR** = exists and is wrong, stale, or fails open. **ADD** =
does not exist and the requirement is genuinely unenforced. Everything in ADD is small and read-only
or label-only; nothing in ADD is a platform.

| Lifecycle requirement | Existing mechanism | Verdict | Action (id) |
|---|---|---|---|
| Intake + triage | GitHub Issues, 5 triage labels, `gh` conventions | REUSE | — |
| Requirement record with acceptance criteria | `docs/prd/` files and `PRD:` issues | REUSE + DOC | Require a literal `## Acceptance criteria` section (both forms) |
| Architecture decision | `docs/adr/` MADR, convergence gates, `CU-*.md` | REUSE + REPAIR | REPAIR-5: regenerate `docs/adr/README.md` index (40 ADRs, mark Proposed vs Accepted) |
| Risk classification | "substantial" (binary); `changes` path filter; guard allowlists; gate7 escalation reasons | ADD (tiny) | ADD-1: one `Risk: R<n> — <why>` line in the PR template; implementer-assigned, reviewer-challenged. No automation in v1 |
| Work claim | `[WORK-CLAIM]` protocol | REUSE | Scope to R2/R3 with plausible overlap |
| Branch hygiene / short-lived | session-discipline, strict up-to-date | REUSE + DOC | §3.9 WIP policy + metric |
| Local gates | ruff/pytest, `.githooks/pre-commit`, Stop hook | REUSE | Documented as convenience; CI is the gate |
| Unit/contract/architecture tests | `ci.yml` 16 gated jobs | REUSE | — |
| Broad offline suite, SimLab, OCR recall, Trivy, gitleaks | `ci.yml` jobs outside `ci-gate` | CONNECT | CONNECT-4: add `secrets-scan` and `docker-build-check` to `ci-gate` `require_success`; promote `test-eval-offline` after one week of observed stability; leave SimLab/OCR advisory (owner intent) |
| Static security analysis | Semgrep ERROR, Bandit high (gated); `.ast-grep-rules/` (never run); AI review (comment) | REUSE + CONNECT | CONNECT-5: run `sg scan` in `code-review.yml` static step; keep AI review advisory |
| Dependency hygiene | Dependabot (partial), pip-audit (3 dirs, `\|\| true`) | REPAIR | REPAIR-4: extend Dependabot roots; make pip-audit non-swallowing; add `bun audit` for Hub/mobile |
| Eval / grounding regression | `deepeval-ci.yml`, `tests/eval/`, `staging-gate.yml`, nightly VPS evals | REUSE | `eval-replay-gate.yml` stays inert until the replay store exists (not v1) |
| Property-based tests | hypothesis in 2 files | REUSE + DOC | Required for new state machines/parsers in R2/R3 (§3.3 G1) |
| Mutation testing | manual step in `defect-workflow` | REUSE (manual) | No tooling ADD in v1; revisit at v1.1 with data |
| Specialist review | `.claude/agents/{safety,security,conversation}-reviewer` | REUSE | Mandatory per class (§3.3) |
| Cheap review lane | `tools/gate7_review.py --paid --post` | REPAIR | REPAIR-6: re-read head SHA immediately before posting and refuse/annotate on drift; document that exit 0 ≠ PASS (callers read `verdict:`) |
| Independent exact-head review | `adversarial-review-trusted.sh` + ledger | REUSE | Trigger rule written per class (§3.3 G2) |
| Review envelope compatibility | guard accepts `[CODEX-ADVERSARIAL-REVIEW]` only | DOC | State that `[CHEAP-REVIEW]` is the G1 artifact, `[CODEX-ADVERSARIAL-REVIEW] GREEN` the G2 artifact for R2/R3; `[CODEX-REVIEW] PASS` (peer runbook) is retired wording |
| Merge gate | branch protection (6 contexts, strict, admins) | REUSE + CONNECT | CONNECT-2: add `Legacy UI Lifecycle Guard` to required contexts (#3657, needs a non-spoofable source first); CONNECT-3: make ruleset 17097034 match the classic layer or remove the duplicate layer |
| Human approval on merge | 0 required reviews; standing owner authority | REUSE | Keep: Codex PASS is the independent review; required-reviewer count stays 0 to avoid a self-approval theatre |
| Conventional Commit | `version-tag.yml` post-merge hard-fail | REUSE | No commitlint in v1; PR title checked by the implementer |
| Version + rollback checkpoint | `version-tag.yml` | REUSE | — |
| Staging deploy exact-SHA | `deploy-staging.yml` + receipt | REUSE | — |
| Staging acceptance consumed by prod | `retrieval-acceptance.yml` artifact | CONNECT | CONNECT-1: `deploy-vps.yml` `authorize-source` requires a successful `retrieval-acceptance` run whose pinned SHA == `approved_rc_sha` (same pattern as the receipt check) |
| Acceptance SHA binding | verdict-time re-read warns and exits 0 on fetch failure | REPAIR | REPAIR-7: fail closed (`exit 1`) when the re-read cannot be performed |
| PR association for Staging Gate check | first-associated-PR fallback | REPAIR | REPAIR-8: remove the fallback; require exact `merge_commit_sha` match |
| Migrations dev→staging→prod | `migration-verify.yml`, `apply-migrations.yml` (ledger + drift), `deploy-vps` drift job | REUSE | Rollback SQL/snapshot id recorded at G0 for R3 |
| Production deploy | `deploy-vps.yml` (manual, receipt-gated) | REUSE | — |
| Hotfix | stale doc path | REPAIR | REPAIR-1: rewrite hotfix section = narrower `services`, same gates, deferred Codex within 24 h |
| Rollback | tags + redeploy; stale runbook; no drill | REPAIR + DOC | REPAIR-2: `docs/runbooks/rollback.md` with real inputs; one staging drill |
| Release holds | `RELEASE_TRAIN.yaml` blockers | DOC now, CONNECT later | G3 criterion lists "no open blocker for the component being deployed"; mechanical check deferred |
| Production observation | 6 canaries, smoke, heartbeat | REUSE | Observation window defined per class (§3.3 G4) |
| Incident record | `*-incident` canary issues, `docs/incidents/` (1 file) | ADD (label) | ADD-2: `incident` label (+ `hotfix`), applied to canary issues and human-filed incidents; `docs/incidents/` for RCAs only |
| Failure → regression | tests citing `#NNNN`, active-learning drafts | REUSE + DOC | §3.8; closing an `incident` requires a merged test link |
| Capability closure / release identity | `CAPABILITY_CLOSURE.yaml`, `RELEASE_TRAIN.yaml` (CI-validated) | REUSE | Named as G4 evidence |
| Metrics | none | ADD (read-only) | ADD-3: `tools/dora.py` — `gh api` joins only, prints §3.11 table; run by hand weekly, no scheduler in v1 |
| Prod mutation guard | `prod-guard.sh` | REPAIR | REPAIR-9: add `40\.160\.141\.61` and `ubuntu@` to `PROD_HOST`; add a prod Neon host pattern |
| Privileged auto-fix | `code-review.yml` `pull_request_target` + head-repo checkout + secrets | REPAIR (security) | REPAIR-10: run `pr_self_fix.sh` from the **base** checkout against the PR diff, or drop the `auto-fix` label path; never execute head-repo scripts with secrets |
| Governance text drift | D1–D20 | REPAIR | REPAIR-3: one docs PR fixing `environments.md`, `deploy-to-production.md`, `hubv3-rollback.md`, `CLAUDE.md:3`, `CLAUDE.md` repo map (`mira-ops`), `review-cheap-lane.md` router reference, convergence doc Gate 7 provider, `domain.md`, expired carve-out in `multi-session-protocol.md`, PR template (drop CHANGELOG line, add `Risk:`), peer runbook envelope wording |

---

## 5. Minimal changes required to adopt v1 (nothing here is implemented yet)

Ordered by confidence gained per line changed. Every item is a normal PR through the gates above;
items touching `.github/workflows/` or `.claude/rules/` are **R3** and need Mike's merge.

| Id | Change | Files | Class | Size |
|---|---|---|---|---|
| DOC-0 | Adopt this document; link it from `CLAUDE.md` § Release / PR Workflow and from `docs/environments.md` | `docs/architecture/mira-sdlc-v1.md`, 2 pointer lines | R3 (governance) | S |
| REPAIR-3 | Governance text drift fixes (D1–D20), delete the expired carve-out, retire `[CODEX-REVIEW] PASS` wording | ~9 docs | R3 (governance, docs-only) | M |
| ADD-1 | `Risk:` line in the PR template (+ drop the CHANGELOG checkbox) | `.github/pull_request_template.md` | R0/R3 boundary — treat as R3 | XS |
| ADD-2 | Labels `incident`, `hotfix`; apply `incident` from the two canary workflows that already open issues | `gh label create`; `provider-health-canary.yml`, `oauth-redirect-canary.yml` (one `--label` each) | R3 | XS |
| CONNECT-1 | `deploy-vps.yml` `authorize-source` requires a successful `retrieval-acceptance` run pinned to `approved_rc_sha` | `.github/workflows/deploy-vps.yml` | R3 | S |
| REPAIR-7 | `retrieval-acceptance.yml` verdict re-read fails closed | `.github/workflows/retrieval-acceptance.yml` | R3 | XS |
| REPAIR-8 | Remove first-associated-PR fallback | `.github/workflows/deploy-vps.yml` | R3 | XS |
| REPAIR-6 | Cheap lane re-reads head before posting; drift → `verdict: STALE` | `tools/gate7_review.py` + test | R2 | S |
| CONNECT-4 | `secrets-scan`, `docker-build-check` into `ci-gate` `require_success` | `.github/workflows/ci.yml` | R3 | XS |
| CONNECT-5 | Run `sg scan` in the static-analysis step (advisory first) | `.github/workflows/code-review.yml` | R3 | XS |
| REPAIR-10 | Fix `pull_request_target` auto-fix trust boundary (or remove it) | `.github/workflows/code-review.yml` | R3 (security) | S |
| REPAIR-9 | `prod-guard.sh` host patterns | `tools/hooks/prod-guard.sh` + `tests/` | R3 | XS |
| REPAIR-4 | Dependabot roots; pip-audit no `\|\| true`; `bun audit` | `.github/dependabot.yml`, `dependency-check.yml` | R3 | S |
| REPAIR-2 | `docs/runbooks/rollback.md` + one staging rollback drill (record run id) | docs + one `deploy-staging.yml` dispatch | R0 + operation | S |
| REPAIR-5 | ADR index regeneration | `docs/adr/README.md` | R0 | S |
| ADD-3 | `tools/dora.py` (read-only `gh api`, prints §3.11) + test | `tools/dora.py`, `tests/test_dora.py` | R1 | S |
| CONNECT-2/3 | Branch-protection: required `Legacy UI Lifecycle Guard` once non-spoofable (#3657); reconcile ruleset 17097034 with the classic layer | GitHub settings (Mike only) | Admin | XS |

Total new code: one ~150-line script and a few-line change to `gate7_review.py`. Everything else is
YAML lines, labels, or prose.

---

## 6. Things we should explicitly NOT build

| Not this | Because this exists |
|---|---|
| A ticketing system, mission registry, or "readiness document" per slice | Issues + `PRD:` threads + `[WORK-CLAIM]` + the PR itself (protocol §2 says a PR carrying the work is a valid claim) |
| A PRD for every defect | PR template already allows "N/A — bug fix, see linked issue"; R1 needs one acceptance line, not a PRD |
| A second CI aggregator or "SDLC gate" status | `ci-gate` is the aggregator; add jobs to its `require_success` list instead |
| A new review platform or reviewer fleet | Cheap lane + `adversarial-review-trusted.sh` + 9 read-only agent roles |
| Automated risk scoring in v1 | One human-written line beats a brittle classifier; the path signals are listed as aids. Revisit after 30 days of `Risk:` data |
| Mutation-testing tooling (mutmut/stryker) in v1 | The manual mutation check exists; the suite is not yet deterministic enough (`mira-web` full suite is non-deterministic per `ci.yml`) |
| A second registry for traceability (contract/capability/release/evidence) | `contract-index.yaml`, `CAPABILITY_CLOSURE.yaml`, `RELEASE_TRAIN.yaml`, `REGISTRY.yaml` — v1 only says which one owns which decision (§3.3 G0/G4) |
| Required human approvals in branch protection | Would be Mike approving Mike's agents; independence comes from Codex, not from a click |
| A rollback workflow | Rollback is a forward deploy of a prior SHA through the same gates; a separate path would bypass them |
| commitlint / PR-title bot | `version-tag.yml` already fails on a bad subject; a pre-merge bot is nice-to-have, not a gap |
| SBOM / SLSA provenance / signed images | Deferred by the brief; the receipts already record image ids, which is the v2 hook |
| Dashboards (Grafana/Prometheus) for metrics | `mira-ops/` does not exist; `tools/dora.py` output pasted into the weekly wiki entry is sufficient at this scale |
| Manual VERSION/CHANGELOG bookkeeping | Shared-Line Guard + auto tags replaced it for a measured reason |
| A separate "staging acceptance" harness | `retrieval-acceptance.yml` is it; connect it (CONNECT-1) |
| Another safety taxonomy | S0–S5 and the safety contracts stay; R-classes are delivery risk, S-classes are action consequence |

---

## 7. Codex's independent objections and findings (round 1, verified)

Codex (read-only, isolated `CODEX_HOME`, `origin/main` @ `32bcaa67e`) was briefed on the proposal
*before* this document existed, so its findings are not anchored on this design. Every item below was
re-verified by reading the cited lines; items that did not verify are not listed. Disposition shows
how v1 answers it.

| # | Objection / finding (Codex) | Verified | Disposition in v1 |
|---|---|---|---|
| 1 | The mandatory cheap lane does not earn an exact-head guarantee: head and diff are separate mutable queries, no re-check before posting, exit 0 on BLOCK/UNKNOWN/post-failure | ✔ `gate7_review.py:705-721,1364-1401` | REPAIR-6; G-22 documents exit-code semantics |
| 2 | Staging *deployment* is being treated as staging *acceptance*; prod never consumes the retrieval verdict | ✔ `deploy-vps.yml:178-227,305-310` | CONNECT-1 (the single most valuable wiring change) |
| 3 | Release/rollback is not a demonstrated recovery contract: failed health leaves replacements running (deliberately), runbooks obsolete, old candidates still face the 168 h receipt freshness gate | ✔ `deploy-vps.yml:606-624`, `hubv3-rollback.md` | REPAIR-2 + drill; §3.7 states the receipt-refresh step; no bypass added |
| 4 | Two incompatible review envelopes: `[CHEAP-REVIEW]` vs SHA+body-bound `[CODEX-ADVERSARIAL-REVIEW]`; the peer runbook's `[CODEX-REVIEW] PASS` is a third | ✔ `ui_surface_lifecycle_guard.py:635-646` | §4 row "Review envelope compatibility"; REPAIR-3 retires the third wording |
| 5 | Security trust-boundary defects outrank new gate names: `pull_request_target` auto-fix runs head-repo code with secrets; prod-guard misses the current host | ✔ `code-review.yml:16-56`, `prod-guard.sh:86` | REPAIR-10, REPAIR-9 ranked above most CONNECTs in §8 |
| 6 | A green check is not a verdict: Staging Gate scope-skips report success, synthetic HOLD is green, large suites excluded from `ci-gate` | ✔ `staging-gate.yml:89-114`, `synthetic-release-gate.yml:133-145`, `ci.yml` | §1.3 "Not gated" list; CONNECT-4; DoD item 8 |
| 7 | `RELEASE_TRAIN` blockers stop a label, not a deploy | ✔ `release_train.py:81-88` | G-23; G3 criterion in prose now, CONNECT later |
| 8 | Exact source SHA ≠ identical binary: separate `--no-cache --pull` rebuilds | ✔ | G-25; claims narrowed in §1.4 and §3.7 |
| 9 | DORA needs joins and definitions; tags are merge events, not deploys | ✔ `version-tag.yml:35-44` | §3.11 defines deploy = successful `deploy-vps` run de-duplicated by SHA, never tags |
| 10 | Universal ceremony and R0 naming collide with existing practice (PRD exceptions, PR-as-claim, R0/R1 checkpoints, authorization-only Codex) | ✔ | §3.2 renames checkpoints CP-before/after in this doc; §6 keeps PRD exception; Codex stays authorization-only except R3 (owner decision needed, see §8 open question) |
| 11 | R0 must exclude `CLAUDE.md`, `.claude/**`, workflows, registries, review tooling — "internal" can change agent authority | ✔ `ui_surface_lifecycle_guard.py:70-113` | Adopted verbatim in §3.2 (those paths are R3) |
| 12 | R2 too broad without escalation: tenant-bearing data and safety-relevant answers are R3 | ✔ | §3.2 "escalate one class on disagreement"; tenant/safety listed under R3 |
| 13 | R3 families need different evidence (auth ≠ migration ≠ OTA); one checklist is wrong | ✔ | §3.3 tables carry per-family rows (migrations, device evidence); v1.1 may split R3 sub-profiles |
| 14 | Do not demand both paid and agentic review on every PR — contradicts the 2026-10-03 decision | ✔ `docs/review-cheap-lane.md:3-8` | v1 proposes Codex **always** only for R3; R2 stays on owner say-so. **Open question for Mike** (§8) |
| 15 | PR body edits invalidate the body-bound attestation; don't add closeout rewrites after review | ✔ `ui_surface_lifecycle_guard.py:1380-1402` | Closeout scoped to R3 and posted as a *comment*, not a body edit |
| 16 | Observation for non-deployed merges is meaningless | ✔ | G3/G4 marked n/a for R0 and "batched" for R1 |
| 17 | Evidence retention differs (30 d eval/acceptance, 3 d smoke, 90 d receipts); long-lived traceability cannot assume artifacts persist | ✔ | §3.11 metrics computed weekly; incident issues (ADD-2) carry the durable links |
| 18 | `dependency-check.yml` swallows audit failures (`\|\| true`) and parse errors | ✔ `dependency-check.yml:24-68` | REPAIR-4 |
| 19 | Dry-run migrations still execute a `CREATE TABLE IF NOT EXISTS` | ✔ `apply-migrations.yml:149-170` | D18; documented, acceptable (idempotent ledger bootstrap) |
| 20 | `enforcement-audit.yml` tries a direct push to `main` (non-fatal) | ✔ `:131-140` | D20; REPAIR-3 removes the dead step or turns it into a PR |
| 21 | License check is a denylist, not the documented allowlist | ✔ `ci.yml:1304-1313` | D16; decide in REPAIR-3 whether to tighten CI or soften the doc |
| 22 | No SBOM, no disclosure policy, vuln response lacks SLA/supported versions, threat analysis scoped to CLF only | ✔ | §3.10: `SECURITY.md` is DOC; SBOM/SLSA/EOL policy deferred to v2 by the brief |

Codex also credited, correctly, that the repo already states requirement → evidence → test →
implementation → independent review → deployment evidence in
`docs/agents/subagent-development-handbook.md:26-30,1728-1787`; v1 should cite that handbook as the
per-defect procedure rather than restate it.

**Codex limitation noted:** its sandbox could not reach the GitHub API, so branch protection was
"unverified" for Codex; it was read live by Claude (§1.3) and the two agree.

---

## 8. Recommended implementation sequence (after approval; nothing started)

Each step is one PR (or one admin action), reviewed per its class. Steps 1–3 can land the same day.

| Step | Change | Why this order |
|---|---|---|
| 1 | DOC-0 + REPAIR-3 (adopt doc, fix the 20 drift items, delete expired carve-out, PR template `Risk:` line + drop CHANGELOG checkbox = ADD-1) | Stops new work from being built on false descriptions; zero behavior change |
| 2 | REPAIR-10 + REPAIR-9 (auto-fix trust boundary, prod-guard host) | Security defects found during recon; small, independent of the SDLC decision |
| 3 | ADD-2 labels + canary label lines | Unblocks change-failure-rate and MTTR measurement immediately |
| 4 | REPAIR-7 + REPAIR-8 + CONNECT-1 (acceptance fails closed, exact PR match, prod requires acceptance) | Closes Codex objection #2, the biggest evidence hole, in one `deploy-vps.yml`/`retrieval-acceptance.yml` PR; verify on the next real RC |
| 5 | REPAIR-6 (cheap lane head re-read) | Makes the required review SHA-honest |
| 6 | CONNECT-4 + CONNECT-5 (gitleaks/Trivy gated; `sg scan` advisory) | Low risk once a week of runs shows they are green on `main` |
| 7 | REPAIR-4 (dependency coverage) | Expect Dependabot noise; schedule after step 6 |
| 8 | REPAIR-2 rollback runbook + staging drill | Needs CONNECT-1 in place so the drill exercises the real gate |
| 9 | ADD-3 `tools/dora.py`, first baseline report into `wiki/hot.md` | Needs 2+ weeks of `incident` labels to mean anything |
| 10 | CONNECT-2/3 branch-protection reconciliation (Mike) | Blocked on #3657's non-spoofable status source |
| 11 | 30-day review of `Risk:` lines and metrics → decide v1.1 (R3 sub-profiles, automated class hints, `test-eval-offline` promotion, `eval-replay-gate` activation) | Data before more rules |

**Open decisions for Mike (v1 cannot settle these):**
1. Codex review **always** for R3 (proposed) vs. the current "only when I say so" for everything.
2. Keep required approvals at 0 (proposed) or require 1 approval as a visible human gate.
3. Whether `test-eval-offline` should ever become merge-blocking (currently advisory by design).
4. License policy: tighten CI to the documented allowlist, or amend the doc to the denylist in use.

---

## Appendix A — Standing authorizations already granted (so they are not re-asked)

- Merge on independent-review PASS + green required contexts (2026-09-19/20).
- Codex review after cheap-lane saturation (2026-10-03).
- Post-cap Codex rounds after main-merge with `ADV_REVIEW_HUMAN_AUTHORIZED=1` (2026-10-01).
- Cheap lane `gate7_review.py --paid --post` as the required review (2026-10-03).
- Safety flags never withhold an answer (2026-09-27).

## Appendix B — Reconnaissance evidence

Seven read-only recon reports (governance docs, PR-time CI, release/deploy/rollback, test/eval
architecture, requirements traceability, security overlay, metrics) and Codex round 1 were produced
against `origin/main` @ `32bcaa67e` on 2026-10-03. Branch protection and rulesets were read live via
`gh api`. All file:line references in this document point at that SHA; line numbers drift, names do
not.

## Appendix C — Changelog of this document

- 2026-10-03 — v1 proposal drafted (Claude), challenged by Codex round 1 (§7). Awaiting Mike.
