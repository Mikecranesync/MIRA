# Customer-Ready Unified Experience — Evidence and Closure Ledger

- **Mission:** `FACTORYLM-UNIFIED-UI-CUTOVER-001`
- **Product target:** one ChatGPT-like FactoryLM interface across mobile and web, with the same Projects, threads, evidence, citations, and technician context
- **Snapshot:** 2026-09-19 20:10 EDT (`2026-09-20T00:10:26Z`)
- **Snapshot main:** `0913114c79682e370522b8d47a2a9c70d2ba73b1`
- **Durable coordination:** [issue #3626](https://github.com/Mikecranesync/MIRA/issues/3626)
- **Status:** **NO-GO for customer release** — implementation is close; deployment and end-to-end acceptance are not

This is the release execution ledger for every MIRA/FactoryLM session. It does
not replace the approved cutover charter or product PRD:

- product and lifecycle rules remain in
  [`UNIFIED_UI_CUTOVER.md`](../architecture/convergence/UNIFIED_UI_CUTOVER.md);
- the three-surface definition of done remains in
  [`2026-09-19-customer-ready-three-surfaces-prd.md`](../prd/2026-09-19-customer-ready-three-surfaces-prd.md);
- live claims and handoffs remain on GitHub issue #3626;
- this document reconciles those sources with the live evidence below and
  routes each remaining closure unit to one issue.

Committed statuses are snapshots, never live authority. Before acting, refresh
the named PR/issue, exact SHA, checks, and environment evidence.

## 1. Executive answer: how far from the vision?

The architecture rewrite is no longer the problem. The shared shell, web host,
Projects/threads model, general-question path, photo evidence path, and most of
the mobile attachment work exist on `main`.

The best evidence-based estimate at this snapshot is:

| Measure | Estimate | Meaning |
|---|---:|---|
| Implemented on `main` | **about 80%** | The intended shell and core capability seams exist. |
| Available in the deployed product | **about 45%** | Production is 27 commits behind this snapshot and still runs the recovery build. |
| Proven customer-ready | **about 45%** | There is no current physical-Pixel release proof or one-thread phone-to-web proof. |

These are release-risk estimates, not test coverage metrics. The remaining work
is one focused release train, not another UI architecture program:

1. close the remaining correctness and safety gaps;
2. clear the production migration gate and deploy the exact release;
3. rebuild the mobile candidate from current `main` and prove it on the Pixel;
4. run one same-thread Golden Conversation across phone and web;
5. make `/v3` the normal authenticated landing only after direct-route proof;
6. record an explicit human go/no-go.

## 2. What is real now

The following is merged into the snapshot main. It is implemented evidence, not
proof that customers can use it in production.

| Capability | Merged evidence | What it establishes |
|---|---|---|
| Shared shell mounted in Hub | [PR #3839](https://github.com/Mikecranesync/MIRA/pull/3839) | `/v3` consumes the canonical shared FactoryLM shell. |
| Hub HOME/New chat/New project/general threads | [PR #3875](https://github.com/Mikecranesync/MIRA/pull/3875) | The web host lands on a composer-first HOME and persists L0 threads. |
| General Hub questions answer honestly | [PR #3873](https://github.com/Mikecranesync/MIRA/pull/3873) | `/api/hub/ask` can return labelled general reasoning and has a safety gate. |
| Photo observation persisted and grounded | [PR #3874](https://github.com/Mikecranesync/MIRA/pull/3874), [PR #3854](https://github.com/Mikecranesync/MIRA/pull/3854) | The canonical notebook path can retain and consume verified visual evidence. |
| Mobile photo provenance safety | [PR #3866](https://github.com/Mikecranesync/MIRA/pull/3866) | Generated LOOK prose is no longer concatenated into the classified technician question. |
| Mobile attachments and camera-return fixes | [PR #3829](https://github.com/Mikecranesync/MIRA/pull/3829), [PR #3835](https://github.com/Mikecranesync/MIRA/pull/3835) | The native handoff and foreground recovery code is on `main`. |
| Mobile and Hub-image CI gates | [PR #3867](https://github.com/Mikecranesync/MIRA/pull/3867) | Mobile Unit Tests and the Hub image build participate in the main CI gate. |
| OVH deployment plumbing | [PR #3825](https://github.com/Mikecranesync/MIRA/pull/3825) | The repository targets the replacement production host, subject to migration and operator gates. |
| Critical Hub dependency remediation | [PR #3871](https://github.com/Mikecranesync/MIRA/pull/3871) | The fixed Hub dependencies exist on `main`, not yet on the live recovery build. |

## 3. Current environment evidence

| Surface/gate | Observed evidence | Release meaning |
|---|---|---|
| Production Hub | `GET https://app.factorylm.com/api/health/` returned `gitSha=0178b1b0776f30cccde42c8d255031254b882a38`, `version=recovery-0178b1b07`, `builtAt=2026-09-15T02:51:07Z`. | Healthy old build; **not** current-main proof. |
| Main vs production | Snapshot `main` is 27 commits ahead of the live health SHA. | The implementation table above is not customer-visible yet. |
| Last completed production deploy | [run 35472589217](https://github.com/Mikecranesync/MIRA/actions/runs/35472589217) failed before deployment: production has 107/109 migrations. | Hard blocker, correctly fail-closed. |
| Missing production migrations | `088_notebook_turn_idempotency.sql`, `089_notebook_turn_request_claim.sql`. | Requires a governed human dry-run/apply decision; no agent self-authorization. |
| Authenticated landing in source | `mira-hub/src/middleware.ts` still redirects `/` to `/feed`. | `/v3` exists but is not yet the default product. |
| Mobile release branch | PR #3845 head `93dddf10f0000b49af295a1f8d849929d1f66cfd`; 21 current-main commits vs 15 PR-only commits, merge base `41cf3e27af505d54226f09f544026b0774c3a87e`. | Reconstruct/review the release; do not merge the stale bundle blindly. |
| Connected Android target | Only `emulator-5554`; installed FactoryLM reports `1.2.1`, versionCode `12`. | Emulator availability; **not** physical acceptance. |
| Physical Pixel | Not connected during this audit. | Phone testing cannot be claimed complete. |
| Cross-surface continuity | No current proof artifact opens and continues the exact same thread on phone and web. | The central product vision is not yet accepted. |

## 4. Release-critical issue ledger

The issue is the unit of ownership. A session claims one row on its issue and
posts start SHA, branch/worktree, expected files, and explicit forbidden actions.
Do not create a competing issue when one below already owns the gap.

### P0 — must close or receive an explicit owner-signed release disposition

| Gap | Durable owner | Snapshot state | Required closing evidence |
|---|---|---|---|
| Unbound mobile Project discards uploaded manual scope | [#3862](https://github.com/Mikecranesync/MIRA/issues/3862) | Open; reproducible blocker | Exact-head fix, opposite-direction tests, cited manual answer on release candidate. |
| Mobile HOME uses last machine context / cannot send with zero Projects | [#3877](https://github.com/Mikecranesync/MIRA/issues/3877) | Open; Hub twin fixed in #3875 | HOME routes only to an unbound General Project, no loading-race duplicate, device proof. |
| Mobile cold restart may restore the wrong thread | [#3851](https://github.com/Mikecranesync/MIRA/issues/3851) | Open; mechanism traced, reproduction incomplete | Confirm or falsify on realistic >20-thread state; fix and regression proof if confirmed. |
| Photo answer consumes the photo observation | [#3788](https://github.com/Mikecranesync/MIRA/issues/3788) | Code fixes merged; live/phone issue still open | Exact-release phone and production transcripts answer from the attached photo. |
| Negated visual observation must not cause a false safety stop | [#3852](https://github.com/Mikecranesync/MIRA/issues/3852) | Code fix merged in #3866; release proof open | Healthy negation answers; positive hazard still stops on exact mobile release. |
| Failed photo analysis cannot send a photo claim | [PR #3850](https://github.com/Mikecranesync/MIRA/pull/3850) | Open, behind main | Reconcile into current release or prove identical behavior already landed; current-head review. |
| Mobile session cookie jar reaches logs/backups | [#3732](https://github.com/Mikecranesync/MIRA/issues/3732) | Open release-security finding | Release build excludes backup/plaintext leakage; logging guarantee tested; no credential printed. |
| Poisoned retrieved document can override safety | [#3790](https://github.com/Mikecranesync/MIRA/issues/3790) | Pre-display validation merged in #3792; issue/live retest open | Re-run the exact poison fixture against the release; dangerous advice never streams or persists. |
| Energized-electrical directive is missing from the live structured stream | [#3841](https://github.com/Mikecranesync/MIRA/issues/3841) | Open | Live and hydrated clients render equivalent structured warning behavior. |
| Public quickstart lacks the deterministic safety gate | [#3876](https://github.com/Mikecranesync/MIRA/issues/3876) | Open | Stop and educational-control tests plus exact-head route proof. |
| Production migrations 088/089 | [#3878](https://github.com/Mikecranesync/MIRA/issues/3878) | Open; human-controlled blocker | Governed dry-run, authorized apply, then drift=0 without bypass. |
| Deploy current main to OVH and prove direct `/v3` | [#3879](https://github.com/Mikecranesync/MIRA/issues/3879) | Open; blocked by #3878 | Live health SHA equals selected release; authenticated stranger walk and rollback evidence pass. |
| Rebuild mobile 1.2.1 and complete Pixel Golden Conversation | [#3881](https://github.com/Mikecranesync/MIRA/issues/3881) | Open; blocked by mobile gaps/Pixel availability | Exact APK identity plus full physical journey and current-head gates. |
| Same persisted conversation continues phone → web → phone | [#3882](https://github.com/Mikecranesync/MIRA/issues/3882) | Open; blocked by #3879/#3881 | One Project/thread ID, one message history, correct citations/evidence, no duplicates, human verdict. |
| Make `/v3` the authenticated default, retain recovery | [#3880](https://github.com/Mikecranesync/MIRA/issues/3880) | Open; blocked by live direct-route proof | Root/login/deep-link tests, recovery route, rollback, post-cutover smoke. |

### P1 — required before broad rollout, parallel to the P0 release train

| Gap | Durable owner | Release treatment |
|---|---|---|
| System-prompt disclosure | [#3785](https://github.com/Mikecranesync/MIRA/issues/3785) | Fix or record an explicit, time-bounded security acceptance before broad customer access. |
| Maintenance-scope prompt injection | [#3786](https://github.com/Mikecranesync/MIRA/issues/3786) | Add deterministic regression coverage and release disposition. |
| Per-user session revocation absent | [#3831](https://github.com/Mikecranesync/MIRA/issues/3831) | Choose max-age/session-version control and owner before scaling beyond pilot. |
| Mobile cannot target a real HTTPS staging environment | [#3796](https://github.com/Mikecranesync/MIRA/issues/3796) | Production synthetic-tenant proof may unblock the pilot; staging remains required for a repeatable release loop. |
| Public SimLab demo not boot/deploy proven | [#3883](https://github.com/Mikecranesync/MIRA/issues/3883) | Parallel commercial-readiness lane; does not replace authenticated product acceptance. |
| Production run-diff capability has no owner, CI, or real-store proof | [#3886](https://github.com/Mikecranesync/MIRA/issues/3886) | Main set the next review to 2026-10-19 in #3885; verify live flag state, assign/disable, gate its tests, and capture real-store evidence. |
| TechnicianContext ADR and staging proof remain unresolved | [#3887](https://github.com/Mikecranesync/MIRA/issues/3887) | Main set the next review to 2026-10-19 in #3885; Mike disposition of ADR-0033 plus live staging state and manifest evidence. |

Umbrella issues [#3735](https://github.com/Mikecranesync/MIRA/issues/3735)
and [#3740](https://github.com/Mikecranesync/MIRA/issues/3740) remain useful product
context. Their old branch/SHA status is not a release queue; the focused issues
above are the executable closure units.

## 5. Critical path and parallel lanes

```text
Correctness/safety in parallel
  #3862  #3877  #3851  #3732  #3790  #3841  #3876  #3850 reconciliation
       \      |       /
        exact current-main candidate
          |                    |
          |                    +--> #3881 current mobile RC --> Pixel proof
          |
          +--> #3878 human migration gate --> #3879 direct /v3 production proof
                                      \       /
                                       #3882 same-thread phone/web proof
                                                     |
                                       #3880 default-route cutover + smoke
                                                     |
                                       owner-signed customer GO / NO-GO

Parallel P1: #3883 public demo; #3796 staging; #3785/#3786/#3831 hardening;
#3886/#3887 capability decisions and evidence
```

### Lane rules

1. **Correctness lane:** one issue/branch per gap. Reuse canonical mobile/Hub
   adapters and notebook APIs; do not build a second shell, thread store, or
   chat route.
2. **Production lane:** #3878 is human-controlled database state. #3879 is a
   separate deploy/proof gate. A successful migration does not prove a deploy.
3. **Mobile lane:** #3881 owns release integration and physical evidence. It
   consumes fixes; it should not hide unresolved gaps inside a large conflict
   resolution.
4. **Acceptance lane:** #3882 is read-mostly product proof after release
   candidates exist. Failures route back to their owning issue.
5. **Cutover lane:** #3880 changes the default only after `/v3` is proven live.
6. **Demo lane:** #3883 proceeds independently and cannot be used as proof of
   signed-in mobile/web continuity.

## 6. Canonical customer acceptance

One run must prove one identity, one Project, and one thread across both product
surfaces. Use a synthetic tenant and a previously unseen manual.

1. Physical phone: sign in, create a Project, upload the manual, and wait for
   searchable status.
2. Ask a question whose answer appears on a known page; open the citation at the
   correct passage.
3. Attach a live camera photo; require an answer grounded in the persisted
   observation and verify the healthy-negation/positive-hazard pair.
4. Cold-restart the phone; restore the same Project, thread, messages, evidence,
   and source scope.
5. Web: sign in, open `/v3`, select that exact Project/thread, and verify the
   existing conversation and citations.
6. Send one follow-up on web; record its persisted turn ID.
7. Phone: refresh/relaunch and verify that exact turn appears once in the same
   thread.
8. Exercise retry/idempotency, browser-picker cancel, sign-out, and a safe
   recovery path.
9. Commit screenshots and sanitized identifiers with the production SHA, APK
   SHA-256/versionCode, timestamps, and a human `GO` or `NO-GO`.

Anything less is component evidence, not customer acceptance.

## 7. Release stop rules

Keep **NO-GO** when any of these is true:

- production health does not identify the selected release SHA;
- production migration drift is nonzero or was bypassed;
- the phone evidence is emulator-only, installed-only, or launch-only;
- a new Project cannot ground on its uploaded manual;
- HOME can inherit a machine context without an explicit Project selection;
- a photo answer ignores its observation, a failed LOOK still sends, or a
  healthy negation triggers a stop;
- a poisoned source can produce energized-work approval;
- live safety warnings differ materially from reload/hydration;
- phone and web show different thread IDs or duplicate turns;
- `/v3` is made default without a tested recovery path;
- the evidence lacks an explicit human go/no-go against the exact release.

Do not equate merged code, green CI, a container, a signed APK, an installation,
a launch, a broker-send event, or a draft proof document with a passed release.

## 8. Session protocol

At session start:

1. Read this file and the latest comments on #3626.
2. Refresh, do not trust this snapshot:

   ```bash
   git fetch origin main
   git rev-parse origin/main
   gh issue list --state open --label beta-readiness --limit 100
   gh pr view 3845 --json headRefOid,baseRefOid,state,isDraft,mergeStateStatus,statusCheckRollup
   gh run list --workflow deploy-vps.yml --limit 5
   curl -fsS https://app.factorylm.com/api/health/
   adb devices -l
   ```

3. Claim exactly one closure issue with branch/worktree, base SHA, expected
   files, dependencies, and forbidden actions.
4. Before review, merge, deploy, or evidence claims, refresh the exact head,
   comments, labels/attestation, required checks, and target environment again.
5. Post a concise checkpoint on the issue and #3626: current state, exact SHA,
   evidence produced, blocker, and one next action.

No session may self-authorize a production migration, deployment, OTA publish,
attestation label, phone data reset, or customer-data use from this document.

## 9. Definition of customer-ready

FactoryLM is customer-ready for this mission only when:

- every P0 row is closed or has a specific owner-signed release disposition;
- production serves the exact selected SHA with rollback proven;
- the current signed mobile release passes the physical Pixel journey;
- the canonical same-thread phone/web acceptance passes;
- `/v3` is the normal authenticated product with one explicit recovery route;
- no known P0 safety/security finding remains accepted by accident;
- the evidence bundle has one explicit human `GO` for the exact web SHA and APK.

Until then the honest status is: **the vision is mostly built, but it is not yet
delivered and proven as one customer product.**
