# MIRA / FactoryLM SDLC v1 — Proposal

**Status:** PROPOSAL — not ratified. Nothing in this document changes CI, branch protection,
CLAUDE.md, environments, or repository policy until Mike approves it. Where this document and a
live workflow disagree, the live workflow on `main` wins until the change is made deliberately.
**Date:** 2026-10-03 · **Reconnaissance base:** `origin/main` @ `32bcaa67e88fc2338103dd0b77b61e9ad3d76e57`
**Authors:** Claude (design + recon), Codex (two independent adversarial rounds, §7) · **Owner:** Mike
**Related:** `docs/environments.md`, `docs/adversarial-review-workflow.md`, `docs/review-cheap-lane.md`,
`docs/versioning.md`, `.claude/rules/multi-session-protocol.md`, `.claude/skills/defect-workflow/SKILL.md`,
`docs/agents/subagent-development-handbook.md`, `docs/architecture/FACTORYLM_MIRA_ARCHITECTURE_CONVERGENCE.md`,
`docs/architecture/convergence/{CAPABILITY_CLOSURE,RELEASE_TRAIN,REGISTRY}.yaml`

---

## 0. One-paragraph summary

MIRA already runs a PR-gated, trunk-based lifecycle with an unusually strict production path: six
required status contexts with strict up-to-date, an exact-SHA staging deploy that leaves a receipt
artifact, and a production deploy that refuses to run without that receipt, a passing Staging Gate on
the PR head, and zero migration drift. Lifecycle doctrine also exists, but **fragmented across six
documents** (defect-workflow skill, subagent handbook, convergence gates, multi-session protocol,
environments, versioning) that partly contradict the live workflows. What is missing is one shape:
a risk tiering (today's only classifier is the binary "substantial"), gates whose passage is a named
artifact for an exact SHA rather than prose, staging *acceptance* consumed by production
authorization, an incident record, and any lifecycle metric. SDLC v1 therefore **names** the lifecycle
that is already running, assigns each step an existing mechanism and an evidence artifact, adds four
risk classes so a documentation change stops inheriting deployment ceremony while **never letting a
class waive an existing enforced gate**, and proposes a short list of small repairs and connections.
New code is limited to one read-only metrics script, one acceptance-receipt producer step, and a
few-line fix to the cheap review lane. Everything else is REUSE, CONNECT, or REPAIR.

---

## 1. Current-state lifecycle map (what actually runs on `main` today)

Legend: **ENFORCED** = a workflow, hook, branch rule, or test fails when violated. **DOCTRINE** = a
written rule relying on human/agent discipline. **STALE** = the doc describes something the code no
longer does. File references are to `origin/main` @ `32bcaa67e`. Counts are filesystem enumerations
on that SHA; GitHub-side facts were read live with `gh api` on 2026-10-03.

### 1.1 Intake → design

| Step | Mechanism today | Status | Evidence artifact |
|---|---|---|---|
| Idea / defect intake | GitHub Issues via `gh` (`docs/agents/issue-tracker.md`); 5 triage labels live (`needs-triage` 220, `ready-for-agent` 98, `ready-for-human` 38, `needs-info` 5 issues) | ENFORCED (tracker) / DOCTRINE (triage) | Issue number |
| Defect procedure | `.claude/skills/defect-workflow/SKILL.md` (intake → investigator → contracts → red tests → implementer → mutation check → review → verification → PR → release-verifier); explicitly covers "production incident" | DOCTRINE (operational checklist, agents consume it) | PR body per its §9 |
| Mission | One program uses a mission ID (`FACTORYLM-UNIFIED-UI-CUTOVER-001`, issue #3626); a second name (`FLM-UI-4000`) exists for related work. No general scheme | DOCTRINE, one-off | — |
| PRD + acceptance criteria | Two tracks: `docs/prd/` (16 top-level files, 21 recursively; header convention drifted after 2026-09; no template file) and 14 issues titled `PRD: …` (e.g. #4160 accumulates owner decisions as numbered comments). 4 PRD files carry explicit acceptance-criteria sections; the PR template has an "Acceptance criteria verified" checkbox nothing parses | DOCTRINE; criteria exist in places, not consistently, and nothing consumes them | PRD file or issue thread |
| ADR when required | 39 numbered MADR files in `docs/adr/`; README index lists 13; ~9 are Draft/Proposed ("awaiting Mike"); numbering collisions at 0014 and 0037. Convergence doc defines Gates 0–11 + pre/post-change checkpoints (called R0/R1 there); nothing mechanical checks "ADR exists" or "checkpoint recorded" | DOCTRINE | ADR file, `CU-*.md` unit record (8 exist) |
| Risk classification | Binary "substantial" (`.claude/rules/multi-session-protocol.md` §5); `tools/gate7_review.py:61-112` escalates review effort on DB/auth/tenant/guardrails/deploy signals; S0–S5 is a *safety consequence* scale (handbook §16.2), not change risk | DOCTRINE + effort heuristic | None durable |
| Work claim | `[WORK-CLAIM]` block, post-claim re-read, earliest-ACTIVE wins (protocol §2); a PR carrying the work is itself a valid claim. Only `tools/ui_surface_lifecycle_guard.py:1662` reads the literal, as a text boundary | DOCTRINE | Issue/PR comment |

### 1.2 Implementation → review

| Step | Mechanism today | Status | Evidence artifact |
|---|---|---|---|
| Short-lived branch off current main | `.claude/rules/session-discipline.md`; `feat/fix/chore/ops` prefixes | DOCTRINE (reality: 40 open PRs, ~25 drafts, oldest 2026-09-13) | Branch |
| Local gates | `ruff format --check && ruff check && pytest` (global CLAUDE.md asks for the full suite); `.githooks/pre-commit` (shellcheck, gitleaks, debug-artifact, actionlint; agent-symbol check warn-only). `core.hooksPath` is per-clone and was found unset 2026-08-09; every tool check degrades to a warning when the binary is missing | DOCTRINE (opt-in, fails open) | None durable |
| Developer verification | PR template `Test plan` + checkbox; defect-workflow §8 ordered verification; hazard ledger (global CLAUDE.md; 1 repo hit) | DOCTRINE | PR body prose |
| Property / mutation / adversarial / eval | Hypothesis: 2 files (`tests/test_fsm_properties.py`, `tests/test_guardrails_properties.py`). Source-mutation tooling: **none**; manual "break the fix, confirm red, restore" is defect-workflow step 6. Eval: 67 fixture files under `tests/eval/fixtures/` (README says 51 — stale), run by Celery on the VPS hourly/nightly; `deepeval-ci.yml` on PR (path-filtered); `eval-replay-gate.yml` **inert** (replay store never recorded) | Mixed; eval-on-PR is path-gated; mutation is manual | CI logs, `tests/eval/runs/*.md` |
| Cheap review lane (required on every PR by owner decision 2026-10-03) | `tools/gate7_review.py <PR> --paid --post` → `[CHEAP-REVIEW]` comment (`head`, `verdict`, `model`, `cost_usd`, `run_id`); cost to `.planning/review-costs.jsonl` (gitignored, per host). Head SHA and diff are fetched separately and not re-read before posting; exit code is 0 for PASS, BLOCK, UNKNOWN and post-failure | DOCTRINE (not a status context; the comment is the artifact, never the exit code) | PR comment |
| Independent exact-head Codex review | `git show origin/main:scripts/adversarial-review-trusted.sh \| bash -s -- <PR> --review-only`; exact-SHA re-verify before review and before GREEN; 3-round budget counted from the GitHub ledger; `ADV_REVIEW_HUMAN_AUTHORIZED=1` post-cap | ENFORCED when run; *running it* is owner say-so | `[CODEX-ADVERSARIAL-REVIEW]` comments (`reviewed_sha`, `reviewed_body_sha256`, `status`), `scripts/adversarial-review-ledger.mjs` |
| Guarded-path attestation | Any PR touching a guarded legacy/control-plane path needs a body-bound `[CODEX-ADVERSARIAL-REVIEW] … status: GREEN` matching head **and** PR body digest; a later body edit invalidates it | ENFORCED as a status (not required, see 1.3) | Comment + body digest |
| Claude-reviews-Claude carve-out | `.claude/rules/multi-session-protocol.md:152-180`, self-expired **2026-09-13**, still present verbatim | STALE | — |

### 1.3 Merge

| Step | Mechanism today | Status | Evidence artifact |
|---|---|---|---|
| Required status contexts | Classic protection on `main`: `staging-gate`, `Hub E2E (command-center + onboarding)`, `mira-web pack tests`, `CI Gate`, `hold-gate`, `Shared UI contract (bun 1.4.0)`; `strict: true`; `enforce_admins: true`; required approving reviews **0**; ruleset 17097034 adds PR-required + non-fast-forward and requires only `staging-gate`, bypassable by repository role 5 | ENFORCED (classic layer carries the weight) | Check runs on the head SHA |
| `CI Gate` aggregator (`ci.yml` `ci-gate`) | 16 jobs must literally `success`; `test-unit`/`bench-harness-tests` required only when `changes.code == true` (success or skipped allowed on docs-only). `ci.yml` deliberately runs on stacked PRs (`ci.yml:33-41`). **Not gated:** `secrets-scan` (gitleaks), `docker-build-check` (Trivy), `test-eval-offline` (the broadest `pytest tests/` sweep), `simlab-gate`, `module-suites` (in `needs`, echoed only), `ocr-recall-gate`, `drive-pack-extract-tests` | ENFORCED (listed set) | `ci-gate` check |
| Legacy UI lifecycle guard | `tools/ui_surface_lifecycle_guard.py` via `ui-lifecycle-guard.yml` (trusted-base evaluation, isolated status posting); registry-driven path allowlist incl. `.claude/**`, `AGENTS.md`, workflows, review producers, guard tests, `pytest.ini`/`tests/conftest.py`; rejects placeholder rationale | ENFORCED as a status, **not** in the required set (binding to a non-spoofable source is an unperformed admin action, #3657) | Check status + PR body field |
| Conventional Commit title | No commitlint; `tools/release/next_version.py:89-96` returns **patch** for an unparseable subject (tested in `tests/test_next_version.py`); the tag workflow only fails when no tag can be computed at all | DOCTRINE (compliance is by eye; a bad subject costs a wrong bump, not a red run) | Tag |
| Human merge | 0 required approvals; merge authority is a standing owner decision (strict up-to-date serialises one PR per sitting); a `sha`-conditioned merge is available via `gh pr merge --match-head-commit` | DOCTRINE | Merge commit |
| Label escape hatches | `shared-line-ok` (Shared-Line Guard), `auto-fix` (privileged self-fix), hold labels (`hold-gate`); the lifecycle guard has **no** label bypass | ENFORCED as designed | Labels |

### 1.4 Release → staging → production → observation

| Step | Mechanism today | Status | Evidence artifact |
|---|---|---|---|
| Version + rollback checkpoint | `version-tag.yml` on every push to `main`: `v<X.Y.Z>` from the Conventional Commit type + `rollback/<date>-v<X.Y.Z>` + GitHub Release (release creation best-effort). 1,119 `v*` tags, 1,077 rollback tags; tags are unprotected. A tag marks the merged commit's *address*, not a verified-good production state. `release.yml` (component tags) dormant since 2026-04-10 | ENFORCED (tagging) | Tag, Release |
| Staging deploy | `deploy-staging.yml`, `workflow_dispatch` only, `approved_rc_sha` (40-hex) validated against the API, `environment: staging-deploy`; co-hosted on the prod host (#3930) with 7 safeguards; asserts runtime `gitSha == approved_rc_sha` **for the Hub/Web targets selected**; writes `staging-receipt-<sha>` (schema `factorylm.deploy-receipt/1`, 90-day retention) | ENFORCED | Receipt artifact |
| Staging acceptance | `retrieval-acceptance.yml` fires after a successful staging deploy; resolves the SHA **actually serving** from `/api/health`, provisions a stranger tenant, runs 6 live Hub retrieval scenarios + capture accounting (capture skips historical deployments and exits 0), re-reads the SHA at verdict time (SUPERSEDED on drift, but **exit 0 with a warning if the re-read fails**), uploads trace-bearing JSON (`base`, `ran_at`, `rows`; no pinned SHA, no run identity; 30-day retention) | ENFORCED as an asynchronous *measurement*; **not consumed** by prod authorization | JSON artifact + Langfuse trace ids |
| PR-time Staging Gate | `staging-gate.yml` on every PR: engine in-process against staging Neon, 10–15 rubric questions; scope-skips (reports success) for docs/wiki/.github/.claude-only PRs and Dependabot; retries once; result comment is best-effort | ENFORCED (required context) | Check run |
| Migrations | `migration-verify.yml` auto-applies PR migrations to staging; `apply-migrations.yml` (`dry-run`/`apply`/`seed-ledger`, `content_sha256` check that skips absent columns/missing hashes); sister `apply-ingest-migrations.yml` shares the ledger; `deploy-vps.yml` `migration-drift` fails prod deploy when a **repo filename** is absent from the ledger (`tools/migration_drift.py`: filename-level, repo→ledger only). Staging-before-prod ordering is DOCTRINE | ENFORCED at the prod boundary (filename level) | Ledger rows, drift job log |
| Production deploy | `deploy-vps.yml`, `workflow_dispatch` only ("AUTO-DEPLOY stays DISABLED (#3800)"). `authorize-source` rejects any `skip_*` input, requires Staging Gate `completed:success` on the PR head of the merge (falls back to the **first** associated PR when exact merge-commit match fails), requires an unexpired (≤168 h) verified `staging-receipt-<sha>` with workflow provenance; separate jobs hold DB vs SSH credentials; `deploy` records `PRIOR_SHA/PRIOR_TAG`, asserts zero tree drift, built-image == running-image, runtime `gitSha == approved_rc_sha` for selected Hub/Web, writes `production-receipt-<sha>` (90 d), strict nginx `sites-enabled` allowlist. Default rebuild set `mira-hub mira-web mira-ask`. On a failed health-gated swap it deliberately leaves the new containers in place | ENFORCED | Production receipt artifact |
| Hotfix path | Docs describe `skip_staging_gate=true` / `skip_reason` dispatch + 24 h follow-up PR (`docs/environments.md:87-90`, `docs/runbooks/deploy-to-production.md:126-145`). The live workflow **rejects** those inputs. 24 h rule enforced nowhere | STALE + DOCTRINE | — |
| Rollback | Redeploy a prior SHA through the same gated `deploy-vps.yml` (its staging receipt must be ≤168 h old); `rollback/*` tags are address anchors; `apply-migrations.yml` has no down mode (Neon snapshot or in-file rollback block); `docs/runbooks/hubv3-rollback.md` uses a `-f ref=` input that does not exist. **No recorded exercise** of a VPS rollback found (June incident was fix-forward). OTA has signed-pointer rollback tooling (`mira-mobile/scripts/ota-rollback.mjs`) | ENFORCED path exists; STALE runbook; no recorded drill | Tag + receipt |
| Production observation | Canaries: provider-health (6 h → `provider-incident` issue; probe failures do not page), oauth-redirect (hourly → `oauth-incident` issue), embedding-coverage (daily → Telegram), proposal-state (nightly → failure email), web-review (daily → wiki report), dogfood-judge-heartbeat (6 h → Telegram + red). `smoke-test.yml` on push to `main`/PR/dispatch against live prod (advisory on PR; alerts muted 10 min around any prod deploy; **not triggered by a prod deploy**). `beta-probe-prod.yml` manual; doc says Mike owns dispatch, nothing enforces actor identity. `mira-ops/` listed in the repo map **does not exist** | ENFORCED (cadence) / three disjoint alert channels | Issues, Telegram, wiki |
| Failure → regression | defect-workflow covers production incidents; 118 test files cite 142 distinct `#NNNN` issues; `tests/bot_regression.py` is the named "never break" file; nightly active-learning opens draft fixture PRs from 👎 feedback; `qa-regression.yml` and `mira-benchmark-weekly.yml` file labelled issues. No durable incident record links deploy SHA → failure → restoring action → regression evidence. `docs/incidents/` has one file (2026-06-02) | DOCTRINE + partial automation | Test docstring citing the issue |
| Capability closure / release identity | `CAPABILITY_CLOSURE.yaml` (12 capabilities; `review_by` expiry and provenance **CI-enforced**, an expired date fails `ci-gate` repo-wide); `RELEASE_TRAIN.yaml` (`DEV→RC→STAGING_PARITY→DEVICE_PARITY→RELEASED`; CI validates the manifest **without `--drift`**; `--drift` is a deploy-path tool; blockers block the `RELEASED` label only; currently `RC` with blocker #3984) | ENFORCED (repo invariants) / DOCTRINE (live parity) | YAML + CI job |

### 1.5 Where the docs and the automation disagree (all verified against the files)

| # | Doc says | Code does | Files |
|---|---|---|---|
| D1 | Merge → smoke → auto prod deploy via `workflow_run` | `deploy-vps.yml` is `workflow_dispatch` only; auto-deploy disabled by design | `docs/environments.md:84`, `docs/runbooks/deploy-to-production.md:45-58`, `docs/specs/staging-environment-spec.md:164`, `smoke-test.yml:27,182-185` vs `deploy-vps.yml:23-41` |
| D2 | Hotfix via `skip_staging_gate=true -f skip_reason=…` | Inputs rejected: "Gate-bypass input … is no longer allowed" | `docs/environments.md:87-90`, `deploy-to-production.md:126-140`, `staging-environment-spec.md:171` vs `deploy-vps.yml:71-81` |
| D3 | Default rebuild set is 7 services | Default is `mira-hub mira-web mira-ask` | `deploy-to-production.md:74-77` vs `deploy-vps.yml:478` |
| D4 | Rollback dispatch uses `-f ref=<tag>`; a `VERSION` bump | Only `approved_rc_sha` exists; `/VERSION` is gone | `docs/runbooks/hubv3-rollback.md:52-61,94-105` |
| D5 | `docs/review-cheap-lane.md` routes the agentic lane through `tools/review_router/router.py` | File not on `main` (PR #4202 open); only `prices.json` present | `docs/review-cheap-lane.md:5-6,61` |
| D6 | Gate 7 default provider is the free Groq→Cerebras→Together cascade / "No OpenAI" | Required gate is the paid OpenAI lane; Cerebras archived 2026-09-29; `--adjudicate` still calls only the free cascade | `FACTORYLM_MIRA_ARCHITECTURE_CONVERGENCE.md:331`, `.claude/commands/gate7-review.md` vs `docs/review-cheap-lane.md`, `tools/gate7_review.py:1206` |
| D7 | `CLAUDE.md:3` "Version: see `/VERSION`" | `/VERSION` deleted 2026-08-02 (#3064); same file says so at lines 247 and 332 | `CLAUDE.md` |
| D8 | Claude-reviews-Claude carve-out "expires 2026-09-13" | Still present verbatim on 2026-10-03 | `.claude/rules/multi-session-protocol.md:152-180` |
| D9 | CI step named "ast-grep" runs the `.ast-grep-rules/` set (5 rules; `sgconfig.yml` configured) | Step installs `@ast-grep/cli` then runs hand-written `rg` regexes for IPs/secrets only; no `sg scan` anywhere in CI | `.github/workflows/code-review.yml:85-156` |
| D10 | Repo map lists `mira-ops/` (Prometheus/Grafana) | Directory absent | `CLAUDE.md` repo map |
| D11 | `docs/agents/domain.md` "16 ADRs"; monday.com scope lock through 2026-07-19 | 39 ADRs; lock date passed | `docs/agents/domain.md:44` |
| D12 | `docs/environments.md:38` "No bypass inputs" vs `staging-environment-spec.md:171` "`skip_staging_gate=true` preserved" | Code matches the first | both docs |
| D13 | `staging-environment-spec.md:24` "No staging mira-hub, no staging Atlas" | `deploy-staging.yml` health-checks Hub, Atlas and Web and emits receipts (nginx not thereby proven) | `deploy-staging.yml:413-490` |
| D14 | `CLAUDE.md` "prod-guard.sh enforces #1–#3" (prod SQL, VPS compose, prod bot token) | `PROD_HOST` lists old VPS IPs and `.factorylm.com`, not the OVH host `40.160.141.61`; no prod-DB-URL or bot-token pattern; allows (with a stderr line) on an empty payload | `tools/hooks/prod-guard.sh:62-66,86,123-136` vs `deploy-vps.yml:383-384` |
| D15 | Peer runbook accepts a `[CODEX-REVIEW] PASS` packet | Only the `[CODEX-ADVERSARIAL-REVIEW]` envelope (SHA + body digest + `status: GREEN`) satisfies the guard; `[CHEAP-REVIEW]` satisfies neither | `docs/runbooks/charlie-codex-claude-peer-review.md:123-130` vs `tools/ui_surface_lifecycle_guard.py:635-646` |
| D16 | `CLAUDE.md:28` "Apache 2.0 or MIT ONLY" | `license-check` allowlists only `asyncpg`; the general check is a denylist (GPLv3/AGPLv3/UNKNOWN) | `ci.yml:1304-1313` |
| D17 | PR template checklist "CHANGELOG entry added" | `docs/CHANGELOG.md` frozen; Shared-Line Guard rejects edits without `shared-line-ok` | `pull_request_template.md:91` vs `ci.yml:185-203` |
| D18 | `apply-migrations.yml` dry-run "no execution" | Dry-run executes `CREATE TABLE IF NOT EXISTS schema_migrations` before the preview (idempotent ledger bootstrap) | `apply-migrations.yml:149-170` |
| D19 | `.githooks/pre-commit:327-328` calls the CI symbol check a "blocking backstop" | `code-review.yml` folds the result into a comment and never fails | `code-review.yml:153-169` |
| D20 | `enforcement-audit.yml` nightly job commits and pushes directly to `main` | Push outcome swallowed as "non-fatal"; contradicts "PR-gated main" whether or not protection rejects it (bot bypass permissions not verified) | `enforcement-audit.yml:131-140` |
| D21 | `tests/eval/README.md:7` "51 fixtures" | 67 fixture files present | `tests/eval/fixtures/` |
| D22 | `.claude/agents/safety-reviewer.md:15` "IMMEDIATE always stops" | Owner decision 2026-09-27: safety-classified turns are answered with a banner (`guardrails.py:1463-1467`) | both files |

---

## 2. Gaps (what the lifecycle requires that nothing provides today)

Each gap is a fact about what is absent or disconnected, with evidence, classified by closure type:
**DOC** (write it down), **CONNECT** (wire two existing things), **REPAIR** (fix a broken or stale
existing thing), **ADD** (does not exist; requirement genuinely unenforced).

| # | Gap | Evidence | Closure |
|---|---|---|---|
| G-01 | Lifecycle doctrine is fragmented across six documents with no single gate map; the one end-to-end promotion narrative (`environments.md`) is stale | §1.5 D1–D4; defect-workflow, handbook §14/§16, convergence gates, protocol | DOC (this document indexes them) |
| G-02 | No change-risk tiering; "substantial" is binary, so written ceremony is uniform and in practice skipped ad hoc | protocol §5; 0/15 sampled merged PRs carry any label | DOC + tiny ADD (one PR-body line) |
| G-03 | Acceptance criteria exist in some PRDs and as a template checkbox, but nothing links a PR to the criterion it satisfies; evidence pointers are prose | 4/21 PRD files; template checkbox unparsed; 0/15 PRs cite a spec path | DOC (criterion → evidence line in the PR body) |
| G-04 | Cheap-lane verdict is not SHA-rebound before posting, has no merge consumer, and is not a status context; exit 0 ≠ PASS | `gate7_review.py:705-721,1364-1401` | REPAIR (small) + DOC (consumer = human reading `verdict:` on the current head) |
| G-05 | Codex lane trigger is owner say-so with no written rule per risk class | `docs/review-cheap-lane.md:5-8` | DOC (+ open decision) |
| G-06 | Staging acceptance is produced but **not consumed** by `deploy-vps.yml`; its artifact lacks the SHA/run identity a consumer would need | `deploy-vps.yml:132-227`; `retrieval_acceptance.py:590-615` | CONNECT (needs an acceptance receipt first) |
| G-07 | Hotfix exists only in stale docs; the live workflow's only fast lever is a narrower `services` list; 24 h rule unenforced | D2 | DOC |
| G-08 | No recorded rollback exercise; migration rollback is manual; runbook inputs stale; `PRIOR_SHA` is the host checkout, not a per-service runtime snapshot | §1.4 | DOC + drill |
| G-09 | Incident taxonomy is per-canary (`provider-incident`, `oauth-incident`, `qa-regression`, `benchmark-regression`, `bug`, `security`); no common `incident` record carrying deploy SHA, first-seen, restored-at | `gh label list` (103 labels); canary issue bodies carry run URLs, not SHAs | ADD (labels + fixed body fields) |
| G-10 | No DORA computation; ingredients partly exist (runs, receipts, PR timestamps); joins and definitions absent | `grep -rli dora` = 0 | ADD (read-only script) after G-09 |
| G-11 | Security tooling present but not gating or not running: `secrets-scan`/Trivy outside `ci-gate`; `.ast-grep-rules/` never executed; AI review comment-only; pip-audit 3 roots with `\|\| true`; Dependabot omits `mira-hub`, `mira-mobile`, `mira-cmms`, `mira-pipeline`, `mira-bridge`; no JS/TS CVE audit; no `SECURITY.md`; no SBOM | `ci.yml:275-340,1393-1463`, `code-review.yml:85-156`, `dependency-check.yml`, `.github/dependabot.yml` | CONNECT + REPAIR + DOC |
| G-12 | Mutation testing is manual; property tests cover 2 modules; `eval-replay-gate.yml` inert | §1.2 | DOC (scope by class); no tooling in v1 |
| G-13 | Local pre-commit layer is opt-in and fails open when a tool is missing | `.githooks/pre-commit`, `.claude/settings.json` gitleaks hook | DOC (CI is the gate; local is convenience) |
| G-14 | Governance text has expired or contradictory blocks (D5–D8, D11–D22) | §1.5 | REPAIR (docs) + two workflow repairs (D16, D20) |
| G-15 | `Legacy UI Lifecycle Guard` not in required contexts; ruleset weaker than classic protection | live protection read | CONNECT (admin, #3657) |
| G-16 | Claims and closeouts are prose; no PR in the sample emitted the SESSION CLOSEOUT block | protocol §9; grep = rule file only | DOC (scope closeout to unresolved-ownership cases) |
| G-17 | Branch longevity: 40 open PRs, ~25 drafts, oldest 2026-09-13 | `gh pr list` 2026-10-03 | DOC (WIP policy) + metric |
| G-18 | `deploy-vps.yml` PR association falls back to the first associated PR | `deploy-vps.yml:144-148` | REPAIR (small) |
| G-19 | `retrieval-acceptance.yml` verdict-time SHA re-read fails open | `retrieval-acceptance.yml:165-174` | REPAIR (small) |
| G-20 | `code-review.yml` `auto-fix` uses `pull_request_target`, checks out the head repo, runs `scripts/pr_self_fix.sh` (reads local `HEAD~1..HEAD`, pushes the local branch) with provider secrets and a write token; label-gated only | `code-review.yml:16-56`; `scripts/pr_self_fix.sh:49,154` | REPAIR (security) |
| G-21 | `prod-guard.sh` host matcher predates the OVH move | `prod-guard.sh:86` | REPAIR (small) |
| G-22 | `gate7_review.py` exit 0 for every outcome | `tools/gate7_review.py:1364-1401` | DOC |
| G-23 | `RELEASE_TRAIN.yaml` blockers stop the `RELEASED` label, not `deploy-vps.yml` | `tools/release_train.py:81-88`, `deploy-vps.yml:305-310` | DOC in v1 (G3 criterion), CONNECT later |
| G-24 | Smoke alerts muted 10 min around any deploy; smoke is not triggered by a prod deploy; missing alert secrets only warn | `smoke-test.yml:30-45,159-179` | DOC (G4 requires an explicit post-deploy smoke dispatch) |
| G-25 | Staging and production rebuild images separately with `--no-cache --pull`; source identity proven, binary identity not | `deploy-staging.yml:372-379`, `deploy-vps.yml:525-540` | DOC (narrow the claim; SLSA-era fix deferred) |
| G-26 | `TenantScopedSession` checks that SQL *mentions* `tenant_id` for a fixed table set (not `knowledge_entries`); hybrid reads intentionally bypass RLS with explicit predicates | `mira-bots/shared/tenant/session.py:53-66`; `knowledge-entries-tenant-scoping.md` | DOC (narrow the PW.9 claim) |
| G-27 | Safety-reviewer agent text contradicts the 2026-09-27 owner decision (D22) | `.claude/agents/safety-reviewer.md:15` | REPAIR (one line) |

---

## 3. SDLC v1 — the proposal

### 3.1 Principles

1. **Formalize, don't re-tool.** Every gate names the existing mechanism that satisfies it. No Jira,
   GitFlow, new CI platform, new agent framework, second registry, or second reviewer fleet.
2. **A gate is passed when a named artifact exists for the exact SHA.** Prose in a PR body *points*
   at evidence (a check run, a `[CHEAP-REVIEW]` or `[CODEX-ADVERSARIAL-REVIEW]` comment, a tag, a
   receipt artifact, a YAML registry row, a test path). Where v1 still accepts a declaration (hazard
   ledger, mutation check), it says so and names the reader who consumes it.
3. **Two independent dimensions, not one.** *Review risk* (R0–R3, §3.2) decides what review and
   testing a change needs. *Deployment applicability* (does this change ship to staging/production
   at all?) decides whether G3/G4 apply. A governance-only R3 change gets rigorous review and no
   production receipt; a one-line R1 UI fix gets light review and the full deploy evidence when it
   ships.
4. **A risk class never waives an enforced obligation.** Branch protection, `ci-gate`, the lifecycle
   guard, the Shared-Line Guard, the cheap review lane (owner mandate: every PR), and the guarded-path
   Codex attestation run regardless of the class written in the PR. Classes only *add* obligations.
5. **Live automation outranks doctrine.** A documented rule with no enforcer is a *target*, labelled
   DOCTRINE, and is either connected to an enforcer or deleted.
6. **Claude implements, Codex reviews read-only, CI decides, Mike authorizes.** Unchanged from
   `.claude/rules/multi-session-protocol.md` §6 and `docs/review-cheap-lane.md`.
7. **Trunk-based, short-lived.** One branch per slice, cut from a freshly fetched `origin/main`,
   merged or closed within the WIP policy (§3.9); stacked PRs get `ci.yml` but not every required
   context, so they are not merge candidates until re-based on `main`.

### 3.2 Risk classes (review-risk dimension)

Assigned at G0 by the implementer on the issue/claim (copied into the PR body as one line:
`Risk: R2 — retrieval ranking change`), challengeable by any reviewer, **escalated one class on any
disagreement**. The path signals are classification *aids* drawn from existing automation
(`tools/ui_surface_lifecycle_guard.py:70-124` trusted control-path list, `ci.yml` `changes` filter,
`tools/gate7_review.py:61-112` escalation reasons, `kg-write-guard.yml` and `migration-verify.yml`
path filters, the `safety-reviewer`/`security-reviewer` trigger lists). The written class is
authoritative for *added* obligations only (principle 4).

| Class | Scope | Path / content signals (existing) | Explicitly **not** in this class |
|---|---|---|---|
| **R0 — inert documentation** | Prose under `docs/**` and `wiki/**` that does not define process or policy; screenshots and promo assets outside guarded trees; comments; `.planning/` fragments | `ci.yml` `changes.code == false` AND not a control-path file | Anything in the **governance floor** below; any file under `mira-web/public/**` or `mira-hub/public/**` (guarded legacy trees) |
| **R1 — low-risk product** | Isolated UI copy/layout inside canonical shells; a single-module bug fix with a red→green test; new non-shared code behind an off flag; non-retrieval API additions; `tools/` scripts that run in neither CI nor deploy; test additions that add coverage without changing collection or enforcement | Code change outside every R2/R3 signal | Concurrency, idempotency, reliability or data-integrity fixes (R2 minimum — protocol §5 "substantial") |
| **R2 — behavioral / retrieval / model / data** | `mira-bots/shared/**` answer path incl. `engine.py`, `inference/router.py`, prompts (`mira-bots/prompts/**`), retrieval (`neon_recall.py`, `mira-hub/src/lib/manual-rag.ts`, BM25/embedding), ingest writers, KG writers, eval fixtures/graders/golden CSVs, classifier/intent, Hub notebook turn pipeline, mobile unified-shell behavior, runtime dependency bumps, concurrency/idempotency/data-integrity fixes | `deepeval-ci.yml`, `eval-replay-gate.yml`, `kg-write-guard.yml`, `beta-gate.yml`, `prompt-guard.yml`, `photo-e2e-verify.yml`, `enforcement-audit.yml` path filters | Anything that changes **who may see what** (tenant/private data) or **what is said about hazards** — those are R3 |
| **R3 — safety / security / auth / tenant / migration / production-control / governance** | Safety: `guardrails.py`, `SAFETY_KEYWORDS`, hazard/safety banners and judges, `mira-hub/src/lib/safety-classifier.ts`, answer-validation. Security/auth: sessions, NextAuth, middleware, secrets handling. Tenant: `knowledge_entries` read/write filters, RLS, `TenantScopedSession`, ingest of private customer documents. Migrations: `mira-hub/db/migrations/**`, `mira-core/mira-ingest/db/migrations/**`. Production control: `.github/**`, `tools/hooks/**`, `.githooks/**`, deploy/receipt/drift scripts, `docker-compose*.yml`, nginx, OTA/native release, PLC/fieldbus/Ignition. **Governance floor:** `CLAUDE.md`, `AGENTS.md`, all of `.claude/**` (rules, agents, skills, settings), review producers and consumers (`tools/gate7_review.py`, `scripts/adversarial-review*`, `tools/ui_surface_lifecycle_guard.py`, `tools/ci/**`, `tools/capability_closure.py`, `tools/release_train.py`, `tools/migration_drift.py`, `tools/staging_receipt.py`), registries and allowlists (`docs/contracts/contract-index.yaml`, `.ast-grep-rules/**`, `sgconfig.yml`, `scripts/kg_write_guard_allowlist.txt`, `docs/architecture/convergence/*.yaml`), test collection/config (`pytest.ini`, `pyproject.toml`, `tests/conftest.py`, tests of any guard), process docs (`docs/adversarial-review-workflow.md`, `docs/environments.md`, `docs/versioning.md`, this document), guarded legacy UI paths | `REGISTRY.yaml` LEGACY entries; the lifecycle guard's trusted control-path list; `migration-verify.yml` paths; reviewer trigger lists | — |

**Relationship to existing vocabulary.** "Substantial" (protocol §5) = R2 ∪ R3. S0–S5 (handbook
§16.2) remains the *safety-consequence* scale used inside R3 safety reviews. The convergence doc's
R0/R1 *checkpoints* are referred to here as **CP-before / CP-after**; the convergence doc is not
edited in v1. R3 is one review class with **family-specific evidence rows** in §3.3 (safety, auth,
tenant, migration, mobile/OTA, governance); v1.1 may split it formally once data exists.

### 3.3 Lifecycle and gates

```
Idea/defect ─► Issue (+ PRD for new behavior) ─► [ADR]* ─► Risk class on the issue/claim
   ═══ G0 Ready to Build ═══
fetch + branch off origin/main ─► implement test-first ─► relevant suites + lint ─► cheap lane to a clean verdict
   ═══ G1 Ready for Review ═══
required contexts green on head ─► [specialist findings]* ─► [Codex exact-head GREEN]* ─► sha-conditioned merge
   ═══ G2 Ready to Merge ═══   (version-tag.yml tags + rollback checkpoint automatically)
            │ (only if the change ships)
deploy-staging(approved_rc_sha) ─► staging receipt ─► retrieval-acceptance receipt ─► [migrations]*
   ═══ G3 Ready for Production ═══
deploy-vps(approved_rc_sha) ─► production receipt ─► smoke dispatch ─► observation window ─► closure records
   ═══ G4 Closed / Observed ═══
production failure ─► `incident` issue (SHA, first-seen, restored-at) ─► regression disposition ─► back to G0
```
`*` = required only for some classes/families (tables below). Columns: R0 / R1 / R2 / R3.

#### G0 — Ready to Build

| Criterion | R0 | R1 | R2 | R3 | Mechanism / evidence |
|---|---|---|---|---|---|
| Requirement record: an issue (the PR may be the issue for R0/R1 one-liners) | opt | ✔ | ✔ | ✔ | GitHub Issues; triage labels |
| Checkable acceptance criteria exist for **new behavior** (defects: the issue + red test + contract ID suffice, as `defect-workflow` already provides) | — | 1+ numbered outcome | numbered criteria in the PRD (file or `PRD:` issue) | same | `docs/prd/`, `PRD:` issues, `docs/contracts/contract-index.yaml` |
| ADR when the change alters a dependency direction, canonical identity, shared contract, or module boundary | — | — | if architectural | if architectural | `docs/adr/`; convergence Gates 1–3; `CU-*.md` |
| Risk class recorded on the issue or claim, copied into the PR body | implicit | ✔ | ✔ | ✔ | `Risk:` line (ADD-1) |
| Work claim when overlap is plausible | — | opt | ✔ | ✔ | `[WORK-CLAIM]` (protocol §2); the PR itself counts |
| Branch cut after `git fetch origin`, from `origin/main` | ✔ | ✔ | ✔ | ✔ | session-discipline; strict up-to-date catches staleness at merge |
| CP-before for architecture/data changes: base SHA, baseline test result, schema/ledger state, Neon snapshot or branch id for migrations, rollback SQL block | — | — | if architectural | ✔ for migrations/architecture | Convergence doc §7 (unchanged); recorded in the PR body / `CU-*.md`. Auto `rollback/*` tags provide *addressability* only |

#### G1 — Ready for Review

| Criterion | R0 | R1 | R2 | R3 | Mechanism / evidence |
|---|---|---|---|---|---|
| Lint + the suites CI will run for the touched packages, as separate invocations where collection collides (`tests/` vs `mira-bots/tests/`), plus any suite the change could pollute | — | ✔ | ✔ | ✔ (behavioral changes) | `defect-workflow` §8 order; global CLAUDE.md local-gates rule |
| Red→green test whose docstring cites the issue | — | ✔ | ✔ | ✔ for behavioral changes; n/a for governance prose | Existing practice (142 issues cited); `tests/bot_regression.py` pattern |
| Eval / golden case when the answer path changes | — | — | ✔ | ✔ if applicable | `tests/eval/fixtures/`, `tests/golden_*.csv`, `deepeval-ci.yml` |
| Property test for a **new** state machine, parser, or invariant | — | — | ✔ | ✔ | hypothesis pattern (`tests/test_fsm_properties.py`) |
| Mutation check (break the fix, confirm red, restore) **for the defect test** | — | — | ✔ when a defect test exists | ✔ when a defect test exists | `defect-workflow` step 6; declared in the PR body with the red output |
| Specialist review **findings** attached (not attendance): `conversation-reviewer` for answer-path changes; `safety-reviewer` for safety family; `security-reviewer` for auth/tenant/deploy/secrets | — | — | conversation | safety and/or security | `.claude/agents/*.md`; findings pasted or linked in the PR, each dispositioned |
| Hazard ledger (noticed-but-unfixed items each dispositioned) | — | — | ✔ | ✔ | PR body; consumer = the merger |
| Cheap review lane on the current head with `verdict: PASS`, or every remaining finding dispositioned (fixed / false-positive with reason / deferred to issue #) | ✔ (owner mandate) | ✔ | ✔ | ✔ | `[CHEAP-REVIEW]` comment whose `head:` equals the current head (REPAIR-6) |
| PR body: Summary, `Risk:`, criterion → evidence mapping, test evidence, hazard ledger | Summary + Risk | ✔ | ✔ | ✔ | `.github/pull_request_template.md` (REPAIR-3 trims it) |

#### G2 — Ready to Merge

| Criterion | R0 | R1 | R2 | R3 | Mechanism / evidence |
|---|---|---|---|---|---|
| Six required contexts green on the current head, strict up-to-date | ✔ | ✔ | ✔ | ✔ | Branch protection; `tools/pr-merge-blocker.sh` |
| `Legacy UI Lifecycle Guard` green (and its body-bound Codex GREEN when the PR touches a guarded path, whatever the class) | ✔ | ✔ | ✔ | ✔ | `ui-lifecycle-guard.yml` (advisory today → CONNECT-2) |
| Independent exact-head Codex review | — | — | when Mike names it or a cheap-lane finding is disputed (**current policy**) | **always** (proposed; open decision 1) | `adversarial-review-trusted.sh … --review-only`; ≤3 rounds |
| When a Codex review is required: `status: GREEN`, `reviewed_sha` == head, `reviewed_body_sha256` == current body | — | — | if required | ✔ | `[CODEX-ADVERSARIAL-REVIEW]` comment |
| Merge is SHA-conditioned (`gh pr merge --match-head-commit <sha>`), performed by the standing authority; R3 by Mike or an explicitly delegated session | ✔ | ✔ | ✔ | ✔ (Mike/delegate) | GitHub merge API `sha` condition |
| Conventional Commit title (checked by the merger; a bad subject yields a wrong bump, not a red run) | ✔ | ✔ | ✔ | ✔ | `tools/release/next_version.py` |
| Exceptions to any gate recorded as a **comment** (not a body edit) linking Mike's approval | — | ✔ | ✔ | ✔ | §3.13 |

#### G3 — Ready for Production (applies only to changes that ship)

| Criterion | R1 | R2 | R3 | Mechanism / evidence |
|---|---|---|---|---|
| `v*` and `rollback/*` tags exist for the merge | ✔ | ✔ | ✔ | `version-tag.yml` (automatic) |
| Staging deploy of the exact RC SHA succeeded; receipt verified (≤168 h old at prod time) | ✔ (batched into an RC) | ✔ | ✔ | `deploy-staging.yml` → `staging-receipt-<sha>` |
| Staging **acceptance receipt** for that SHA and that deploy run: all scenario verdicts PASS, none SUPERSEDED/skipped; required whenever `mira-hub` is in the deployed service set; reusable for an unchanged SHA within 168 h | ✔ | ✔ | ✔ | `retrieval-acceptance.yml` → `acceptance-receipt-<sha>` (CONNECT-1 producer + consumer) |
| Migrations (Hub **and** ingest) applied to staging then prod via the ledgered workflows, `dry-run` then `apply`; prod drift job = 0 missing files; content check reported no mismatch | n/a | n/a | ✔ when present | `migration-verify.yml`, `apply-migrations.yml`, `apply-ingest-migrations.yml`, `deploy-vps.yml` `migration-drift` |
| No open `RELEASE_TRAIN.yaml` blocker for the component being deployed, or Mike's written waiver | — | ✔ | ✔ | `RELEASE_TRAIN.yaml` `blockers:` (manual check in v1; G-23) |
| Device evidence when native/OTA mobile is in the release | ✔ if mobile | ✔ if mobile | ✔ if mobile | `RELEASE_TRAIN.yaml` `device_parity` receipts; `ota-release.yml` handset-evidence job |
| Production dispatch authorized by Mike: he dispatches, or his authorizing comment is linked in the dispatch summary | ✔ | ✔ | ✔ | `deploy-vps.yml` `workflow_dispatch` (`environment: production`) |

#### G4 — Closed / Observed (applies only to changes that shipped)

| Criterion | R1 | R2 | R3 | Mechanism / evidence |
|---|---|---|---|---|
| Production receipt exists for the SHA and the deployed service set | ✔ | ✔ | ✔ | `production-receipt-<sha>` |
| **Explicit post-deploy smoke**: `smoke-test.yml` dispatched after the deploy completes (outside the 10-min mute), run id recorded | ✔ | ✔ | ✔ | `smoke-test.yml` `workflow_dispatch`; screenshots per the Screenshot Rule when UI changed |
| Observation window, starting at the smoke run: no `incident` issue created **or updated** attributing this SHA, and canary runs completed (not infra-failed) | 24 h | 24 h | 72 h | Canaries (§1.4) + `incident` label (ADD-2) |
| Feature proven on where a capability/flag is involved; `CAPABILITY_CLOSURE.yaml` advanced from a Doppler read (this is an evidence-record commit, distinct from the deployed SHA) | — | ✔ | ✔ | `finish-capability` skill; `tools/capability_closure.py` |
| Release identity recorded when the release train applies | — | — | ✔ | `RELEASE_TRAIN.yaml` observed_* + `tools/release_train.py --drift` |
| Tenant-touching changes: the BRAVO RBAC inspection run after the deploy is linked | — | — | ✔ (tenant family) | `tools/qa/rbac/*` run (launchd on BRAVO) |
| Any attributable failure → `incident` issue → regression disposition (§3.8); the change is **FAILED-OBSERVED**, not closed, until the disposition is merged | ✔ | ✔ | ✔ | §3.8 |
| Handoff comment only when ownership, blockers, or authorization remain unresolved (the full SESSION CLOSEOUT block is not required for a merged, deployed PR) | — | — | if unresolved | protocol §9 |

### 3.4 Definition of Ready (= G0 passed)

1. A durable requirement record exists: an issue (R1+); for **new behavior** at R2/R3 a PRD in either
   accepted form (`docs/prd/YYYY-MM-DD-slug.md` or a `PRD:` issue) with numbered, checkable
   acceptance criteria. For **defects** the issue, the contract ID(s) and the planned red test are
   the record (`defect-workflow` §1–§4).
2. The risk class is written on the issue/claim and no reader of the plan disagrees (or it was escalated).
3. Design is settled at the level the class needs: R3 architecture changes have an ADR (Proposed is
   acceptable; "Proposed ≠ authorized" stands) and, for convergence units, a `CU-*.md` with CP-before.
4. The slice is claimed when overlap is plausible and the post-claim re-read confirmed it.
5. The implementer can name the test that goes red first and, for R2, the eval/golden case.

### 3.5 Definition of Done (= G4 passed, or an explicit non-deploy state)

A change is Done — and may be reported as done — only when, for the exact merged SHA:

1. Merged through the required contexts with the review evidence its class requires (G2).
2. `v*` and `rollback/*` tags exist.
3. One of: **(a) Deployed** — staging receipt + acceptance receipt + production receipt + post-deploy
   smoke run exist and the observation window elapsed clean; **(b) Merged-not-deployed** — the
   change is explicitly recorded on its issue as batched into a named RC, and that RC's deployment
   closes it; **(c) Not deployable** — governance/docs-only; Done at G2.
4. Each acceptance criterion in the requirement record is marked met with a pointer (test name, check
   run, screenshot path, receipt, trace id).
5. The hazard ledger has no undispositioned row.
6. "Merged" is not "done" for anything that ships (`CLAUDE.md` § Capability closure). "Green CI" is
   not "the new tests ran": the named tests appear in the CI log.

### 3.6 Hotfix path (production degraded, normal flow too slow)

The live `deploy-vps.yml` has **no gate bypass**, and v1 keeps it that way. A hotfix is the normal
path with the queue cleared:

1. Open the fix PR as **R3 (production-control)** regardless of diff size, title `fix(hotfix): …`,
   and open an `incident` issue first (ADD-2) linking the PR.
2. G1: cheap lane one round. Codex review may be **deferred post-merge only** when the PR touches no
   guarded control-plane path (the body-bound attestation cannot be deferred) and Mike says so on
   the PR; it must complete within 24 h and its `[CODEX-ADVERSARIAL-REVIEW]` comment is the
   follow-up artifact.
3. G2: required contexts green (strict up-to-date applies; nothing else merges meanwhile).
4. G3: `deploy-staging.yml`, then `retrieval-acceptance` (wait for it when `mira-hub` is in the set),
   then `deploy-vps.yml` with the narrowest `services` list containing the fix.
5. G4 as normal; the regression disposition lands in the hotfix PR or a follow-up within 24 h.
6. The stale `skip_staging_gate` / `skip_reason` prose is removed (REPAIR-3).

### 3.7 Rollback path

Rollback is a **forward deploy of a known-good SHA** through the same gates, plus a data decision.

| Layer | Mechanism (exists) | v1 rule |
|---|---|---|
| Code / containers | Re-dispatch `deploy-vps.yml` with `approved_rc_sha=<PRIOR_SHA>` (printed as the rollback anchor by the failed run); `rollback/*` tags name candidates | The prior SHA needs a staging receipt **≤168 h old** and an acceptance receipt; if expired, re-run `deploy-staging.yml` (and acceptance) first. Never bypass. `PRIOR_SHA` is the host checkout, so confirm the per-service runtime SHAs from the last production receipt before choosing the anchor. |
| Database | No down mode. Options: the in-file rollback block, or restore the Neon snapshot/branch (loses writes since the snapshot) | R3 migration PRs record the Neon snapshot/branch id and rollback SQL at G0 (CP-before). Expand/contract migrations so code rollback never needs schema rollback within the observation window. |
| Mobile / OTA | `mira-mobile/scripts/ota-rollback.mjs`, `ota-release.yml promote` re-points the signed manifest; native via `mobile-release-distribute.yml` | Roll back by promoting the previous signed manifest; the handset-evidence job applies to the rollback too. |
| Docs | `docs/runbooks/hubv3-rollback.md` (stale) | REPAIR-2: `docs/runbooks/rollback.md` with the real inputs and the receipt-refresh rule. |
| Drill | None recorded | One drill before v1 is declared adopted: deploy the **previous** RC to staging, run acceptance, then exercise `deploy-vps.yml` `authorize-source` against it with `services` set to the smallest safe target, and record the run ids. A receipt-only staging drill does not count. |

### 3.8 Failure → regression workflow

1. **Detect**: canary issue, smoke alert, Telegram heartbeat, user report, eval regression.
2. **Record**: one issue labelled **`incident`** (ADD-2) whose body carries fixed fields the metrics
   script can parse: `first_seen:`, `deploy_sha:` (from the latest `production-receipt-*` or
   `/api/version`), `impact:`, `restored_at:`, `restoring_action:` (deploy SHA / Doppler change /
   provider recovery / none). Canary-opened `*-incident` issues get the `incident` label added rather
   than a second issue; `docs/incidents/` stays for narrative RCAs.
3. **Restore**: §3.6 or §3.7, or an operational action (config, provider) recorded in `restoring_action:`.
4. **Regression disposition** (required to close the issue), one of: `new-test:<path>` (docstring
   cites the issue), `existing-coverage:<path>`, `guard:<workflow/hook>`, `eval-fixture:<path>`
   (promote the active-learning draft rather than duplicate), or `external-cause:<reason>` (provider
   outage with no code change). The disposition is a comment on the issue.
5. **Rule**: second occurrence of the same class = a new rule or guard, not only a test (Cluster Law 6).

### 3.9 Branch and WIP policy

- One branch per slice. Target: merged or closed within **5 working days**; a draft older than
  **14 days** is rebased and re-scoped or closed with a note on its issue. Baseline: 40 open, oldest
  2026-09-13.
- Stacked PRs receive `ci.yml` but not the other required contexts; rebase onto `main` before review.
- Rebase onto `origin/main` before requesting Codex review; strict up-to-date voids a GREEN otherwise.

### 3.10 Security and safety integration (NIST SSDF + IEC 62443-4-1, mapped to what exists)

Only existing controls are listed as satisfied; "Enforced" means a workflow, branch rule, or runtime
check fails on violation; hooks are **harness-scoped** (Claude Code sessions only) and are listed as
such. Nothing here introduces a new platform.

| SSDF | 62443-4-1 | Control today | Status | v1 action |
|---|---|---|---|---|
| PO.1 / PO.3 | SM, SR | `.claude/rules/security-boundaries.md`, Doppler-only secrets, env separation (`docs/environments.md`), `prod-guard.sh` | Doctrine + harness hook | Keep; this document becomes the SM index |
| PS.1 | SM | Branch protection (strict, admins enforced, no force-push); `git-state-guard.sh`, `rm-guard.sh` | Enforced (GitHub) / harness-scoped (hooks, overridable) | Tighten ruleset to match the classic layer (CONNECT-3) |
| PS.2 | SI | gitleaks pre-commit (fail-open locally); `secrets-scan` CI job (**not gated**) | Partial | CONNECT-4 |
| PS.3 | SUM | `version-tag.yml` tags (unprotected) + best-effort Release; receipts record built vs running image ids for selected services | Partial | Keep; SBOM/SLSA/signing deferred (out of v1 by the brief) |
| PW.1 | SD | `docs/mira-ignition-secure-architecture.md`, `fieldbus-readonly.md`, read-only OT tests (`test_drive_packs_readonly.py`, `test_no_customer_write_paths.py`); CLF threat/privacy analysis (`docs/specs/continuous-learning-factory/threat-privacy.md`, scoped) | Doctrine + tests | Keep; R3 routes these paths to `security-reviewer`/`safety-reviewer`; product-wide threat model deferred |
| PW.4 / SUM | SUM | Dependabot (pip ×4 dirs, npm `mira-web`, docker, actions); `dependency-check.yml` pip-audit ×3 roots weekly, `\|\| true`, parse errors swallowed | Partial | REPAIR-4 |
| PW.6 | SI, SVV | Semgrep ERROR (required), Bandit high (required), Trivy image scan (not gated), `.ast-grep-rules/` 5 rules (never executed), AI review (comment-only) | Mixed | CONNECT-4, CONNECT-5 |
| PW.7 | SVV | `security-reviewer` / `safety-reviewer` agents; Codex exact-head review; trusted-base lifecycle guard with isolated status posting | Doctrine / enforced-as-status | R3 makes specialist findings mandatory (§3.3 G1); REPAIR-11 fixes the safety-reviewer text |
| PW.9 | SD | RLS on tenant tables; `knowledge_entries` read law (explicit predicate on a BYPASSRLS pool, by design); `TenantScopedSession` (regex: query mentions `tenant_id`, fixed table set); `kg-write-guard.yml` (runs on PRs, allowlisted, **not** in `ci-gate`); RBAC deny-grid on BRAVO (outside CI) | Runtime-enforced where RLS applies; detection elsewhere | Keep; G4 tenant-family row links the BRAVO run |
| RV.1 / RV.2 | DM | Canaries → issues (probe failures do not page); `dependency-check.yml` → `security` issue (conditional) | Partial | ADD-2 unifies incident records; DOC-1 `SECURITY.md` with intake channel, triage owner, response expectation |
| RV.3 | DM | Cluster Laws 6/7; `docs/incidents/`; defect-workflow | Doctrine | §3.8 step 5 |
| — | SG | Customer-facing security guidance for the Ignition module | Absent | Out of v1; tracked in the secure-architecture doc |

**Existing controls to credit, not rebuild:** production credential separation (`deploy-vps.yml`
DB job vs SSH job), receipt provenance verification (`deploy-vps.yml:185-226`), co-host staging
isolation checks (`deploy-staging.yml:249-259`), OTA signatures + protected-environment verification +
physical-handset evidence (`ota-release.yml:579-727`), OT serial-bus hazard handling
(`fieldbus-readonly.md`). **Safety (product) controls** are part of R3 and unchanged: `SAFETY_KEYWORDS`
phrase tests, hazard banner tests (`mira-bots/tests/test_safety_flag_banner.py`), the 2026-09-27
owner decision that safety flags never withhold an answer, and the S0–S5 consequence scale.

### 3.11 Metrics — DORA plus MIRA-specific

Definitions are written around **deployment events** and **explicit incident records**, not tags
(tags are merge events) and not SHA de-duplication alone (that erases restores). ADD-3 is one
read-only script, `tools/dora.py`, whose inputs are: `gh api` run history for `deploy-vps.yml` and
`deploy-staging.yml`, receipt artifacts (while retained, 90 d), merged PR data, `incident` issues
(ADD-2 fields), the local `.planning/review-costs.jsonl` **if present** (reported with a completeness
flag), and the committed YAML registries. Missing data is reported as missing, never interpolated.

| Metric | Definition for MIRA | Source |
|---|---|---|
| Deployment frequency | Successful `deploy-vps.yml` runs per week (events, with `services` scope); separately: distinct `approved_rc_sha` values and failed attempts that reached the swap step | Run history; production receipts |
| Lead time for changes | PR `mergedAt` → first production receipt whose deployed Hub/Web SHA is a descendant of the merge commit (median, p90) for the component the PR touched; reported only where the receipt is still retained; reverted changes excluded and counted separately | Merged PRs; receipts; `git merge-base --is-ancestor` |
| Change failure rate | `incident` issues whose `deploy_sha:` names a deployment ÷ deployments in the period; `external-cause` dispositions reported separately, not in the numerator | ADD-2 fields; run history |
| Time to restore | `first_seen:` → `restored_at:` from the incident record, whatever the restoring action | ADD-2 fields |
| **MIRA: review rounds** | Codex `review_iteration` to GREEN per PR (ledger); cheap-lane runs per PR to a `verdict: PASS` or fully dispositioned round | `scripts/adversarial-review-ledger.mjs`; `[CHEAP-REVIEW]` comments |
| **MIRA: review cost** | USD per PR from posted `cost_usd:` fields; local ledger totals shown with a host/completeness note | `[CHEAP-REVIEW]` comments; `.planning/review-costs.jsonl` |
| **MIRA: eval pass rate** | Pass count ÷ fixture count for the named suite, with suite id, fixture denominator (currently 67 files), source SHA and judge mode recorded; compare like with like | `tests/eval/runs/*.md` |
| **MIRA: staging acceptance** | Per **deployment generation** (staging receipt run id): acceptance receipt PASS / FAIL / SUPERSEDED / skipped-capture / infra | `acceptance-receipt-<sha>` (CONNECT-1) |
| **MIRA: regression promotion** | Closed `incident` issues by disposition type (`new-test`, `existing-coverage`, `guard`, `eval-fixture`, `external-cause`) | Issue comments |
| **MIRA: WIP** | Open PR count, median age, drafts > 14 days | `gh pr list` |
| **MIRA: capability closure** | Capabilities per state; `review_by` dates within 14 days | `tools/capability_closure.py` |

Baseline captured 2026-10-03: **PR open→merge** interval median 0.51 h, mean 2.55 h (n=30 merged
PRs — not the merge→production lead time, which cannot yet be joined); prod deploy runs over 17
days: 7 success / 22 failure / 1 skipped, 4 distinct successful days; staging deploy runs 29/30
success; 20 releases in <2 days. Change failure rate and MTTR: not derivable until ADD-2 exists.

### 3.12 Responsibility split

| Responsibility | Mike | Claude (implementer sessions) | Codex (reviewer) | CI / automation |
|---|---|---|---|---|
| Risk-class disputes, R3 merges, prod dispatch authorization, ADR acceptance, exceptions, open decisions | **Owner** | proposes | may object | — |
| PRD/acceptance criteria, ADR drafts, claims, CP-before records | reviews | **does** | — | — |
| Implement, red→green tests, eval fixtures, hazard ledger, PR body | — | **does** | never edits the branch | — |
| Cheap lane run to a clean verdict | — | **runs** | — | posts `[CHEAP-REVIEW]` |
| Independent exact-head review, evidence-backed findings, GREEN bound to SHA + body | authorizes agentic rounds | remediates findings | **does (read-only)** | ledger in PR comments |
| Required contexts, SAST, license, architecture contracts, capability-closure validity, lifecycle guard, staging gate | — | fixes red | — | **decides** (branch protection) |
| Staging deploy, acceptance, migrations dry-run/apply | authorizes `apply` to prod | dispatches staging; assembles the prod evidence packet | — | receipts, drift checks, acceptance receipt |
| Production deploy | **dispatches** or links an authorizing comment | prepares exact SHA + packet | — | `authorize-source` enforces |
| Post-deploy smoke, observation, incident filing, regression disposition | triages | dispatches smoke, files `incident`, writes the disposition | — | canaries open/update issues |
| Metrics | reads | runs `tools/dora.py` weekly, pastes into `wiki/hot.md` | — | — |

### 3.13 Exceptions and escalation

1. **Exceptions are recorded, never silent.** A waived gate is recorded as a PR **comment**
   (`Exception: <gate> — <reason> — approved by Mike <link>`), not a body edit, so a body-bound
   attestation is not invalidated. Label bypasses exist only where a workflow already defines one
   (`shared-line-ok` for the Shared-Line Guard; hold labels); the lifecycle guard has none and v1 adds
   none.
2. **Who may grant**: Mike, in a GitHub comment. Standing authorizations (Appendix A) are not re-asked.
3. **Escalate to Mike when**: a risk-class disagreement survives one exchange; Codex reaches 3 rounds;
   a required context is red for a reason outside the PR (compare against `main` head and report,
   never bypass); an `incident` is open longer than 4 h; a `review_by` expiry is within 14 days; a
   rollback would require a schema rollback.
4. **Never**: merge through red required checks, dispatch prod without a staging receipt and
   acceptance receipt, edit another session's branch, simulate a review, rewrite shared history, run
   prod SQL from a session, or weaken a gate to pass it.
5. **Carve-outs expire.** Any time-boxed exception carries an end date and is deleted on that date or
   re-decided in writing.

---

## 4. REUSE / CONNECT / REPAIR / ADD matrix

**REUSE** = satisfies the requirement as-is (limitations stated). **CONNECT** = exists but is not
wired to the step that should consume it. **REPAIR** = exists and is wrong, stale, or fails open.
**ADD** = does not exist and the requirement is genuinely unenforced; every ADD is small.

| Lifecycle requirement | Existing mechanism | Verdict | Action |
|---|---|---|---|
| Intake + triage | GitHub Issues, 5 triage labels, `gh` conventions | REUSE | — |
| Defect procedure | `defect-workflow` skill + handbook §14 | REUSE | v1 cites it as the per-defect procedure |
| Requirement record with acceptance criteria | `docs/prd/` files and `PRD:` issues (criteria present in 4 files, unstructured elsewhere) | REUSE + DOC | Numbered criteria for new behavior; criterion → evidence line in the PR body; no literal-heading rule |
| Architecture decision | `docs/adr/` MADR, convergence gates, `CU-*.md` | REUSE + REPAIR | REPAIR-5: regenerate `docs/adr/README.md` (39 ADRs; Proposed vs Accepted) |
| Risk classification | "substantial" (binary); lifecycle-guard control-path list; gate7 escalation reasons | ADD (tiny) | ADD-1: `Risk:` line in the PR template; human-assigned; no automation in v1 |
| Work claim | `[WORK-CLAIM]` protocol; PR-as-claim | REUSE | — |
| Short-lived branches | session-discipline, strict up-to-date | REUSE + DOC | §3.9 policy + metric |
| Local gates | ruff/pytest, `.githooks/pre-commit`, Stop hook | REUSE | Convenience layer; CI is the gate |
| Unit/contract/architecture tests | `ci.yml` 16 gated jobs | REUSE | — |
| gitleaks / Trivy in CI | `secrets-scan`, `docker-build-check` outside `ci-gate` | CONNECT | CONNECT-4: add both to `needs`; `require_success secrets-scan`; `docker-build-check` gated with the same `code == true` conditional as `test-unit` (success\|skipped on docs-only) |
| Broad offline suite / SimLab / OCR | `test-eval-offline`, `simlab-gate`, `ocr-recall-gate` (advisory by design) | REUSE (advisory) | Open decision 3 before any promotion |
| Static analysis | Semgrep/Bandit (gated); `.ast-grep-rules/` (never run); AI review (comment) | CONNECT | CONNECT-5: run `sg scan` in the static step, **capture output into the existing comment, never fail the step** (so the dependent AI-review job still runs); gate later if findings warrant |
| Dependency hygiene | Dependabot (partial); pip-audit 3 roots, `\|\| true`, parse errors swallowed | REPAIR | REPAIR-4: extend Dependabot roots; capture each scanner's exit status separately, fail on **scanner error**, and still reach the issue-creation step on **vulnerabilities**; add `bun audit` for Hub/mobile |
| Eval / grounding regression | `deepeval-ci.yml`, `tests/eval/`, `staging-gate.yml`, nightly VPS evals | REUSE | `eval-replay-gate.yml` stays inert until the replay store exists |
| Property-based tests | hypothesis in 2 files | REUSE + DOC | Required for new state machines/parsers in R2/R3 |
| Mutation check | manual step in `defect-workflow` | REUSE (manual) | Scoped to defect tests; no tooling in v1 |
| Specialist review | `.claude/agents/{safety,security,conversation}-reviewer` | REUSE + REPAIR | Findings (not attendance) required per class; REPAIR-11: safety-reviewer text vs the 2026-09-27 decision |
| Cheap review lane | `tools/gate7_review.py --paid --post` | REPAIR | REPAIR-6: re-read the head immediately before posting; on drift post `verdict: STALE` naming both SHAs; document exit-code semantics. (Metadata/diff snapshot immutability and a mechanical merge consumer remain out of scope: the consumer is the merger reading `head:`/`verdict:`.) |
| Independent exact-head review | `adversarial-review-trusted.sh` + ledger | REUSE | Trigger rule per class; open decision 1 |
| Review envelopes | `[CHEAP-REVIEW]` (G1 artifact), `[CODEX-ADVERSARIAL-REVIEW] GREEN` (G2 artifact where required; **always** for guarded paths) | DOC | `[CODEX-REVIEW] PASS` wording retired (REPAIR-3) |
| Merge gate | branch protection (6 contexts, strict, admins); `gh pr merge --match-head-commit` | REUSE + CONNECT | CONNECT-2: require `Legacy UI Lifecycle Guard` once a non-spoofable status source exists (#3657); CONNECT-3: reconcile ruleset 17097034 |
| Human approval on merge | 0 required reviews; standing authority | REUSE | Keep 0 (open decision 2) |
| Conventional Commit | `next_version.py` patch fallback | REUSE (doctrine) | Checked by the merger; no commitlint in v1 |
| Version + rollback address | `version-tag.yml` | REUSE | Tags = addressability; CP-before for architecture/data stays manual |
| Staging deploy exact-SHA | `deploy-staging.yml` + receipt | REUSE | — |
| Staging acceptance → prod | `retrieval-acceptance.yml` artifact (no SHA/run identity) | CONNECT (two-step) | CONNECT-1a: acceptance job writes `acceptance-receipt-<sha>` (`schema`, pinned `gitSha`, acceptance run id, triggering staging run id, per-scenario verdicts, capture status, `ran_at`; 90 d). CONNECT-1b: `deploy-vps.yml` `authorize-source` requires it (same provenance pattern as the staging receipt) **when `mira-hub` is in `services`**, age ≤168 h, all verdicts PASS, none SUPERSEDED; same-SHA redeploy may reuse it; expired → re-run acceptance via dispatch (fail closed) |
| Acceptance SHA binding | verdict re-read warns + exit 0 on fetch failure | REPAIR | REPAIR-7: fail closed |
| PR association for the Staging Gate check | first-associated-PR fallback | REPAIR | REPAIR-8: require exactly one **merged** PR into `main` whose `merge_commit_sha` matches; otherwise STOP |
| Migrations dev→staging→prod | `migration-verify.yml`, `apply-migrations.yml`, `apply-ingest-migrations.yml`, prod drift job | REUSE (with limits: filename-level drift; content check has fail-open branches; ordering is doctrine) | Rollback SQL/snapshot id at G0 for R3 |
| Production deploy | `deploy-vps.yml` | REUSE | — |
| Hotfix | stale doc path | DOC | §3.6 |
| Rollback | tags + redeploy; stale runbook; no drill | REPAIR + DOC | REPAIR-2 + drill (§3.7) |
| Release holds | `RELEASE_TRAIN.yaml` blockers | DOC now, CONNECT later | G3 row (manual) |
| Production observation | canaries, smoke (dispatchable), heartbeat | REUSE + DOC | G4 requires an explicit post-deploy smoke dispatch |
| Incident record | per-canary labels; `docs/incidents/` | ADD (labels + fields) | ADD-2: `incident`, `hotfix` labels; fixed body fields; canary workflows add the label |
| Failure → regression | tests citing `#NNNN`, active-learning drafts, defect-workflow | REUSE + DOC | §3.8 disposition types |
| Capability closure / release identity | `CAPABILITY_CLOSURE.yaml`, `RELEASE_TRAIN.yaml` | REUSE | G4 evidence |
| Metrics | none | ADD (read-only) | ADD-3: `tools/dora.py` + test, run by hand weekly |
| Prod mutation guard | `prod-guard.sh` | REPAIR | REPAIR-9: add the OVH host IP/hostname (not a bare `ubuntu@`); add the prod Neon host pattern for `psql`; keep staging co-host excluded |
| Privileged auto-fix | `code-review.yml` `pull_request_target` path | REPAIR (security) | REPAIR-10: **delete the `auto-fix` job** (the human `/autofix-pr` path remains); if kept, it must run the trusted base's script against the PR diff and push through a separate, candidate-scoped token |
| Governance text drift | D1–D22 | REPAIR | REPAIR-3 (docs), REPAIR-12 (`enforcement-audit.yml` push step → PR or removal), REPAIR-13 (license allowlist in CI to match the hard constraint) |
| Vulnerability intake | `security` issues from the audit | DOC | DOC-1: `SECURITY.md` — intake channel, triage owner, response expectation, supported versions statement |

---

## 5. Minimal changes required to adopt v1 (nothing here is implemented)

Every item is a normal PR through the gates above; items touching `.github/workflows/`,
`tools/hooks/`, review producers, or `.claude/` are **R3** and need Mike's merge.

| Id | Change | Files | Class | Size |
|---|---|---|---|---|
| DOC-0 | Adopt this document; pointer lines in `CLAUDE.md` § Release / PR Workflow and `docs/environments.md` | this file + 2 lines | R3 (governance) | S |
| DOC-1 | `SECURITY.md` | new file | R3 (governance) | XS |
| REPAIR-3 | Docs drift D1–D8, D10–D15, D17–D19, D21–D22; delete the expired carve-out; PR template: add `Risk:`, drop the CHANGELOG checkbox (= ADD-1) | ~10 docs + template | R3 (governance, docs-only) | M |
| REPAIR-11 | `safety-reviewer.md` line 15 aligned with the 2026-09-27 decision | `.claude/agents/safety-reviewer.md` | R3 | XS |
| REPAIR-12 | `enforcement-audit.yml` nightly direct push → open a PR or remove | `.github/workflows/enforcement-audit.yml` | R3 | XS |
| REPAIR-13 | `license-check` → `--allow-only="Apache-2.0;MIT"` (plus explicitly justified exceptions) | `.github/workflows/ci.yml` | R3 | XS |
| ADD-2 | Labels `incident`, `hotfix`; fixed body fields documented in `docs/agents/issue-tracker.md`; `--label incident` in the two canary workflows that open issues | labels; `provider-health-canary.yml`, `oauth-redirect-canary.yml`; one doc | R3 | XS |
| REPAIR-10 | Remove (or re-architect) the `pull_request_target` auto-fix job | `.github/workflows/code-review.yml` | R3 (security) | S |
| REPAIR-9 | `prod-guard.sh` host and DB patterns + tests | `tools/hooks/prod-guard.sh`, `tests/` | R3 | XS |
| CONNECT-1a | Acceptance receipt producer step | `.github/workflows/retrieval-acceptance.yml`, small writer in `tools/qa/` + test | R3 | S |
| REPAIR-7 | Acceptance verdict re-read fails closed | `.github/workflows/retrieval-acceptance.yml` | R3 | XS |
| CONNECT-1b | `deploy-vps.yml` consumes the acceptance receipt (scope, age, reuse, fail-closed rules in §4) | `.github/workflows/deploy-vps.yml`, `tools/staging_receipt.py` (verify mode) + test | R3 | S |
| REPAIR-8 | Exact merged-PR match only | `.github/workflows/deploy-vps.yml` | R3 | XS |
| REPAIR-6 | Cheap lane head re-read before posting; `STALE` verdict on drift; exit-code docs | `tools/gate7_review.py`, `tests/test_gate7_review.py`, `docs/review-cheap-lane.md` | R3 (review producer) | S |
| CONNECT-4 | `secrets-scan` + `docker-build-check` into `ci-gate` with correct skip semantics | `.github/workflows/ci.yml` | R3 | XS |
| CONNECT-5 | `sg scan` output captured into the static-analysis comment | `.github/workflows/code-review.yml` | R3 | XS |
| REPAIR-4 | Dependabot roots; pip-audit status handling; `bun audit` | `.github/dependabot.yml`, `dependency-check.yml` | R3 | S |
| REPAIR-2 | `docs/runbooks/rollback.md` + one authorization-exercising drill (run ids recorded here) | docs + two dispatches | R0 docs + operation | S |
| REPAIR-5 | ADR index regeneration | `docs/adr/README.md` | R0 | S |
| ADD-3 | `tools/dora.py` + `tests/test_dora.py` (read-only; inputs and missing-data behavior per §3.11) | 2 files | R1 | S–M |
| CONNECT-2/3 | Required `Legacy UI Lifecycle Guard` once non-spoofable (#3657); reconcile ruleset 17097034 | GitHub settings (Mike) | Admin | XS |

New code: one metrics script with tests, one acceptance-receipt writer/verifier with tests, a
few-line change to `gate7_review.py` with a test. Everything else is YAML lines, labels, or prose.

---

## 6. Things we should explicitly NOT build

| Not this | Because this exists |
|---|---|
| A ticketing system, mission registry, or "readiness document" per slice | Issues + `PRD:` threads + `[WORK-CLAIM]` + the PR itself |
| A PRD for every defect | `defect-workflow` already records intake, contracts and red tests; the PR template keeps its bug-fix exception |
| A second CI aggregator or "SDLC gate" status | `ci-gate`; add jobs to its `require_success` list |
| A new review platform or reviewer fleet | Cheap lane + `adversarial-review-trusted.sh` + 9 read-only agent roles |
| Automated risk scoring in v1 | One human-written line; path signals are aids; revisit with 30 days of data |
| Mutation-testing tooling in v1 | Manual check exists; `mira-web` full suite is non-deterministic per `ci.yml` |
| A second traceability registry | `contract-index.yaml`, `CAPABILITY_CLOSURE.yaml`, `RELEASE_TRAIN.yaml`, `REGISTRY.yaml` already exist; v1 only says which owns which decision |
| Required human approvals in branch protection | Mike approving Mike's agents; independence comes from Codex |
| A rollback workflow | Rollback is a forward deploy of a prior SHA through the same gates |
| commitlint / PR-title bot | Nice-to-have; the only cost of a bad subject is a wrong bump |
| SBOM / SLSA provenance / signed images / EOL policy | Deferred by the brief; receipts' image ids are the v2 hook |
| Dashboards (Grafana/Prometheus) | `mira-ops/` does not exist; a weekly table in `wiki/hot.md` suffices at this scale |
| Manual VERSION/CHANGELOG bookkeeping | Shared-Line Guard + auto tags replaced it for a measured reason |
| A separate staging-acceptance harness | `retrieval-acceptance.yml`; give it a receipt and a consumer |
| Another safety taxonomy | S0–S5 and the safety contracts stay |
| A universal session-closeout report | Protocol §9 stays for unresolved ownership; merged+deployed PRs are closed by their artifacts |

---

## 7. Codex's independent objections and findings

Codex ran twice, read-only, in an isolated `CODEX_HOME` against `origin/main` @ `32bcaa67e`
(`gpt-6.1-sol`; round 1 ≈ $1.21). Round 1 challenged the owner's proposal before this document
existed; round 2 challenged the complete first draft of this document. Every item below was
re-verified by reading the cited lines; items that did not verify are omitted. Codex's sandbox could
not reach the GitHub API, so branch protection, labels and run history were read live by Claude.

### 7.1 Round 1 (challenge of the proposal)

| # | Finding | Verified | Disposition |
|---|---|---|---|
| 1 | Cheap lane lacks an exact-head guarantee: separate head/diff queries, no re-read before posting, exit 0 on every outcome | ✔ | REPAIR-6 for the head re-read; §1.2/G-22 state exit-code semantics; snapshot immutability and a mechanical merge consumer are **not** claimed |
| 2 | Staging deployment is treated as staging acceptance; prod never consumes the retrieval verdict | ✔ | CONNECT-1a/1b (receipt first, then consumer) |
| 3 | Release/rollback is not a demonstrated recovery contract; 168 h receipt freshness applies to old candidates | ✔ | §3.7 (168 h, receipt refresh, authorization-exercising drill) |
| 4 | Three incompatible review envelopes | ✔ | §4 row; guarded paths always need the body-bound Codex GREEN regardless of class |
| 5 | Security trust-boundary defects (privileged auto-fix; stale prod-guard host) | ✔ | REPAIR-10 (delete preferred), REPAIR-9; sequenced second in §8 |
| 6 | A green check is not a verdict (scope-skips, synthetic HOLD, excluded suites) | ✔ | §1.3 list; CONNECT-4; DoD item 6; acceptance receipt carries per-scenario verdicts |
| 7 | `RELEASE_TRAIN` blockers stop a label, not a deploy | ✔ | G3 row (manual) now present; CONNECT later |
| 8 | Exact source SHA ≠ identical binary | ✔ | §1.4 and §3.7 narrowed |
| 9 | DORA needs joins and definitions; tags are merge events | ✔ | §3.11 rewritten around deployment events and incident fields |
| 10 | Ceremony and R0 naming collide with existing practice | ✔ | CP-before/after naming; PRD exception kept; Codex-always only proposed for R3 (open decision 1) |
| 11 | R0 must exclude all control-plane paths | ✔ | §3.2 governance floor adopted from the lifecycle guard's list; principle 4 |
| 12–13 | R2 too broad; R3 families need different evidence | ✔ | Tenant/safety moved to R3; family rows in G3/G4; v1.1 may split |
| 14 | Don't demand paid + agentic on every PR | ✔ | Cheap lane every PR (current mandate); Codex per class/decision |
| 15 | Body edits invalidate attestations | ✔ | Exceptions and closeouts are comments |
| 16 | Observation for undeployed changes is meaningless | ✔ | Principle 3; G3/G4 apply only to shipped changes; DoD state (c) |
| 17 | Evidence retention differs | ✔ | §3.11 reports missing data; incident records hold the durable fields |
| 18 | `dependency-check.yml` swallows failures | ✔ | REPAIR-4 (status per scanner, issue step preserved) |
| 19 | Dry-run migrations execute a ledger bootstrap | ✔ | D18, accepted |
| 20 | Nightly direct push to `main` | ✔ | REPAIR-12 |
| 21 | License denylist vs allowlist | ✔ | REPAIR-13 tightens CI; the Apache/MIT constraint is not softened |
| 22 | No SBOM / disclosure policy / vuln SLA / product-wide threat model | ✔ | DOC-1 `SECURITY.md`; SBOM/SLSA/EOL deferred by the brief |

### 7.2 Round 2 (challenge of the first draft of this document)

| # | Finding | Verified | Disposition |
|---|---|---|---|
| F1 | Draft claimed Conventional Commit "hard-fails post-merge"; `next_version.py` returns patch for an unparseable subject | ✔ | Corrected throughout (§1.3, G2, §4) |
| F2 | Acceptance criteria do exist in some PRDs and the template; the gap is consumption | ✔ | §1.1, G-03, §3.4 rewritten; literal-heading rule dropped |
| F3 | Lifecycle doctrine exists (fragmented), not absent | ✔ | §0, G-01 rewritten; `defect-workflow` and handbook cited as the per-defect procedure |
| F4–F7 | Counts: 39 ADRs, 16/21 PRDs, 67 fixtures, 5 ast-grep rules | ✔ | Corrected |
| F8 | `RELEASE_TRAIN` CI validates without `--drift` | ✔ | §1.4 corrected |
| F9 | Migration drift is filename-level; content check has fail-open branches | ✔ | §1.4, §4 corrected |
| F10 | Runtime `gitSha` identity is per selected target | ✔ | §1.4 corrected |
| F11 | Acceptance is an asynchronous measurement; capture skips historical deploys | ✔ | §1.4 corrected |
| F12 | `defect-workflow` already covers production incidents | ✔ | §1.4 corrected; §3.8 builds on it |
| F13 | Stacked PRs do get `ci.yml` | ✔ | §3.9 corrected |
| F14 | `beta-probe-prod.yml` "Mike-only" is doctrine | ✔ | §1.4 corrected |
| R0 loophole | Implementer-written R0 could skip review for `.claude/**`, agent instructions, guard tests, registries, review producers; cheap lane dropped for R0 against the owner mandate | ✔ | Principle 4; governance floor in §3.2; cheap lane every PR |
| CONNECT-1 | Retrieval JSON has no SHA/run identity; scope, same-SHA reuse, expiry undefined | ✔ | Split into CONNECT-1a (receipt) and 1b (consumer) with rules in §4 |
| CONNECT-4 | Unconditional `require_success docker-build-check` would fail docs-only PRs | ✔ | Gated with the `test-unit` conditional pattern |
| CONNECT-5 | Bare `sg scan` failure would skip the AI-review job | ✔ | Capture into the comment, never fail the step |
| REPAIR-4 | Removing `\|\| true` alone prevents issue creation | ✔ | Status per scanner; issue step preserved |
| REPAIR-8 | Require a uniquely matching **merged** PR, not any object | ✔ | Adopted |
| REPAIR-9 | `ubuntu@` is a username, not a prod identity | ✔ | Host IP/hostname + Neon pattern |
| REPAIR-10 | Moving execution to the base checkout changes what the script reads/pushes | ✔ | Delete preferred |
| Rollback | 90 days vs the 168 h authorization limit; receipt-only drill insufficient | ✔ | §3.7 corrected |
| G0–G4 | Branch-before-G0 ordering; `git log` test without fetch; auto tags ≠ baseline; PRD for defects; full root pytest; "no new findings" ≠ PASS; attendance ≠ findings; non-atomic merge; optional R2 Codex vs unconditional rows; hotfix deferral vs guarded attestation; ingest migrations; "Mike authorizes" inferred; blocker row missing; push-time smoke ≠ post-deploy; issue updates missed; closure commits vs exact SHA; prod evidence for governance docs | ✔ | All adopted in §3.3–§3.6 |
| Metrics | SHA dedup erases restores; labels don't attribute SHAs; MTTR needs explicit timestamps; cost ledger is local; eval denominator stale; same-SHA staging dispatches inflate; "PR lead time" mislabelled | ✔ | §3.11 rewritten; baseline relabelled |
| Security claims | PS.1/PS.3 "Enforced" overstated; PW.9 `TenantScopedSession` is a regex; RV.1 probe failures don't page; "no label bypass" vs `shared-line-ok`; safety-reviewer text conflicts with the owner decision | ✔ | §3.10 narrowed; §3.13 corrected; REPAIR-11 added |
| Scope | `SECURITY.md`, D20 and D16 repairs absent from §5; code-size estimate omitted tests and the receipt producer | ✔ | DOC-1, REPAIR-12, REPAIR-13 added; estimate corrected |
| Bureaucracy | Literal heading rule, defect PRDs, universal full pytest, universal mutation assertion, `review_by` forecasting gate, universal R3 closeout, prod evidence for undeployed changes, mandatory new test per provider incident | ✔ | All deleted or scoped (§3.3–§3.8) |

**Declined / held as open decisions:** Codex's view that automatic Codex review for R3 contradicts
the 2026-10-03 decision is recorded as open decision 1 rather than resolved either way. Codex's
suggestion to credit the existing doctrine as sufficient lifecycle definition is partly declined:
the doctrine exists but no document maps the gates to artifacts, which is what §3 adds.

---

## 8. Recommended implementation sequence (after approval; nothing started)

| Step | Change | Why this order |
|---|---|---|
| 1 | DOC-0, DOC-1, REPAIR-3, REPAIR-11 (adopt; fix 22 drift items; `SECURITY.md`; safety-reviewer text; template `Risk:` + drop CHANGELOG checkbox) | Stops new work being built on false descriptions; no behavior change |
| 2 | REPAIR-10, REPAIR-9, REPAIR-12 (privileged auto-fix, prod-guard host, nightly direct push) | Security/trust-boundary defects; independent of the SDLC decision |
| 3 | ADD-2 labels + canary label lines + issue-tracker doc | Unblocks CFR/MTTR measurement immediately |
| 4 | CONNECT-1a + REPAIR-7 (acceptance receipt producer; fail-closed re-read) | Produces the artifact before anything consumes it; verify on the next real RC |
| 5 | CONNECT-1b + REPAIR-8 (prod consumes the acceptance receipt; exact merged-PR match) | Closes the largest evidence hole; verify on the following RC |
| 6 | REPAIR-6 (cheap lane head re-read) | Makes the required review SHA-honest |
| 7 | CONNECT-4 + CONNECT-5 + REPAIR-13 (gitleaks/Trivy gated with skip semantics; `sg scan` captured; license allowlist) | After a week of observed green runs on `main` for the two jobs |
| 8 | REPAIR-4 (dependency coverage) | Expect Dependabot volume; schedule after step 7 |
| 9 | REPAIR-2 rollback runbook + authorization-exercising drill | Needs CONNECT-1b so the drill exercises the real gate |
| 10 | ADD-3 `tools/dora.py`, first baseline into `wiki/hot.md` | Needs 2+ weeks of `incident` records |
| 11 | CONNECT-2/3 branch-protection reconciliation (Mike) | Blocked on #3657 |
| 12 | 30-day review of `Risk:` lines and metrics → v1.1 (R3 sub-profiles, class hints, `test-eval-offline`, `eval-replay-gate`) | Data before more rules |

**Open decisions for Mike (v1 cannot settle these):**
1. Codex review **always** for R3 (proposed) vs. the current "only when I say so" for everything.
2. Keep required approvals at 0 (proposed) or require 1 approval as a visible human gate.
3. Whether `test-eval-offline` should ever become merge-blocking (advisory by design today).
4. Whether pure R0 (inert docs) may skip the cheap lane (v1 keeps the every-PR mandate as written).
5. Whether to delete the `auto-fix` job outright (proposed) or re-architect it.

---

## Appendix A — Standing authorizations already granted (not re-asked)

- Merge on independent-review PASS + green required contexts (2026-09-19/20).
- Codex review after cheap-lane saturation (2026-10-03).
- Post-cap Codex rounds after main-merge with `ADV_REVIEW_HUMAN_AUTHORIZED=1` (2026-10-01).
- Cheap lane `gate7_review.py --paid --post` as the required review on every PR (2026-10-03).
- Safety flags never withhold an answer (2026-09-27).

## Appendix B — Reconnaissance evidence

Seven read-only recon reports (governance docs, PR-time CI, release/deploy/rollback, test/eval
architecture, requirements traceability, security overlay, metrics) plus two Codex rounds were
produced against `origin/main` @ `32bcaa67e` on 2026-10-03. Branch protection, rulesets, labels, PR
samples and run history were read live via `gh api`/`gh` CLI. Line numbers point at that SHA and
will drift; names will not.

## Appendix C — Changelog of this document

- 2026-10-03 — v1 proposal drafted (Claude); Codex round 1 (proposal) and round 2 (draft) folded in.
  Awaiting Mike.
