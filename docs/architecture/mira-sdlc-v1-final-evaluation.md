# MIRA / FactoryLM SDLC v1 — Final Independent Evaluation

**Status:** EVALUATION — complete; verifier pass applied (58 PASS / 2 PARTIAL fixed / 1 FAIL fixed of claims checked); Codex adversarial round on PR #4210 recorded in Appendix C when complete. Nothing in this document changes CI, branch protection, environments,
workflows, rulesets, CLAUDE.md, staging, production, or release behavior. It recommends; it does not
implement.
**Subject:** draft PR #4208 — `docs/architecture/mira-sdlc-v1.md` @ `6eecb1507ecea6c9d13db8f0c8979e4f685270dc`
(byte-identical to the Git object; SHA-256 `b692ed43662dbbb697cb1e59d707e5a3b02f54a9bfc10b8b4a8e316bb17393de`).
**Recon base:** `origin/main` @ `a54c4c88bd4f349c14884ff5701375f644bd7c31` (2026-10-03). All
`file:line` references are to that SHA unless marked.
**Brief:** `mira-sdlc-v1-final-evaluation-prd.md` (owner PRD, 2026-10-03).

**Authorship (disclosed per section).** The proposal in #4208 was written by a Claude session with
Codex as adversarial challenger. To avoid self-review, this evaluation splits roles:
- **Evidence clerk** (the same Claude lineage): §2 delta recon, the "today" half of §4, §10 and §16
  facts, the citation ledger, assembly. No verdicts.
- **Fresh drafter** (a new Claude context seeded only with the PRD, the proposal, the fact pack and
  three sourced research reports; no transcript): §1, §3, §5–§9 judgments, §11–§15, §17.
- **Codex blind verdict** (`gpt-6.1-sol`, read-only sandbox, isolated home, no network; produced
  *before* the fresh draft existed and without seeing it): an independent §1 verdict, §4 "required"
  contract, §5/§9 requirements, §12 classifications, §13 ranked changes, §21 readiness. Where the
  fresh drafter and Codex disagree, both are quoted; the clerk does not reconcile silently.
- **Verifier** (another fresh read-only context): re-checked every repository and external claim
  before publication; failures were fixed or dropped.

---

## 1. Executive verdict

### Steelman: REPLACE WITH ALTERNATIVE

1. **The Definition of Done is internally contradictory.** §3.5 lists "(b) Merged-not-deployed" as a
   way to satisfy "Done" (`mira-sdlc-v1.md@6eecb1507:308-311`), while item 6 of the same section says
   "'Merged' is not 'done' for anything that ships" (`:315`). A release-centric model (unit of 'done'
   is the RC, not the PR) wouldn't need this patch.
2. **"Exact SHA" never proves an identical artifact.** Staging and production each rebuild the image
   independently with `--no-cache --pull` (`deploy-staging.yml@a54c4c88b:372-379`,
   `deploy-vps.yml@a54c4c88b:525-540`) — source identity is proven, binary identity is not. A
   build-once/promote-the-same-digest pipeline removes this class of finding structurally instead of
   narrowing the claim in prose (the proposal's own G-25, `:154`).
3. **"Independent reviewer" is an organizational fact, not a technical one.** The lifecycle guard
   counts a Codex verdict only when posted by the repository owner account
   (`ui_surface_lifecycle_guard.py@a54c4c88b:1405-1416`) — independence today is "who holds the `gh`
   token," not two distinct credentials. Real service-identity separation (two scoped GitHub Apps)
   removes this by construction, not policy.
4. **Six workflows each reinvent a slightly different "exact SHA."** Staging receipt, acceptance JSON
   (no SHA/run id at all), production receipt, migration drift (filename-level), PR-association
   fallback, and the cheap-review head — six ad hoc identity mechanisms instead of one release packet
   carried through every stage.
5. **24h/72h observation and 168h receipt-freshness are literal sleeps with no durable resume.**
   Nothing survives the session that would act on them dying mid-window; a durable-workflow engine's
   signal/sleep/resume primitive is the textbook fit: "If the process running it crashes, the Temporal
   Service hands the work to another process, which rebuilds the state" (`research-orchestration.md`
   §1, quoting `docs.temporal.io/evaluate/understanding-temporal`).

