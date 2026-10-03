# MIRA / FactoryLM SDLC v1 — Canonical Specification

**Status:** CANONICAL SPECIFICATION v1.0, **ratified by Mike 2026-10-03** (PR #4208 at
`7eb189d822e4cd075a2ecbaaf0fdea288637df87`; implementation sequence Part B §B.3 in progress). This
document defines the rules. It implements nothing: CI, branch protection, environments, workflows,
repository security settings, staging and production are unchanged by it. Where a rule below says
"required" and Part B says the mechanism does not yet exist, the rule is the target and Part B names
the implementation step that closes the gap. Until that step lands, the rule is **doctrine**, and
this document says so in place.
**Version:** v1.0 (2026-10-03) · **Owner:** Mike · **Authors:** Claude (specification), Codex
(adversarial review of #4208 and of the evaluation #4210) · **Fact base:** `origin/main` @
`a54c4c88bd4f349c14884ff5701375f644bd7c31`; live GitHub settings read 2026-10-03.
**History:** proposal (PR #4208, two Codex rounds) → independent evaluation (PR #4210,
`docs/architecture/mira-sdlc-v1-final-evaluation.md`, verdict **ADOPT WITH CHANGES**, Codex GREEN at
`67fc0b913`) → this canonical revision, which applies the evaluation's fifteen rule-text changes
(Appendix C traces each) and records the six owner decisions (§0.1).
**Precedence:** this document governs SDLC process. It does not override `docs/environments.md`
hard rules, `.claude/rules/*` safety/security doctrine, or Mike's explicit instructions; where it and
a live workflow disagree, the live workflow wins until changed through the process defined here.

---

## 0. Decisions and principles

### 0.1 Owner decisions encoded in v1

| # | Decision | Resolution in v1 | Where it applies |
|---|---|---|---|
| D1 | Independent exact-head Codex review for every R3 change | **YES.** Mandatory for all R3, including governance prose. | §4.3 |
| D2 | Required GitHub PR approvals | **Stay at 0 for v1.** A human approval count on every PR would be Mike approving his own agents; independence comes from the reviewer lane and deterministic checks, human intent from the production checkpoint (D6). | §3.1, §7 |
| D3 | `test-eval-offline` merge-blocking | **NO in v1.** Observe for 30 days (runtime, flake rate, false-block rate, unique failures, overlap) before any promotion decision. | §3.2, §13 |
| D4 | R0 exemption from the cheap review lane | **NO in v1.** Every PR gets the cheap lane; `changes.code == false` is a build signal, not a semantic-inertness proof. Revisit only with 30 days of `Risk:` data and the R2 mechanical floor in place. | §4.2 |
| D5 | Privileged `auto-fix` job (`pull_request_target`) | **DELETE / retired from the target architecture.** The human `/autofix-pr` path remains. | §11.2 |
| D6 | A recorded production click without identity separation | **ACCEPTED as an interim control.** It is **human deployment intent/confirmation**, never "independent approval". No `prevent_self_review` on `production` (it deadlocks a one-owner repo and already blocks `ota-production`). | §7 |

### 0.2 Principles

1. **Formalize, don't re-tool.** Every rule names the existing GitHub/Actions/Codex mechanism that
   carries it. No Jira, GitFlow, new CI platform, new agent framework, second registry, new store.
2. **A gate is passed when a named artifact exists for the exact identity that gate certifies.**
   §12 defines which identity (PR head, merge commit, deployed runtime SHA, receipt) each artifact
   proves. Prose in a PR body points at evidence; it is evidence only where this document says so
   (hazard ledger, mutation-check declaration) and then names the reader who consumes it.
3. **Two independent dimensions.** *Review risk* (R0–R3, §2) decides review and test obligations.
   *Deployment applicability* decides whether staging, production and observation stages apply
   (§1.3). A governance-only R3 change gets rigorous review and no production receipt.
4. **A risk class never waives an enforced obligation.** Branch protection, `ci-gate`, the lifecycle
   guard, the Shared-Line Guard, the cheap lane and the guarded-path Codex attestation run regardless
   of the declared class. Classes only add obligations. **Effective risk = max(declared risk,
   trusted-path floor, reviewer findings)** (§2.3).
5. **Live automation outranks doctrine.** A rule with no enforcer is labelled DOCTRINE here and is
   either connected to an enforcer (Part B) or deleted; it is never described as enforced.
6. **Claude implements, Codex reviews read-only, CI decides, Mike authorizes.** The Codex verdict is
   today authenticated as a comment posted under the **repository owner account**; its independence
   is organizational (who runs the trusted script), not a separate technical identity (§4.4).
7. **Trunk-based, short-lived.** One branch per slice from a freshly fetched `origin/main`; merged or
   closed under the WIP policy (§1.5).

---

# Part A — Normative rules

## 1. Lifecycle and state machine

### 1.1 Lifecycle

```
Issue (+PRD for new behavior, +ADR if architectural) ─ Risk class on the issue/claim ─► G0 Ready to Build
  fetch + branch off origin/main ─ implement test-first ─ relevant suites + lint ─ cheap lane clean ─► G1 Ready for Review
  required contexts green on head ─ [specialist findings] ─ [Codex exact-head GREEN] ─► G2 Ready to Merge
  SHA-conditioned merge ─ version-tag.yml tags + rollback checkpoint (automatic)
            │ (only if the change ships)
  deploy-staging(approved_rc_sha) ─ staging receipt ─ acceptance receipt (capability-bound) ─ [migrations] ─► G3 Ready for Production
  recorded human intent ─ deploy-vps(approved_rc_sha) ─ production receipt ─ explicit post-deploy smoke ─ observation window ─► G4 Closed
  (failure) ─► `incident` issue (deploy run, first-seen, restored-at) ─ regression disposition ─► new G0
```

### 1.2 States (the unit of state is the owning issue; one issue, one append-only timeline)

| State | Meaning | GitHub home (no new store) | Terminal? |
|---|---|---|---|
| `OPEN` | Issue/PR exists, G0 not passed | Issue or PR | no |
| `READY` | G0 passed | `Risk:` line on the issue/claim, copied to the PR body | no |
| `IN_REVIEW` | G1 in progress | PR checks; `[CHEAP-REVIEW]` / `[CODEX-ADVERSARIAL-REVIEW]` comments | no |
| `MERGED` (non-shipping) | G2 passed; governance/docs-only, nothing deploys | Merge commit; `v*`/`rollback/*` tags | **yes** |
| `MERGED_NOT_DEPLOYED` | G2 passed; the change ships but no release candidate (RC) has carried it to production | Comment on the owning issue naming the RC it is batched into | **no — never Done** |
| `STAGED` | Staging receipt and acceptance receipt exist for the RC SHA | `staging-receipt-<sha>`, `acceptance-receipt-<sha>` artifacts, linked from the issue | no |
| `AUTHORIZED` | Recorded human deployment intent exists for the RC (§7) | `deploy-vps.yml` dispatch (actor) + authorizing comment link | no |
| `DEPLOYED` | Production receipt exists for the RC and service set | `production-receipt-<sha>` | no |
| `DEPLOY_FAILED` | The swap step ran and may have mutated runtime without reaching a receipt | Run conclusion + restoration note on the issue | no |
| `OBSERVING` | Explicit post-deploy smoke dispatched; window running | Smoke run id on the issue | no |
| `OBSERVATION_INCOMPLETE` | A later deploy superseded the window before it elapsed | Note on the issue; evidence carried only with an explicit equivalence record | no |
| `CLOSED` | Window elapsed clean; every DoD item met | Issue closed with a final comment pointing at every artifact | **yes** |
| `FAILED_OBSERVED` | Attributable failure during the window | `incident` issue linked from the owning issue | no (until the disposition lands) |

**`MERGED_NOT_DEPLOYED` is non-terminal.** Merged code that ships is **never Done** until the RC that
carries it has a production receipt, an explicit post-deploy smoke run, and a clean observation window
(or a filed incident with a merged regression disposition). Reporting a shipping change as "done" at
merge is a process violation.

Transitions:
```
OPEN → READY → IN_REVIEW → MERGED ────────────────────────────────────────────────► CLOSED  (non-shipping)
                        → MERGED_NOT_DEPLOYED → STAGED → AUTHORIZED → DEPLOYED → OBSERVING → CLOSED
                                                                       │            ├──► OBSERVATION_INCOMPLETE → (next RC's window)
                                                                       ▼            ▼
                                                                 DEPLOY_FAILED  FAILED_OBSERVED
                                                                       └──► INCIDENT → restoring action → disposition → new OPEN (the fix)
```
The original change stays `FAILED_OBSERVED` until its disposition comment lands; it does not inherit the
fix's success. One RC may batch N issues; each issue links the shared RC artifacts, so closing one
issue says nothing about another on the same RC.

### 1.3 Deployment applicability

| Change type | Applies | Done at |
|---|---|---|
| Governance / docs / rules / specs (no runtime artifact) | G0–G2 only | `MERGED` |
| Code that ships (any service, mobile, OTA, migrations) | G0–G4 | `CLOSED` |
| Batched change | G0–G2 now; G3–G4 when its named RC deploys | `CLOSED` of that RC |

### 1.4 Definition of Ready (G0) and Definition of Done

**Ready** when: (1) a durable requirement record exists — an issue for R1+; for *new behavior* at
R2/R3 a PRD (either `docs/prd/YYYY-MM-DD-slug.md` or a `PRD:` issue) with numbered, checkable
acceptance criteria; for *defects*, the issue + contract ID(s) + the planned red test
(`.claude/skills/defect-workflow/SKILL.md` §1–§4) suffice; (2) the risk class is written on the issue or
claim and no reader disagrees (or it was escalated, §2.3); (3) R3 architecture changes have an ADR
(Proposed is acceptable; Proposed ≠ authorized) and, for convergence units, a `CU-*.md` with a
CP-before record; (4) the slice is claimed when overlap is plausible (`[WORK-CLAIM]`, protocol §2; the
PR itself counts); (5) the implementer can name the test that goes red first and, for R2, the eval case.

**Done** when, for the exact merged SHA: (1) merged through the required contexts with the review
evidence its class requires; (2) `v*` and `rollback/*` tags exist; (3) per §1.3 — non-shipping:
`MERGED`; shipping: `CLOSED` (staging receipt + acceptance receipt + production receipt + explicit smoke
run + clean window), or a filed `incident` with a merged regression disposition; (4) every acceptance
criterion is marked met with a pointer (test name, check run, screenshot path, receipt, trace id);
(5) the hazard ledger has no undispositioned row; (6) the named new tests appear in the CI log.

### 1.5 Branch and WIP policy

One branch per slice. Target: merged or closed within **5 working days**; a draft older than **14
days** is rebased and re-scoped or closed with a note on its issue. Stacked PRs receive `ci.yml` but
not every required context (`staging-gate.yml` and others filter on `branches: [main]`); they are not
merge candidates until re-based on `main`. Rebase onto `origin/main` before requesting Codex review;
strict up-to-date voids a GREEN otherwise. GitHub Merge Queue is **not used in v1** (§13).

---

## 2. Risk classification

### 2.1 Classes (review-risk dimension)

| Class | Scope | Path / content signals (existing aids) | Explicitly **not** in this class |
|---|---|---|---|
| **R0 — inert documentation** | Prose under `docs/**` and `wiki/**` that does not define process or policy; screenshots and promo assets outside guarded trees; comments; `.planning/` fragments | `ci.yml` `changes.code == false` AND not a governance-floor path | Anything in the **governance floor** (R3); any file under `mira-web/public/**` or `mira-hub/public/**` (guarded legacy trees) |
| **R1 — low-risk product** | Isolated UI copy/layout inside canonical shells; a single-module bug fix with a red→green test; new non-shared code behind an off flag; non-retrieval API additions; `tools/` scripts that run in neither CI nor deploy; test additions that do not change collection or enforcement | Code change outside every R2/R3 signal | Concurrency, idempotency, reliability or data-integrity fixes (R2 minimum — protocol §5 "substantial") |
| **R2 — behavioral / retrieval / model / data** | `mira-bots/shared/**` answer path incl. `engine.py`, `inference/router.py`, prompts, retrieval (`neon_recall.py`, `mira-hub/src/lib/manual-rag.ts`, BM25/embedding), ingest writers, KG writers, eval fixtures/graders/golden CSVs, classifier/intent, Hub notebook turn pipeline, mobile unified-shell behavior, runtime dependency bumps, concurrency/idempotency/data-integrity fixes | `deepeval-ci.yml`, `eval-replay-gate.yml`, `kg-write-guard.yml`, `beta-gate.yml`, `prompt-guard.yml`, `photo-e2e-verify.yml`, `enforcement-audit.yml` path filters | Anything that changes **who may see what** (tenant/private data) or **what is said about hazards** — R3 |
| **R3 — safety / security / auth / tenant / migration / production-control / governance** | Safety: `guardrails.py`, `SAFETY_KEYWORDS`, hazard/safety banners and judges, `mira-hub/src/lib/safety-classifier.ts`, answer-validation. Security/auth: sessions, NextAuth, middleware, secrets handling. Tenant: `knowledge_entries` read/write filters, RLS, `TenantScopedSession`, ingest of private customer documents. Migrations: `mira-hub/db/migrations/**`, `mira-core/mira-ingest/db/migrations/**`. Production control: `.github/**`, `tools/hooks/**`, `.githooks/**`, deploy/receipt/drift/acceptance scripts (`tools/staging_receipt.py`, `tools/migration_drift.py`, `tools/qa/retrieval_acceptance.py` and the acceptance-receipt writer/verifier), `docker-compose*.yml`, nginx, OTA/native release, PLC/fieldbus/Ignition. **Governance floor:** `CLAUDE.md`, `AGENTS.md`, all of `.claude/**`, review producers/consumers (`tools/gate7_review.py`, `scripts/adversarial-review*`, `tools/ui_surface_lifecycle_guard.py`, `tools/ci/**`, `tools/capability_closure.py`, `tools/release_train.py`), registries and allowlists (`docs/contracts/contract-index.yaml`, `.ast-grep-rules/**`, `sgconfig.yml`, `scripts/kg_write_guard_allowlist.txt`, `docs/architecture/convergence/*.yaml`), test collection/config (`pytest.ini`, `pyproject.toml`, `tests/conftest.py`, tests of any guard), **process documents and runbooks** (`docs/adversarial-review-workflow.md`, `docs/environments.md`, `docs/versioning.md`, `docs/runbooks/**` including the rollback and hotfix runbooks, this document), guarded legacy UI paths | `REGISTRY.yaml` LEGACY entries; the lifecycle guard's trusted control-path list (`tools/ui_surface_lifecycle_guard.py:70-124`); `migration-verify.yml` paths; reviewer trigger lists | — |

"Substantial" (protocol §5) = R2 ∪ R3. S0–S5 (handbook §16.2) remains the *safety-consequence* scale
used inside R3 safety reviews. The convergence doc's R0/R1 *checkpoints* are called **CP-before /
CP-after** here. R3 is one review class with family-specific evidence rows (§3.3, §5–§9).

### 2.2 Assignment

Written by the implementer at G0 on the issue or claim and copied into the PR body as one line:
`Risk: R2 — retrieval ranking change`. Any reviewer may challenge it. The path signals are aids; the
**effective risk** rule below is authoritative.

### 2.3 Effective risk (the floor rule)

```
effective_risk = max( declared_risk,
                      trusted_path_floor,     # R3 for any governance-floor / production-control path; R2 minimum for the R2 signal list
                      reviewer_findings )     # the class any reviewer (specialist agent, cheap lane, Codex, Mike) asserts with a reason
```

- A declared class can **never lower** the effective class. Lowering requires an explicit owner
  decision recorded as a PR comment.
- Recompute on every candidate change (new commits can move a PR into a higher floor).
- **Today** the only mechanical floor is the lifecycle guard's control-path list (R3 governance
  paths). The R2 signal floor (tenant / safety / migration / retrieval paths) is **DOCTRINE until
  Part B step 5 lands** (a narrow companion check reusing the guard's shape). Until then, an
  under-classified R2 change outside the guarded list is caught only by a reviewer.

---

## 3. Required checks (G1 → G2)

### 3.1 Required contexts (enforced today by branch protection)

Classic protection on `main`: `staging-gate`, `Hub E2E (command-center + onboarding)`, `mira-web pack
tests`, `CI Gate`, `hold-gate`, `Shared UI contract (bun 1.4.0)`; `strict: true`; `enforce_admins:
true`; **required approving reviews: 0 (decision D2)**. Ruleset `main-branch-protection` (17097034)
adds PR-required + non-fast-forward and requires `staging-gate` (bypassable by repository role 5).
`CI Gate` (`ci.yml` `ci-gate`) requires 16 jobs to `success`; `test-unit`/`bench-harness-tests` only
when `changes.code == true`.

**Not gated today** (facts, not rules): `secrets-scan` (gitleaks), `docker-build-check` (Trivy),
`test-eval-offline` (the broadest `pytest tests/` sweep), `simlab-gate`, `module-suites`,
`ocr-recall-gate`, `drive-pack-extract-tests`; `Legacy UI Lifecycle Guard` posts a status but is not
required (binding is an unperformed admin action, #3657). `staging-gate` success can mean the evaluation
was **skipped** (docs/.github/.claude-only PRs and Dependabot), so it does not distinguish ran-and-passed
from skipped; a Dependabot runtime bump (R2) skips evaluation yet reports success.

### 3.2 v1 required state

| Check | v1 rule | State today | Closed by |
|---|---|---|---|
| Six required contexts, strict, admins | Keep | Enforced | — |
| `secrets-scan`, `docker-build-check` | Gated in `ci-gate` with the same `code == true` conditional as `test-unit` (success or skipped on docs-only) | Not gated | Part B step 7 |
| `Legacy UI Lifecycle Guard` | Required context once a non-spoofable status source exists | Advisory | Part B step 11 (#3657, Mike) |
| `test-eval-offline` | **Advisory for v1 (D3)**; measure 30 days, then decide | Advisory | Part B step 12 |
| `.ast-grep-rules/` | Executed by `sg scan` in `code-review.yml`, output captured into the existing comment, step never fails (advisory first) | Never executed | Part B step 7 |
| `license-check` | Allowlist `Apache-2.0;MIT` (plus explicitly justified exceptions), matching the hard constraint | Denylist | Part B step 7 |
| Conventional Commit title | Checked by the merger; `next_version.py` returns a patch bump for an unparseable subject, so a bad subject costs a wrong bump, not a red run | Doctrine | — (no commitlint in v1) |
| Merge | `gh pr merge --match-head-commit <reviewed sha>`; R3 merges by Mike or an explicitly delegated session; branch protection carries no risk-class concept, so this is **doctrine** | Doctrine | — (documented, D2) |

### 3.3 Verification per class (G1)

| Criterion | R0 | R1 | R2 | R3 | Mechanism / evidence |
|---|---|---|---|---|---|
| Lint + the suites CI runs for the touched packages (separate invocations where collection collides: `tests/` vs `mira-bots/tests/`) plus any suite the change could pollute | — | ✔ | ✔ | ✔ (behavioral changes) | `defect-workflow` §8; global local-gates rule |
| Red→green test whose docstring cites the issue | — | ✔ | ✔ | ✔ behavioral; n/a governance prose | existing practice (142 issues cited from `tests/`) |
| Eval / golden case when the answer path changes | — | — | ✔ | ✔ if applicable | `tests/eval/fixtures/`, `tests/golden_*.csv`, `deepeval-ci.yml` |
| Property test for a **new** state machine, parser or invariant | — | — | ✔ | ✔ | hypothesis pattern (`tests/test_fsm_properties.py`) |
| Mutation check for the defect test (break the fix, confirm red, restore), declared with the red output | — | — | ✔ when a defect test exists | ✔ when a defect test exists | `defect-workflow` step 6 (manual) |
| Specialist review **findings** attached and dispositioned (not attendance): `conversation-reviewer` for answer-path; `safety-reviewer` for the safety family; `security-reviewer` for auth/tenant/deploy/secrets | — | — | conversation | safety and/or security | `.claude/agents/*.md` |
| Hazard ledger (each noticed-but-unfixed item dispositioned) | — | — | ✔ | ✔ | PR body; consumer = the merger |
| Cheap review lane on the current head (§4.2) | ✔ (D4) | ✔ | ✔ | ✔ | `[CHEAP-REVIEW]` comment |
| PR body: Summary, `Risk:`, criterion → evidence mapping, test evidence, hazard ledger | Summary + Risk | ✔ | ✔ | ✔ | PR template |

---

## 4. AI review and attestation

### 4.1 Roles

Claude implements and remediates. Specialist Claude agents produce findings (read-only). The cheap
lane produces a single-shot verdict. Codex produces the independent exact-head verdict (read-only
sandbox, trusted-base launcher). Deterministic CI decides facts. Mike authorizes consequential
transitions. No agent may self-award a PASS on work it authored.

### 4.2 Cheap review lane — **advisory in v1** (decision D4 keeps it on every PR)

- Mechanism: `tools/gate7_review.py <PR> --paid --post` posts `[CHEAP-REVIEW]` with `head`, `verdict`,
  `model`, `cost_usd`, `run_id`. Required on **every PR including R0** (owner mandate 2026-10-03; D4).
- **Classification: ADVISORY, not a blocking attestation**, until it is posted as a **commit/head-bound
  GitHub check-run** that a required context consumes (Part B step 6). Reasons, all facts today: the
  head SHA and the diff are fetched separately and the head is not re-read before posting; the exit code
  is 0 for rendered PASS, BLOCK and UNKNOWN and for a failed post (2/3/4 only for provider failure,
  budget refusal, oversized diff); the only consumer is the merger reading `head:` and `verdict:`.
- Rule for the merger (doctrine until the check-run exists): merge only when the latest
  `[CHEAP-REVIEW]` `head:` equals the current head and `verdict: PASS`, or every remaining finding is
  dispositioned in a PR comment (fixed / false-positive with reason / deferred to issue #). "No new
  findings" is not PASS.
- Cost is recorded in `.planning/review-costs.jsonl` (gitignored, per host) and in the comment.

### 4.3 Independent exact-head Codex review — **authoritative where required**

- Launch only from the trusted base: `git show origin/main:scripts/adversarial-review-trusted.sh | bash -s -- <PR> --review-only`
  (a candidate-local run exits 0 and reviews nothing). Read-only sandbox, isolated `CODEX_HOME`.
- Verdict envelope `[CODEX-ADVERSARIAL-REVIEW]` carries `reviewed_sha`, `reviewed_body_sha256`,
  `base_sha`, `status GREEN|ISSUES_FOUND`, `review_iteration`, counts; the script re-verifies the head
  before review and before GREEN. **GREEN binds to the exact head and the exact PR body**: any push or
  body edit makes it stale. Maximum three autonomous rounds, then escalate to Mike with the open findings.
- **Required (D1):** every **R3** change; every PR touching a guarded path (the lifecycle guard
  demands the body-bound GREEN regardless of class). **R2:** when Mike names it or a cheap-lane finding is
  disputed. R0/R1: not required.
- Hotfix deferral (§10.1) is allowed only when the PR touches no guarded control-plane path.

### 4.4 Trust limitation of the attestation (stated plainly)

The lifecycle guard and the ledger count a `[CODEX-ADVERSARIAL-REVIEW]` comment only when posted by the
**repository owner account** (`user.type == User`); the review lane runs under that account. So the
attestation authenticates **the account that posted it**, not a separate reviewer identity: a session
holding the owner's `gh` token could post a syntactically valid envelope. Independence is therefore
**organizational** (only the trusted script, run from `origin/main`, is permitted to post it) and
**auditable** (ledger comments, run ids), not cryptographic. v1 accepts this and does not claim
otherwise; a separate reviewer identity (second GitHub App/account) is a deferred improvement (§13).

### 4.5 Advisory vs authoritative — the unambiguous list

| Artifact | Status in v1 |
|---|---|
| `[CODEX-ADVERSARIAL-REVIEW] status: GREEN` on the exact head + body | **Authoritative** for the gates that require it (§4.3) |
| `[CHEAP-REVIEW]` comment | **Advisory** (until a head-bound check-run exists) |
| Specialist agent findings | **Advisory input**; their dispositions are evidence in the PR |
| `code-review.yml` AI review comment | **Advisory** (comment-only, never fails) |
| Required status contexts | **Authoritative** (deterministic) |
| Human merge / human dispatch | **Authoritative** for authority, **not** independent review (§7) |

---

## 5. Staging

### 5.1 Mechanism (enforced today)

`deploy-staging.yml` is `workflow_dispatch` only, from `refs/heads/main`, with `approved_rc_sha`
(40-hex) validated by `gh api repos/…/commits/<sha>`; co-hosted on the production host with seven
safeguards; asserts runtime `gitSha == approved_rc_sha` **for the Hub/Web targets selected**; images are
rebuilt `--no-cache --pull`; writes `staging-receipt-<sha>` (`factorylm.deploy-receipt/1`, 90 days).

### 5.2 Validator trust boundary (explicit)

Facts: (a) the SHA check accepts **any commit present in the repository**, including an unmerged
PR-branch commit — descent from `main` is not required; (b) once staged, `retrieval-acceptance.yml`
fires automatically on the successful staging run, checks out the **deployed** SHA and runs that tree's
`mira-hub/scripts/provision-beta-gate.ts` with the staging `DOPPLER_TOKEN` and its
`tools/qa/retrieval_acceptance.py`; (c) `deploy-vps.yml`'s `migration-drift` job checks out
`approved_rc_sha` and runs **that tree's** `tools/migration_drift.py` with the production DB URL
(`env -i`, `python3 -I`, URL-only handoff). The validators therefore come from the **candidate tree**,
not from a pinned trusted base as the review lane does. Consequence: today an unmerged, unreviewed
branch can be staged and have its provisioning script executed with staging credentials, with no merge,
no Codex review and no cheap-lane verdict in between.

**v1 rule.** Candidate-tree validators are acceptable **only** for commits reachable from `main`
(merged). Required state: `deploy-staging.yml` `authorize-target` verifies
`git merge-base --is-ancestor <sha> origin/main` (or the API equivalent) and **fails closed** otherwise;
`retrieval-acceptance.yml` runs the provisioner and harness from the **trusted base** (`origin/main`
checkout) against the deployed URL, or verifies the deployed SHA is an ancestor of `main` before executing
anything from it; `migration-drift` runs `tools/migration_drift.py` from the trusted base. Until Part B
step 4 lands this is **DOCTRINE**: do not dispatch `deploy-staging.yml` for a SHA that is not on `main`.

### 5.3 Environment facts

GitHub environments `production`, `staging`, `staging-deploy` exist with **zero protection rules**
(no required reviewers, wait timers or branch policies); `environment:` on a job grants secrets only.
`apply-ingest-migrations.yml` uses `environment: production` for **both** targets, so a staging ingest
migration runs under production secrets scope — v1 required state: a `staging` environment for the
staging target (Part B step 6).

---

## 6. Acceptance receipts (capability-bound)

### 6.1 Today

`retrieval-acceptance.yml` resolves the SHA **actually serving** from `/api/health`, provisions a
stranger tenant, runs six live Hub retrieval scenarios plus capture accounting (capture skips historical
deployments and exits 0), re-reads the SHA at verdict time (SUPERSEDED on drift, **exit 0 with a warning
if the re-read fails**), and uploads JSON `{base, ran_at, rows}` with **no pinned SHA, no run id, no
service list** (30-day retention). **Nothing downstream consumes it.** The staging receipt verifier uses a
fixed `DEFAULT_REQUIRED_SERVICES = ("mira-hub", "mira-web")` and is never given the dispatched
`services`; the production default target set is `mira-hub mira-web mira-ask`, so **`mira-ask` deploys
with no receipt-proven staging identity**, and a narrow (e.g. web-only) staging receipt fails the fixed
Hub/Web requirement.

### 6.2 v1 rule — binding model

`production delta → affected capabilities → actual deployed service set (the real services input, never
a hardcoded default) → required acceptance suites tagged to those capabilities → one generation-bound
receipt`. A generic "staging passed" receipt certifies **only** the services and revisions it proves.

**`acceptance-receipt-<sha>` must contain:** schema id; repository; pinned deployed `gitSha` **per
service** it certifies; the triggering `staging-receipt` run id and the acceptance run id (+ attempt);
environment generation; the **actual services list covered**; the capability set exercised; per-scenario
verdicts tagged by capability; capture status; start/end identity probes; `ran_at`; expiry.
**`staging-receipt-<sha>` verification must compare against the dispatch's `services`**, not the
fixed default; every service in the production target set — explicitly including **`mira-ask`** — needs
a receipt-proven staging runtime identity or an explicit, recorded `NOT_APPLICABLE` with a reason.

| Concern | Rule |
|---|---|
| Scope | Suites required for the capabilities the delta touches; a Web-only release with no retrieval capability changed makes the retrieval suite `NOT_APPLICABLE`; a changed Hub retrieval path requires it. Unknown impact → broader coverage, never an empty suite set |
| Universal checks | Runtime identity, basic health, essential auth/tenant isolation, receipt integrity always apply to affected surfaces |
| `NOT_APPLICABLE` | Scenario outside the deployed capability set; recorded, never silently absent |
| `SKIPPED` | Scenario **inside** scope that did not run (capture skip, historical deploy) — **blocks** authorization for that capability |
| `SUPERSEDED` | Deployment generation changed during assessment → the receipt does not authorize; no fallback to an older passing receipt |
| `INFRA_UNASSESSED` | Provider/infra failure (fetch failed, tool error) — retried within one bounded re-run, then **blocks** the affected capability; never recorded as a product regression and never reduced to exit 0 |
| Same-SHA redeploy | A rebuild (`--no-cache --pull`) or recreation is a **new generation**; reuse requires the new generation's runtime identity to equal the receipt's pinned SHA **and** the receipt's triggering staging run id to match the **current** staging receipt presented at authorization **and** no migration/config/provider change since acceptance completed — never "SHA unchanged within 168 h" alone |
| Expiry | 168 h from acceptance completion (one system-wide freshness constant, shared with the staging receipt); not refreshed by copying |
| Fail-closed | Missing, malformed, unparseable, stale, ambiguous or scope-mismatched receipts block; a failed verdict-time identity re-read is `INFRA_UNASSESSED`, not success |

State today: the receipt does not exist; the fail-open re-read exists. **DOCTRINE until Part B steps 4–5**
(producer first, then the `deploy-vps.yml` consumer).

---

## 7. Production authorization (G3)

### 7.1 Mechanical checks (enforced today)

`deploy-vps.yml` is `workflow_dispatch` only ("AUTO-DEPLOY stays DISABLED"); `authorize-source` rejects
every `skip_*` input, requires Staging Gate `completed:success` on the PR head mapped from the merge
commit, requires an unexpired (≤168 h) verified `staging-receipt-<sha>` with workflow provenance, and
`migration-drift` requires zero repo→ledger filename drift. Credentials are split by job (DB URL only in
`migration-drift`, SSH key only in `deploy`).

### 7.2 v1 required state

| Criterion | Rule | Today | Closed by |
|---|---|---|---|
| Staging receipt covers the dispatched `services` | Verifier compares against the real input; `mira-ask` included | Fixed Hub/Web default | Part B step 5 |
| Acceptance receipt | Required for every capability in scope, PASS, not SUPERSEDED/SKIPPED/INFRA_UNASSESSED, ≤168 h, generation-matched (§6.2) | No consumer | Part B step 5 |
| PR association | Exactly one **merged** PR into `main` whose `merge_commit_sha` matches; otherwise STOP (no first-associated-PR fallback) | Fallback exists | Part B step 5 |
| Migrations (Hub **and** ingest) | Applied staging → prod via the ledgered workflows, `dry-run` then `apply`; content check has fail-open branches (absent hashes) — recorded, not relied on | Filename-level drift gate | — (documented) |
| Release holds | No open `RELEASE_TRAIN.yaml` blocker for the component deployed, or Mike's written waiver (manual check in v1) | Blockers stop the `RELEASED` label only | §13 |
| Device evidence | When native/OTA mobile is in the release | Present in `ota-release.yml`; `ota-*` environments absent | §13 |
| **Human deployment intent** | See §7.3 | No environment rule | Part B step 9 (Mike) |

### 7.3 Human deployment intent (decision D6) — stated accurately

- **Today:** `environment: production` has **no protection rules**; "Mike authorizes" is doctrine; any
  actor with Actions write access can dispatch production once the mechanical checks pass.
- **v1 required state:** a **required reviewer (Mike) on the `production` environment, WITHOUT
  `prevent_self_review`**. What this is: a **recorded human deployment intent/confirmation checkpoint** —
  a deliberate click, logged with actor and time. What it is **not**: independent review or identity
  separation. In a one-owner repository the dispatcher and the approver are the same account, and an
  agent operating with the owner's token could in principle both dispatch and approve; the control's
  value is friction plus an audit record. `prevent_self_review` is **not** enabled: with one authorized
  human it deadlocks every dispatch (the exact failure `ota-release.yml` encodes for the non-existent
  `ota-production` environment). Mike has **accepted this interim control (D6)**; a genuinely separate
  authorized reviewer identity is a deferred improvement (§13).
- Authorization is recorded on the owning issue: the dispatch actor/run URL or a linked authorizing
  comment by Mike.

---

## 8. Deployment

### 8.1 Mechanism (enforced today)

`deploy-vps.yml` `deploy` job: records `PRIOR_SHA/PRIOR_TAG` from the host checkout as the rollback
anchor; asserts zero tree drift in `/opt/mira`; rebuilds the selected services `--no-cache --pull`
(default `mira-hub mira-web mira-ask`); health-gated swap (`--wait`); asserts built image id == running
image id; asserts runtime `gitSha == approved_rc_sha` for the selected Hub/Web; writes
`production-receipt-<sha>` (90 days); strict nginx `sites-enabled` allowlist. On a failed health-gated
swap it **deliberately leaves the new containers in place** (tearing down would deepen the outage).

### 8.2 Identity the receipt proves — and does not

Source identity is proven (runtime `gitSha` for selected Hub/Web); binary identity is **not** (staging
and production rebuild separately; receipts carry local image ids, not registry digests; no
attestations exist). v1 states this narrowly and does not claim "the accepted artifact was promoted".
v1 required additions to the production receipt: the **actual services list** deployed, the per-service
runtime SHA, and a `rollback_candidate` per service (§10.2). Build-once/promote-by-digest and
attestations are deferred (§13).

### 8.3 Version and rollback address

`version-tag.yml` tags every push to `main`: `v<X.Y.Z>` (type-derived; unparseable subject → patch)
and `rollback/<date>-v<X.Y.Z>`; Release creation is best-effort; tags are unprotected. A tag is an
**address**, not proof of a verified-good production state.

---

## 9. Post-deployment verification (G4)

| Criterion | R1 | R2 | R3 | Mechanism / evidence |
|---|---|---|---|---|
| Production receipt for the SHA **and the actual service set** | ✔ | ✔ | ✔ | `production-receipt-<sha>` |
| **Explicit post-deploy smoke**: `smoke-test.yml` dispatched after the deploy completes (outside the 10-minute alert mute), run id on the issue. Push-time smoke does not count — it runs at merge, before the manual deploy | ✔ | ✔ | ✔ | `smoke-test.yml` `workflow_dispatch`; screenshots per the Screenshot Rule when UI changed |
| Observation window, starting at the smoke run: no `incident` issue **created or updated** attributing this deployment, and canary runs **completed** (an infra-failed canary is `unassessed`, not clean) | 24 h | 24 h | 72 h | Canaries; `incident` label (Part B step 3). Windows are provisional defaults; do not hold other releases for a window; a superseding deploy marks the window `OBSERVATION_INCOMPLETE` |
| Capability/flag changes: `CAPABILITY_CLOSURE.yaml` advanced from a Doppler read (an evidence-record commit, distinct from the deployed SHA) | — | ✔ | ✔ | `finish-capability` skill |
| Release identity recorded when the release train applies | — | — | ✔ | `RELEASE_TRAIN.yaml` observed_* + `tools/release_train.py --drift` |
| Tenant-touching changes: the BRAVO RBAC inspection run after the deploy is linked | — | — | ✔ (tenant family) | `tools/qa/rbac/*` (launchd on BRAVO) |
| Attributable failure → `incident` → regression disposition; the change is `FAILED_OBSERVED` until the disposition merges | ✔ | ✔ | ✔ | §10.3 |
| Handoff comment only when ownership, blockers or authorization remain unresolved | — | — | if unresolved | protocol §9 |

---

## 10. Failure, hotfix and rollback

### 10.1 Hotfix (production degraded, normal flow too slow)

The live `deploy-vps.yml` has **no gate bypass** and v1 keeps it that way. A hotfix is the normal path
with the queue cleared and the emergency mode recorded:
1. Open an `incident` issue first; open the fix PR as **R3 (production-control)**, title `fix(hotfix): …`.
2. G1: cheap lane one round. Codex may be **deferred post-merge only** when the PR touches no guarded
   control-plane path (the body-bound attestation cannot be deferred) and Mike says so on the PR; it must
   complete within 24 h and its `[CODEX-ADVERSARIAL-REVIEW]` is the follow-up artifact.
3. G2: required contexts green (strict up-to-date; nothing else merges meanwhile).
4. G3: `deploy-staging.yml`, acceptance for the capabilities in scope, then `deploy-vps.yml` with the
   narrowest `services` list containing the fix. Receipt, acceptance and drift gates apply unchanged.
5. G4 as normal; the regression disposition lands in the hotfix PR or a follow-up within 24 h.

### 10.2 Rollback

Rollback is a **forward deploy of a known-good SHA** through the same gates, plus a data decision.

| Layer | v1 rule |
|---|---|
| Recovery candidates | Each production receipt records, **per service**, a `rollback_candidate` (normally that service's previous production SHA). Candidates are explicit, not inferred from `PRIOR_SHA` (which is the host checkout, not the per-service runtime set) and not inferred from tags. |
| Fresh evidence **before** the incident | A scheduled job re-deploys the **designated recovery candidate(s)** to staging and re-runs acceptance so their staging and acceptance receipts stay ≤168 h fresh **while they remain recovery targets**. Refreshing only the current production SHA does **not** preserve the rollback target (A→B, B current >168 h, outage: A's receipts have expired). |
| Compatibility | A candidate is valid only while no **contracting** migration has been applied since it ran (expand/contract discipline: code rollback within the window never needs schema rollback). |
| Refresh failure | A stale or failed candidate refresh opens an `incident`-labelled issue: recovery readiness is lost. |
| Executing a rollback | Re-dispatch `deploy-vps.yml` with `approved_rc_sha=<candidate>`; the receipt, acceptance and drift gates apply unchanged — never bypass. If evidence is expired, re-stage and re-accept first; this is the failure the refresh schedule exists to prevent. |
| Database | `apply-migrations.yml` has no down mode. R3 migration PRs record the Neon snapshot/branch id and the rollback SQL at G0 (CP-before). |
| Mobile / OTA | `mira-mobile/scripts/ota-rollback.mjs` and `ota-release.yml promote` re-point the signed manifest; the handset-evidence job applies to the rollback too (the `ota-*` environments must exist first, §13). |
| Drill | One drill before v1 is declared adopted: deploy the designated candidate to staging, run acceptance, exercise `deploy-vps.yml` `authorize-source` against it with the smallest safe `services`, and walk A→B→rollback-to-A with B current >168 h; record run ids in the runbook. A receipt-only staging drill does not count. |
| Runbook | `docs/runbooks/rollback.md` (R3 governance doc) replaces `hubv3-rollback.md`, whose `-f ref=` input no longer exists. |

State today: no `rollback_candidate` field, no refresh schedule, no recorded drill. **DOCTRINE until
Part B step 10.**

### 10.3 Failure → regression

1. **Detect**: canary issue, smoke alert, Telegram heartbeat, user report, eval regression.
2. **Record**: one issue labelled `incident` with fixed fields: `first_seen:`, `deploy_run:` (the
   `deploy-vps.yml` run id + attempt), `deploy_sha:`, `services:`, `impact:`, `restored_at:`,
   `restoring_action:` (deploy / config / provider recovery / none). Canary-opened `*-incident` issues get
   the `incident` label added; `docs/incidents/` holds narrative RCAs.
3. **Restore**: §10.1, §10.2, or an operational action recorded in `restoring_action:`.
4. **Regression disposition** (required to close): `new-test:<path>` (docstring cites the issue),
   `existing-coverage:<path>`, `guard:<workflow/hook>`, `eval-fixture:<path>` (promote the
   active-learning draft), or `external-cause:<reason>`.
5. Second occurrence of the same class = a new rule or guard, not only a test (Cluster Law 6).

---

## 11. Security and trust boundaries

### 11.1 Boundaries this document defines

| Boundary | Rule | Today | Closed by |
|---|---|---|---|
| Candidate code with credentials | Candidate-tree validators only for commits on `main`; trusted-base validators preferred (§5.2) | Any repo commit can be staged; validators from the candidate | Part B step 4 |
| Privileged `pull_request_target` | **No job may check out and execute PR-head code with secrets or a write token.** The `auto-fix` job is **retired (D5)**; `ui-lifecycle-guard.yml`'s trusted-base evaluation is the permitted pattern | `code-review.yml` `auto-fix` exists (label-gated) | Part B step 2 |
| Review producers/consumers and agent rules | Governance floor (R3): Codex GREEN required; lifecycle guard status (advisory today) | Guard not required | Part B step 11 |
| Attestation identity | Owner-account comment authentication; organizational independence (§4.4) | As stated | §13 (separate identity) |
| Body-bound attestation | Any PR body edit invalidates GREEN by design; exceptions and closeouts are **comments**, not body edits | Enforced by the guard parser | — |
| Direct push to `main` | Forbidden; `enforcement-audit.yml`'s nightly push attempt is removed or turned into a PR | Attempt exists, non-fatal | Part B step 2 |
| Prod mutation from a Claude session | `tools/hooks/prod-guard.sh` (harness hook, convenience boundary, not authority); host list must include the OVH host and a prod Neon pattern | Host list stale | Part B step 2 |
| Deployment credentials | DB URL only in `migration-drift`; SSH key only in `deploy` (keep) | Enforced | — |
| Secret-bearing control jobs | Pin actions by SHA (`actions/checkout@v6` in `apply-migrations.yml`, `oven-sh/setup-bun@v2` in `retrieval-acceptance.yml` are mutable today) | Mutable | Part B step 6 |
| Environments | `staging` target of `apply-ingest-migrations.yml` uses a staging environment, not `production` | Both use `production` | Part B step 6 |

### 11.2 Repository security settings — current state vs v1 required vs future

| Control | Current state (live, 2026-10-03) | v1 required | Future |
|---|---|---|---|
| Environment protection (`production`, `staging`, `staging-deploy`) | **0 rules** on all three | Required reviewer on `production`, no `prevent_self_review` (D6) | Separate reviewer identity |
| `ota-signing` / `ota-canary` / `ota-production` environments | **Do not exist** (referenced by `ota-release.yml`; the promote job's self-check fails closed) | Create them before any OTA promotion; preserve the fail-closed check | — |
| Secret scanning | **disabled** | Enable (free on public repos) | — |
| Push protection | **disabled** | Enable | — |
| Dependabot alerts / security updates | **not enabled / disabled** | Enable; extend `dependabot.yml` to `mira-hub`, `mira-mobile`, `mira-cmms`, `mira-pipeline`, `mira-bridge`, root `pyproject.toml` | Dependency review action on PRs |
| Code scanning (default setup) | **not-configured** | Keep Semgrep/Bandit in CI (gated); decide default-setup after an OpenSSF Scorecard report | Scorecard as a gate |
| `secrets-scan` / Trivy in CI | run, **not gated** | Gated with docs-only skip semantics | — |
| `.ast-grep-rules/` | **never executed** | `sg scan` advisory in `code-review.yml` | Gate if warranted |
| pip-audit | 3 roots, `\|\| true`, parse errors swallowed | Status per scanner; fail on scanner error; still reach issue creation on vulnerabilities; add `bun audit` | — |
| `SECURITY.md` | absent | Add: intake channel, triage owner, response expectation, supported versions | — |
| SBOM / attestations / signed images | none | not in v1 | §13 |

None of the "v1 required" cells is implemented by this document; Part B sequences them. **Product
safety controls** are unchanged: `SAFETY_KEYWORDS` phrase tests, hazard banner tests, the 2026-09-27
owner decision that safety flags never withhold an answer, S0–S5 inside safety reviews; the
`safety-reviewer` agent text must be aligned with that decision (Part B step 1).

---

## 12. Evidence and audit requirements

### 12.1 Identity contract (which identity each artifact proves)

| Stage | Authoritative identity | Produced by | Verified by | Invalidated when |
|---|---|---|---|---|
| Classified | `Risk:` line on issue/claim + PR body; effective risk per §2.3 | implementer; floors | reviewer; guard (R3 paths) | any candidate change |
| Cheap review | PR head SHA stamped in `[CHEAP-REVIEW]` (advisory) | `gate7_review.py` | merger (doctrine) | head moves |
| Codex review | `reviewed_sha` + `reviewed_body_sha256` + `base_sha` | trusted-base script, owner account | guard parser (guarded paths), ledger | head or body changes |
| Merge candidate | PR head containing current `main` | GitHub (strict) | branch protection | any push to `main` |
| Merged | merge commit SHA ↔ exactly one merged PR (`merge_commit_sha`) | GitHub | `deploy-vps.yml` mapping (v1: no fallback) | — |
| Tagged | `v*`, `rollback/*` at the merge commit (address only) | `version-tag.yml` | none (tags unprotected) | tag moved |
| Staged | `approved_rc_sha` on `main`; per-service runtime SHA for the **dispatched services**; local image ids; staging run id | `deploy-staging.yml` | `tools/staging_receipt.py verify` against the real `services` | > 168 h; new generation |
| Accepted | pinned per-service `gitSha`, triggering staging run id, acceptance run id + attempt, capability set, services covered, per-scenario verdicts | `retrieval-acceptance.yml` (receipt producer) | `deploy-vps.yml` `authorize-source` | SUPERSEDED; > 168 h; generation/migration/config change |
| Authorized | recorded human intent: dispatch actor + run URL / authorizing comment | Mike (environment reviewer when present) | issue record | — |
| Deployed | per-service runtime SHA for the **actual services**, local image ids, `rollback_candidate` per service | `deploy-vps.yml` | `production-receipt-<sha>` | — |
| Observed | production receipt + explicit smoke run id + window start/end | smoke dispatch, canaries | closure comment | attributable incident; superseding deploy |
| Artifact digest | **not proven** (separate rebuilds, no attestations) | — | — | — |

### 12.2 Evidence rules

1. Every gate artifact is a GitHub-native object (check run, comment with a fixed envelope, tag,
   artifact, issue with fixed fields). No external store. Retention differs (receipts and acceptance
   artifacts 90/30 days; comments and issues indefinite): durable facts (SHA, run ids, verdicts) are
   copied into the owning issue when the artifact is produced.
2. Exceptions are **comments** (`Exception: <gate> — <reason> — approved by Mike <link>`), never body
   edits. Label bypasses exist only where a workflow already defines one (`shared-line-ok`, hold labels);
   the lifecycle guard has none and v1 adds none.
3. Cost is recorded per review (`cost_usd` in `[CHEAP-REVIEW]`; the Codex envelope has no cost field —
   a known metric gap).
4. Standing authorizations (Appendix B) are not re-asked.

### 12.3 Metrics (definitions; `tools/dora.py` is read-only and reports missing data as missing)

| Metric | Definition | Computable today |
|---|---|---|
| Deployment frequency | Successful `deploy-vps.yml` runs per week **that reached the swap step**, with service scope; distinct `approved_rc_sha` reported separately | Yes once the swap-step filter is applied (raw run failures are mostly pre-swap exits) |
| Change lead time | PR `mergedAt` → first production receipt proving inclusion of **each component the PR touched** (per-service runtime SHA is a descendant of the merge; unrelated-service ancestry does not count; non-shipping PRs excluded; reverts counted separately) | Partially (receipts retained 90 d; a run's `headSha` is the controller ref, never use it) |
| Change failure rate | **Distinct failed deployment events** (run id + attempt + service set) with ≥1 attributable `incident` ÷ deployment events that reached the swap step; three incidents on one deployment count once; `external-cause` separate | No until the `incident` record exists |
| Time to restore | `first_seen:` → `restored_at:` from the incident record | No until the record exists |
| Deployment rework | Same-service redeploy of a different SHA within a week ÷ deployments (swap-step filtered) | Partially |
| Review rounds / cost | Codex `review_iteration` to GREEN; cheap-lane runs to PASS or full disposition; `cost_usd` sums | Yes (Codex cost not computable: no field) |
| Eval pass rate | pass ÷ **executed** fixtures (loader globs match 65 of 67 files), with suite id, SHA, judge mode | Yes with the 65 denominator |
| Staging acceptance / superseded rate | Per deployment generation: PASS / FAIL / SUPERSEDED / SKIPPED / INFRA_UNASSESSED | No until the receipt exists |
| Regression promotion | Closed incidents by disposition type | No until the record exists |
| WIP | Open PRs, median age, drafts > 14 days | Yes |
| **Human interventions per completed change** (primary autonomy metric) | Attributable Mike actions (PR comments by the owner, dispatch actor, label events, authorizing comments) ÷ changes reaching `CLOSED` or non-shipping `MERGED`. **Neither an upper nor a lower bound**: agent actions under the owner account inflate it; Mike's out-of-GitHub instructions deflate it. Report with both caveats | Partially |

---

## 13. Controls deferred beyond v1 (and what is explicitly not built)

| Item | v1 position | Reconsider when |
|---|---|---|
| Separate reviewer identity (second GitHub App/account) for the Codex attestation and the production reviewer | Deferred; v1 accepts organizational independence and a recorded click (D6) | A second authorized human or a scoped App credential exists |
| `test-eval-offline` as a merge gate | Advisory (D3) | 30 days of runs: flake ≤1–2 %, runtime known, unique failures shown |
| R0 cheap-lane exemption | Not in v1 (D4) | R2 mechanical floor exists and 30 days of `Risk:` lines show no mislabelled control-path change |
| GitHub Merge Queue | **Not used.** Not eligible: GitHub limits merge queue to Enterprise Cloud and "all public repos owned by organizations"; this repo is owned by a User account. Even if eligible, the queue's candidate SHA ≠ PR head conflicts with exact-head review | Repo moves to an organization or GitHub changes eligibility, **and** the exact-head binding question is resolved |
| `RELEASE_TRAIN.yaml` blockers consumed by `deploy-vps.yml` | Manual G3 check | After acceptance receipts are consumed |
| Build-once / promote-by-digest, artifact attestations, SBOM, signed images, SLSA | Deferred (the receipts' image ids are the hook) | A published artifact is pulled by reference at deploy time |
| Dependency review action, OpenSSF Scorecard as gates | Scorecard run once as a report; dependency review after Dependabot is enabled | After §11.2 enablement |
| Automated risk-class hints | Not in v1 | 30 days of `Risk:` data |
| Mutation-testing tooling | Manual mutation check only | `mira-web` suite deterministic; data on defect-test sensitivity |
| **Not SDLC machinery in v1 (rejected):** FactoryLM Forge, Temporal (adopted for *product* workflows per ADR-0029, not for the SDLC), Restate, DBOS, Dagger (pattern only), Argo Workflows (Kubernetes), Backstage, LangGraph (banned), SWE-agent/mini-SWE-agent, OpenHands, hosted Claude review actions, the ChatGPT Codex cloud review app, a second traceability registry, a rollback workflow that bypasses gates, commitlint, dashboards before status reconstruction is a measured bottleneck | Rejected | Triggers: GitHub-native state projection proven insufficient with evidence; a wait/retry/compensation GitHub Actions + Environments cannot express; multiple human teams; a reviewer role the local split is shown incapable of |

---

# Part B — Current state, gaps and implementation

## B.1 Current-state map (what runs on `main` today; verified 2026-10-03)

| Stage | Mechanism | Status |
|---|---|---|
| Intake | GitHub Issues; triage labels (`needs-triage` 220, `ready-for-agent` 98, `ready-for-human` 38, `needs-info` 5); `defect-workflow` skill covers production incidents | Enforced (tracker) / doctrine (procedure) |
| Requirements | `docs/prd/` (16 top-level, 21 recursive files; 4 with acceptance-criteria sections) and 14 `PRD:` issues; PR-template checkbox unparsed | Doctrine; criteria not consumed |
| ADRs | 39 MADR files; README index lists 13; ~9 Draft/Proposed; collisions at 0014/0037; convergence Gates 0–11 + checkpoints | Doctrine |
| Risk | Binary "substantial"; `gate7_review.py:61-112` effort escalation; S0–S5 safety scale | Doctrine |
| Local gates | ruff/pytest; `.githooks/pre-commit` opt-in (`core.hooksPath` per clone), tool checks fail open when a binary is missing | Convenience |
| Tests/evals | 16 gated CI jobs; hypothesis in 2 files; no mutation tooling; 67 eval fixture files (65 executed by the loader globs) run by Celery on the VPS; `eval-replay-gate.yml` inert | Mixed |
| Cheap lane | `[CHEAP-REVIEW]` comment; not SHA-rebound; exit 0 on rendered outcomes; human consumer | Advisory in fact |
| Codex lane | trusted-base script; exact-head + body-bound GREEN; 3-round ledger; owner-account authentication | Enforced when run |
| Merge | 6 required contexts, strict, admins; 0 approvals; lifecycle guard advisory; `ci.yml` runs on stacked PRs, other contexts do not | Enforced |
| Tags | `version-tag.yml`: 1,120 `v*`, 1,078 `rollback/*` at `a54c4c88b`; unprotected; patch bump on unparseable subject | Enforced (tagging) |
| Staging | `deploy-staging.yml` dispatch-only; any repo commit accepted; selected Hub/Web identity asserted; receipt 90 d | Enforced, boundary gap §5.2 |
| Acceptance | `retrieval-acceptance.yml` automatic after staging; live-SHA audit; JSON without SHA/run id; fail-open re-read; not consumed | Measurement only |
| Prod authorization | `deploy-vps.yml` dispatch-only; receipt (fixed Hub/Web) + Staging Gate + filename drift; first-associated-PR fallback; no environment rules | Enforced, gaps §7.2 |
| Deploy | health-gated swap; selected Hub/Web identity; production receipt; failed swap leaves new containers | Enforced |
| Observation | 6 canaries (3 alert channels); smoke on push/PR/dispatch, muted 10 min around deploys, not deploy-triggered; `incident` label absent; `docs/incidents/` has 1 file | Partly automated |
| Registries | `CAPABILITY_CLOSURE.yaml` (`review_by` expiry fails CI repo-wide), `RELEASE_TRAIN.yaml` (validated without `--drift`; blockers stop the `RELEASED` label only) | Enforced (repo invariants) |

Live GitHub settings (read 2026-10-03, unchanged since the evaluation): 3 environments with 0 rules;
`ota-*` absent; secret scanning / push protection / validity checks / Dependabot security updates
disabled; Dependabot alerts not enabled; code scanning not configured; no attestation workflow;
owner type `User`; 0 of 62 workflows use `merge_group`.

## B.2 Gaps the rules above close (summary; evidence in PR #4210)

Fragmented doctrine; no risk tiering; prose-only acceptance evidence; cheap lane not SHA-bound and not
consumed; acceptance not consumed by production; receipt scope fixed to Hub/Web (`mira-ask` unproven);
candidate-tree validators with credentials and arbitrary-commit staging; environments without rules;
`ota-*` absent; security scanners not gating or not running; repository security features off; stale
hotfix/rollback docs and no drill; no incident record; no metrics; expired carve-out; 22 doc-vs-automation
drift items (Appendix D); `test-eval-offline` and other broad suites outside `ci-gate`; mutable action
tags; ingest-migration environment scope.

## B.3 REUSE / CONNECT / REPAIR / ADD and implementation sequence

Every step is a normal PR through this document's gates (steps touching `.github/`, `tools/hooks/`,
review producers, `.claude/` are R3 → Codex GREEN + Mike merge) or an explicit Mike settings action.
Nothing below is implemented by this document.

| Step | Type | Change | Files / systems | Prerequisite | Evidence of completion | Rollback | Mike |
|---|---|---|---|---|---|---|---|
| 1 | REPAIR + DOC | Adopt this document (pointer lines in `CLAUDE.md` § Release / PR Workflow and `docs/environments.md`); fix the 22 drift items (Appendix D); delete the expired Claude-reviews-Claude carve-out; add `SECURITY.md`; align `.claude/agents/safety-reviewer.md:15` with the 2026-09-27 decision; PR template: add `Risk:`, drop the CHANGELOG checkbox; retire `[CODEX-REVIEW] PASS` wording in the peer runbook | ~12 docs, template | none | merged diff | revert | Y (R3 governance) |
| 2 | REPAIR (security) | Delete the `auto-fix` job (D5); `prod-guard.sh` host list (`40.160.141.61`, hostname, prod Neon pattern — not a bare `ubuntu@`); remove or PR-ify `enforcement-audit.yml`'s nightly push | `code-review.yml`, `tools/hooks/prod-guard.sh` + tests, `enforcement-audit.yml` | none (parallel with 1) | workflow diff; hook tests | revert | Y |
| 3 | ADD (labels) | `incident`, `hotfix` labels; fixed body fields (§10.3) documented in `docs/agents/issue-tracker.md`; `--label incident` in `provider-health-canary.yml` and `oauth-redirect-canary.yml` | labels, 2 workflows, 1 doc | none | `gh label list`; canary diff | remove labels | Y |
| 4 | REPAIR + CONNECT | `deploy-staging.yml`: fail closed unless `approved_rc_sha` is an ancestor of `origin/main`; `retrieval-acceptance.yml`: trusted-base harness/provisioner (or ancestor check before executing candidate code), fail-closed verdict re-read, **acceptance-receipt producer** (§6.2 fields) | `deploy-staging.yml`, `retrieval-acceptance.yml`, `tools/qa/*` + tests | step 1 | a real RC's `acceptance-receipt-<sha>`; tests | revert | Y |
| 5 | CONNECT | `deploy-vps.yml` `authorize-source`: receipt verification against the dispatched `services` (incl. `mira-ask`); acceptance receipt required per §6.2 (scope, age, generation, fail-closed); exact merged-PR match only; `migration-drift` from the trusted base. **R2 mechanical floor**: a narrow companion check reusing the lifecycle guard's shape for tenant/safety/migration/retrieval paths (advisory status first, then required) | `deploy-vps.yml`, `tools/staging_receipt.py`, `tools/migration_drift.py` call site, guard companion + tests | step 4 producing receipts | staging dispatch exercising the new checks; tests | revert (fails closed) | Y |
| 6 | REPAIR | Cheap lane: re-read head before posting, `verdict: STALE` on drift, post a **head-bound check-run** (becomes authoritative only when a required context consumes it); pin `actions/checkout@v6` (`apply-migrations.yml`) and `oven-sh/setup-bun@v2` (`retrieval-acceptance.yml`) by SHA; `apply-ingest-migrations.yml` staging target → `staging` environment | `tools/gate7_review.py` + tests, 3 workflows | none | tests; workflow diffs | revert | Y |
| 7 | CONNECT | `secrets-scan` + `docker-build-check` into `ci-gate` with the `code == true` skip semantics; `sg scan` output captured into the static-analysis comment (never fails the step); `license-check` allowlist `Apache-2.0;MIT` | `ci.yml`, `code-review.yml` | a week of observed green for the two jobs on `main` | `ci.yml` diff + runs | revert | Y |
| 8 | REPAIR + SETTINGS | Dependabot roots; pip-audit status per scanner (fail on scanner error, still create the issue on CVEs); `bun audit`; **enable secret scanning, push protection, Dependabot alerts** (repo settings) | `.github/dependabot.yml`, `dependency-check.yml`; settings | step 7 | diff; settings read via `gh api` | revert / disable | Y (settings) |
| 9 | SETTINGS | `production` environment: required reviewer Mike, **no `prevent_self_review`** (D6); create `ota-signing`/`ota-canary`/`ota-production` with the protections `ota-release.yml` asserts when OTA is next shipped | GitHub environments | step 1 (text first) | `gh api …/environments/production` shows the rule; one exercised dispatch | remove the rule | Y |
| 10 | REPAIR + DOC | `docs/runbooks/rollback.md`; `rollback_candidate` per service in the production receipt; scheduled re-staging + re-acceptance of the designated candidates with compatibility and refresh-failure rules; the A→B→rollback-to-A drill exercising `authorize-source` | runbook, `deploy-vps.yml` receipt schema, one scheduled workflow, two dispatches | step 5 | drill run ids in the runbook; first green refresh of a prior candidate | n/a | Y |
| 11 | SETTINGS | Required `Legacy UI Lifecycle Guard` once a non-spoofable status source exists (#3657); reconcile ruleset 17097034 with the classic layer | branch protection / ruleset | #3657 | protection read | revert | Y |
| 12 | ADD + REVIEW | `tools/dora.py` + tests (read-only; §12.3 definitions; missing data reported as missing); first baseline into `wiki/hot.md`; **30-day review**: `Risk:` lines, `test-eval-offline` measurements (D3), R0 exemption evidence (D4), v1.1 decisions | 2 files; `wiki/hot.md` | steps 3 and 5 running ≥2 weeks | first report | n/a | Y (policy) |

New code in total: one read-only metrics script, one acceptance-receipt writer/verifier, a guard
companion check, a few lines in `gate7_review.py` — each with tests. Everything else is YAML lines,
labels, settings, or prose.

## B.4 Responsibility split

| Responsibility | Mike | Claude (implementer) | Codex (reviewer) | CI / workflows |
|---|---|---|---|---|
| Risk disputes, downward overrides, R3 merges, production intent, ADR acceptance, exceptions, decisions D1–D6 | **owner** | proposes | may object | — |
| PRD / criteria / ADR drafts / claims / CP-before | reviews | **does** | — | — |
| Implement, tests, eval fixtures, hazard ledger, PR body | — | **does** | never edits the branch | — |
| Cheap lane to a clean verdict | — | **runs** | — | posts `[CHEAP-REVIEW]` |
| Exact-head review, findings, GREEN bound to SHA + body | authorizes rounds beyond policy | remediates | **does (read-only)** | ledger comments |
| Required contexts, SAST, license, architecture contracts, capability-closure validity, guard | — | fixes red | — | **decides** |
| Staging deploy, acceptance, migrations dry-run/apply | authorizes prod `apply` | dispatches staging; assembles the evidence packet | — | receipts, drift, acceptance receipt |
| Production deploy | **records intent** (dispatch / environment approval / comment) | prepares SHA + packet | — | `authorize-source` enforces |
| Post-deploy smoke, observation, incident filing, disposition | triages | dispatches smoke, files `incident`, writes the disposition | — | canaries open/update issues |
| Metrics | reads | runs `tools/dora.py` weekly | — | — |

## B.5 Exceptions and escalation

Exceptions are recorded as PR comments linking Mike's approval; never silent, never body edits. Escalate
to Mike when: a risk-class disagreement survives one exchange; a downward override is wanted; Codex
reaches three rounds; a required context is red for a reason outside the PR; an `incident` is open
longer than 4 h; a `review_by` expiry is within 14 days; a rollback would need a schema rollback; a
recovery-candidate refresh fails. Never: merge through red required checks; dispatch production without
the receipts §7 requires; stage a SHA that is not on `main`; edit another session's branch; simulate a
review; rewrite shared history; run prod SQL from a session; weaken a gate to pass it. Carve-outs carry
an end date and are deleted on it.

---

## Appendix A — Decision and evaluation record

- 2026-10-03 — Proposal drafted (PR #4208); Codex round 1 (22 findings) and round 2 (14 factual
  corrections, R0 loophole) folded in.
- 2026-10-03 — Independent evaluation (PR #4210): evidence clerk + fresh Claude drafter + blind Codex
  verdict; verifier pass; three Codex adversarial rounds (F1–F5 fixed) → **GREEN at `67fc0b913`**.
  Verdict **ADOPT WITH CHANGES**; PRD §21 readiness 5/10 as drafted, 10/10 after the fifteen rule-text
  changes.
- 2026-10-03 — This canonical revision applies the fifteen changes (Appendix C) and records decisions
  D1–D6 (§0.1).
- 2026-10-03 — **Ratified by Mike** at `7eb189d822e4cd075a2ecbaaf0fdea288637df87` with the instruction to
  proceed with §B.3; steps 2, 3 and 6 opened as PRs #4211, #4212, #4213 the same day; this step-1 PR
  adopts the document.

## Appendix B — Standing authorizations already granted (not re-asked)

Merge on independent-review PASS + green required contexts (2026-09-19/20); Codex review after
cheap-lane saturation (2026-10-03); post-cap Codex rounds after main-merge with
`ADV_REVIEW_HUMAN_AUTHORIZED=1` (2026-10-01); cheap lane as the required review on every PR
(2026-10-03); safety flags never withhold an answer (2026-09-27).

## Appendix C — Traceability: the evaluation's fifteen changes → this document

| # | Evaluation change (PR #4210 §13) | Where applied |
|---|---|---|
| 1 | `MERGED_NOT_DEPLOYED` non-terminal; never Done | §1.2, §1.3, §1.4 |
| 2 | Capability-bound acceptance scope; `mira-ask` named | §6.1–§6.2, §7.2, §12.1 |
| 3 | Candidate-tree validators with credentials; staging accepts any repo commit; trust boundary and fail-closed rule | §5.2, §11.1, B.3 step 4–5 |
| 4 | Codex attestation authenticated as an owner-account comment | §0.2 principle 6, §4.4, §11.1 |
| 5 | Same-SHA reuse requires generation match (triggering staging run id = current receipt) and no migration/config change | §6.2 "Same-SHA redeploy", §12.1 |
| 6 | Process docs and runbooks (rollback, hotfix) are R3; acceptance-receipt tooling in the governance floor | §2.1 R3 row |
| 7 | Mechanical floor for R2 signals; effective risk = max(...) | §2.3, B.3 step 5 |
| 8 | Cheap lane: head-bound check-run or advisory | §4.2, §4.5, B.3 step 6 |
| 9 | R3 merge mechanism named (doctrine) + `--match-head-commit` | §3.2 "Merge" |
| 10 | `production` environment has no rule; required reviewer without `prevent_self_review`; residual risk named | §7.3, §11.2, B.3 step 9 |
| 11 | `NOT_APPLICABLE` / `SKIPPED` / `INFRA_UNASSESSED` three-way distinction | §6.2 table |
| 12 | Metrics: CFR numerator = distinct failed deployment events, denominator = swap-step deployments; eval denominator 65; `headSha` is the controller ref | §12.3 |
| 13 | Merge Queue: REJECT for v1 (User-owned repo not eligible), trigger and binding conflict recorded | §1.5, §13 |
| 14 | Rollback: per-service recovery candidates, scheduled refresh of the candidates (not current prod), compatibility, refresh failure → incident | §10.2, B.3 step 10 |
| 15 | Pin mutable action tags; `apply-ingest-migrations.yml` staging environment | §5.3, §11.1, §11.2, B.3 step 6 |

## Appendix D — Doc-vs-automation drift to repair in step 1 (verified at `a54c4c88b`)

| # | Doc says | Code does |
|---|---|---|
| D1 | Merge → smoke → auto prod deploy (`docs/environments.md:84`, `docs/runbooks/deploy-to-production.md:45-58`, `docs/specs/staging-environment-spec.md:164`, `smoke-test.yml:27,182-185`) | `deploy-vps.yml` is dispatch-only |
| D2 | Hotfix via `skip_staging_gate=true` / `skip_reason` (`environments.md:87-90`, `deploy-to-production.md:126-140`, `staging-environment-spec.md:171`) | inputs rejected (`deploy-vps.yml:71-81`) |
| D3 | Default rebuild set is 7 services (`deploy-to-production.md:74-77`) | `mira-hub mira-web mira-ask` (`deploy-vps.yml:478`) |
| D4 | Rollback dispatch `-f ref=`, `VERSION` bump (`docs/runbooks/hubv3-rollback.md`) | only `approved_rc_sha`; `/VERSION` gone |
| D5 | `docs/review-cheap-lane.md:5-6,61` cites `tools/review_router/router.py` | not on `main` (#4202 open) |
| D6 | Gate 7 default = free cascade / "No OpenAI" (`FACTORYLM_MIRA_ARCHITECTURE_CONVERGENCE.md:331`, `.claude/commands/gate7-review.md`) | paid lane is required; Cerebras archived; `--adjudicate` uses the cascade only |
| D7 | `CLAUDE.md:3` "see `/VERSION`" | deleted (#3064); same file says so at 247/332 |
| D8 | Claude-reviews-Claude carve-out "expires 2026-09-13" (`multi-session-protocol.md:152-180`) | still present |
| D9 | CI "ast-grep" step runs the 5 rules | `rg` regexes only (`code-review.yml:85-156`) |
| D10 | Repo map lists `mira-ops/` | absent |
| D11 | `docs/agents/domain.md` "16 ADRs"; monday.com lock to 2026-07-19 | 39 ADRs; date passed |
| D12 | `environments.md:38` "no bypass inputs" vs `staging-environment-spec.md:171` | code matches the first |
| D13 | `staging-environment-spec.md:24` "no staging Hub/Atlas" | `deploy-staging.yml:413-490` checks both |
| D14 | `CLAUDE.md` "prod-guard enforces #1–#3" | `PROD_HOST` lacks `40.160.141.61`; no DB/token pattern; allows on empty payload |
| D15 | peer runbook accepts `[CODEX-REVIEW] PASS` | guard accepts only `[CODEX-ADVERSARIAL-REVIEW]` (`ui_surface_lifecycle_guard.py:635-646`) |
| D16 | `CLAUDE.md:28` Apache/MIT only | `license-check` denylist (`ci.yml:1304-1313`) |
| D17 | PR template "CHANGELOG entry added" | CHANGELOG frozen; Shared-Line Guard |
| D18 | `apply-migrations.yml` dry-run "no execution" | executes `CREATE TABLE IF NOT EXISTS schema_migrations` (`:149-170`) |
| D19 | `.githooks/pre-commit:327-328` "blocking backstop" | `code-review.yml:153-169` comment-only |
| D20 | `enforcement-audit.yml` pushes to `main` nightly | non-fatal attempt (`:131-140`) |
| D21 | `tests/eval/README.md:7` "51 fixtures" | 67 files, 65 executed |
| D22 | `.claude/agents/safety-reviewer.md:15` "IMMEDIATE always stops" | owner decision 2026-09-27 (`guardrails.py:1463-1467`) |

## Appendix E — Changelog of this document

- 2026-10-03 — v1 proposal (two Codex rounds folded in).
- 2026-10-03 — v1.0 canonical revision: evaluation #4210's fifteen changes applied; decisions D1–D6
  recorded; restructured into Part A (normative, §1–§13) and Part B (state, gaps, implementation).
- 2026-10-03 — Ratified (status line, Appendix A); no rule text changed.
