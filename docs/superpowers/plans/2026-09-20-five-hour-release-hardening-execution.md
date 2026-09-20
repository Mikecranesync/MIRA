# FactoryLM Five-Hour Nappy-Time Release-Hardening Execution Plan

> **For agentic workers:** REQUIRED SUB-SKILL: use `superpowers:executing-plans` to execute this plan task by task. Use `superpowers:test-driven-development` for code changes and `superpowers:verification-before-completion` before any completion claim.

**Goal:** During Mike's five-hour sleep window, turn Claude's release-hardening specification into the smallest exact-head, independently reviewed engineering queue that can be handed to Mike for decisions. Production, customer readiness, and physical-device acceptance remain unclaimed until their separate gates actually run.

**Architecture:** Keep the existing FactoryLM shared shell, notebook/thread/evidence model, deployment workflows, and release control plane. One implementer works sequentially in isolated worktrees. Other peers are reviewers, evidence collectors, or backups; a backup does not write until an explicit handoff releases the original owner. Issue [#3626](https://github.com/Mikecranesync/MIRA/issues/3626) remains the durable coordination ledger.

**Tech stack:** Git/GitHub Actions, Bun/TypeScript, Docker Compose, Hono (`mira-web`), Next.js (`mira-hub`), Android/Capacitor, Neon, Doppler, the `claude-peers` broker, and existing repository test/review tooling.

**Window:** Five hours from dispatch. Checkpoints at T+00, T+30, T+60, T+120, T+180, T+240, T+285, and T+300.

**Execution status at authoring:** `NO-GO`; production and the Pixel are not authorized targets for this plan.

---

## 1. Starting truth

Refresh every value before acting. This table is a signed snapshot, not permanent authority.

| Fact | Verified state at 2026-09-20 15:47 UTC | Release meaning |
|---|---|---|
| `origin/main` | `5eb562feba2c6418c86d5ba82d73c19bdac8e5f5`, tag `v3.349.16` | Frozen RC source at the start of this plan. |
| Production | Healthy older recovery build, last observed `gitSha=0178b1b0776f30cccde42c8d255031254b882a38` | No outage requires a rushed deploy. Refresh live before relying on it. |
| Last RC deploy | Run `35505726834` failed closed before container replacement because the OVH host lacked a usable Doppler token | Production remained unchanged; later token provisioning did not itself prove a new deploy. |
| Claude plan | `/Users/bravonode/factorylm-release-plan-v2-hardened.md`, 171 lines, SHA-256 `256468bd46c468750c5dafbdbdd9d57573bd640fba17de1addc25d379aa50f7b` | Useful source material, but node-local and not repository-durable. This document is the repo-readable execution record. |
| Hardening issues | #3909–#3914 are open, unassigned, unlabeled, and have no claims or implementation PRs | They are specifications, not implemented gates. |
| Existing issue extensions | #3343, #3880, #3882, and #2986 contain the new acceptance conditions | Comments do not make those conditions pass. |
| Physical device | Pixel released on stock FactoryLM 1.2.1/versionCode 12; emulator evidence remains separate | No install, reset, OTA, or physical acceptance is authorized overnight. |
| Local planning checkout | `codex/rc-technician-journey-2026-09-20` is behind `origin/main` and contains preserved Hub safety work | Do not use this checkout as the overnight implementation carrier and do not alter or clean its existing changes. |

### Claude work that is accepted

- The eleven blocker model is directionally sound.
- A separate staging host is the cleanest mechanical proof that staging has no path to production secrets.
- Production source, build, deployed artifact, and runtime identity must bind to one approved RC SHA.
- Production migration drift and staging quality gates must fail closed and must not be bypassable.
- Safety-stop hydration, rollback rehearsal, cross-surface idempotency, Neon isolation, `/v3` recovery, external prerequisites, and Mike's literal SHA-named GO remain separate gates.
- The six new issues and four issue extensions exist durably on GitHub.

### Corrections this plan makes

1. `deploy-vps.yml` does not silently replace a selected SHA with a newer `origin/main`. Manual dispatch has no SHA input, checks out the dispatch SHA, and then requires that SHA to remain current `main`. The defect is that an approved older RC cannot be selected and Mike's approval is not machine-bound to the dispatched SHA.
2. Runtime SHA proof currently exists only for Hub source metadata. `mira-web` hardcodes health version `0.2.1` and has no equivalent source-SHA identity, so a Hub-only assertion cannot prove the Hub + marketing artifact pair.
3. `--no-cache --pull` prevents stale local layers but does not make builds reproducible while base images and dependency fallbacks remain mutable. #3910 must record immutable image identities and either pin inputs or describe the narrower guarantee honestly as exact source provenance.
4. `deploy-staging.yml` also requires current `main`; it must be able to deploy the same approved frozen SHA.
5. The RC is already frozen, but #3910, #3911, #3912, and #3880 require code commits. Any merge reopens the freeze and invalidates artifact-bound evidence. Overnight work may prepare branches and draft PRs only.
6. #3913 requires a deployed rollback rehearsal before freeze, but it was filed after the current freeze. It can be designed overnight; its real acceptance requires a new staging target and a later re-freeze.
7. #3626 contains two incompatible sequences: the 14:24 UTC release-director checkpoint recommends direct production first, while the 15:38 UTC hardening roll-up requires staging first. No agent may silently choose between them. This plan recommends staging first and leaves the final decision to Mike.
8. #3909's old-IP removal must be scoped to active staging workflows, runtime configuration, compose defaults, and runbooks—not every historical reference in the repository.
9. #3914 must verify the exact Neon project/branch identifier. `current_database()` alone is insufficient because different Neon branches can expose the same database name.

---

## 2. Five-hour outcome

The strongest honest outcome possible in five hours is:

1. one live owner/continuity map recorded on #3626;
2. one isolated, draft hardening carrier for #3910 + #3911, or an evidence-backed blocker before code begins;
3. red-first tests and exact-head verification for the carrier;
4. independent workflow and security review bound to the exact carrier SHA;
5. read-only prerequisite packets for staging, rollback, mobile, and cross-surface acceptance;
6. a wake-up card listing only the exact human decisions and consequential approvals still required.

This window cannot honestly complete separate VPS procurement, DNS/OAuth/secrets configuration, a deployed rollback rehearsal, production deployment, physical Pixel proof, cross-surface acceptance, `/v3` cutover, or the required 24-hour soak.

---

## 3. Authority envelope

### Authorized without waking Mike

- Refresh Git, GitHub, peer, workflow, production-health, and device visibility using read-only commands.
- Create isolated branches/worktrees after a durable issue claim wins the post-claim reread.
- Write red-first tests and bounded code for an assigned issue.
- Run local tests, lint, builds, `git diff --check`, workflow static checks, and existing adversarial review tooling.
- Commit and push only an owned feature branch; open or update a draft PR carrying the actual work.
- Post material claim, checkpoint, review, and handoff evidence on the owning issue and #3626.
- Prepare non-executing commands, checklists, and sanitized evidence templates.
- Run emulator-only checks when clearly labelled `NOT TESTED` for physical-device acceptance.

### Not authorized in this plan

- Merge any PR or move `main`.
- Reopen or re-freeze the RC on Mike's behalf.
- Dispatch staging or production deployment workflows.
- Apply or roll back a production migration or production database state.
- Buy/provision a VPS; modify DNS, OAuth, Doppler, GitHub environments, protected variables, secrets, firewall rules, or TLS.
- Publish OTA, distribute a mobile release, install/uninstall/reset the Pixel, or interact with Mike's personal phone.
- Change industrial equipment or customer data.
- Add an attestation/exception/release label.
- Claim final `GO`, customer readiness, staging acceptance, production acceptance, or physical-device acceptance.

If a command reaches one of these boundaries, stop that lane and write the exact command, target, reason, owner, and approval needed into the wake-up packet. Do not execute it.

---

## 4. Lane and backup map

Assignments become active only after the primary acknowledges the work order and confirms no older overlapping claim. Until then the lane state is `PROPOSED`.

| Lane | Primary | Continuity / independent check | Deliverable in five hours | Write boundary |
|---|---|---|---|---|
| Release control | `uip267k1` (`mira-2a-mq`) | `um6ts10l` (current Codex coordinator) | Refresh the ledger, resolve claims, record exact heads, post T+00/T+120/T+300 material checkpoints | No implementation, merge, deploy, label, attestation, or GO |
| Sole implementation | `iriya7m7@bravo` (BRAVO-A), after acknowledgement and winning claim | `f7wg2tjp@bravo` is read-only standby; it writes only after a recorded handoff | One draft carrier for #3910 + #3911 with red-first tests and exact-source/artifact gate evidence | One writer only; no edits before durable claim; no merge |
| Workflow truth / exact-head review | `workflow_truth_audit` subagent for the initial audit; then a non-author peer selected and acknowledged at T+00 by the director | `github_durability_audit` checks claim/head/evidence durability; neither is an automatic code-owner replacement | Review the exact candidate SHA, reproduce failures, validate all new symbols and workflow paths, return PASS/FAIL/NOT TESTED | Read-only on implementation carrier |
| GitHub durability / collision control | `github_durability_audit` subagent | Release control lane | Verify issue owners, claim timestamps, current PR heads, freeze state, and whether evidence is actually durable | No code edits |
| Staging and external prerequisites | `ybn1dstd@bravo` (BRAVO-B) | `uip267k1` | Read-only #3909/#3914 inventory: host/trust boundary, active old-IP uses, DNS/TLS/OAuth/Neon/OTA gaps, exact approval card | No provision/config/secrets/deploy |
| Mobile and cross-surface preparation | `o2fbkipe` (device captain) | Release control lane | Refresh #3881/#3882 source/artifact plan, approved-SHA workflow gap, scripted evidence template, emulator-only non-acceptance checks if useful | No Pixel/OTA/distribution/install/reset |
| Rollback/data isolation | BRAVO-B | Workflow reviewer | Static #3913/#2986 plan: concrete prior tag, non-prod rehearsal commands, exact Neon branch proof, timing/evidence schema | No rollback execution or DB mutation |
| Safety-stop hydration | `nap_coordination_audit` subagent for the initial scope check; release director queues the next carrier | Workflow reviewer | Read-only #3912 test specification covering live STOP versus cold-reopened STOP; name exact likely files and acceptance assertions | No code edit in this five-hour carrier; #3912 remains OPEN |
| Plan integration | `nap_coordination_audit` subagent | Current Codex coordinator | Check that lanes do not overlap, backup rules are explicit, stop conditions are complete, and wake-up packet is decision-ready | Document review only |

### Backup rule

A continuity owner is an evidence validator unless explicitly named as a technical backup. It is not a second writer. A write handoff must be recorded on the owning issue with: issue, exact files, old owner, new owner, worktree, branch, last known SHA, test state, and `Status: RELEASED` for the old claim. The new owner rereads claims before editing.

---

## 5. Ordered execution

### Task 1 — Establish the live control plane (T+00 to T+30)

**Owner:** release control.  
**Files changed:** none.  
**Durable target:** #3626.

Run:

```bash
git fetch origin main
git rev-parse origin/main
git log origin/main --oneline -10
gh pr list --state open --json number,title,headRefName,headRefOid,isDraft
gh issue view 3626 --comments
python3 ~/.claude/peer-roster/peer-router.py roster --json
gh run list --workflow deploy-vps.yml --limit 5
curl -fsS https://app.factorylm.com/api/health/
adb devices -l
```

Acceptance:

- [ ] Record current `origin/main`, production SHA, latest deploy outcome, connected devices, and reachable peer identities.
- [ ] Reread #3909–#3914, #3880, #3881, #3882, #2986, and all active claims touching the proposed files.
- [ ] Record the staging-first/direct-production conflict as `DECISION REQUIRED`; do not infer resolution.
- [ ] Record `um6ts10l` as release control/document owner, not an implementation writer, superseding its stale broker summary before BRAVO-A claims work.
- [ ] Assign and obtain acknowledgements from one implementation primary, one read-only technical backup, and one independent reviewer. If the primary does not acknowledge or cannot win the claim, mark implementation `BLOCKED` and keep the other lanes read-only.
- [ ] Post one `[RELEASE-DIRECTOR][NAPPY-TIME T+00]` checkpoint. Do not post repeated no-change comments.

### Task 2 — Claim and isolate the hardening carrier (T+30 to T+60)

**Owner:** sole implementer.  
**Issues:** #3910 and #3911.  
**Base:** one captured SHA from refreshed `origin/main`; never the dirty `cf59` worktree.

Before editing:

```bash
git log HEAD..origin/main --oneline
BASE_SHA="$(git rev-parse origin/main)"
gh pr list --state open --search '3910 OR 3911 OR approved_rc_sha OR skip_drift_check'
git ls-tree -r --name-only origin/main | rg 'deploy-(vps|staging)|resolve_release_tag|workflow.*test|actionlint'
gh pr list --state merged --limit 20 --search 'deploy approved sha drift staging gate'
sed -n '13,38p' docs/plans/2026-04-19-mira-90-day-mvp.md
```

Post the canonical claim on #3626 and mirror or backlink it on both #3910 and #3911. It must include both issues, expected files, captured base SHA, branch, worktree, and forbidden actions. Reread #3626, #3910, and #3911. If an earlier overlapping claim exists, release this claim and coordinate on the winner.

Expected scope after the reuse scan:

- `.github/workflows/deploy-vps.yml`
- `.github/workflows/deploy-staging.yml`
- `.github/scripts/resolve_release_tag.sh`
- existing workflow contract tests
- `docker-compose.saas.yml` and `docker-compose.staging-vps.yml` only where build/runtime identity already flows
- `mira-web/src/server.ts` plus an existing test for the health endpoint if marketing source identity is implemented there

Do not touch mobile, `/v3` product routing, safety hydration, database migrations, or shared UI in this carrier.

Acceptance:

- [ ] Isolated worktree and branch start at the captured `BASE_SHA`; later movement of `origin/main` cannot change the base silently.
- [ ] Durable claim wins the post-claim reread.
- [ ] Red tests demonstrate the missing approved-SHA input, current-main coupling, bypass paths, missing Hub runtime assertion, and missing marketing identity.
- [ ] No production or staging workflow is dispatched.

### Task 3 — Implement the exact-source and non-bypass contract (T+60 to T+180)

**Owner:** sole implementer.  
**Reviewer:** workflow truth lane, read-only.

Required behavior:

1. `approved_rc_sha` is required, exactly 40 lowercase hex characters, and exists in this repository. The SHA is the immutable authority. An `approved_release_tag` may be required and must point to the SHA, but ordinary repository tags are not called immutable unless tag protection is separately proven.
2. Production and staging checkouts, Staging Gate lookup, tag resolution, build arguments, and post-deploy assertions all use that value—not live `origin/main` and not an implicit event SHA.
3. Mike's eventual approval must be an authenticated human gate bound to the visible `approved_rc_sha`, preferably Mike as the required reviewer of a protected production environment. A comment from the shared `Mikecranesync` automation identity is not proof Mike personally approved. The current production environment has no protection rules, so this gate remains externally `BLOCKED` until configuration and identity are verified.
4. `skip_staging_gate=true` and `skip_drift_check=true` are rejected or removed on the production path. Drift setup and verification always execute and fail closed.
5. The untagged moving/hotfix fallback is removed for this release path.
6. Production builds use the issue-required `docker compose build --no-cache --pull`. Staging and production capture each post-build image ID/digest, then inspect each running container's `.Image` after `compose up` and require equality. If mutable inputs remain, wording says `exact source provenance`, not `reproducible build`.
7. Hub health failure is blocking and response JSON must report `gitSha == approved_rc_sha`.
8. `mira-web` exposes equivalent source identity or the workflow verifies an immutable image label/digest. A hardcoded semantic version is not source proof.
9. Staging deploy accepts the same approved SHA, reports it, and emits a durable deployed-staging receipt containing `approved_rc_sha`, runtime SHA, built image IDs, running image IDs, target identity, run URL, and timestamp. Production authorization queries that receipt and rejects a missing, stale, or mismatched receipt. The ordinary CI `Staging Gate` is not deployed-environment acceptance.
10. No tests, access control, safety behavior, or drift checks are weakened.

Test cycle:

1. Run the narrow red tests and capture the failure.
2. Make the smallest bounded change.
3. Run narrow tests.
4. Run workflow/YAML/static checks and relevant TypeScript tests.
5. Run `git diff --check`.
6. Run the repository stop gate appropriate to changed files.
7. Verify every new variable, script, endpoint field, and compose argument exists and is wired from producer to consumer.

Local/static verification cannot prove deployed behavior. Image-ID equality, runtime SHA equality, staging receipt enforcement, and missing-environment-credential behavior remain `NOT TESTED` in deployed environments until an authorized staging run executes them.

Commit policy: conventional commits, small bisectable steps. Push only the owned branch. Open a draft PR referencing #3910 and #3911; do not merge it.

### Task 4 — Independent exact-head review (T+180 to T+240)

**Owner:** non-author workflow reviewer.  
**Backup:** durability reviewer.

The reviewer checks out the exact draft-PR head in a separate worktree and records:

- repository, base SHA, head SHA, changed paths, and claim identity;
- red-test reproduction or the preserved red-test commit/output;
- focused tests, full relevant suite, lint/static checks, build checks, and `git diff --check`;
- tamper cases: uppercase/malformed SHA, unknown SHA, SHA without the requested tag, main moving after dispatch, staging/drift bypass requested, missing/stale/mismatched staging receipt, built/running image mismatch, Hub SHA mismatch, web identity mismatch, missing health body, missing drift credential, and tag resolver fallback;
- whether staging and production use the identical approved SHA;
- whether any new symbol or field is unwired;
- whether test or gate strength decreased.

Verdict must be `PASS`, `FAIL`, or `NOT TESTED` and names the exact reviewed SHA. Any head change makes it stale. The expected first TDD red run does not count as a retry. After that, allow at most two bounded fix/retest attempts for one root cause; if it is still failing, preserve the branch and escalate.

### Task 5 — Parallel read-only readiness packets (T+30 to T+240)

These lanes may run while Task 3 proceeds because they do not edit the carrier.

#### 5A. Staging/external packet — #3909 + #3914

- Inventory only active staging workflows, runtime configuration, compose defaults, and current runbooks for the dead `165.245.138.91` target.
- Propose `STAGING_HOST` validation and dedicated staging host-key material; never reuse production trust material.
- Record public raw `4xxx` ports that must close behind the HTTPS front door.
- Check DNS resolution, OAuth callback inventory, GitHub environment names, and variable names without reading secret values.
- Specify authoritative Neon project/branch-ID evidence; do not accept `current_database()` alone.
- Return exact external actions, owner, cost/time estimate, and required approval. Do not make the changes.

#### 5B. Rollback packet — #3913

- Name a concrete prior release SHA plus its observed tag and image digest; treat the SHA/digest, not an unprotected tag name, as authoritative.
- Write but do not execute the non-production rehearsal steps: checkout, build, bring up, health, runtime identity, and measured restore time.
- Define what evidence proves rollback and what failure stops the later freeze.
- Mark the actual rehearsal `NOT TESTED` until a separate staging host exists.

#### 5C. Mobile/cross-surface packet — #3881 + #3882

- Extend the plan so mobile build source binds to the same `approved_rc_sha`; current mobile release jobs also couple to dispatch-time current `main`.
- Confirm exact versionName/versionCode source state and stale direct-publication host references.
- Prepare the Golden Conversation evidence sheet: source SHA, APK SHA-256, signer, versionCode, tenant, Project ID, thread ID, evidence IDs, citation targets, timestamps, and PASS/FAIL/NOT TESTED rows.
- Include photo-first, text-first, upload failure/retry, correct evidence association, grounded answer, close/reopen safety state, simultaneous phone/web sends, and phone -> web -> phone continuity.
- Emulator checks are component evidence only. Physical acceptance remains `NOT TESTED`.

#### 5D. Safety-stop hydration packet — #3912

- Specify, without editing code, a red test that creates a real structured hazard STOP, cold-reopens the same thread, and asserts STOP banner + LOTO text + no answer/provider card.
- Name the existing Hub and mobile hydration paths and likely test files after a read-only reuse scan.
- Queue #3912 as the next separate carrier owned by the sole implementer only after #3910/#3911 is released or handed off.
- Mark implementation and physical proof `NOT TESTED` in this five-hour carrier.

#### 5E. `/v3` decision packet — #3880

- Write a read-only test specification/pseudocode for authenticated `/` routing and parity between `/feed` and `/v3` gates. Any real test edit waits for the sole implementer and a separate recorded claim/handoff.
- Present two choices to Mike: environment-controlled destination requiring controlled recreate, or live runtime-config/database flag requiring no restart.
- Recommend the smallest option that satisfies Mike's intended meaning of “no rebuild.”
- Do not implement disputed scope or flip the default.

### Task 6 — Freeze work and assemble the wake-up packet (T+240 to T+300)

At T+240 stop adding scope. At T+285 stop code changes and preserve exact heads.

Every lane returns:

```text
Outcome proven:
Issue / criterion:
Primary / backup:
Worktree / branch:
Base SHA / exact tested head:
Files changed or inspected:
Commands, UTC timestamps, exit codes, artifact locations:
PASS / FAIL / NOT TESTED rows:
Independent verdict and reviewed SHA:
Remaining blocker:
Next action and owner:
Exact approval required:
Unauthorized operations confirmation:
```

Release control posts one final `[RELEASE-DIRECTOR][NAPPY-TIME T+300]` checkpoint on #3626 and writes a uniquely owned handoff, such as `docs/mira/evidence/nappy-time-2026-09-20/HANDOFF.md`, from `docs/templates/overnight-HANDOFF.md`. Do not overwrite the root `HANDOFF.md`, whose ownership is tracked separately. No completion wording may exceed the evidence.

---

## 6. Collision and evidence rules

- #3626 is the claim board and release ledger. Broker delivery is supplemental, not durable completion evidence.
- One implementer owns all carrier writes. Reviewers never edit the carrier.
- Separate worktrees and branches are mandatory. Never use another session's dirty checkout.
- Check open PR changed-file lists and claims before claiming and before pushing.
- Do not steal a silent claim. One missed 30-minute checkpoint triggers contact; it does not transfer ownership.
- A changed candidate head invalidates every earlier exact-head review.
- A CI pass, workflow dry run, image build, deployed container, signed APK, installation, launch, emulator pass, and customer acceptance are different gates.
- Record commands, exit codes, timestamps, and artifact locations. Keep credentials, tokens, customer data, and personal-device data out of evidence.
- Never weaken a test to get green. Never turn a skipped or unexecuted check into PASS.
- The expected first TDD red run is not a retry. Permit two bounded fix/retest attempts for one root cause, then stop with the reproduction and blocker if it is still failing.

---

## 7. Mandatory stop conditions

Stop only the affected lane when:

- ownership overlaps, the claim loses the post-claim reread, or two writers touch the same files;
- the base or candidate SHA changes unexpectedly;
- required review tooling is unavailable, malformed, or times out;
- a required test/check is red, skipped, or not run;
- a proposed change weakens tests, safety, access control, tenant isolation, drift detection, or immutable identity;
- implementation expands into a new orchestrator, tracker, deployment platform, UI shell, data store, or competing release candidate;
- work requires secret values, a new credential, VPS purchase, DNS/OAuth/environment mutation, production access, or production/customer data;
- the lane reaches merge, deploy, rollback, migration, OTA/distribution, Pixel mutation, attestation, freeze, cutover, or customer GO;
- source, built image, deployed image, and runtime-reported identity disagree;
- the same root cause is still failing after two bounded fix/retest attempts.

When a stop condition fires, preserve the branch and evidence, post one material checkpoint, write `HANDOFF.md`, and move only to an already-authorized non-overlapping read-only lane.

---

## 8. Mike's wake-up decision card

Release control must present these as independent decisions, with exact SHA/target details filled in:

1. **Freeze:** authorize reopening the current RC freeze so the reviewed hardening carrier(s) can merge. Merging makes `5eb562feb...` historical, not the release candidate.
2. **Sequence:** confirm **staging-first**. Choosing direct-production-first stops this execution and requires Mike to explicitly change the hardened gate policy; it is not a normal alternative under this plan because the policy forbids staging and drift bypasses and production is currently healthy.
3. **Carrier merge:** authorize merge of each named, exact reviewed PR SHA only after required checks and current-head reviews are green.
4. **Staging and approval infrastructure:** authorize the separate VPS, protected staging deploy identity/host variable, staging-only Doppler configuration, DNS/TLS, OAuth redirect URIs, exact Neon staging branch, required GitHub environments, and a production environment protection rule that identifies Mike as the required human reviewer for a run showing the exact approved SHA.
5. **`/v3` semantics:** decide whether “runtime switch” permits a controlled container recreate with no new image, or requires an instant no-restart flag.
6. **New RC:** after merges and staging proof, approve a new exact `approved_rc_sha` and freeze it.
7. **Later production action:** separately authorize a production rolling deploy naming the exact new RC SHA. Do not infer this from any earlier go.
8. **Later device action:** separately authorize signed build/distribution and physical Pixel interaction for the named artifact.
9. **Final customer GO:** only after staging, production, physical mobile, same-thread cross-surface acceptance, `/v3` cutover/recovery, and 24-hour soak are complete.

---

## 9. Definition of a successful five-hour run

The overnight run is successful when Mike wakes to:

- this repo-readable execution record;
- a current acknowledged primary/continuity map;
- one exact hardening carrier SHA with independent verdict, or a preserved partial carrier with exact failure evidence and blocker at any stage;
- read-only staging, rollback, mobile, cross-surface, and `/v3` decision packets;
- a short approval card with no hidden consequential action;
- confirmation that `main`, production, secrets, DNS/OAuth, customer data, industrial equipment, OTA channels, and the physical phone remained untouched.

It is not successful merely because issues exist, peers said “sent,” tests passed on another SHA, an image built, or a draft PR was opened.