**Replacement does not win.** None of the five is evidence GitHub-native primitives cannot express the
same contract — they are drafting gaps in identity/scope/provenance, and #4208's own §4 matrix already
names most as REPAIR/CONNECT work (`:462-511`). Replacing the control plane trades a working,
zero-new-infra system — 1,120 `v*` tags and 1,078 `rollback/*` tags at `a54c4c88b` (`git tag -l`), 90-day receipts, two already-run adversarial rounds — for a
durable-orchestration dependency with **no SDLC installation in this repo today**
(`research-orchestration.md` §1: "no Temporal server/worker container exists in this repo's compose
files"), one that would need to survive the very outage it exists to coordinate recovery from, whose
adoption the owner's constraints gate on a demonstrated trigger (PRD §12). Ratification means "adopting
the architecture and rules, not claiming every gap is already fixed" (PRD §21) — the same line.

### Steelman: ADOPT AS-IS

1. **The gate model is structurally sound and already adversarially tested.** Every gate names an
   existing artifact; principle 4 is testable; two independent Codex rounds already forced 35+
   corrections into this exact draft (`:572-634`) — the adversarial loop this evaluation re-runs has
   already run twice against this text.
2. **New code is minimal.** One metrics script, one receipt producer, a few-line `gate7_review.py` fix
   (`:462-511,544-546`) — exactly the "no new platform" posture the PRD demands.
3. **Much of it is already running by standing authorization.** Five owner decisions this document
   merely indexes are already in force (Appendix A, `:669-675`) — blocking ratification delays naming a
   lifecycle that is, in large part, already live.

**AS-IS does not win either.** The holes are exactly the stale-evidence/self-authorization failure
modes PRD §21 requires be understood, not stylistic imperfections: the DoD contradiction above; the
acceptance-scope hole leaving `mira-ask` with no receipt-proven identity (J3); candidate-checked-out
validators running with production/staging credentials (J4); a cheap-review lane the proposal's own
table admits has no mechanical merge consumer (`:487`); and two gates (§6 Gap 1, G1's consumer) that
are, right now, satisfied by agent prose alone. Adopt with these holes named and closed (§13), not
waved through on the strength of the parts already right.

### Verdict: ADOPT WITH CHANGES

- Keep GitHub as the control plane, agents as workers, CI as the fact-checker, Mike as the authority
  for consequential transitions — the architecture passes PRD §19's correctness/burden/migration-cost/
  evolvability criteria on today's evidence.
- Six concrete rule defects need fixing *in the document* before ratification, not after: the DoD
  contradiction, the acceptance-scope rule, the candidate-validator-trust rule, the reviewer-identity-
  independence claim, the missing R2 mechanical floor, and the cheap-lane consumer (§12, §13).
- `environment: production` has no GitHub-enforced protection today — "Mike authorizes" is pure
  doctrine (fact-pack B:33, D:61) — the single highest-leverage, zero-cost fix available (§10, §13.10).
- Merge Queue is **not eligible** for this repository today: GitHub's own statement limits it to Enterprise Cloud and "all public repos owned by organizations" (fact pack K1) and `owner.type` is `User`. Final classification **REJECT for v1**, trigger = the repo moves to an organization or GitHub changes eligibility; even then the queue's candidate SHA ≠ PR head conflicts with exact-head Codex binding. (The drafter's original DEFER reasoning is retained in §1b/§10 for transparency.)
- The authority matrix (§8) shows the biggest gap is not any agent role — branch protection doesn't
  distinguish risk class at all, so "Mike merges R3" and "Mike authorizes production" stay doctrine,
  not mechanism, unless §13's changes land.
- None of this requires Forge, Temporal, Backstage, or a new agent framework (§11, §15) — every fix is
  REUSE, CONNECT, or REPAIR of what's already in the repo.
- Ratify the architecture and the rules; treat the still-open security/identity items as sequenced
  work (§14), consistent with PRD §21's own instruction not to require every gap closed first.

**PRD §21 readiness, condition by condition (assessed against #4208 as written today, before §13's
changes land):**

| Condition | Met? | Why |
|---|---|---|
| No fundamental architecture flaw | TRUE | §3 — every gap found is drafting/wiring, not structural |
| Exact identity unambiguous | **FALSE** | §4 (full doc) + §9/§12 findings 1,2,4 |
| Objective gates ≠ agent prose alone | **FALSE** | §12 before-ratification findings 5,6 (R2 self-classification; cheap-lane consumer) |
| Stale-evidence invalidation defined | **FALSE** | §9 same-SHA-reuse gap; §12 finding 4 |
| Security trust boundaries understood | **FALSE** | §12 findings 1–4 — understood by this evaluation, not yet stated in the document |
| Deployment applicability ≠ review risk | TRUE | §3.1 principle 3, already correct |
| Hotfix/rollback remain practical | **FALSE** | §13 change 14 — no drill, no pre-staged fresh rollback evidence |
| No new platform required | TRUE | §11, §15 |
| Unresolved issues = normal follow-up PRs | TRUE | §14 — every remaining item is REUSE/CONNECT/REPAIR |
| Consistent with current `origin/main` | TRUE | per the delta recon (§2, out of this agent's scope; fact-pack §A: no material drift) |

**Six of ten TRUE.** Ratification readiness: **NOT YET** — ratify after the four before-ratification
rule fixes in §12/§13 land in the document text (no code changes required for three of the four), at
which point this table should read ten of ten TRUE.

---

### 1b. Codex blind verdict vs fresh drafter — convergence and disagreements (evidence clerk)

Both reached **ADOPT WITH CHANGES** and both rate #4208 **NOT READY as drafted, ready after the rule
fixes land in the document**. Codex's blind verdict is reproduced in full in Appendix B. Convergent
points: Decisions 1–5 (YES / keep 0 / NO / NO / DELETE); the DoD contradiction; the acceptance-scope
hole (`mira-ask`, J3); candidate-supplied validators (J4); owner-account authentication of the Codex
attestation (J8); the cheap lane's human-only consumer; the need for explicit lifecycle states with
GitHub homes; CFR denominator = deployments that reached the swap step; Forge/Temporal/Backstage/new
framework deferred or rejected.

| Topic | Fresh drafter | Codex (blind) | Clerk note (evidence) |
|---|---|---|---|
| Merge Queue | DEFER; doubts the org-only eligibility claim because the ruleset already grants a `RepositoryRole 5` bypass on a User-owned repo | DEFER; wants a bounded compatibility investigation | Official GitHub changelog (fact pack K1): "available on private and public repos on the GitHub Enterprise Cloud plan and all public repos owned by organizations." Ruleset bypass actors are a different feature and prove nothing about merge-queue eligibility. `owner.type` is `User`. **Clerk records: NOT ELIGIBLE today → REJECT for v1; trigger = repo moves to an organization or GitHub changes eligibility; even then the candidate-SHA ≠ PR-head conflict with Codex binding is unresolved.** The two drafts' DEFER is kept visible; the eligibility fact decides. |
| What must change *before* ratification | 6 rule defects: DoD contradiction, acceptance scope, candidate-validator trust, reviewer-identity limitation, R2 mechanical floor, cheap-lane consumer | 4 rule defects: human-only review consumption + risk floor, candidate-controlled validators, reviewer/owner authorization provenance, same-SHA reuse and acceptance scope | Same set, grouped differently; union is §13 changes 1–8, 10. |
| `prevent_self_review` on `production` | Required reviewer **without** `prevent_self_review` (deadlock in a one-owner repo; `ota-production` already shows it) | Add a human gate "where consequential authorization is needed", no stance on the flag | Fact pack K4 confirms the flag's semantics. Clerk records the drafter's position as the recommendation and flags it as owner decision 6. |
| Risk assignment rule | "escalate one class on disagreement" is weak; add a mechanical floor for R2 signals | effective risk = **max(declared, trusted-path floor, reviewer findings)**; downward override needs owner decision | Codex's max-rule is the sharper formulation; §13 change 7 adopts it. |
| Observation windows | provisional 24/72 h, revisit at 30 days | provisional; do not hold parallel releases for a window; `OBSERVATION_INCOMPLETE` state when superseded | Compatible; the state is added to §5. |
| Rollback | daily scheduled re-acceptance of the production SHA so a ≤168 h rollback receipt always exists | maintain fresh known-good candidates before emergencies; drill must exercise authorization, not receipts | Compatible; §13 change 14 carries both. |
| Candidate-supplied validators (J4) | **Before ratification**: state the rule; an unmerged PR-branch SHA can be staged and its provisioner run with staging credentials (`deploy-staging.yml` checks commit existence only) | **Before ratification**: "specify trusted current-policy validators and controlled candidate-harness eligibility" | Verified by the clerk: `deploy-staging.yml:70-81` accepts any repository commit; `retrieval-acceptance.yml:17-19` fires on every successful staging deploy. Both agree on classification. |
| Eval fixture denominator | 65 executed | 65 (loader globs) vs 67 files | Agree (J7). |
| Codex cost metric | NOT COMPUTABLE (no cost field in the envelope) | not raised | Clerk confirms: the envelope regex has no cost field (`ui_surface_lifecycle_guard.py:635-646`). |

**Independence disclosure.** The fresh drafter found `codex-blind-verdict.md` in the shared scratchpad
and read it before drafting (its Evidence limits paragraph says so). Its claims were re-grounded in
source, but its state names, acceptance-status terms and about three of five REPLACE-steelman bullets
track Codex's framing. The two judgments are therefore **partially** independent, not fully; the
clerk's reconciliation above and the verifier pass are the remaining controls. The Codex verdict itself
was produced before any draft existed and is unaffected.

---

## 2. Delta recon against current `main`

| Item | Previous assumption (#4208) | Current fact | Materiality | Affected section |
|---|---|---|---|---|
| Recon base | `32bcaa67e88fc2338103dd0b77b61e9ad3d76e57` | `a54c4c88bd4f349c14884ff5701375f644bd7c31`; 1 commit ahead (#4207 `fix(mobile): BACK from a chat lands on the project's thread list…`) | none | — |
| Files changed since base | — | `mira-mobile/src/screens/UnifiedRoot.tsx` (+124/−17), `mira-mobile/src/unified/UnifiedProjectRoot.tsx` (+71), `mira-mobile/src/unified/unified-project-root.css` (+22), `mira-mobile/tests/unified-root.test.tsx` (+263/−6) | none: no workflow, hook, script, registry, rule or doc cited by #4208 is touched | — |
| #4208 head | `6eecb1507` | unchanged; draft; `mergeStateStatus: BEHIND` (strict up-to-date) | none | — |
| #4208 checks | — | all SUCCESS; SKIPPED on the docs-only path: Unit Tests, Eval Offline, Docker Build Check, SimLab Grader Gate, Bench Harness, Module Suites, Drive Pack Extract, OCR Recall Gate; `Secrets Scan` ran (not gated); `CI Gate` SUCCESS | none; confirms the docs-only skip path #4208 §1.3 describes | — |
| Line numbers cited by #4208 | at `32bcaa67e` | identical at `a54c4c88b` for every cited file (none of the four changed files is cited) | none | — |

Facts discovered during this evaluation that #4208 did not record (not drift — omissions):

| Fact | Source | Affected #4208 section |
|---|---|---|
| Environments `production`, `staging`, `staging-deploy` have no required reviewers, wait timers or branch policies; `ota-signing`/`ota-canary`/`ota-production` are referenced by `ota-release.yml` but do not exist | `gh api repos/Mikecranesync/MIRA/environments`; `ota-release.yml:10,205,371,682-696,1097` | §3.3 G3 ("Mike authorizes"), §3.7 (OTA rollback), §3.10 |
| GitHub secret scanning, push protection, validity checks, Dependabot security updates: `disabled`; Dependabot alerts endpoint 404; code scanning default setup `not-configured`; no attestation workflow | `gh api repos/Mikecranesync/MIRA --jq .security_and_analysis`; `…/vulnerability-alerts`; `…/code-scanning/default-setup`; `git grep attest-build-provenance` = 0 | §3.10, §4 |
| Staging receipt verification uses a fixed `DEFAULT_REQUIRED_SERVICES = ("mira-hub","mira-web")` and never compares it to the dispatched `services`; prod default targets include `mira-ask` | `tools/staging_receipt.py:35`; `deploy-vps.yml:224-226,478` | §3.3 G3, §4 CONNECT-1 |
| Drift and acceptance validators run from the candidate tree (`approved_rc_sha` / deployed SHA) with credentials, not from a pinned trusted base | `deploy-vps.yml:232-290`; `retrieval-acceptance.yml:79-112` | §3.10 |
| `apply-ingest-migrations.yml` uses `environment: production` for both targets | `apply-ingest-migrations.yml:59` | §3.3 G3 migrations row |
| Mutable action tags in secret-bearing jobs (`actions/checkout@v6` in `apply-migrations.yml:72`; `oven-sh/setup-bun@v2` in `retrieval-acceptance.yml:90`) | files | §3.10 |
| The Codex attestation is trusted by **owner-account authorship** of the comment; the review lane runs under that account | `tools/ui_surface_lifecycle_guard.py:1405-1416` | §3.1 principle 6, §3.12 |
| `gate7_review.py` exit codes: #4208 §1.2 correctly says 0 for PASS/BLOCK/UNKNOWN/post-failure, but its G-22 ("exit 0 for every outcome") is overbroad — the lane returns 2 on provider failure, 3 on budget refusal, 4 on an oversized diff | `tools/gate7_review.py:1180,1214,1296,1309,1362` | §1.2, G-22 |
| Eval fixtures: 67 files, 65 matched by the loader globs (#4208 says 67 executed) | `tests/eval/run_eval.py:190-191` | §1.2, D21, §3.11 |
| `docs/GATE_AND_BLOCKER_REGISTER.md:174` already records strict up-to-date as "structural" with mitigations at `:176-190`; its line 172 (`ci.yml` `branches:[main]`) is stale since `ci.yml:33-41` | file | §3.9, merge-queue question |

**Verdict on drift: NO MATERIAL DRIFT.** The recon base for this evaluation is `a54c4c88b`.

---

## 3. Architecture verdict

The recommended lifecycle from intake through closure is the one the proposal already draws
(`mira-sdlc-v1.md@6eecb1507:211-224`), with the §5 state model and §13 textual corrections applied:

```
Issue (+PRD/ADR as required) ─ Risk class written ─► G0 Ready to Build
  branch off origin/main ─ implement test-first ─ cheap lane clean ─► G1 Ready for Review
  required contexts green ─ [specialist findings] ─ [Codex exact-head GREEN] ─► G2 Ready to Merge
  SHA-conditioned merge ─ tag + rollback checkpoint (automatic)
  (only if the change ships)
  staging deploy ─ staging receipt ─ acceptance receipt (capability-scoped) ─► G3 Ready for Production
  Mike-authorized dispatch ─ production deploy ─ production receipt ─ post-deploy smoke
  observation window ─► G4 Closed/Observed
  (failure) ─► incident issue ─ restoring action ─ regression disposition ─► new G0
```

Three things make this correct as an architecture, not merely a description of current practice:

1. **Two independent dimensions, not one** — review risk (R0–R3) and deployment applicability are
   kept separate (`:170-174`), so a governance-only R3 change gets rigorous review with no production
   receipt, and a one-line R1 UI fix gets full deploy evidence when it ships. Correct shape; don't
   collapse it into one scale.
2. **A gate is a named artifact for an exact identity, not prose** (`:166-169`) — "exact identity"
   needs the Identity Contract (§4, out of this agent's scope) to say *which* identity (source SHA vs.
   runtime SHA vs. image id) a given artifact proves; §9/§12 supply the missing precision where the
   gap is largest (staging acceptance).
3. **Live automation outranks doctrine; an unenforced rule is a target, not a control** (principle 5,
   `:178-179`) — §8 shows three doctrine-only load-bearing controls (R3-merge-by-Mike,
   production-authorization-by-Mike, the guard's required-status binding) that must either be named as
   doctrine honestly or converted to mechanism. Either is acceptable; silently treating them as
   enforced is not.

GitHub remains the correct control plane: nothing in the fact pack, proposal, or research shows a
GitHub-native primitive incapable of expressing a needed contract — every gap is drafting (a rule not
yet written precisely) or wiring (CONNECT), never structural (§10, §11).

---

---

## 4. Identity Contract

### 4a. What identity each stage actually produces today (evidence clerk)

| Stage | Identity recorded today | Produced by | Verified by | Invalidated when |
|---|---|---|---|---|
| Cheap review | `head:` SHA captured once; diff fetched separately; `verdict`, `model`, `cost_usd`, `run_id` in `[CHEAP-REVIEW]` | `tools/gate7_review.py:705-721,1386-1390` | nobody mechanically; the merger reads the comment | never automatically (a new head simply leaves a stale comment) |
| Codex review | `reviewed_sha` + `reviewed_body_sha256` + `base_sha` + `status` | `scripts/adversarial-review.sh` under the owner account | `tools/ui_surface_lifecycle_guard.py:635-646,1405-1416` for guarded paths; ledger `.mjs` | head or body changes (by design) |
| Merge candidate | PR head SHA containing current `main` (strict) | GitHub | branch protection (6 contexts) | any push to `main` (BEHIND) |
| Merged | merge commit SHA (merge/squash/rebase allowed) | GitHub | `version-tag.yml` tags it; `deploy-vps.yml:140-148` maps it back to a PR head (fallback: first associated PR) | — |
| Tag | `v*` + `rollback/*` at the merge commit (unprotected; patch bump on unparseable subject) | `version-tag.yml`; `next_version.py:89-96` | none | tag moved (nothing prevents it) |
| Staged | `approved_rc_sha`; runtime `gitSha` for **selected** Hub/Web; local image ids (not registry digests); images rebuilt `--no-cache --pull` | `deploy-staging.yml:125-134,372-379,432-450` | self; `staging-receipt-<sha>` (90 d) | receipt age > 168 h at prod time |
| Accepted | live Hub `gitSha` at run start; JSON `{base, ran_at, rows}` (no SHA, no run id); verdict re-read fails open | `retrieval-acceptance.yml:61-81,165-174`; `tools/qa/retrieval_acceptance.py:590-615` | nobody downstream | SUPERSEDED only when the re-read succeeds and differs |
| Prod-authorized | `approved_rc_sha` + Staging Gate success on the mapped PR head + receipt (fixed Hub/Web requirement) + filename-level drift = 0 | `deploy-vps.yml:71-81,132-227,305-310`; `tools/staging_receipt.py:35`; `tools/migration_drift.py:53-59` | self | — (no human-authorization record; `environment: production` has no rules) |
| Deployed | `PRIOR_SHA` from host checkout; runtime `gitSha` for selected Hub/Web; local image ids; `production-receipt-<sha>` (90 d) | `deploy-vps.yml:400-403,655-711,733-775` | self | — |
| Observed | none bound to the receipt; canaries on cron; smoke on push/PR/dispatch (muted 10 min around a deploy) | `smoke-test.yml:30-45,159-179` | nobody | — |
| Artifact digest | not recorded as a registry digest anywhere; no attestations | — | — | — |

### 4b. Required contract and silent substitutions (Codex blind verdict, verbatim where quoted)

The following is the **required contract**, not a claim of current enforcement.

| Stage | Authoritative identity | Produced by | Verified by | Invalidated when |
|---|---|---|---|---|
| Requirement/classification | Requirement revision, criteria, effective risk/family, applicability | Issue/PR records plus trusted classifier | Trusted policy consumer | Requirements, scope, risk, or policy changes |
| Cheap review | Repository/PR, head SHA, comparison base, exact reviewed-byte digest, coverage, producer version | Trusted cheap-review producer | Trusted G2 consumer | Candidate/input/coverage changes; verdict revoked |
| Codex review | Head SHA, exact body digest, comparison base, reviewer run and trusted producer identity | Independent trusted-base reviewer | G2 consumer; applicable guard | Head/body changes, revocation, relevant policy changes |
| Integration candidate | PR test-merge SHA; queue SHA if queue adopted | GitHub candidate construction | Required integration checks | Base, head, or group membership changes |
| Merged | Actual main commit(s), tree identity, explicit mapping to reviewed PR candidate(s) | GitHub merge | Trusted release consumer | Mapping missing, ambiguous, or candidate content differs |
| Release candidate | RC SHA plus per-component inclusion, service set, build plan, schema/config references | Release assembly | G3 consumer | RC, targets, required dependencies, or build policy changes |
| Staging deployed | Deployment run **and attempt**, RC SHA, service image IDs/digests, runtime identities, environment generation | Staging controller | Trusted receipt verifier and runtime probes | Relevant redeploy, rebuild, schema/config/provider change |
| Accepted | Acceptance run/attempt, staging generation, scoped artifact/runtime map, suite/harness versions and verdicts | Trusted acceptance producer | G3 consumer | Required scope/context changes, supersession, expiry, later failure |
| Production authorized | Owner authorization bound to the release packet and exact receipt IDs | Mike or explicitly delegated authority | Trusted deployment controller | Packet changes, expiry, revocation |
| Production deployed | Run/attempt, actual per-service source and artifact identity, target/config/schema context | Production controller | Receipt verifier and runtime probes | Relevant deployment or operational change |
| Observed/closed | Production deployment identity plus smoke and observation coverage interval | Probes/canaries; closure consumer | Deterministic coverage checks; semantic attribution where needed | Attributable failure or evidence found invalid |

**Places where identities currently substitute for others:**

1. Cheap-review metadata SHA substitutes for independently fetched diff identity. (`tools/gate7_review.py:705`)
2. Current owner-account authorship substitutes for independently established reviewer identity. (`tools/ui_surface_lifecycle_guard.py:1409`)
3. PR-head evidence substitutes for merged-source evidence without an explicit content mapping; the fallback can select an unrelated associated PR. (`.github/workflows/deploy-vps.yml:144`)
4. CI documentation conflates “checks on head” with what candidate checkout executes; default checkout is used. (`.github/workflows/ci.yml:53`)
5. Staging Gate workflow success substitutes for an evaluation that ran, although scope and Dependabot skips succeed. (`.github/workflows/staging-gate.yml:80`)
6. Live Hub SHA substitutes for the triggering staging deployment generation. (`.github/workflows/retrieval-acceptance.yml:61`)
7. Source equality substitutes for tested artifact equality across separate `--pull` rebuilds. (`.github/workflows/deploy-staging.yml:372`, `.github/workflows/deploy-vps.yml:525`)
8. Selected Hub/Web runtime identities substitute for a release-wide identity unless remaining services are separately mapped. (`.github/workflows/deploy-vps.yml:741`)
9. Host checkout `PRIOR_SHA` substitutes for the prior running software set. (`.github/workflows/deploy-vps.yml:400`)
10. Migration filename presence substitutes for applied content/schema identity. (`tools/migration_drift.py:53`)
11. A SHA-named artifact substitutes for deployment scope/generation unless its payload is checked against targets. (`.github/workflows/deploy-vps.yml:195`, `.github/workflows/deploy-vps.yml:224`)
12. Workflow-controller `headSha` substitutes for deployed SHA if metrics read run metadata alone; dispatch has a separate target input. (`.github/workflows/deploy-vps.yml:28`)
13. Tags substitute for known-good recovery candidates if treated as rollback proof; tagging happens at merge. (`.github/workflows/version-tag.yml:105`)
14. Updated capability evidence can substitute for deployed code identity unless its separate evidence-record commit is preserved. *(Proposal §3.3, line 284.)*

Docker image IDs are useful content identities; they are not registry manifest digests. V1 must preserve both stage artifact maps and state explicitly when acceptance proves source behavior rather than an identical production artifact. Promote tested images where practical; defer signing infrastructure.

### 4c. Fresh drafter's position

The fresh drafter treated §4 as out of scope and defers to 4a/4b; its §9 (acceptance receipt fields) and §12 findings 1, 2 and 4 refine the rows "Accepted", "Prod-authorized" and the same-SHA reuse rule.

---

## 5. Lifecycle state model

**PRD §7.C decision:** `DEPLOYED`/`OBSERVING`/`CLOSED`/`DEPLOY_FAILED`/`FAILED_OBSERVED` are **explicit
lifecycle states**, not sub-states hidden inside G4 — multiple concurrent changes need independently
readable status without a reader having to open G4's internal checklist to know which one applies.

### States and GitHub homes

| State | Meaning | GitHub home | Written by |
|---|---|---|---|
| `OPEN` | Issue/PR exists, G0 not yet passed | Issue or PR | Claude/Mike |
| `READY` | G0 passed | PR body `Risk:` line + linked issue | Claude |
| `IN_REVIEW` | G1 in progress | PR checks + `[CHEAP-REVIEW]`/`[CODEX-ADVERSARIAL-REVIEW]` comments | Claude/Codex/cheap |
| `MERGED` (non-shipping) | G2 passed, R0/governance-only | Merge commit; `v*`/`rollback/*` tags (automatic) | GitHub |
| `MERGED_NOT_DEPLOYED` | G2 passed, ships, no RC yet | Comment on the owning issue naming the RC it is batched into | Claude |
| `STAGED` | Staging + acceptance receipts exist for the RC SHA | `staging-receipt-<sha>`, `acceptance-receipt-<sha>` artifacts, linked from the issue | `deploy-staging.yml`, `retrieval-acceptance.yml` |
| `AUTHORIZED` | Mike's dispatch or linked authorizing comment recorded | `deploy-vps.yml` dispatch inputs/actor + a PR/issue comment | Mike |
| `DEPLOYED` | Production receipt exists | `production-receipt-<sha>` artifact | `deploy-vps.yml` |
| `DEPLOY_FAILED` | Swap attempted, may have mutated runtime | Workflow run conclusion + restoration note on the issue — the workflow "deliberately leaves the new containers in place" on a failed health-gated swap (`mira-sdlc-v1.md@6eecb1507:86`) | `deploy-vps.yml` + Mike |
| `OBSERVING` | Smoke dispatched, window running | Explicit `smoke-test.yml` dispatch run id on the issue | Claude |
| `CLOSED` | Window elapsed clean, all DoD criteria met | Issue closed + final comment pointing at every artifact | Claude/Mike |
| `FAILED_OBSERVED` | Attributable failure during the window | `incident` issue (ADD-2) linked from the owning issue | Canary/Claude |
| `INCIDENT → restoring → disposed` | §3.8 workflow | Comments on the `incident` issue (`first_seen`, `deploy_sha`, `restored_at`, `restoring_action`, disposition) | Claude/Mike |

### Transitions and failure paths

```
OPEN → READY → IN_REVIEW → MERGED ────────────────────────────► CLOSED        (non-shipping)
                         → MERGED_NOT_DEPLOYED → STAGED → AUTHORIZED → DEPLOYED → OBSERVING → CLOSED
                                                                            │          │
                                                                            ▼          ▼
                                                                     DEPLOY_FAILED  FAILED_OBSERVED
                                                                            │          │
                                                                            └──► INCIDENT ──► restoring ──► disposition ──► new OPEN (for the fix)
```

The original change stays `FAILED_OBSERVED`, not `CLOSED`, until its disposition comment lands — it
does not silently inherit the fix's eventual success.

### Fixing the proposal's Done defect (§13 change 1)

§3.5 enumerates `MERGED_NOT_DEPLOYED` as satisfying "Done" while also saying merged is never done for
anything that ships. Fix: `MERGED_NOT_DEPLOYED` is explicitly **non-terminal** above; only `CLOSED` (or
non-shipping `MERGED`) is Done — no new states beyond what G3/G4 already imply.

### Concurrency

The unit of state is the **owning issue**, not the RC. One issue : one timeline, via its own
append-only comment thread (no shared lock). One RC can batch N issues; each links to the shared RC
artifacts (tags, receipts) rather than sharing a mutable document, so closing issue A implies nothing
about issue B on the same RC (PRD §4.C) — and no new store is needed: every state above already has a
durable GitHub home.

---

---

## 6. Risk-model assessment

**R0–R3 is correct for v1.** It separates "no review," "light," "behavioral," and "can hurt someone or
break trust" — matching distinct G1/G3/G4 evidence rows already differentiated downstream per family
inside R3 (`:201,245-287`). Splitting R3 further now, with no classification data yet, is premature;
deferring to v1.1 (`:207`) is right.

**Gap 1 — self-classification has no mechanical floor outside the lifecycle guard's path list.**
Principle 4 (`:175-177`) protects obligations that already fire regardless of class — it does not
force the *written* class to be correct. The one mechanical floor is the guard's control-path allowlist
(`ui_surface_lifecycle_guard.py@a54c4c88b:70-124`), which is why Codex's "R0 loophole" was closeable for
governance-floor paths (`:621`) but nothing equivalent exists for R2's tenant/safety/migration signals,
still advisory "aids" (`:189-194`). An implementer can mislabel an R2 change as R1 outside the guard's
path list and nothing but a reviewer's disagreement catches it — PRD §20.5's "can an agent still
under-classify its own change?" is yes, outside the guarded-path list.

**Gap 2 — the document contradicts its own classification.** §3.2's governance floor lists "process
docs" as R3 (`:201`), but the minimal-changes table classifies the rollback runbook itself
**"R0 docs + operation"** (`:539`, REPAIR-2) — same genre, opposite class, two sections apart. Not a
missing label; a direct internal contradiction.

**Recommended exact change:** extend the lifecycle guard's allowlist (or a narrow companion check
reusing its shape) to cover R2's safety/tenant/migration signals as a mechanical floor, the way R3's
governance paths already work — a REPAIR, not a new platform. List rollback/hotfix runbooks and the
review-producer tooling itself explicitly under the governance floor.

---

---

## 7. Gate-model assessment

| Gate | Assessment | Exact change |
|---|---|---|
| **G0** | Sound; CP-before for architecture/migrations correctly reuses existing convergence-doc evidence. No mechanical check that the written `Risk:` line exists before review begins. | Add a tiny CI step (fails the step, not the merge) that greps the PR body for a `Risk:` line before the cheap lane runs — closes part of PRD §20.5 cheaply. |
| **G1** | The cheap lane is "required" by owner mandate but the proposal's own §4 table says its consumer is "the merger reading `head:`/`verdict:`" (`:487`) — no mechanical G1→G2 gate exists; a `BLOCK` verdict does not block merge today (confirmed: `gate7_review.py` returns 0 for every rendered outcome, only 2/3/4 for infra failures, fact-pack J1). | Either post the cheap-lane verdict as a GitHub check-run bound to the current head (a standard Actions capability, zero new infra) so a `BLOCK` becomes a seventh required context, or stop calling it "required" and say "advisory, human-read" in the DoD. |
| **G2** | Structurally sound; the SHA-conditioned merge row correctly names `gh pr merge --match-head-commit` (research-github-native.md §9) but nothing in the proposal's workflow set actually invokes it today. | Wire `--match-head-commit <reviewed sha>` into whatever performs R3 merges (`tools/pr-merge-blocker.sh` or the merge skill) — REPAIR, not ADD. |
| **G3** | Where the material security/identity gaps concentrate — see §9 and §12 for the acceptance-scope hole, candidate-supplied validators, and the PR-association fallback. | See §9, §12, §13 changes 2–3, 11. |
| **G4** | Outline is sound but the 24h/72h windows are provisional defaults, not measured thresholds — the proposal's own baseline admits "Change failure rate and MTTR: not derivable until ADD-2 exists" (`:425`). | Treat as provisional; revisit only at the already-proposed 30-day review (implementation step 12). |

**Capability-scoped vs. repo-wide (PRD §20.14):** G0–G2's required-context set (`ci-gate`, `Legacy UI
Lifecycle Guard`, `staging-gate`) is correctly repo-wide — it is cheap, fast, and a legitimate floor
every PR should pay. G3's acceptance evidence must NOT be repo-wide the way it is drafted today
(`mira-hub`-in-services triggers the full retrieval suite regardless of what capability changed) — it
must be capability-scoped per §9, or every PR touching any rebuilt service pays the full suite cost
PRD §4.D explicitly warns against.

---

---

## 8. Agent authority matrix

Actors: **Impl**=Claude implementer, **Spec**=specialist subagents, **Cheap**=cheap review model,
**Cdx**=Codex reviewer, **Auto**=deterministic CI, **Dep**=deployment workflows, **Mike**.
A=ALLOWED, AE=ALLOWED WITH EVIDENCE, ROA=REQUIRES OWNER AUTHORIZATION, P=PROHIBITED. ROA never applies
to Mike's own column (the owner can't require his own authorization) — his cells are **A**, or **AE**
where evidence-only-completion (Cluster Law 1) applies to everyone. No cell is left undefined. Shown:
the **proposed** model; divergences from what's enforced **today** are called out below.

| Action | Impl | Spec | Cheap | Cdx | Auto | Dep | Mike |
|---|---|---|---|---|---|---|---|
| create issue | A | A | P | P | P | P | A |
| classify risk | AE | AE | P | AE | P | P | A |
| change risk upward | AE | AE | P | AE | P | P | A |
| change risk downward | ROA | P | P | P | P | P | A |
| modify production workflows (`.github/workflows/**`) | AE | AE (findings) | P | AE | AE | P | A |
| modify review machinery (gate7, adversarial-review*, lifecycle guard, allowlists) | AE | AE | P | AE | AE | P | A |
| write tests | A | A | P | P | P | P | A |
| run tests | A | A | P | P | A | P | A |
| declare tests passed | AE | AE | P | AE (verdict only) | A | P | AE |
| create review artifact | P (own PR) | AE | AE | AE | A | A (receipts) | A |
| merge PR | AE (R0–R2); ROA (R3) | P | P | P | P | P | A |
| deploy staging | AE | P | P | P | P | A | A |
| authorize production | P (prepares only) | P | P | P | P | AE (mechanical checks) | A |
| deploy production | ROA (dispatches only once authorized) | P | P | P | P | AE | A |
| waive gate | ROA (requests only) | P | P | P | P | P | A |
| open incident | A | A | P | P | A | P | A |
| close incident | AE (disposition required) | AE | P | P | P | P | A |
| mark lifecycle closed | AE | P | P | P | P | P | A |

**Where today diverges materially from proposed (the load-bearing gaps):**

| Action | Today (enforced) | Proposed | Why it matters |
|---|---|---|---|
| modify production/review-machinery workflows | Effectively **A** for any write-access actor — the lifecycle guard posts a status but is **not** a required context (G-15, `tools/ui_surface_lifecycle_guard.py@a54c4c88b:70-124`; `ui-lifecycle-guard.yml@a54c4c88b:40-46`) | **AE** — but this requires the admin action CONNECT-2/3 (#3657), still open | The proposal does not close this gap; it is blocked on a GitHub-settings action, not code |
| merge PR (R3) | **A** for any write-access actor once contexts are green — 0 required approvals apply uniformly, branch protection carries no risk-class concept | **ROA** (Mike/delegate) | Doctrine only; no mechanical check exists or is proposed beyond `--match-head-commit` (§7, §13 change 9) |
| authorize production | **A**, mechanically — `environment: production` has **no protection rules** (fact-pack B:33, D:61); "Mike authorizes" is pure doctrine | **ROA** | Single largest enforcement gap in this matrix; §13 change 10 is the fix |
| waive gate | **A** for anyone who can apply `shared-line-ok`/hold labels — not Mike-exclusive mechanically | **ROA** | The proposal states "no label bypass... v1 adds none" (`:447`) for the lifecycle guard specifically, but does not revisit the *pre-existing* label bypasses on other gates |
| close incident | No defined evidence requirement — the `incident` label doesn't exist yet (ADD-2) | **AE** with a required disposition comment (§3.8) | This is the actual improvement ADD-2 buys, not a correction of an existing gap |

**Key principle applied to "declare tests passed":** every actor's declaration is `AE`, never `A` — the
named tests must appear in the `ci-gate` log (DoD item 6, `:315-316`), and `Auto` (deterministic CI) is
the independent decider. This is the one row where PRD §8's "agents produce candidate evidence; the
system independently verifies" is already fully honored by the proposal as written, for every actor
including Mike.

---

---

## 9. Staging acceptance model

**Binding rule:** `changed/deployed production delta → affected capability → actual deployed service
set (the real `services` dispatch input, never a hardcoded default) → required acceptance suites tagged
to that capability → one generation-bound receipt`. Answers PRD §4.D's "relevant evidence for the
affected capability" over "all tests for every rebuilt service": a `mira-web`-only release with no
retrieval-tagged capability changed makes the retrieval suite `NOT_APPLICABLE`; a changed `mira-hub`
retrieval path requires it.

**Receipt fields (extends CONNECT-1a, `:495,531-533`):** schema id, pinned deployed `gitSha`,
triggering staging-receipt id + run id, acceptance run id, per-scenario verdicts tagged by capability,
capture status, `ran_at`, expiry, and — the J3 fix — **the actual services list the receipt covers**,
compared against `deploy-vps.yml`'s dispatch `services` input rather than today's fixed
`("mira-hub", "mira-web")` default (`staging_receipt.py@a54c4c88b:35`; `deploy-vps.yml@a54c4c88b:224-226,478`
— default prod target is `mira-hub mira-web mira-ask`, so `mira-ask` deploys with no proof at all).

| Concern | Rule |
|---|---|
| **Skipped vs. not-applicable** | A scenario outside the deployed capability set is `NOT_APPLICABLE` (never silently absent). A scenario **inside** scope that didn't run (capture skip, historical deploy) is `SKIPPED` and **blocks** authorization for that capability — today's capture step "skips historical deployments and exits 0" regardless of scope (`mira-sdlc-v1.md@6eecb1507:83`); this must stop reducing to a clean exit when the capability is in scope. |
| **Superseded** | Verdict-time SHA re-read must fail **closed** (REPAIR-7 already proposed, `:496,532`; today it fails open, `.github/workflows/retrieval-acceptance.yml@a54c4c88b:165-174`). A drift during acceptance invalidates the receipt for the drifted SHA, full stop — no fallback to an older passing receipt. |
| **Infra/provider failure** | A distinct `INFRA_UNASSESSED` status, retried within one bounded re-run, blocks authorization for the affected capability without being recorded as a product regression. Today the capture-skip and health-fetch-fail paths both reduce to "exit 0," conflating "nothing to check" with "couldn't check." |
| **Same-SHA redeploy** | A redeploy that rebuilds the image (`--no-cache --pull`) is a **new deployment generation**. Reuse of a prior acceptance receipt requires the new generation's runtime identity to still equal the receipt's pinned SHA **and** no relevant schema/config/provider change since — not "SHA unchanged within 168h" alone, which the proposal's current wording states (`:271,495`) and which would let a freshly-rebuilt, never-independently-accepted image ride a stale receipt. |
| **Reuse** | Same rule as above — reuse requires the new generation to be provably equivalent, not merely SHA-identical. |
| **Expiry** | 168h from acceptance completion (matching the existing staging-receipt freshness window — one system-wide freshness constant, not two). |
| **Fail-closed** | Missing, malformed, unparseable, or scope-mismatched receipts block — generalizing the REPAIR-7 principle to the receipt's whole schema, not only the SHA field. |

---

---

## 10. GitHub-native opportunity review

| Control | Repo state today (fact pack) | Classification | Why |
|---|---|---|---|
| **Rulesets** | One ruleset (17097034): `deletion`, `non_fast_forward`, `pull_request` (0 approvals), `required_status_checks=[staging-gate]`; coexists with classic protection (6 contexts, `strict:true`) — the two stack, neither overrides (`docs.github.com/.../about-protected-branches`: "Only a single branch protection rule can apply at a time... This restriction does not apply to rulesets," per `research-github-native.md` §3) | BORROW PATTERN | Document the union of both mechanisms explicitly as the real required-check set; don't consolidate into one ruleset until org-ownership (below) is settled |
| **Merge Queue** | `0/62` workflows use `merge_group`; repo `owner.type` confirmed **`User`** live. The strict-up-to-date friction Merge Queue would target is real and documented (`docs/GATE_AND_BLOCKER_REGISTER.md:174-190`: "Structural, not fixable here" + mitigation ideas at `:176-190`) | **REJECT for v1 (not eligible)** — drafter proposed DEFER | GitHub: merge queue is available on Enterprise Cloud and "all public repos owned by organizations" (fact pack K1); this repo's `owner.type` is `User`. The drafter noted the ruleset's `RepositoryRole 5` bypass actor on this User-owned repo as a reason to doubt org-only claims; bypass actors are a different feature and do not bear on merge-queue eligibility. Even if eligible later, none of `GATE_AND_BLOCKER_REGISTER.md`'s mitigations preserve Codex's exact-head binding (candidate SHA ≠ PR head, `research-github-native.md` §1) |
| **Environments / deployment protection rules** | `production`/`staging`/`staging-deploy` exist with **no protection rules** — no required reviewers, no `prevent_self_review`, no branch policy (fact-pack D, B:33) | **REUSE NOW** | Free on public repos, zero migration cost, directly converts "Mike authorizes production" from doctrine to a GitHub-enforced gate (§8, §13 change 10) — but see the caveat below |
| **Reusable workflows** | No `workflow_call` composition found for the staging-gate logic | BORROW PATTERN | Would unify "what counts as green" into one definition; no urgency, no security exposure from deferring |
| **Artifact attestations** | `0` workflows reference `attest-build-provenance` or the attestations API (fact-pack J2, corrected from an earlier zero-digest-404 overclaim) | **DEFER** | No build-artifact-publish step exists to attest; deploys reference a source SHA and rebuild, not a published artifact pulled by digest |
| **Dependency review** | Dependabot config omits `mira-hub`, `mira-mobile`, `mira-cmms`, `mira-pipeline`, `mira-bridge`; no `dependency-review-action` on PRs (fact-pack D) | **REUSE NOW** | Free on public repos, PR-time block, fills a gap the current ast-grep/gitleaks pattern-scanning doesn't cover |
| **OpenSSF Scorecard** | Not run | BORROW PATTERN (run once as a report) | Advisory by default; would independently check the exact `pull_request_target`/pinned-dependency exposure already found in §12, at near-zero cost |
| **Secret scanning / push protection** | Both **disabled** at the repo level (fact-pack D); local gitleaks hook is opt-in and fails open (S16) | **REUSE NOW**, cost unconfirmed this pass | Closes a real gap local hooks cannot guarantee; none of the three supplied research files state its public-repo pricing — treat "free on public" as plausible general GitHub knowledge, not a sourced claim, and confirm before relying on it in §13/§14 |

**Clerk note on Merge Queue (evidence wins):** the official GitHub changelog states merge queue is "available on private and public repos on the GitHub Enterprise Cloud plan and all public repos owned by organizations" (fact pack K1); this repository is owned by a User account. The evaluation therefore records Merge Queue as **REJECT for v1 — not eligible**, with the trigger "repository moves to an organization or GitHub changes eligibility". The drafter's DEFER reasoning above is retained for transparency; ruleset bypass actors are a separate feature and do not bear on merge-queue eligibility.

**The production-environment caveat (required for §13.10 to be honest):** required reviewers alone
don't separate identities the way they would for a human team, and `prevent_self_review` specifically
**deadlocks** this repo. **Off**: an agent dispatching with Mike's token could, in principle, also
approve the job (same owner-account limitation as the review layer, J8). **On**: Mike can't approve a
dispatch "he" initiated — a one-owner repo has no second approver, so every dispatch hangs. Not
hypothetical: `ota-release.yml` already asserts `prevent_self_review:true` for `ota-production`
(fact-pack S14), and that environment doesn't exist — OTA promotion fails closed today, the exact
failure mode this warns against. **Recommendation:** a required reviewer **without**
`prevent_self_review`. What it then buys, stated honestly: **a deliberate, recorded click** — friction/
audit, not identity separation.

---

---

## 11. External technology matrix

### 13-dimension treatment (compact; dimensions as rows, candidates as columns)

| Dimension | Merge Queue | Environments | Attestations | Dep. Review | Scorecard | Claude Code Action | Codex Action | Temporal |
|---|---|---|---|---|---|---|---|---|
| Problem solved | Serialize merges without per-PR rebase | Human gate on deploy | Build↔commit provenance | PR-time vuln/license block | Composite risk score | Hosted implement/review | Hosted read-only Codex | Durable long-running coordination |
| MIRA has this problem? | Yes (strict-up-to-date friction, `docs/GATE_AND_BLOCKER_REGISTER.md:174`) | Yes (no prod gate today) | No (no published artifact) | Yes (scanner gaps) | Partially (tribal-knowledge rules) | No (local CLI already does this) | No (local Codex already does this) | Partially (durable waits exist, already solved via GitHub Environments + PR-comment ledger) |
| Current MIRA equivalent | None | `prod-guard.sh` (doctrine) | None | ast-grep (pattern, not CVE-DB) | `.claude/rules/dangerous-commands-safety.md` | Local Claude Code CLI | `adversarial-review-trusted.sh` + isolated `CODEX_HOME` | GitHub Environments + ledger comments |
| Migration cost | Eligibility unconfirmed; if eligible, `merge_group:` must be added to the workflows behind required contexts, not all 62 | Near zero | Zero (unused until needed) | Low | Low (one-time report) | Medium (new App+runner) | Low | High (stand up Service+DB+workers) |
| Maintenance burden | Medium | Low | Low | Low | Low | Medium | Low | High (cluster ops, schema upgrades) |
| New infra required | No (repo-level feature) | No | No | No | No | Yes (GitHub App+runner) | Yes (`OPENAI_API_KEY` in CI) | Yes |
| Dev/operator complexity | Medium (candidate SHA ≠ PR head) | Low | Low | Low | Low | Medium | Low | High |
| Security/trust implications | Candidate SHA breaks Codex exact-head binding | **Caveat above** — doctrine-to-friction, not identity separation | None yet (nothing to attest) | None | Surfaces pwn-request risk MIRA already has (§12) | **High** — 2 disclosed 2026 CVEs (secret leak; TOCTOU→RCE, CVSS 7.7, `research-agent-workers.md` §1) | Lower (drop-sudo/read-only modes documented) | Operating a new distributed system |
| Observability benefit | Low | Medium (who approved what) | High (if ever needed) | Medium | Medium (one-time) | Low (duplicates existing) | Low (duplicates existing) | High (durable execution history) |
| Agent compatibility | Breaks SHA-bound review unless redesigned | High | N/A | High | High | High in principle, undermined by CVEs | High (matches MIRA's own isolation shape) | Good, but agent now operates a new system |
| Failure/retry semantics | N/A | N/A | N/A | N/A | N/A | Undocumented SHA binding | Undocumented SHA binding | Strong (core value-prop) |
| Lock-in | Low (GitHub-native) | Low | Low | Low | Low | Medium (GitHub App) | Low | Moderate (SDK/service-coupled) |
| Expected reduction in Mike intervention | Unproven — eligibility unconfirmed and candidate-SHA/Codex-binding conflict unresolved | Unproven — a deliberate click, not identity separation (§10 caveat) | None | None | None | None (duplicates roles MIRA already fills) | None (duplicates roles MIRA already fills) | Unproven; no SDLC installation exists to measure |

**Classifications:** Merge Queue **REJECT for v1** (not eligible: User-owned repo per GitHub's changelog, fact pack K1; the drafter's DEFER is recorded in §1b; the candidate-SHA-vs-Codex-binding conflict stands regardless). Environments **REUSE NOW** (no-`prevent_self_review`
caveat above). Attestations **DEFER**. Dependency Review **REUSE NOW**. Scorecard **BORROW PATTERN**.
Claude Code Action **REJECT** (review) / **DEFER** (@mention implement) — MIRA's local split already
covers both roles without the disclosed CVE class (`research-agent-workers.md` §1,§6). Codex Action
**BORROW PATTERN only** — MIRA's `adversarial-review-trusted.sh` + isolated `CODEX_HOME` already
matches its `read-only`/`drop-sudo` modes; the hosted Action would add an `OPENAI_API_KEY`-in-CI
dependency for no new capability. Temporal **DEFER** — real durable-wait needs exist but GitHub
Environments + the PR-comment ledger already serve them, and no SDLC installation exists to build on.

### Short treatment (matrix short-circuited — explicit repo constraints already settle these)

| Candidate | Classification | Why the 13-dim matrix was skipped |
|---|---|---|
| SWE-agent / mini-swe-agent | REJECT | Benchmark-lineage fixer with no reviewer role and no GitHub integration to reuse — would only duplicate the implementer MIRA already has, with less repo-awareness (no CLAUDE.md/skills/worktree isolation) |
| OpenHands | REJECT | Heaviest net-new infra of any candidate (its own per-conversation Docker + Agent Server) — directly against PRD §10's "no new agent framework"; fixer-only, no reviewer gained |
| DBOS | REJECT | A second durable-execution engine beside the product-adopted Temporal violates the repo's own one-canonical-system discipline (`.claude/rules/materialized-evidence.md` rule 15) applied to orchestration |
| Restate | REJECT | Same second-engine objection, plus a new always-on server (port 8080/9070 to deploy/secure/back up) for a one-owner repo |
| Dagger | BORROW PATTERN | Toolchain drift is a real, logged problem here (two python3 interpreters, a bun pin divergence), but full adoption's migration cost is high; borrow the pinned-entrypoint pattern instead of the engine/DSL |
| Argo Workflows | REJECT | Requires Kubernetes by its own docs; K8s-for-SDLC is an explicit repo-fixed constraint (PRD §10) |
| Backstage | REJECT | Solves multi-team service-catalog discoverability; MIRA is one owner with markdown repo maps already serving that role; its own docs describe a continuous coordinated-upgrade burden disproportionate to the problem size |
| LangGraph | REJECT | Banned by repo policy (LangChain-org framework, `CLAUDE.md` Hard Constraints #3; ADR-0011) |
| FactoryLM Forge | REJECT for v1 | No occurrence in the repo other than a competitor's product of the same name (fact-pack H); see §15 for concrete reconsideration triggers |

---

---

## 12. Security findings

Classification test applied throughout: **the proposal's written rule is wrong or missing** →
MUST FIX BEFORE RATIFICATION; **the rule is already correct but the code hasn't caught up** → MUST
FIX DURING V1; **neither blocks correctness nor autonomy** → MAY DEFER.

### MUST FIX BEFORE RATIFICATION (rule wrong or missing in the document itself)

| # | Finding | Evidence |
|---|---|---|
| 1 | G3's acceptance-scope rule ("required whenever `mira-hub` is in the deployed service set," `mira-sdlc-v1.md@6eecb1507:271`) never compares to the actual `services` dispatch input and never mentions `mira-ask` — `mira-ask` deploys today with no receipt-proven staging identity at all. | fact-pack J3; `tools/staging_receipt.py@a54c4c88b:35`; `.github/workflows/deploy-vps.yml@a54c4c88b:224-226,478` |
| 2 | The proposal cites `migration-drift` and the acceptance provisioner as satisfying G3 evidence without stating that both execute code checked out from the **candidate RC tree**, with production/staging DB credentials — and the candidate SHA is validated only as "exists as a commit in this repo" (confirmed directly: `deploy-staging.yml@a54c4c88b:76` calls `gh api repos/.../commits/$SHA`, which succeeds for any pushed branch commit, not only commits reachable from `main`). `retrieval-acceptance.yml` then fires **automatically** on every successful staging deploy (`workflow_run` on "Deploy to Staging VPS" completion, `retrieval-acceptance.yml@a54c4c88b:17-19`) and runs its provisioning script with the staging `DOPPLER_TOKEN` against whatever was just staged. As written, an unmerged, unreviewed PR-branch SHA could be staged and have its provisioning script executed with staging credentials with no merge, no Codex review, and no cheap-lane verdict in between. | fact-pack J4; `.github/workflows/deploy-staging.yml@a54c4c88b:70-81`; `.github/workflows/retrieval-acceptance.yml@a54c4c88b:17-19,79-112`; `.github/workflows/deploy-vps.yml@a54c4c88b:232-290` |
| 3 | "Independent Codex review" is never stated to mean, today, "a comment posted by the repository owner account" (`user.type == User`) rather than a distinct technical identity — Decision 1 (mandatory Codex for every R3 change) is being evaluated on an independence premise the document doesn't itself state. PRD §21's bar ("security trust boundaries are understood") can be satisfied by naming this limitation in text; it does not require new infrastructure. | fact-pack J8; `tools/ui_surface_lifecycle_guard.py@a54c4c88b:1405-1416` |
| 4 | CONNECT-1b's reuse rule ("reusable for an unchanged SHA within 168h," `:271,495`) requires only SHA match + unexpired age — not that the acceptance receipt's triggering staging-run-id still matches the **current** staging receipt being used for production authorization, and not any check for migration/config changes applied after acceptance completed. Production never deploys the staging image itself (it rebuilds separately, `deploy-vps.yml@a54c4c88b:525-540`) — the real gap is narrower than "a stale image rides through": a staging environment torn down and redeployed (new run, unchanged SHA and content) *after* acceptance passed would still satisfy today's SHA+168h check, even though the fresh staging receipt now in hand was never itself the one acceptance evidence was produced against. | §9 above; `.github/workflows/deploy-staging.yml@a54c4c88b:372-379` |
| 5 | Outside the lifecycle guard's own control-path list, nothing mechanically forces a correct risk class — an implementer's own `Risk:` line (prose) decides whether a non-guarded-path R2/R3 change gets the family-specific review PRD §20.5 and §21 ("objective gates cannot be satisfied by agent prose alone") require. §6 Gap 1 names this; it is currently satisfied by prose alone. | §6 above; `tools/ui_surface_lifecycle_guard.py@a54c4c88b:70-124`; `mira-sdlc-v1.md@6eecb1507:189-194` |
| 6 | The cheap-review lane's G1→G2 consumer is, by the proposal's own text, "the merger reading `head:`/`verdict:`" (`:487`) — a prose-read consumer, not a mechanical one. Because merge authority for R0–R2 is today exercised by any write-access actor including a Claude session (§8), this gate can in practice be satisfied by one agent's prose verdict being read and acted on by another agent — exactly the "agent prose alone" case PRD §21 rules out. | §7 above (G1 row); `mira-sdlc-v1.md@6eecb1507:487` |

### MUST FIX DURING V1 IMPLEMENTATION (rule already right in the proposal; code is the gap)

| # | Finding | #4208's own disposition |
|---|---|---|
| 1 | Privileged `pull_request_target` auto-fix job: candidate-ref checkout + provider secrets + write token, gated only by a label. | REPAIR-10 — proposal already says delete it |
| 2 | `prod-guard.sh` host list predates the OVH move; no prod-DB-URL/bot-token pattern; empty payload allows with a stderr line. | REPAIR-9 |
| 3 | `enforcement-audit.yml` nightly direct push to `main`, swallowed as non-fatal. | REPAIR-12 |
| 4 | Acceptance verdict-time re-read fails open on fetch failure. | REPAIR-7 |
| 5 | Production-deploy PR-association falls back to the first associated PR, not an exact `merge_commit_sha` match. | REPAIR-8 |
| 6 | Cheap-lane head/diff fetched separately, no re-read before posting, exit 0 on rendered outcomes. | REPAIR-6 |
| 7 | `secrets-scan`/Trivy run but aren't gated; `.ast-grep-rules/` never executed. | CONNECT-4/CONNECT-5 |
| 8 | Dependency scanners swallow failures with `\|\| true`; Dependabot omits 5 directories. | REPAIR-4 |
| 9 | `safety-reviewer.md` text contradicts the 2026-09-27 owner decision. | REPAIR-11 |
| 10 | Mutable action tags (`actions/checkout@v6`, `oven-sh/setup-bun@v2`) in secret-bearing control jobs (`apply-migrations.yml`, `retrieval-acceptance.yml`). | **Not named in #4208's own table — add it** (§13 change 15) |
| 11 | `apply-ingest-migrations.yml` uses `environment: production` for the staging target too. | **Not named in #4208's own table — add it** (§13 change 15) |
| 12 | `staging-gate.yml` success can mean the evaluation was **skipped** (docs/.github/.claude-only PRs, Dependabot), not that it ran and passed — the required context does not distinguish the two. Sharp edge: the proposal classifies dependency/runtime bumps as **R2** (`:200`), yet a Dependabot PR bumping a runtime dependency skips `staging-gate` evaluation entirely and still reports `success`. | fact-pack J9; `.github/workflows/staging-gate.yml@a54c4c88b:80-115` |
| 13 | Tags (`v*`/`rollback/*`) are unprotected and Release creation is best-effort — not itself exploitable, but worth naming alongside finding 4 above since a rollback anchor's trustworthiness depends on tag integrity. | fact-pack S17 |

### MAY DEFER

| # | Finding | Reason |
|---|---|---|
| 1 | `TenantScopedSession` is a regex check for `tenant_id` mention, not real isolation enforcement, on a fixed table set excluding `knowledge_entries`. | Proposal already narrows this claim (G-26); product-level redesign is out of SDLC scope |
| 2 | Local pre-commit hooks fail open when a tool binary is missing. | Principle 5: live automation (CI) is the real gate; local is convenience by design |
| 3 | No SBOM/SLSA provenance/signed images. | Explicitly deferred by the PRD itself (§14) pending a reliable identity chain |
| 4 | OTA `ota-*` environments referenced but absent, so OTA promote fails closed; `production`/`staging`/`staging-deploy` carry secrets with no protection rules (fact-pack S13). | Fails closed already (safe default); OTA matters only "when OTA is shipped" — see the `prevent_self_review` deadlock this exact pattern already produces, §10 |

**Credit where due (not findings):** production credential separation (`deploy-vps.yml@a54c4c88b:229-242,264-285`);
staging co-host isolation safeguards (`deploy-staging.yml@a54c4c88b:249-259`); body-edit invalidation
of Codex attestations — a *correctly designed* control, not a defect (S7).

---

---

## 13. Exact changes recommended to #4208

Section-level edits to `docs/architecture/mira-sdlc-v1.md`. Not implemented here.

1. **§3.5** — remove "(b) Merged-not-deployed" from the enumerated ways "Done" is satisfied; name it
   the non-terminal `MERGED_NOT_DEPLOYED` state from §5 of this evaluation instead.
2. **§3.3 G3 / §4 CONNECT-1a/1b** — replace the fixed "`mira-hub` in service set" scope rule with the
   capability-bound rule in §9; name `mira-ask`'s current evidence gap explicitly (J3).
3. **§3.3 G3 (migration row) / §4** — state that `migration-drift` and the acceptance provisioner
   execute candidate-RC-tree code with production/staging credentials, and that `deploy-staging.yml`'s
   SHA check only requires existence in the repo, not descent from `main`; define when that's
   acceptable (merged-to-main only) vs. needing the pinned-trusted-base pattern Codex uses (finding 2).
4. **§3.1 principle 6 / §3.12 / §7 (J8)** — add one sentence: independent Codex review is today
   authenticated as an owner-account comment, not a separate technical identity.
5. **§4 CONNECT-1b** — restate same-SHA reuse to require the acceptance receipt's triggering
   staging-run-id to still match the **current** staging receipt used at authorization time, plus no
   relevant migration/config change since acceptance completed — not SHA+168h alone (§12 finding 4).
6. **§3.2 / §5 REPAIR-2** — resolve the direct contradiction: §3.2 lists process docs as R3 while
   REPAIR-2 labels the rollback runbook "R0 docs + operation" (§6 Gap 2); pick one classification and
   also add the acceptance-receipt tooling (CONNECT-1a/1b) to the governance-floor enumeration.
7. **§3.2 / §4 ADD-1** — add a mechanical floor for R2's tenant/safety/migration signals (extending the
   lifecycle guard's shape), closing the under-classification gap PRD §20.5 asks about.
8. **§3.3 G1 / §4** — either wire the cheap-lane verdict into a required check-run bound to the current
   head, or relabel it "advisory" throughout rather than "required."
9. **§3.3 G2 / §3.12** — name the mechanism (or lack of one) restricting R3 merges to Mike/delegate; at
   minimum, require `--match-head-commit` on R3 merges.
10. **§3.3 G3 (production authorization) / §3.10** — state that `environment: production` has no
    GitHub-enforced rule today; recommend a required reviewer **without** `prevent_self_review` (that
    setting already deadlocks `ota-production`, S14); name the residual self-approval risk (§10).
11. **§3.3 G3 (acceptance scope)** — add the `NOT_APPLICABLE`/`SKIPPED`/`INFRA_UNASSESSED` three-way
    distinction from §9; today both reduce to "exit 0."
12. **§3.11** — correct change-failure-rate's denominator to deployments that reached the swap step
    (not every workflow run, J11); correct the eval-fixture denominator from 67 to 65 (J7); note
    `headSha` on a `deploy-vps.yml` run is the controller-checkout ref, not the deployed SHA (G:105).
13. **New subsection near §3.3/§3.9** — the proposal text has zero mentions of "Merge Queue" or
    `merge_group` despite PRD §4.B requiring this; add one recording the confirmed `owner.type: User`
    fact and GitHub's eligibility statement (fact pack K1); classify **REJECT for v1** with the trigger
    "repo moves to an organization or GitHub changes eligibility", and note the unresolved
    candidate-SHA-vs-exact-head-review conflict for that future (§10/§11).
14. **§3.6 / §3.7** — name the mechanism: a hotfix's rollback target needs a fresh (≤168h) staging +
    acceptance receipt *before* the incident, not re-acquired during it; add a scheduled (e.g. daily)
    re-run of `deploy-staging.yml` + `retrieval-acceptance.yml` against the current production SHA so a
    rolling ≤168h-fresh receipt for the known-good rollback target always exists.
15. **§5 / §8 (implementation sequence)** — add two omitted REPAIR items: pin
    `actions/checkout@v6`/`oven-sh/setup-bun@v2` in `apply-migrations.yml`/`retrieval-acceptance.yml`
    (J6); fix `apply-ingest-migrations.yml`'s shared `environment: production` for staging (J5).

---

---

## 14. Implementation sequence

| Step | Type | Change | Files/systems | Prerequisite | Required evidence | Rollback | Mike auth |
|---|---|---|---|---|---|---|---|
| 1 | REPAIR+DOC | Adopt the document with §13 changes 1,4,6,9,10,13 applied; fix drift items; add `SECURITY.md`; fix `safety-reviewer.md` text | `docs/architecture/mira-sdlc-v1.md`, ~10 drift docs, `SECURITY.md`, `safety-reviewer.md` | None | Merged PR diff | Revert PR | Y (R3 governance) |
| 2 | REPAIR (security) | Delete auto-fix job; fix `prod-guard.sh` host list; fix nightly direct push | `code-review.yml`, `prod-guard.sh`, `enforcement-audit.yml` | **None — independent of step 1**, may run in parallel | Workflow diff + a dry run | Revert | Y |
| 3 | ADD | `incident`/`hotfix` labels + fixed body fields; wire into 2 canary workflows | labels; `provider-health-canary.yml`, `oauth-redirect-canary.yml`; `docs/agents/issue-tracker.md` | None (parallel to 1–2) | `gh label list`; canary diff | Remove labels | Y (touches workflows) |
| 4 | CONNECT | Acceptance-receipt producer with corrected scope/skip semantics (§13 ch. 2,11); fail-closed re-read | `retrieval-acceptance.yml`, `tools/qa/*`, tests | Step 1 | A real RC's receipt artifact + test pass | Revert workflow | Y |
| 5 | CONNECT | `deploy-vps.yml` consumes the receipt with actual-`services` comparison (§13 ch. 2); exact-merged-PR match | `deploy-vps.yml`, `tools/staging_receipt.py` | Step 4 producing real receipts | Staging dispatch exercising the new check + tests | Revert (fails closed = safe default) | Y |
| 6 | REPAIR | Cheap-lane head re-read + mechanical-vs-advisory decision (§13 ch. 8); pin mutable action tags (J6); fix ingest-migration environment (J5) | `gate7_review.py`, `apply-migrations.yml`, `retrieval-acceptance.yml`, `apply-ingest-migrations.yml` | None additional | `tests/test_gate7_review.py`; workflow diffs | Revert | Y |
| 7 | CONNECT | Gitleaks/Trivy into `ci-gate`; ast-grep output captured; license allowlist | `ci.yml`, `code-review.yml` | One week of observed green on `main` for the two jobs | `ci.yml` diff + a week of green | Revert `ci.yml` | Y |
| 8 | REPAIR | Dependabot roots + pip-audit status handling + `bun audit` | `.github/dependabot.yml`, `dependency-check.yml` | Step 7 | Diff + a scanner run | Revert | Y |
| 9 | ADD (settings) | `production` Environment gets **a required reviewer only — not `prevent_self_review`** (§10's deadlock caveat), with the friction-not-separation framing stated in docs | GitHub repo settings | Step 1 (doctrine named in text first) | `gh api .../environments/production` showing the rule; one exercised dispatch | Remove the rule | Y (this *is* the admin action) |
| 10 | REPAIR+DOC | Rollback runbook rewrite + one authorization-exercising drill against the real gate from step 5; add a scheduled re-acceptance keeping the production SHA's rollback evidence ≤168h fresh (§13 ch. 14) | `docs/runbooks/rollback.md`, two dispatches, one new scheduled workflow | Step 5 | Drill run ids recorded in the runbook; the scheduled job's first green run | n/a | Y (dispatches the drill + the schedule) |
| 11 | ADD | `tools/dora.py` with corrected denominators (§13 ch. 12) — swap-step-based CFR, 65-fixture eval rate, controller-vs-deployed-SHA distinction | `tools/dora.py`, `tests/test_dora.py` | Step 3 (≥2 weeks of `incident` records) + step 5 (receipts to join) | `tests/test_dora.py`; first run in `wiki/hot.md` | n/a (read-only) | N |
| 12 | Review | 30-day review of `Risk:` lines + metrics → v1.1 decisions (R3 sub-profiles, `test-eval-offline` promotion, R0-exemption evidence, Merge Queue eligibility check) | `wiki/hot.md` | Steps 1–11 running 30 days | `wiki/hot.md` metrics table + `Risk:` line sample | n/a | Y (policy) |

---

---

## 15. Deferred architecture triggers

| Candidate | Reconsider when |
|---|---|
| **FactoryLM Forge** | GitHub-artifact status reconstruction repeatedly costs meaningful operator time *despite* steps 1–12 above landing; or one mission regularly spans many PRs/environments with no usable GitHub-native projection; or lifecycle state must be consumed by a non-GitHub system; or the evidence graph can no longer be queried safely without duplicating state logic in multiple places. A prettier dashboard is never sufficient alone. |
| **Temporal / Restate / DBOS** | An SDLC step needs a wait/retry/compensation GitHub Actions + Environments genuinely cannot express within documented limits (e.g., a saga spanning multiple workflows with compensation, or a wait exceeding Actions' timeout ceilings) — never adopted merely because durable execution is "nice to have," and never as a second engine beside the product-adopted Temporal without a single repo-wide durable-execution consolidation decision. |
| **Backstage** | FactoryLM grows multiple human teams with genuinely fragmented service ownership such that "who owns this, where are its docs" becomes a real, recurring, unanswered question — not merely "a developer portal would look nice." |
| **New agent framework** | MIRA's current implement/review split (local Claude CLI + `adversarial-review-trusted.sh`) is shown, with incident evidence, to be structurally incapable of a role the architecture needs — not merely "a hosted Action exists." The two disclosed 2026 CVEs against `claude-code-action` (research-agent-workers.md §1) are themselves a reason to wait, not adopt. |
| **SLSA / signed artifacts / attestations** | MIRA begins publishing a built artifact (container image, release binary) that a downstream step pulls **by reference** rather than rebuilding from source at deploy time — at that point attestations become a near-zero-cost REUSE NOW. Not before. |
| **Additional dashboards** | Steps 1–12 (GitHub-native state projection: labels, issue fields, receipts, `tools/dora.py`) are shown, with evidence, to be insufficient for reconstructing SDLC state across N concurrent sessions — the explicit precondition PRD §10 already sets. |

---

---

## 16. Metrics baseline

**DORA baseline**

| Metric | Exact definition | Source | Computable now? |
|---|---|---|---|
| Change lead time | PR `mergedAt` → first production receipt whose deployed Hub/Web SHA is a descendant of the merge commit (median/p90), reported only while the receipt is retained; reverted changes excluded and counted separately | Merged PRs; `production-receipt-<sha>`; `git merge-base --is-ancestor` | **Partially** — a run's `headSha` is the *controller-checkout* ref, not the deployed SHA (G:105); must join via receipts, never `headSha` alone |
| Deployment frequency | Successful `deploy-vps.yml` runs per week that reached the swap step, not every workflow conclusion | Run history; production receipts | **Yes**, once the swap-step distinction is applied — today's raw run count (22/30 "failed" over 17 days) is mostly pre-swap authorization/build exits (J11), not deployment-frequency evidence |
| Change failure rate | `incident` issues whose `deploy_sha:` names a deployment that reached the swap step ÷ deployments that reached the swap step; `external-cause` reported separately | ADD-2 fields; run history filtered to post-swap conclusions | **No** — requires ADD-2 first; explicitly not derivable today per the proposal's own baseline (`:425`) |
| Failed-deployment recovery time | `first_seen:` → `restored_at:` from the incident record | ADD-2 fields | **No** — same prerequisite |
| Deployment rework rate | Deployments followed by a same-week redeploy of a different SHA to the same service, excluding scheduled/no-op redeploys ÷ total deployments | Run history + production receipts | **Partially** — mechanically countable from run history today; needs the swap-step filter above to avoid counting pre-swap retries as "rework" |

**MIRA-specific**

| Metric | Exact definition | Source | Computable now? |
|---|---|---|---|
| Eval pass rate | Pass count ÷ **executed** fixture count (the loader's glob matches 65 of 67 files present, J7), suite id + source SHA + judge mode recorded | `tests/eval/run_eval.py`; `tests/eval/runs/*.md` | **Yes**, with the corrected denominator (65, not 67) |
| Staging acceptance / superseded rate | Per deployment generation (not per SHA): PASS/FAIL/SUPERSEDED/`SKIPPED`/`INFRA_UNASSESSED` counts | `acceptance-receipt-<sha>` (step 4) | **No** — no acceptance receipt exists yet to count, pre-step 4 |
| Review rounds per accepted PR | Codex `review_iteration` to GREEN; cheap-lane runs to a dispositioned verdict | Ledger comments; `[CHEAP-REVIEW]` comments | **Yes** |
| Cheap-review cost per accepted PR | Sum of `cost_usd:` fields on `[CHEAP-REVIEW]` comments for that PR | PR comments API | **Yes** |
| Codex cost per accepted PR | — | — | **NOT COMPUTABLE** — the `[CODEX-ADVERSARIAL-REVIEW]` envelope carries no cost field at all (fact-pack G:111 lists `reviewed_sha, body sha, status, iteration, counts` — no `cost_usd`); would require instrumenting the review script itself |
| Total agent cost per accepted change | Cheap-review cost + Codex cost + implementer token spend | — | **NOT COMPUTABLE** — same Codex-cost gap, plus no token-spend ledger exists for implementer sessions at all |
| Autonomous repair-loop completion rate | Review rounds that reached GREEN/PASS without a Mike comment in between ÷ total review rounds | Ledger comments; PR comments API, filtered by actor | **Partially** — mechanically derivable once "Mike comment" can be distinguished from "agent comment under Mike's account" (see the primary-autonomy-metric limitation below); currently overcounts autonomy |
| Escaped regression rate | `incident` issues whose root cause maps to a merged PR that had passing CI + review ÷ total merged PRs in the period | ADD-2 fields; issue disposition comments (§3.8) | **No** — requires ADD-2 and the disposition taxonomy to exist first |
| Staging→production conversion rate | RCs with a production receipt ÷ RCs with a staging receipt, in the period | `staging-receipt-<sha>`, `production-receipt-<sha>` (90-day window) | **Yes**, bounded by the 90-day artifact retention window |
| Gate failure rate | Required-context failures per PR, by gate name, ÷ total PRs | `gh api` check-run history | **Yes** |
| Evidence invalidation rate | Receipts/verdicts marked SUPERSEDED or STALE (REPAIR-6/REPAIR-7 outcomes) ÷ total receipts/verdicts issued | Ledger + receipt artifacts | **Only after** REPAIR-6/REPAIR-7 land (step 6) — today's fail-open paths don't record a STALE/SUPERSEDED outcome to count |
| WIP | Open PR count, median age, drafts > 14 days | `gh pr list --json` | **Yes** |
| % of changes completed without Mike intervention | changes reaching `CLOSED` with zero attributable Mike actions (proposal §3.13) ÷ total changes reaching `CLOSED` | Same sources as the primary metric below | **Partially** — same owner-account-attribution limitation as the primary metric |
| **Human interventions per completed change (primary autonomy metric)** | Attributable Mike actions (PR comments by `Mikecranesync`, `workflow_dispatch` actor, label events, linked authorizing comments per §3.13) ÷ changes reaching `CLOSED` or non-shipping `MERGED` in the period | PR/issue comments API; `gh api .../actions/runs?actor=` | **Neither an upper nor a lower bound — state this plainly.** Independent review and production authorization are both authenticated as actions under the **owner account** (J8), so an agent dispatching or commenting with Mike's own token **inflates** the count (double-counts agent action as Mike's). But Mike's own interventions delivered outside GitHub — chat instructions to an agent session, which never land as a PR/issue comment or a logged actor — are invisible to this data and **deflate** it. The two errors run in opposite directions and don't cancel in any provable way; report the number with both caveats stated, not as a bound. |

**Not computable, period:** change failure rate, recovery time, escaped regression rate (no ADD-2 yet);
Codex/total agent cost per PR (no cost field in the envelope, no token ledger); acceptance/superseded
and evidence-invalidation rate (no receipt yet, pre-step 4/6); any DORA metric past the 90-day retention window.

---

---

## 17. Owner decisions

Only items repository evidence and architecture principles cannot settle on their own.

| # | Decision | This evaluation's recommendation | Why repo evidence can't settle it alone |
|---|---|---|---|
| 1 | Codex mandatory for every R3 change (PRD §6 Decision 1) | **YES for v1, with §13 change 4's identity-limitation sentence added first.** The review-cost-vs-rigor tradeoff for governance-only R3 prose vs. behavioral R3 control changes is a judgment about Mike's own risk tolerance for agent-modified agent rules, not a fact the repo can derive. | The repo shows the mechanism works (two Codex rounds already improved this document) but not what cost Mike is willing to pay per governance-prose PR |
| 2 | Required human PR approvals: keep at 0 (Decision 2) | **Keep at 0**, conditional on step 9 (production Environment reviewers) landing as the real human gate. An approval count on every PR would make Mike approve his own agents' work with no independence gained (§8's authority matrix already shows the real gaps are elsewhere: production authorization, R3-merge enforcement). | Whether "Mike approving Mike's agents" has any independence value is a stance, not a measurement |
| 3 | `test-eval-offline` merge-blocking (Decision 3) | **NO for now.** Measure runtime/flake/false-block/unique-failure rate for 30 days per the proposal's own plan (`:663`); this evaluation adds no new evidence either way. | Requires 30 days of data that doesn't exist yet |
| 4 | R0 cheap-review exemption (Decision 4) | **NO for v1.** The repo's own CI classification (`changes.code == false`) is a *build* signal, not a *semantic-inertness* proof — it cannot distinguish truly inert prose from a `.claude/**` rule edit without the mechanical floor from §6's recommended change. Revisit only once that floor exists and 30 days of `Risk:` lines show no missed control-path change was ever labeled R0. | Depends on a control (§6/§13 change 7) this evaluation recommends but that doesn't exist yet |
| 5 | Privileged auto-fix: delete or re-architect (Decision 5) | **DELETE.** §12's "During V1" finding 1 and the proposal's own REPAIR-10 agree; no repository evidence supports a safe re-architecture that keeps candidate-ref checkout + provider secrets + write token under a label gate alone. | Settled by evidence — included here only because PRD §6 asks for an explicit recommendation, not because it's genuinely open |
| 6 | §10's production-environment caveat: is "a deliberate click" (not identity separation) an acceptable interim control? | **Yes, if stated honestly in the document** (§13 change 10) — this is a risk-tolerance call about whether friction-without-separation is worth the zero cost, which only Mike can make for his own one-owner repo. | Not a fact; a stance on acceptable control strength for a one-owner repo |

---

## Evidence limits

Grounded against the checkout at `eval-wt` (origin/main @ `a54c4c88b`), re-verifying — not merely
trusting — the load-bearing fact-pack claims by reading cited lines directly: `gate7_review.py`'s
exit-code paths, `ui_surface_lifecycle_guard.py`'s owner-account trust check, `deploy-vps.yml`'s
PR-association fallback/default services, `staging_receipt.py`'s default services tuple,
`retrieval-acceptance.yml`'s fail-open re-read and `workflow_run` trigger, `deploy-staging.yml`'s
SHA-existence check, and `code-review.yml`'s auto-fix job. `owner.type` was confirmed live (`User`).

**An input outside the assigned list was read, and it was not without influence — stated honestly.**
The scratchpad also contains `codex-blind-verdict.md`, an independent blind Codex review of the same
proposal that had read no evaluation draft. Every claim above was independently re-grounded in
`file@sha:line` evidence, including several re-verified directly that document didn't cite the same
way (e.g. the `deploy-staging.yml` SHA check behind §12 finding 2). But reading it first isn't
reversible: the `NOT_APPLICABLE`/`INFRA_UNASSESSED` terms (§9), the `DEPLOY_FAILED` state name (§5),
and roughly three of the five REPLACE-steelman points track that document's own framing. The verdict,
the delete-auto-fix call, and keep-0-approvals also match it — each independently supportable from the
evidence cited, but *arriving* at them independently of having read it first cannot be fully proven.

**Not independently verified:** fact-pack §§C/D/G beyond `owner.type` and the trigger logic above (a
single point-in-time `gh api` read, not re-queried); the research files' own flagged items (exact
`strict_required_status_checks_policy` field name, the "50 total reusable workflows" figure, whether a
PR-head status counts toward a `merge_group` candidate — moot here but unresolved in the sources);
artifact-retention enforcement beyond the stated 90/30-day windows; whether `prevent_self_review`'s
absence still leaves a live self-approval path (reasoned, not exercised — validate in step 9). Section 2
(Delta recon) and Section 4 (Identity Contract) are outside this agent's scope and not written here.

---

## 18. Summary for the owner (PRD §22)

1. **Executive verdict:** **ADOPT WITH CHANGES.** Both independent judgments (fresh Claude context; blind Codex) agree, and both say #4208 is **not ready for ratification as drafted** but becomes ready once the rule-level changes below land in its text. No new platform is needed.
2. **Top five recommended changes to #4208** (full list §13):
   1. Fix the Definition-of-Done contradiction: `MERGED_NOT_DEPLOYED` is a non-terminal state, never "Done".
   2. Replace "`mira-hub` in the service set" with a capability-bound acceptance rule whose receipt names the actual `services` deployed; `mira-ask` currently ships with no receipt-proven staging identity.
   3. State the validator trust boundary: drift and acceptance validators run from the candidate tree with credentials, and `deploy-staging.yml` accepts any repository commit, so an unmerged branch can be staged and its provisioner run with staging credentials today.
   4. Make classification and the cheap lane mechanical: effective risk = max(declared, trusted-path floor, reviewer findings); the `[CHEAP-REVIEW]` verdict becomes a head-bound check-run or is relabelled advisory.
   5. Put a required reviewer on the `production` environment (without `prevent_self_review`, which deadlocks a one-owner repo and already blocks `ota-production`), and say plainly that this buys a recorded click, not identity separation; also state that the Codex attestation is authenticated as an owner-account comment.
3. **Top three explicitly rejected ideas:** (a) FactoryLM Forge / Temporal-Restate-DBOS / Backstage / Argo / LangGraph / SWE-agent / OpenHands as SDLC machinery — rejected or deferred with triggers (§15); (b) a hosted reviewer — `claude-code-action` in review mode, or the ChatGPT Codex cloud review app (distinct from `openai/codex-action`, which §11 rates BORROW PATTERN) — duplicates the local lane and reintroduces the disclosed secrets-plus-untrusted-PR-text failure class; (c) GitHub Merge Queue for v1 — the repo is User-owned and not eligible, and the candidate-SHA model conflicts with exact-head review regardless.
4. **Unresolved owner decisions (§17):** Codex mandatory for all R3 (recommend YES); keep required approvals at 0 (recommend YES, conditional on the environment reviewer); `test-eval-offline` blocking (recommend NO, measure 30 days); R0 cheap-lane exemption (recommend NO in v1); delete the `auto-fix` job (recommend DELETE); whether a recorded click without identity separation is an acceptable interim production control (risk-tolerance call).
5. **Ready for ratification after those changes?** **Yes.** PRD §21 reads 6/10 TRUE today (drafter) — the four FALSE conditions are all rule-text defects in #4208, not code; after §13 changes 1–8 and 10 land in the document, all ten conditions are met. Ratification adopts rules, not completed repairs; the code-level items are sequenced in §14.
6. **Path:** `docs/architecture/mira-sdlc-v1-final-evaluation.md` (this document), branch `docs/sdlc-v1-evaluation`, draft PR #4210.

## Appendix A — Inputs, costs and limits

- Inputs: owner PRD; #4208 @ `6eecb1507` (byte-verified); fact pack §A–§K (evidence clerk); three
  sourced research reports (GitHub-native, agent workers, orchestration; every claim with URL, quote
  and 2026-10-03 access date; unresolved flags listed in each file and resolved in fact pack §K where
  official pages settled them); blind Codex verdict; fresh draft; verifier pass.
- Codex blind verdict: `gpt-6.1-sol`, read-only sandbox, isolated `CODEX_HOME`, no network; it
  verified the proposal bytes against the Git object and flagged every GitHub-API fact as "reported".
- Not verified by anyone with write access to settings: branch protection, rulesets, environments and
  security toggles were read once via `gh api` on 2026-10-03 and could change.
- Nothing was implemented. #4208 was not edited. No CI, settings, environments, workflows, CLAUDE.md,
  staging or production were touched.

## Appendix B — Codex blind verdict (verbatim)

### B.1 EXECUTIVE VERDICT

**Steelman for REPLACE WITH ALTERNATIVE**

- A release-centric model could replace per-PR G3/G4 bookkeeping and handle batches more naturally; the proposal’s Done definition currently mixes completed and pending work. *(Proposal §3.5, lines 304–315.)*
- Immutable artifact promotion could establish a stronger acceptance chain than separately rebuilding staging and production. (`.github/workflows/deploy-staging.yml:372`, `.github/workflows/deploy-vps.yml:525`)
- A dedicated authority service could separate implementer, reviewer, and release credentials more clearly than owner-account comments. (`tools/ui_surface_lifecycle_guard.py:1409`)
- Durable orchestration could explicitly manage acceptance supersession, observation timers, retries, and recovery instead of relying on dispatches and comments. *(Proposal §3.3–§3.8.)*
- A smaller model—intake, verified candidate, authorized release, observed outcome—could reduce ceremony and avoid conflicting gate terminology. *(Proposal §3.3, lines 211–223.)*

**Replacement does not win.** Those arguments identify missing contracts, not evidence that GitHub cannot support them. Existing trusted-base evaluation, receipt verification, CI aggregation, and deployment workflows provide a substantial foundation. (`.github/workflows/ui-lifecycle-guard.yml:227`, `tools/staging_receipt.py:81`, `.github/workflows/ci.yml:1700`)

**ADOPT WITH CHANGES**

- Keep GitHub as authority, agents as workers, and deterministic verification as the factual gate.
- Ratify only after replacing ambiguous identity, acceptance, authority, and closure rules with the contracts below.
- Require mechanical consumption of review evidence; the proposed human-only cheap-review consumer undermines autonomous delivery. *(Proposal §4, line 487.)*
- Keep review risk separate from deployment applicability, and make emergency handling a separate operating mode. *(Proposal §3.1, lines 170–174; §3.6, line 323.)*
- Existing code defects belong in implementation PRs; ratification must adopt correct rules without claiming those repairs already exist.

**Evidence boundary.** `git rev-parse HEAD` returned `563d2b9ade172375268a8e2a5b8c0e49797015bd`, not the expected commit. Local `origin/main` is the expected `a54c4c88bd4f349c14884ff5701375f644bd7c31`; HEAD adds only `docs/architecture/mira-sdlc-v1-final-evaluation.md`. I did not read that file. All repository citations below refer to files unchanged between those commits.

The supplied proposal is byte-identical to its Git object at `6eecb1507ecea6c9d13db8f0c8979e4f685270dc`—SHA-256 `b692ed43662dbbb697cb1e59d707e5a3b02f54a9bfc10b8b4a8e316bb17393de`. GitHub-side statements are **reported evidence from the fact pack**, not independently verified facts. No files were changed or network calls made.

**Delta recon: NO MATERIAL DRIFT** in the SDLC mechanisms between `32bcaa67e…` and expected main. `git diff --numstat` confirms only the four reported mobile files changed. New findings below concern existing omissions, not that delta.

**PRD §19 assessment—judgment, not measured scores:** strong on operating burden, migration cost, agent replaceability, and evolvability; conditional on correctness, security, recoverability, observability, concurrency, and cost efficiency; weak on current evidence integrity, deterministic consumption, stale-evidence resistance, and self-authorization resistance. Reduction in Mike intervention remains unproven.

### B.2 Five owner decisions

| Decision | Recommendation | Reasons and evidence |
|---|---|---|
| Independent Codex for every R3 | **YES for v1**, including governance prose; scope evidence by family. | Review producers, consumers, agent rules, and enforcement configuration can change delivery authority without changing product code. The existing guard already recognizes control paths. (`tools/ui_surface_lifecycle_guard.py:70`; proposal §3.2, line 201.) |
| One required human PR approval | **NO; retain 0**, conditional on verified review gates and separate release authorization. | An approval count does not establish reviewer independence. Protection currently requires 0 approvals according to **reported** fact-pack D:59–60; the current reviewer trust identity is the owner account. (`tools/ui_surface_lifecycle_guard.py:1409`) Add a human gate where consequential authorization is needed, rather than on every PR. |
| Make `test-eval-offline` blocking now | **NO for the aggregate suite; promote useful subsets first.** | It is absent from the blocking aggregator, while named regression tests already run separately. (`.github/workflows/ci.yml:1704`, `.github/workflows/ci.yml:437`) Proposed promotion trigger: 30 days of representative runs, measured coverage and runtime, ≤1% unexplained false blocks, and demonstrated unique relevant failures; retain advisory execution meanwhile. |
| Exempt mechanically inert R0 from cheap review | **NO in v1.** | CI’s non-code classification excludes all Markdown and `.claude/**`, so it cannot establish semantic inertness. (`.github/workflows/ci.yml:64`) Consider v1.1 exemption only after audited classifications, no missed control changes, a trusted inert-path allowlist, and measured cost savings. |
| Privileged auto-fix | **DELETE the current job.** | A mutable candidate ref supplies the executed script while the job has provider secrets and write permissions. The label is an invocation gate, not code isolation. (`.github/workflows/code-review.yml:19`, `.github/workflows/code-review.yml:29`, `.github/workflows/code-review.yml:46`) Any replacement must separate unprivileged candidate execution from privileged publication. |

These are recommendations for Mike’s policy adoption; they do not authorize settings changes.

### B.3 Required risk and gate changes

**Retain R0–R3.** Four classes are workable; family profiles matter more than additional classes.

| Class | Exact required change | Evidence |
|---|---|---|
| R0 | Restrict to demonstrably inert content; comments, assets, and `.planning` files qualify only when no build, runtime, policy, or agent consumes them. `changes.code == false` is insufficient. | `.github/workflows/ci.yml:64`; proposal §3.2, line 198. |
| R1 | Define by bounded behavioral impact, not “single module,” “off flag,” or “API addition.” Shared contracts, authorization, and activation effects override size. | Proposal §3.2, lines 199–201. |
| R2 | Keep retrieval/model/data/concurrency scope; specify affected capabilities and required behavioral suites. Dependency changes escalate to R3 when they alter security or delivery authority. | Proposal §3.2, line 200; `.github/workflows/staging-gate.yml:96` skips Dependabot evaluation. |
| R3 | Retain the governance floor; require family-specific evidence and independent review. Classify rollback runbooks as governance, correcting their R0 implementation label. | Proposal §3.2, line 201 versus §5, line 539. |
| Assignment | Effective risk is the **maximum** of declared risk, trusted path floor, and reviewer findings—not “one class higher on disagreement.” Recompute on every candidate change; downward overrides require an explicit owner decision. | Proposal §3.2, lines 188–194; §4, line 474 leaves assignment unenforced. |

This is deterministic enforcement of a floor, not automated semantic risk scoring. An implementer can presently under-classify changes outside guarded paths; principle “classes never waive existing gates” does not protect newly added class-dependent obligations.

| Gate | Exact required change | Evidence |
|---|---|---|
| G0 | Record effective risk, family, deployment applicability, affected capabilities, criterion IDs, ownership, and recovery approach; architectural authorization must be distinguishable from a Proposed ADR. | Proposal §3.4, lines 292–300. |
| G1 | Separate deterministic test evidence from semantic findings. Cheap review must cover a verified immutable input snapshot; scoped or incomplete coverage cannot represent the whole PR. | `tools/gate7_review.py:705`, `tools/gate7_review.py:725`. |
| G2 | A trusted consumer verifies current candidate identity, authenticated review provenance, required verdicts/dispositions, body binding where required, and required checks before SHA-conditioned merge. Include R3 changes outside legacy guarded paths. | Proposal §3.3, lines 257–261; §4, line 487 explicitly excludes a mechanical cheap-review consumer. |
| G3 | Authorize a release packet containing reviewed-to-merged mappings, affected capabilities, actual service targets, acceptance coverage, schema/config identity, receipt generations, and owner authorization. | `.github/workflows/deploy-vps.yml:144`, `.github/workflows/deploy-vps.yml:224`; proposal §3.3, line 271. |
| G4 | Verify deployment identity, then smoke, then observation coverage, then closure. Missing monitoring is **unassessed**, not “no incidents.” Attribute failures to deployment events and components. | `.github/workflows/smoke-test.yml:30`, `.github/workflows/smoke-test.yml:85`; proposal §3.3, lines 281–287. |

**Authority rule:** implementers may propose risk, write code/tests, dispatch staging, and assemble evidence; independent reviewers produce semantic verdicts; trusted automation verifies objective facts and consumes authorization; Mike authorizes consequential transitions and policy exceptions. Implementer credentials must not independently mint reviewer or production authority. Current owner-authored envelopes authenticate an account, not model independence. (`tools/ui_surface_lifecycle_guard.py:1409`)

**Merge Queue: DEFER**, with a bounded compatibility investigation. Strict-review friction is documented, but there are no `merge_group` triggers in the 62 inspected workflows. (`docs/GATE_AND_BLOCKER_REGISTER.md:174`; verified workflow search.) A trial must distinguish PR-head semantic review from integration checks on the queue candidate; interacting R3 changes require review of the resulting integration candidate. The reported median PR time does not prove low concurrent readiness. Current feature eligibility and GitHub semantics were not independently checked offline.

**Native opportunities:** reuse Actions, Issues, receipts, and existing environments; repair protection alignment and authorization consumption first. Evaluate native secret protection, dependency review, and scoped reusable workflows during v1 implementation using the reported settings as leads. Defer signed provenance and attestations; recording artifact identities is required now.

**Alternatives:** borrow durable-state and retry patterns; defer Forge, Backstage, Temporal/DBOS/Restate, Dagger/Argo, and replacement worker frameworks absent a demonstrated SDLC gap they uniquely solve. Reject a LangGraph migration under current policy. (`docs/adr/0011-no-langgraph-migration.md:41`) Temporal’s documented product role does not justify SDLC adoption. (`docs/adr/0029-materialized-evidence.md:44`) Current external implementations and operator feedback remain unevaluated offline.

### B.4 Identity contract

The following is the **required contract**, not a claim of current enforcement.

| Stage | Authoritative identity | Produced by | Verified by | Invalidated when |
|---|---|---|---|---|
| Requirement/classification | Requirement revision, criteria, effective risk/family, applicability | Issue/PR records plus trusted classifier | Trusted policy consumer | Requirements, scope, risk, or policy changes |
| Cheap review | Repository/PR, head SHA, comparison base, exact reviewed-byte digest, coverage, producer version | Trusted cheap-review producer | Trusted G2 consumer | Candidate/input/coverage changes; verdict revoked |
| Codex review | Head SHA, exact body digest, comparison base, reviewer run and trusted producer identity | Independent trusted-base reviewer | G2 consumer; applicable guard | Head/body changes, revocation, relevant policy changes |
| Integration candidate | PR test-merge SHA; queue SHA if queue adopted | GitHub candidate construction | Required integration checks | Base, head, or group membership changes |
| Merged | Actual main commit(s), tree identity, explicit mapping to reviewed PR candidate(s) | GitHub merge | Trusted release consumer | Mapping missing, ambiguous, or candidate content differs |
| Release candidate | RC SHA plus per-component inclusion, service set, build plan, schema/config references | Release assembly | G3 consumer | RC, targets, required dependencies, or build policy changes |
| Staging deployed | Deployment run **and attempt**, RC SHA, service image IDs/digests, runtime identities, environment generation | Staging controller | Trusted receipt verifier and runtime probes | Relevant redeploy, rebuild, schema/config/provider change |
| Accepted | Acceptance run/attempt, staging generation, scoped artifact/runtime map, suite/harness versions and verdicts | Trusted acceptance producer | G3 consumer | Required scope/context changes, supersession, expiry, later failure |
| Production authorized | Owner authorization bound to the release packet and exact receipt IDs | Mike or explicitly delegated authority | Trusted deployment controller | Packet changes, expiry, revocation |
| Production deployed | Run/attempt, actual per-service source and artifact identity, target/config/schema context | Production controller | Receipt verifier and runtime probes | Relevant deployment or operational change |
| Observed/closed | Production deployment identity plus smoke and observation coverage interval | Probes/canaries; closure consumer | Deterministic coverage checks; semantic attribution where needed | Attributable failure or evidence found invalid |

**Places where identities currently substitute for others:**

1. Cheap-review metadata SHA substitutes for independently fetched diff identity. (`tools/gate7_review.py:705`)
2. Current owner-account authorship substitutes for independently established reviewer identity. (`tools/ui_surface_lifecycle_guard.py:1409`)
3. PR-head evidence substitutes for merged-source evidence without an explicit content mapping; the fallback can select an unrelated associated PR. (`.github/workflows/deploy-vps.yml:144`)
4. CI documentation conflates “checks on head” with what candidate checkout executes; default checkout is used. (`.github/workflows/ci.yml:53`)
5. Staging Gate workflow success substitutes for an evaluation that ran, although scope and Dependabot skips succeed. (`.github/workflows/staging-gate.yml:80`)
6. Live Hub SHA substitutes for the triggering staging deployment generation. (`.github/workflows/retrieval-acceptance.yml:61`)
7. Source equality substitutes for tested artifact equality across separate `--pull` rebuilds. (`.github/workflows/deploy-staging.yml:372`, `.github/workflows/deploy-vps.yml:525`)
8. Selected Hub/Web runtime identities substitute for a release-wide identity unless remaining services are separately mapped. (`.github/workflows/deploy-vps.yml:741`)
9. Host checkout `PRIOR_SHA` substitutes for the prior running software set. (`.github/workflows/deploy-vps.yml:400`)
10. Migration filename presence substitutes for applied content/schema identity. (`tools/migration_drift.py:53`)
11. A SHA-named artifact substitutes for deployment scope/generation unless its payload is checked against targets. (`.github/workflows/deploy-vps.yml:195`, `.github/workflows/deploy-vps.yml:224`)
12. Workflow-controller `headSha` substitutes for deployed SHA if metrics read run metadata alone; dispatch has a separate target input. (`.github/workflows/deploy-vps.yml:28`)
13. Tags substitute for known-good recovery candidates if treated as rollback proof; tagging happens at merge. (`.github/workflows/version-tag.yml:105`)
14. Updated capability evidence can substitute for deployed code identity unless its separate evidence-record commit is preserved. *(Proposal §3.3, line 284.)*

Docker image IDs are useful content identities; they are not registry manifest digests. V1 must preserve both stage artifact maps and state explicitly when acceptance proves source behavior rather than an identical production artifact. Promote tested images where practical; defer signing infrastructure.

### B.5 Staging acceptance scope

Required binding: **production delta → affected capabilities → runtime dependencies/service targets → required suites → generation-bound receipt**.

| Concern | Binding rule required |
|---|---|
| Changed paths | Compare intended production contents against the currently deployed **per-component** baseline, including batched PRs, dependencies, configuration, and migrations. |
| Capability | Use trusted mappings plus explicit semantic impact declarations; shared dependencies expand coverage. Unknown impact requires broader review/coverage, not an empty suite set. |
| Service set | Record normalized actual targets, including workflow defaults. Require staging coverage or an explicit validated equivalent for each relevant production target. Rebuilding Hub alone must not require unrelated retrieval assertions. |
| Universal checks | Runtime identity, basic health, essential authorization/tenant isolation, and receipt integrity always apply to affected surfaces. |
| Receipt | Include schema; repository; controller/harness identity; run IDs and attempts; triggering staging receipt ID; environment generation; source/artifact/service maps; capability set; required/selected suites; individual outcomes; start/end identity probes; timestamps. |
| Reuse | Same SHA is insufficient. Reuse only for unchanged relevant artifacts, schema/config/provider context, harness, scope, and valid generation. New receipts must explicitly reference carried evidence. |
| Same-SHA redeploy | Rebuilding or recreating the relevant deployment creates a new generation. Reuse requires demonstrated equivalence, not a SHA-only match. |
| Expiry | Keep 168 hours as a v1 maximum, measured from original acceptance completion; do not refresh it through copying. Relevant context changes invalidate sooner. This is a policy default, not empirically justified freshness. |
| Superseded | A relevant generation change during assessment makes that assessment non-authorizing. Deployment and acceptance must coordinate so same-SHA replacement is detectable. |
| Skipped | Required-suite skip blocks authorization. Out-of-scope suites may be explicitly `NOT_APPLICABLE` under trusted scope rules; historical absence is not PASS. |
| Provider/infra failure | Record `INFRA_UNASSESSED`, retry within a bounded budget, and block affected authorization; distinguish it from product failure. Unrelated advisory failures do not block. |
| Fail-closed | Missing, malformed, stale, ambiguous, unverifiable, or mismatched receipts block. Do not fall back to an older passing receipt after a later relevant failure. |

Current acceptance runs six scenarios and historical capture skips, then compares only live SHA; verdict-time fetch failure exits successfully. (`.github/workflows/retrieval-acceptance.yml:116`, `.github/workflows/retrieval-acceptance.yml:135`, `.github/workflows/retrieval-acceptance.yml:165`)

**Verified scope hole:** production receipt authorization defaults to requiring Hub/Web, without comparing to production `services`; default production targets also include `mira-ask`. (`tools/staging_receipt.py:35`, `.github/workflows/deploy-vps.yml:224`, `.github/workflows/deploy-vps.yml:478`) A read-only verifier probe accepted a Hub/Web receipt containing no Ask image. Conversely, narrow staging receipts can fail the fixed Hub/Web requirement. Replace that fixed default with the release’s actual required coverage.

### B.6 Lifecycle state model

Use explicit states for reporting; keep detailed execution phases inside G4:

`OPEN → READY → BUILDING → REVIEWING → MERGED_NOT_DEPLOYED → DEPLOYED → OBSERVING → CLOSED`

- Non-deployable work transitions from verified merge directly to `CLOSED`.
- Shipping work remains `MERGED_NOT_DEPLOYED` until its named release includes and deploys it.
- G4 contains deployment-proof, smoke, monitoring-coverage, and closure checks; no extra G5/G6 is needed.
- Failed assessment before deployment leaves the change pending with a blocker; a failed swap that may have changed runtime requires `DEPLOY_FAILED` and restoration evidence.
- An attributable deployed failure produces `FAILED_OBSERVED`, links an incident, and starts restoration plus a new G0 change; restoration is not equivalent to closing the incident.
- Observation superseded before sufficient evidence is `OBSERVATION_INCOMPLETE`; carry evidence only with an explicit equivalence record.
- `PRODUCTION` is unnecessary as a separate state: it names an environment. `MERGED` is an event; applicability decides the resulting state.

Keep authoritative lifecycle records on the **owning GitHub issue**, with release/deployment IDs and append-only transition comments; use labels or Project fields as projections. PR closure proves merge, not shipment. GitHub deployment records hold release events; existing registries retain their capability/release responsibilities.

The proposal’s §3.5 option “Merged-not-deployed” must be removed from Done: it contradicts its later statement that merged shipping work is not done. *(Lines 308–315.)*

Retain 24/72-hour windows as provisional defaults for relevant runtime families, with required probe cadence, coverage, and missing-data rules. Do not hold subsequent releases or parallel work for an observation window; track each affected deployment separately. A universal 72-hour rule for every R3 family lacks supporting measurement. *(Proposal §3.3, line 283.)*

### B.7 Security findings

“Before ratification” means correcting the **rules**, not completing code repairs.

| Finding | Classification | Reason and evidence |
|---|---|---|
| Human-only review consumption and incomplete risk floor | **MUST FIX BEFORE RATIFICATION** | Added obligations remain self-declared and cheap-review consumption is explicitly manual, contrary to the autonomy/evidence objective. *(Proposal §4, lines 474, 487.)* |
| Candidate-controlled validators/harnesses | **MUST FIX BEFORE RATIFICATION** | Specify trusted current-policy validators and controlled candidate-harness eligibility: staging accepts any repository SHA, acceptance runs its provisioner with credentials, and production runs the RC’s drift verifier with the production DB URL. (`deploy-staging.yml:76`; `retrieval-acceptance.yml:79`, `:110`; `deploy-vps.yml:239`, `:285`) |
| Reviewer and owner authorization provenance | **MUST FIX BEFORE RATIFICATION** | Account-authored comments do not establish independent production of evidence; define credential separation, trusted producers, authorization scope, and consumption rules. (`tools/ui_surface_lifecycle_guard.py:1409`; proposal §3.3, line 275.) |
| Same-SHA generation reuse and acceptance scope | **MUST FIX BEFORE RATIFICATION** | Current proposed reuse and Hub-wide scope can authorize stale evidence or block unrelated changes. *(Proposal §3.3, line 271; §4, line 495.)* |
| Privileged candidate auto-fix | **MUST FIX DURING V1 IMPLEMENTATION** | Remove candidate script execution with write credentials and provider secrets before using that lane. (`.github/workflows/code-review.yml:29`, `:46`) |
| Review producer/consumer or agent-rule changes | **MUST FIX DURING V1 IMPLEMENTATION** | Enforce trusted-base independent review and source-authentic consumption before considering these obligations autonomous gates; the existing guard is explicitly advisory. (`.github/workflows/ui-lifecycle-guard.yml:40`) |
| Cheap-review snapshot race | **MUST FIX DURING V1 IMPLEMENTATION** | Capture and verify immutable inputs, then bind publication and merge consumption; a final head reread alone does not prove which diff was reviewed. (`tools/gate7_review.py:705`, `:1386`) |
| Body-bound review status race | **MUST FIX DURING V1 IMPLEMENTATION** | Revalidate the current review tuple at merge; asynchronous status posting is head-bound while body changes can invalidate evidence without moving head. (`ui-lifecycle-guard.yml:55`, `:291`; `tools/ui_surface_lifecycle_guard.py:1414`) |
| Acceptance fetch failure and generation mismatch | **MUST FIX DURING V1 IMPLEMENTATION** | Failed identity reread must block, and the triggering receipt must match the assessed deployment. (`.github/workflows/retrieval-acceptance.yml:61`, `:169`) |
| Production PR association fallback | **MUST FIX DURING V1 IMPLEMENTATION** | Require an unambiguous reviewed-to-merged mapping rather than the first associated PR. (`.github/workflows/deploy-vps.yml:144`) |
| Owner release authorization unenforced | **MUST FIX DURING V1 IMPLEMENTATION** | Reported environments have no protection rules, while the workflow checks source evidence but not Mike’s authorization. (Fact pack D:61, **reported**; `deploy-vps.yml:132`) |
| Migration authority, hash uncertainty, ingest environment | **MUST FIX DURING V1 IMPLEMENTATION** | Bind production application to approved source and verified staging content; absent hashes/query failures must not mean verified content, and ingest staging currently uses `production`. (`apply-migrations.yml:171`, `:180`; `apply-ingest-migrations.yml:59`) |
| Stale production hook | **MUST FIX DURING V1 IMPLEMENTATION** | Repair host/DB/token coverage and payload handling, while keeping the hook explicitly a convenience boundary rather than production authority. (`tools/hooks/prod-guard.sh:62`, `:86`, `:123`) |
| Nightly direct push | **MUST FIX DURING V1 IMPLEMENTATION** | Replace or remove the PR-bypassing write attempt and swallowed result. (`.github/workflows/enforcement-audit.yml:131`) |
| Security scanners/license policy gaps | **MUST FIX DURING V1 IMPLEMENTATION** | Connect required scanner outcomes, distinguish scanner failure from clean results, and align license enforcement with Apache/MIT policy. (`ci.yml:1309`, `:1704`; `dependency-check.yml:24`, `:53`) |
| Staging co-host isolation | **MUST FIX DURING V1 IMPLEMENTATION** | Existing safeguards deserve credit, but candidate-controlled compose/build inputs require explicit trust eligibility and privilege limits. (`deploy-staging.yml:240`, `:250`, `:379`) |
| Mutable action/tool acquisition in privileged paths | **MUST FIX DURING V1 IMPLEMENTATION** | Pin executable dependencies in secret-bearing control jobs; several relevant workflows still use mutable action tags. (`retrieval-acceptance.yml:90`; `apply-migrations.yml:72`) |
| Safety reviewer contradiction | **MUST FIX DURING V1 IMPLEMENTATION** | Align reviewer instructions with the actual owner decision so mandatory specialist review evaluates the adopted behavior. (`.claude/agents/safety-reviewer.md:15`; `mira-bots/shared/guardrails.py:1465`) |
| OTA environment absence | **MUST FIX DURING V1 IMPLEMENTATION when OTA is shipped** | Preserve its fail-closed checks and establish required environments rather than crediting unavailable promotion as operational protection. (`ota-release.yml:682`; fact pack D:61, **reported**.) |
| Tenant regex treated as isolation | **MAY DEFER broader redesign** | Retain accurate limitations and focused tenant-family verification; this inspection proves weak detection, not a specific exploitable product path. (`mira-bots/shared/tenant/session.py:18`, `:32`, `:53`) |
| Local hooks, signed provenance, comprehensive threat model | **MAY DEFER** | CI must provide required enforcement; local tools already skip when absent, while signing and wider modeling need not precede a truthful v1 identity chain. (`.githooks/pre-commit:122`, `:158`, `:302`) |

### B.8 Fact-pack challenges

| Entry | Independent finding |
|---|---|
| A:15, environment premise | Expected local `origin/main` verified; working HEAD is one documentation commit ahead. I cannot verify that it is still live remote main without network. |
| A:16–18 | Git objects verify the four-file delta, proposal’s one changed file, and ahead/behind count `1 / 2`; PR draft status and live merge status remain **reported**. |
| A:19, C, D, G API samples | Checks, settings, bypass grants, environments, security toggles, labels, run histories, releases, and samples cannot be independently verified offline; the supplied `gh` commands establish reported provenance, not independent confirmation. |
| B:26, S8 | “Exit 0 always” is too broad: rendered BLOCK/UNKNOWN and post failures reach 0, but total provider failure returns 2 and budget refusal returns 3. (`tools/gate7_review.py:1309`, `:1357`, `:1401`) |
| B:27, C:43 | Codex envelope verification is substantial but authenticates owner-account comments; it does not prove independent execution, and the guard is not mechanically required according to the reported settings. (`tools/ui_surface_lifecycle_guard.py:1409`; `ui-lifecycle-guard.yml:40`) |
| B:31–34, S11 | Service coverage and validator trust are omitted: fixed Hub/Web authorization does not verify requested target coverage; the candidate supplies executed validators, and the drift job receives a Doppler token while resolving the DB URL. (`deploy-vps.yml:224`, `:239`, `:264`, `:285`) Credential separation is useful but narrower than complete least privilege. |
| B:32, S5 | SHA pinning does not identify the triggering deployment generation or same-SHA replacements; confirmed fail-open reread and absent SHA/run fields in JSON. (`retrieval-acceptance.yml:61`, `:169`; `tools/qa/retrieval_acceptance.py:590`) |
| B:36, D:65 | Querying an all-zero digest and getting 404 does **not** establish that the repository has no attestations; it establishes no accessible attestation at that queried digest. (Fact pack B:36, D:65, **reported command**.) |
| E:76 | Median PR age does not establish that the queue rarely has concurrent ready PRs; event-overlap/readiness data is needed. (Fact pack E:76, **reported sample**.) |
| G:113 / proposal eval denominator | Verified 67 top-level YAML files, but the text loader’s patterns match 65 before content filtering; 67 is not a valid universal executed-fixture denominator. (`tests/eval/run_eval.py:176`, `:190`, `:199`) |
| G:105 | “API, indefinite” retention is unsupported by the supplied evidence; treat historical completeness as measured availability, not guaranteed retention. (Fact pack G:105.) |
| G:114 | Owner-account comments and dispatch actors cannot distinguish Mike’s interventions from agents using that account. (`tools/ui_surface_lifecycle_guard.py:1409`; fact pack G:114, **reported**.) |
| G:115 | 22 failed production workflows are not evidence of 22 failed deployments or outages; distinguish authorization/build failures from attempts that mutated runtime. (`deploy-vps.yml:56`, `:232`, `:599`) |
| H:119 | Temporal’s product role is documented; this does not independently prove a deployed Temporal installation or SDLC use. (`docs/adr/0029-materialized-evidence.md:44`) |
| I | Prior scratchpad reports were not supplied or inspected; I have not treated prior evaluator findings as independent corroboration. |

### B.9 Top 10 changes to #4208 before ratification

1. **§3.1–§3.3 and §4:** replace “artifact exists for exact SHA” with verified identity, provenance, coverage, freshness, and trusted consumption; remove the human-only cheap-review consumer exclusion.
2. **New identity-contract subsection:** adopt the stage table and explicit mappings above; distinguish source, artifact, controller, runtime, schema/config, and deployment generation.
3. **§3.3 G3 / CONNECT-1:** replace Hub-service-wide acceptance with capability-bound coverage, generation semantics, context-aware reuse, and explicit failure outcomes.
4. **§3.10 / §3.12:** define trusted-policy execution, candidate-harness eligibility, credential separation, reviewer provenance, and enforceable owner authorization.
5. **§3.5 / G4:** remove pending deployments from Done; adopt deployment/observation states and concurrent release attribution.
6. **§3.2 / ADD-1 / §6:** enforce trusted risk floors and maximum-risk dispute resolution; correct rollback runbooks’ R0 classification.
7. **§3.6–§3.7:** make emergency mode orthogonal to risk; maintain refreshed known-good recovery candidates, per-service anchors, compatibility evidence, and a measurable recovery drill.
8. **§3.3 migration rows / §4:** require approved migration content and staging evidence, specify legacy-hash uncertainty, and correct ingest environment scope.
9. **§3.11:** repair metrics: count failed **deployment events**, not incident issues; join by run/attempt/component; use executed suite denominators and distinguish humans from agent actors.
10. **§1 / §5 / §8 / Appendix B:** update recon to expected main, incorporate omitted findings, distinguish ratification from implemented enforcement, and move authority/evidence repairs ahead of autonomy expansion.

For metrics, define **human interventions per completed change** as attributable human decision/action events divided by lifecycle-closed changes, with bundled actions recorded explicitly; preserve missing actor provenance. Change failure rate is distinct attributable failed deployment events divided by deployment events that reached runtime mutation. Receipt-backed lead time requires component inclusion, not ancestry alone. *(Proposal §3.11, lines 410–415.)*

Rollback must remain executable during provider failure: maintain fresh acceptance evidence for compatible known-good candidates before emergencies, preserve prior per-service artifact maps, and drill the actual authorization/restoration path. Waiting to rebuild and reaccept an expired candidate during an outage is not demonstrated recovery. *(Proposal §3.7, lines 341–345.)* Do not create a silent bypass of currently enforced gates.

### B.10 Ratification readiness against PRD §21

Assessment is of **the supplied proposal today**, not completion of implementation repairs.

| Condition | TRUE/FALSE | Evidence |
|---|---|---|
| No fundamental architecture flaw remains | **TRUE** | Existing trusted-base guard and receipt mechanisms support a repairable GitHub architecture. (`ui-lifecycle-guard.yml:227`; `tools/staging_receipt.py:81`) |
| Exact identity is unambiguous | **FALSE** | Reviewed/merged mappings, service coverage, artifacts, and deployment generations remain incomplete. (`deploy-vps.yml:144`, `:224`; proposal §3.3, line 271.) |
| Objective gates cannot be satisfied by agent prose alone | **FALSE** | Classification and cheap-review consumption remain declarations/manual interpretation. *(Proposal §4, lines 474, 487.)* |
| Stale evidence invalidation is defined | **FALSE** | Same-SHA reuse ignores relevant deployment/context changes, and immutable cheap-review inputs remain out of scope. *(Proposal §4, lines 487, 495.)* |
| Security trust boundaries are understood | **FALSE** | Candidate-supplied acceptance/drift validators and owner-credential authority need explicit rules. (`retrieval-acceptance.yml:79`, `:110`; `deploy-vps.yml:239`, `:285`) |
| Deployment applicability is separate from review risk | **TRUE** | Explicitly defined, including governance-only R3. *(Proposal §3.1, lines 170–174.)* |
| Hotfix and rollback paths remain practical | **FALSE** | All hotfixes become R3, while expired rollback evidence requires staging refresh and acceptance; no completed drill is presented. *(Proposal §3.6, line 323; §3.7, lines 341–345.)* |
| No new platform is required | **TRUE** | Proposed mechanisms are extensions to existing GitHub workflows and records. *(Proposal §4–§6.)* |
| Unresolved issues are normal follow-up PRs | **TRUE** | The needed consumers, scope checks, workflow repairs, and records fit existing mechanisms; no replacement control plane is justified. (`ci.yml:1700`; `ui-lifecycle-guard.yml:227`) |
| Consistent with current main after delta recon | **TRUE, bounded** | Local expected `origin/main` and its four-file delta verified; no material SDLC drift. Live remote currency remains reported, and factual omissions require correction above. |

**NOT READY.** Adopt with the ranked document changes, then reassess the false conditions. Ratification can precede code repairs once the rules and boundaries are correct; the current draft should not be ratified unchanged.
