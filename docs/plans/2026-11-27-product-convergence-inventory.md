# FactoryLM convergence resource inventory

Observed 2026-11-27, approximately 12:40–12:55 UTC on BRAVO, with read-only
CHARLIE SSH checks. This is a dated evidence snapshot, not a second registry,
assignment queue, proof of current acceptance or a complete cross-host census.
Operating authority: [DELIVERY](../../DELIVERY.md). Recovery and acceptance mapping:
[crosswalk](2026-11-27-product-convergence.md). Durable documentation claim:
[#5232 / 7218731903](https://github.com/Mikecranesync/MIRA/issues/5232#issuecomment-7218731903).

## Repository and isolation

- Verified origin: `git@github.com:Mikecranesync/mira.git`; connected GitHub metadata
  identifies `Mikecranesync/MIRA`, public, default branch `main`.
- Fetched main/base: `6446e887b11be95b1c463d0c1a26b1d105ea9210`.
  Recent merges include #5746 photo/manual flow, #6056 live warning, #6084 replayed
  electrical directive, #6088/#6089 bypass coverage and #6091 live-cable stop.
- Shared checkout `/Users/bravonode/Mira` remains on older
  `d5f10e2dc499f99e8c95e22ca1c51bfa62a86e78`, with unrelated edits in
  `qa/dogfood/latest-report.md`, `wiki/hot.md`, `wiki/log.md` and untracked dogfood/
  web-review artifacts. They were not adopted, cleaned, staged or overwritten.
- This mission uses `/Users/bravonode/Mira-worktrees/product-convergence`, branch
  `docs/factorylm-product-convergence`, from fetched main. No application changes.
- Observed estate: **194 local worktrees including this one, 619 local branches,
  2,238 advertised origin branch heads and 409 open PRs**. These are inventory
  counts, not counts of active agents or unfinished unique capabilities.
  Full open-PR filenames were queried for overlap. Relevant recovery candidates
  and local worktree locations are indexed below. Branch existence is not a claim.

The required MVP coordination check was run in order: `git fetch origin main`,
`git log origin/main --oneline -10`, then `gh pr list --state open --json ...`.
The April plan's in-flight list was read; it contains old claims and does not
replace the newer #5232 namespace. Post-claim reread found this mission's single
matching claim; no earlier product-convergence operating-plan claim was returned.
Existing overlapping document PRs were inspected and retained as distinct scopes.

## Existing coordination resources

| Resource | Verified source / observation | Reuse and limit |
|---|---|---|
| Assignment/outcome queue | [#5232](https://github.com/Mikecranesync/MIRA/issues/5232), OPEN; ranked G01–G12 closure and owner claims/reports read. | Canonical queue. Link implementation threads; do not create another tracker. |
| Shared delivery plan | [DELIVERY](../../DELIVERY.md); merged [#5314](https://github.com/Mikecranesync/MIRA/pull/5314) added it plus root startup pointers. | Extend this plan/template. Four existing lane owner comments remain their owners' records. |
| Mission Control | `tools/mission-control/`, [runbook](../runbooks/mission-control.md), existing Project #4 board. BRAVO `http://127.0.0.1:8790/healthz` and `/api/snapshot.json` read. | Read-only cockpit; Send disabled in current-main contract. No dispatcher needed. Snapshot is not a pilot ledger. |
| Pilot acceptance | CHARLIE private `Mira/.planning/2026-11-10-garage-pilot/PILOT-ACCEPTANCE-LEDGER.md` and adjacent `PLAN-2026-11-11-prove-gs10-workflow.md` read over existing SSH. | Authoritative pilot rows L1–L14, five distinct evidence stages, failures, denominators and explicit owner exceptions. Keep private and update in place through its owner. |
| Claims/handoff/conflict rules | [.claude/rules/multi-session-protocol.md](../../.claude/rules/multi-session-protocol.md), session discipline, shared UI cutover. | Existing earliest-claim/post-claim reread, isolation, stale-claim and closeout procedures; no new locking service. |
| Peer communications | Existing `~/claude-peers-mcp/server.ts` and `broker.ts` inspected on BRAVO: loopback `:7899`, `/list-peers`, summaries and 15-second broker heartbeat. Read-only peer discovery performed; no send/register/unregister/poll-mailbox mutation. | Fast current contact discovery. Summary is self-report; broker heartbeat is not a work acceptance heartbeat. Stale routes need an actual ACK before reliance. |
| Native session discovery | `~/.claude/sessions/*.json` allowlisted non-secret fields plus live PID checks on BRAVO/CHARLIE; [CHARLIE peer runbook](../runbooks/charlie-codex-claude-peer-review.md). | Session name/status is reported metadata, not verified assignment. Socket authentication keys were not read. CHARLIE-local broker returned no repo peers in this request despite native live records. |
| Codex Desktop task inventory | App-server `list_threads(limit=20)` read, response marked truncated. This task ACTIVE; the other returned tasks notLoaded. | Local app visibility only; notLoaded neither establishes termination nor releases claims, and this is not a cross-host census. No task started/resumed/interrupted. |
| Capability/ownership records | `docs/architecture/convergence/{REGISTRY,CAPABILITY_CLOSURE}.yaml`, `BACKLOG.md`, `OWNERSHIP.md`, `ASSET_IDENTITY.md`. | Canonical mappings and existing debt. Preserve human approval and separate identity schemes through existing bridges. |
| Proposed reuse | [#5628](https://github.com/Mikecranesync/MIRA/pull/5628) roadmap/FIND contract; [#5629](https://github.com/Mikecranesync/MIRA/pull/5629) Mission Control capability view; [#3653](https://github.com/Mikecranesync/MIRA/pull/3653) shadow peer contract; [#3761](https://github.com/Mikecranesync/MIRA/pull/3761) provider-neutral agent standard; [#6027](https://github.com/Mikecranesync/MIRA/pull/6027) bot-ranked fixes. | All OPEN, not adopted by being inventoried. Reuse designs/requirements after owner reconciliation; install none and create no competing platform. Bot votes are prioritization input, not product authority. |
| Hooks | `.claude/settings.json`: session-start log/lock, touched-file tracking, git-state/prod/rm/worktree guards, staged secret scan, stop hook; `.githooks/pre-commit`; `git config core.hooksPath` = `.githooks`. | Existing enforcement retained. Hook configuration is not evidence every host actually executed it; warnings/skipped tools must remain visible. Session-start lock is not an ownership lease. |
| Review and CI | Trusted-base `scripts/adversarial-review*`; `tools/ui_surface_lifecycle_guard.py`; workflows `ci.yml`, `cheap-review-check.yml`, `code-review.yml`, `ui-lifecycle-guard.yml`, `beta-gate.yml`, `retrieval-acceptance.yml`, `deploy-staging.yml`, `deploy-vps.yml`, `stale-pr-sweep.yml`. | R3 exact-head/body independent review and durable round limits persist, including governance prose. Existing CI/workflow definitions inspected, not changed; current branch protection must be read before merge. No new review granted or run here. |
| Journey/evaluation assets | `mira-hub/tests/stranger-walk/`, merged #5794 tablet journey/receipts, `tools/mobile-e2e/`, source/citation/table and actual-Postgres regression suites. | Recover tests and historical failure cases. Synthetic/device automation, current human acceptance and production evidence remain distinct. No local application tests or metered runs in this mission. |

### Mission Control and pilot ledger readback

At **12:52:13Z**, BRAVO snapshot reported LIVE; last poll **12:51:55Z**, lifecycle
evidence **12:50:22Z**, no evidence error. Readiness was **NO-GO**:
`#4793 is not DEPLOYED:production`. This is the cockpit's conservative rule,
not a fresh independent judgment of every pilot requirement.

The snapshot carried production SHA
`37bedcf465ef9c336b37689d8f05c9b4f51565dd` and an unavailable staging read at its
configured loopback URL. These are **cockpit-reported** observations; no direct
staging/production qualification or runtime change was performed here.

All four primary lane reports were stale in the live snapshot:

| Lane | Existing owner-managed comment | Report timestamp | Interpretation |
|---|---|---|---|
| CHARLIE-CODEX | [6870960483](https://github.com/Mikecranesync/MIRA/issues/5232#issuecomment-6870960483) | 2026-11-19 01:21:40Z | BLOCKED report still names old #5644 blockers; fresh PR reads show later merges. Refresh through its owner. |
| CHARLIE-CLAUDE | [6892397495](https://github.com/Mikecranesync/MIRA/issues/5232#issuecomment-6892397495) | 2026-11-19 00:32:23Z | State/evidence/stage unparsed; old #5625 draft claim contradicted by current MERGED metadata. |
| BRAVO-CODEX | [6883373082](https://github.com/Mikecranesync/MIRA/issues/5232#issuecomment-6883373082) | 2026-11-20 18:47:02Z | BLOCKED, VERIFIED/local describes an older #5669 recovery head; newer GitHub closeout must be reconciled. |
| BRAVO-CLAUDE | [6872204712](https://github.com/Mikecranesync/MIRA/issues/5232#issuecomment-6872204712) | 2026-11-19 13:29:09Z | BLOCKED #5646 review/budget report; stage unparsed. Do not reset its review budget. |

Latest #5232 repair [closeout 7189492174](https://github.com/Mikecranesync/MIRA/issues/5232#issuecomment-7189492174)
names #6015/#6025/#5671/#5669 and exact worktrees; it is not parsed as a replacement
lane report. This explains how active work and a stale cockpit can coexist.
The appropriate repair is to reconcile existing owner reports and links, not build
another reporting service or interpret the stale reports as current blockers.

The private pilot ledger was **176,342 bytes**, last modified
**2026-11-20T09:50:45.495946Z**, SHA-256
`3ffd847f17c1f256a67fa2a6ee9d7d5fbaa18c6ea29a5cc122f917da76ef7e75`.
Its L1–L14 rows and adjacent plan were inspected. Historical evidence includes
different builds, pass/fail cases, owner exceptions and missing field checks;
the file is not fresh qualification of today's main. Private rows/artifacts are
not reproduced here. The original #5086 report/plan are public but remain draft;
their immutable requirement links are in the crosswalk.

## Observed sessions and ownership visibility

| Host / identity | Authoritative liveness evidence | Mission / ownership evidence | Safe next use |
|---|---|---|---|
| BRAVO Codex, this task `01a21d0a-0df6-7151-94f2-b085967b53a9` | App task ACTIVE. | User documentation mission, claim 7218731903 and isolated branch. | Author draft only; separate auditor required. |
| BRAVO Claude `0cd970a4-693a-4e67-8ece-67dd47a42ab3`, PID 82321; broker `vw7va12u`, child PID 82665 | Both PIDs checked live; broker last_seen 12:50:52Z. Native record name `converge-adversarial-review-round-10`, status busy. | Broker reports #6104 identity/catalog confirmation, CI/review work; GitHub verifies PR OPEN at the exact inventory head, not the older SHA in its summary. #5232 also records this session's #5746 takeover history. | Preserve claim and ongoing work; ask for a plan ACK through the existing owner at a safe boundary after draft review/adoption. No interruption occurred. |
| BRAVO Claude `a64d6ee8-2ae7-409f-ba31-2923b5bb490a`, PID 38800; broker `2mquvvlx`, child PID 39076 | Both PIDs checked live; broker last_seen 12:50:51Z. Native name `expiring-credit-eval-assets`, status shell. | Broker reports #6081 accounting and #6082 follow-on; current PRs independently read. Name is not the assignment authority. | Preserve route/cascade claims and per-PR budgets. |
| BRAVO broker `thuqfuuu`, PID field 4481 | Broker last_seen 2026-11-20; not fresh liveness evidence. | Summary references an older #5669 head/round allowance. | Historical route only; do not send or assume a live receiver. |
| BRAVO Codex repair tasks | Returned app tasks `01a1fda4-…` and `01a1dab7-…` notLoaded. | Current #5232 closeout and repair PRs supply durable ownership/status evidence. | Reconcile with designated lane owner; no inference that implementation stopped globally. |
| CHARLIE Claude `5b3ff234-faee-44c7-83b9-59f6d469c226`, PID 13394 | Non-secret native record and `kill(pid,0)` succeeded over SSH; status shell. | Name `safety-switch-jumper-fix`, cwd `/Users/charlienode`; no fresh claim binding obtained. | Mission/ownership unverified until owner reports. |
| CHARLIE Claude `59596322-ad3e-4d9f-b13d-5dd5a04ed45d`, PID 86102 | Native record/PID check succeeded; status idle; cwd `/Users/charlienode/MIRA`. | Name `ship-v3-461-5-prod` is metadata, not authorization or proof of a deployment. | Preserve session; require current claim/next action. |
| CHARLIE Codex and Claude lane owners | Existing #5232 reports plus GitHub integration/harness history; no fresh Desktop runtime census. | Old reports cannot establish present mission or authority. | Fresh owner registration and exact-plan acknowledgment pending. |
| ALPHA | Existing SSH alias attempted with BatchMode and bounded connection timeout; connection timed out. | No current process/assignment census available. | Mark UNKNOWN/unreachable, not inactive; no repeated restarts or setup changes. |
| Other app/remote/CLI workers | Local Codex task list is truncated; no organization-wide session authority available. | Open PRs/branches are artifacts, not liveness. CHARLIE has 50 worktrees, not 50 verified agents. | Coordinator reconciles additional owners in existing #5232; no claim of exhaustive enrollment. |

## Open-document overlap and recovery decisions

Full open-PR filename enumeration found root-document overlap in #5628, #5568,
#4960, #4761, #3761, #3748, #3653 and #3565. The current patch adds a distinct
convergence section/template to DELIVERY and a short pointer to each root map;
it does not amend these PRs or take over their subjects. Recheck actual diffs
and resolve additive conflicts through their owners before an authorized merge.

- #5628 adds a current-capability block near DELIVERY's top and new FIND documents.
  Preserve it as the existing proposal; this PR links its exact revision instead
  of creating another FIND contract.
- #5086 owns the Level 3 report and plan; reuse their pinned requirements without
  reauthoring or pretending they are on main.
- #5589 owns proposed North Star end-state prose; NORTH_STAR is unchanged here.
- #4875 proposes T-1–T-5 pilot trust gates, fixtures and pass bars. Retain that
  proposal and #4372 owner decisions; reconcile current evidence before onboarding.
- #3761 proposes the provider-neutral root/adapter consolidation; #4761 fixes root
  header drift. Current AGENTS/CLAUDE product/provider headers disagree. This mission
  does not resolve provider policy or revive deprecated services.
- #3653 is a shadow peer-network contract, not a deployed global scheduler.
  #5629 is an unmerged capability-cockpit extension. Neither is needed to begin
  reporting through existing GitHub/peer/Mission Control resources.
- Existing stale-PR policy keeps branches for recovery. No PR/branch/worktree was
  closed, deleted, reset, pruned, force-pushed or reassigned by this inventory.

## Reproduce or refresh the inventory

Use authorized read-only tools; do not print tokens/session keys. GitHub connectors
were used for repository/issues/comments/search, with `gh` for full paginated
filename/branch inventories and source-file reads. All counts are time-bounded.

```bash
git fetch origin main
git log origin/main --oneline -10
gh pr list --repo Mikecranesync/MIRA --state open --limit 1000 --json number,title,headRefName,headRefOid,baseRefName,files
git worktree list --porcelain
git for-each-ref --format='%(refname) %(objectname)' refs/heads
git ls-remote --heads origin
gh api repos/Mikecranesync/MIRA/issues/5232/comments --paginate
curl --fail --silent http://127.0.0.1:8790/healthz
curl --fail --silent http://127.0.0.1:8790/api/snapshot.json
```

A 1,000-PR bound sufficed for 409 returned rows in this observation; increase or
paginate if it reaches the bound. Check actual fields/claim timestamps and branch
movement before concluding anything about ownership. The following indexes are
historical locators; refreshed GitHub and the owner's current claim win.

## Relevant PR revisions (GitHub read 2026-11-27)

OPEN/MERGED is verified repository metadata. Review, deployment and human acceptance
are separate and are not asserted by this table. Full head SHAs are intentional.

| PR | Observed state / base | Exact head | Reusable slice |
|---|---|---|---|
| [#3565](https://github.com/Mikecranesync/MIRA/pull/3565) | OPEN; `main` | `132174af5d5cfcb2e0dde164e5134d7920a268c8` | fix(foreman): serialize warm-agent send through wait (#3559) |
| [#3653](https://github.com/Mikecranesync/MIRA/pull/3653) | OPEN; `main` | `4bbe1d225be8ec8952ff08e04a0a2e353e1106e8` | docs(peer-network): FLEET-PEER-NETWORK-001 Slice A — contract, onboarding, schemas, node metadata |
| [#3748](https://github.com/Mikecranesync/MIRA/pull/3748) | OPEN; `main` | `58b36e2edc8270d9b0d610cab00c5567c1ad6b2a` | docs: establish canonical FactoryLM UI design policy |
| [#3761](https://github.com/Mikecranesync/MIRA/pull/3761) | OPEN; `main` | `3e63ae79d9b77a9cda57454380688d251a1d5619` | docs(agent-standard): wire provider adapters to the fleet standard (rollout Phase 2) |
| [#4761](https://github.com/Mikecranesync/MIRA/pull/4761) | OPEN; `main` | `3a845f2bc77a4fbc5da560bb1eb94b0a77f91095` | docs(agents): bring AGENTS.md header in line with CLAUDE.md |
| [#4875](https://github.com/Mikecranesync/MIRA/pull/4875) | OPEN; `main` | `4498abbfd6d6a7569e59ae3bb61d9f34ee4bcbd4` | docs(register): pilot trust gates T-1..T-5 before the first five pilots |
| [#4960](https://github.com/Mikecranesync/MIRA/pull/4960) | OPEN; `main` | `62920eafd21266238095baef1a0a84cc788493aa` | fix(onboarding): unify the free pilot first experience |
| [#5086](https://github.com/Mikecranesync/MIRA/pull/5086) | OPEN; `main` | `5b9aaf30184763b3d64dbcd99eda5f7f4b9a3c31` | docs: [P0] first-customer Level 3 closure and readiness report |
| [#5510](https://github.com/Mikecranesync/MIRA/pull/5510) | MERGED; `main` | `bc067dc81643f76de589682ccdf2e453c6b20e4b` | fix(hub): bind model-specific manual sections to applicable output variants (#5503) |
| [#5530](https://github.com/Mikecranesync/MIRA/pull/5530) | OPEN; `main` | `c7a21990b391af70e62e4656a7cccc5b6cb4f01c` | test(ontology): fixture coverage becomes a gate; runtime contract and drift check (#5528) |
| [#5539](https://github.com/Mikecranesync/MIRA/pull/5539) | OPEN; `test/ontology-shape-coverage-5528` | `611d8f2a8e1892f60893ee80363b4988413624ce` | test(ontology): bench runtime context contract — executable contracts for drive + supply relay |
| [#5543](https://github.com/Mikecranesync/MIRA/pull/5543) | OPEN; `test/ontology-bench-runtime-contract` | `1c1a4550da8b2b65aa2df3cb25c1dbec420d31d0` | fix(kg): approved relationships are readable and corrected ones leave the verified set (#5519, #5523) |
| [#5544](https://github.com/Mikecranesync/MIRA/pull/5544) | OPEN / draft; `main` | `a427fd8bccd02e81ac1755243a8b7d74aaf504a0` | fix(hub): pending-manual recovery follows a PDF stored with a generic file type (#5315) |
| [#5545](https://github.com/Mikecranesync/MIRA/pull/5545) | OPEN / draft; `main` | `ea911850b6aa27db55e22007c10e3c9779c640f1` | docs(runbook): workbench component onboarding and recovery |
| [#5558](https://github.com/Mikecranesync/MIRA/pull/5558) | OPEN; `main` | `c98348b533e91da2fddf0b10410b4d71f891a29e` | ci(ontology): require executed bench database contracts |
| [#5568](https://github.com/Mikecranesync/MIRA/pull/5568) | OPEN; `main` | `cd9df0369e790399722a28a2fbc2e3b75f4ecdf5` | feat(inference): time-boxed Anthropic cascade slot + MIRA_CASCADE_ORDER hot-swap |
| [#5589](https://github.com/Mikecranesync/MIRA/pull/5589) | OPEN; `main` | `b413e6fb7729d0be719b1c1a06f69ab19dc308d8` | docs(product): record repeatable-product end-state vision |
| [#5602](https://github.com/Mikecranesync/MIRA/pull/5602) | MERGED; `main` | `ab0ed25eace273a1533393ea156e514e380eb609` | feat(hub): bounded read-only equipment browsing and exact resolution |
| [#5614](https://github.com/Mikecranesync/MIRA/pull/5614) | MERGED; `main` | `37445da99320f689f5ee64db9113522cc0cd7071` | feat(ui): paged equipment navigator over the equipment-browser contract |
| [#5615](https://github.com/Mikecranesync/MIRA/pull/5615) | MERGED; `main` | `16e09f8227a6318ec09bbca3151641b70ac7fbaf` | fix(hub): GS10 group labels hold on a real upload, not only the captured fixture (pilot #5232) |
| [#5625](https://github.com/Mikecranesync/MIRA/pull/5625) | MERGED; `main` | `7031abc15a144edfc250af6020e60b87736ba3b7` | feat(hub): equipment-first navigation in the Hub behind MIRA_EQUIPMENT_NAV (+ #5617 fixes) |
| [#5628](https://github.com/Mikecranesync/MIRA/pull/5628) | OPEN; `main` | `b07057c6255b4608faa243ca59becdc3b706456a` | docs: define Find the Right Equipment milestone and capability roadmap |
| [#5629](https://github.com/Mikecranesync/MIRA/pull/5629) | OPEN; `main` | `7ed276199ecd1506367f73d0476383229a5eb69e` | feat(tools): run the capability roadmap from Mission Control |
| [#5646](https://github.com/Mikecranesync/MIRA/pull/5646) | OPEN / draft; `main` | `ab5b5fb4984c96ee4eac416457fcd8dfe2536554` | fix(hub): record the owner-reviewed GS10 page 26 digest, with a drift guard (pilot #5232) |
| [#5669](https://github.com/Mikecranesync/MIRA/pull/5669) | OPEN / draft; `main` | `85608452e976e02bea1c4e4f75140668b159429f` | fix(hub): preserve one saved exchange and its original retry context (#5669) |
| [#5671](https://github.com/Mikecranesync/MIRA/pull/5671) | OPEN / draft; `main` | `421bbbb37f278f79d68c55d7bd6841a0febb0b45` | fix(hub): keep typed and photo machine subjects within the selected manual (#5671/#5764) |
| [#5746](https://github.com/Mikecranesync/MIRA/pull/5746) | MERGED; `main` | `a36493c2dab92b28447db9e99557501de8ac5e69` | fix(hub): keep the nameplate-to-manual flow intact through the first cited answer |
| [#5764](https://github.com/Mikecranesync/MIRA/pull/5764) | OPEN / draft; `main` | `d276e8f2eb3b2e2bcd6dca1e05c968f2d9b169f6` | fix(hub): a nameplate photo of another drive is not answered from the project's manual (#5706) |
| [#5794](https://github.com/Mikecranesync/MIRA/pull/5794) | MERGED; `main` | `fca36c5cc0ffff892670e0e8be78389d1a7b821e` | test(stranger-walk): Level-3 journey on the real tablet with a per-step receipt |
| [#5874](https://github.com/Mikecranesync/MIRA/pull/5874) | OPEN / draft; `main` | `3aab41ef27bf0ed6aba5d51de7290a7b8b963933` | fix(hub): answer 'what did I note on the open job' from the job sheet (#5335) |
| [#6015](https://github.com/Mikecranesync/MIRA/pull/6015) | OPEN; `main` | `813aa49fd2073d84635e001d128becce50bb31af` | fix(hub): warn on each hazardous instruction clause (#5962) |
| [#6025](https://github.com/Mikecranesync/MIRA/pull/6025) | OPEN; `main` | `5a8ca5dce5c140f5f737e352ca0b40008fc1c85a` | fix(hub): suppress corrupt citation pages without collapsing passages (#5955) |
| [#6027](https://github.com/Mikecranesync/MIRA/pull/6027) | OPEN; `main` | `275f0d44a39f1d1b535385ae040b37b0a905a53e` | docs: bot-voted MIRA fix plan and agent prompts (2026-11-26) |
| [#6028](https://github.com/Mikecranesync/MIRA/pull/6028) | OPEN / draft; `main` | `653c5d327969a26aef32bb43478a556044bb4090` | fix: use printed page labels in citations instead of PDF page index |
| [#6030](https://github.com/Mikecranesync/MIRA/pull/6030) | OPEN / draft; `main` | `95f8abfe4bacf3edd1434cee4ffdbc2d50a876ff` | fix(hub): prevent false refusals when answer is in retrieved table rows |
| [#6081](https://github.com/Mikecranesync/MIRA/pull/6081) | OPEN / draft; `main` | `0863c4ee9ddd2d43b7c5e7135b5c7cb6490d252e` | fix(hub): hold the redraft allowance across providers and account for every redraft attempt (#6021, #6022, #6023) |
| [#6082](https://github.com/Mikecranesync/MIRA/pull/6082) | OPEN / draft; `main` | `6cd3b0b06f550ba4d1ae2bafe30890728941a8f6` | fix(hub): settle a committed turn's packet and usage once when delivery fails; record which floor stopped a redraft (#6048, #6062) |
| [#6090](https://github.com/Mikecranesync/MIRA/pull/6090) | OPEN / draft; `main` | `5b157ab2b74ec38da430d2e21f254bd85374271e` | fix(hub): a cited zero is checked against its page like any other value (#6049) |
| [#6104](https://github.com/Mikecranesync/MIRA/pull/6104) | OPEN / draft; `main` | `03eab5cf56d23adf612112e63d41c0db0f386b76` | feat(hub): the technician confirms the order number on the identity card (#6085) |

## Local worktree snapshot

Source: `git worktree list --porcelain`, BRAVO, 2026-11-27 12:54Z. These
are locations, not active leases. Do not remove a worktree because it is old or
appears merged. The fleet-gateway worktree is explicitly locked as a live deploy source.

| Absolute path | Branch or detached | HEAD | Lock / note |
|---|---|---|---|
| `/Users/bravonode/Mira` | `main` | `d5f10e2dc499f99e8c95e22ca1c51bfa62a86e78` |  |
| `/Users/bravonode/.codex/worktrees/cv101-charlie-integration-20261108` | `detached` | `dd580ed7097e409ac50e6bce343175ef59726d5b` |  |
| `/Users/bravonode/.codex/worktrees/cv101-composed-current-20261108` | `integ/cv101-current-main-20261108` | `3685e9d18416203d768c6a07f1d9058014ea90ab` |  |
| `/Users/bravonode/.codex/worktrees/cv101-machine-context-20261108` | `detached` | `e7e66339d28970af1730affb1c48273285b18270` |  |
| `/Users/bravonode/.codex/worktrees/cv101-review-5294-current-20261108` | `detached` | `b304d5dcfa85da3d3abaf227c2d431352c3fe90c` |  |
| `/Users/bravonode/.codex/worktrees/cv101-review-5317-20261108-63174229` | `detached` | `422329dc8887fabca2b5efba7f27a68f17f7c278` |  |
| `/Users/bravonode/.codex/worktrees/cv101-review-5320-current-20261108` | `detached` | `b304d5dcfa85da3d3abaf227c2d431352c3fe90c` |  |
| `/Users/bravonode/.codex/worktrees/issue-5408-20261111` | `fix/5408-safety-card-citation` | `621bb8f73e0cc2bd5d79ad1370d1d797349d92b9` |  |
| `/Users/bravonode/mira-crawler-prod` | `detached` | `5eca3ba0afde50f21d263074538c3213434ebe84` |  |
| `/Users/bravonode/Mira-worktrees/4462-harness` | `bravo/4462-harness` | `e067e9ae908d5c35665e90c6b75f2139b31d06d0` |  |
| `/Users/bravonode/Mira-worktrees/4507-runtime-identity` | `feat/4507-runtime-identity` | `803333fc60062732057f9e5ed1a6c6cdf2ddeaa5` |  |
| `/Users/bravonode/Mira-worktrees/5127-search` | `bravo/5127-search-recall` | `f5149205e4aea9c3587b7642b75074e892b4090e` |  |
| `/Users/bravonode/Mira-worktrees/5128-followup` | `bravo/5160-ellipsis` | `a124132bf082028e989edfa15d6a66720080b3b7` |  |
| `/Users/bravonode/Mira-worktrees/5129-reset` | `bravo/5129-reset-backup` | `3f09bd8f01cfed4edeaae796b7376d2af5f39e22` |  |
| `/Users/bravonode/Mira-worktrees/5130-decimal` | `bravo/5130-decimal-glyph` | `51602b5ffd9a847acff859a049fde134dbcaf80d` |  |
| `/Users/bravonode/Mira-worktrees/5131-factory` | `bravo/5131-factory-vs-fault` | `946ca41d353e7875156943ca3f9e490a6a149511` |  |
| `/Users/bravonode/Mira-worktrees/5132-quote` | `bravo/5132-quote-chunk` | `39aa0f4f6041d4447ae0f934da020a934923497d` |  |
| `/Users/bravonode/Mira-worktrees/5133-correction` | `bravo/5133-correction-repeat` | `d98c2795153e59ac2c5949c615abfe6f13dc3ec0` |  |
| `/Users/bravonode/Mira-worktrees/5415-current-qualification-20261115` | `chore/ontology-db-ci-integration-20261115` | `c98348b533e91da2fddf0b10410b4d71f891a29e` |  |
| `/Users/bravonode/Mira-worktrees/5608-trust-atlas-in-testing` | `foreman/5608-trust-atlas-in-testing` | `62168b0e8cfc8cbb35babc9135fc12df5dd3e263` |  |
| `/Users/bravonode/Mira-worktrees/5669-current-integration-20261126` | `fix/5669-current-integration-20261126` | `85608452e976e02bea1c4e4f75140668b159429f` |  |
| `/Users/bravonode/Mira-worktrees/5669-e7-publication-20261121` | `review/5669-e7-publication-20261121` | `38334397f87ebe83f847e7185ba22c9db184609b` |  |
| `/Users/bravonode/Mira-worktrees/5669-recovery-backend` | `fix/5669-recovery-backend-20261120` | `e7e70f15bdac01f7bb3b2901bc26883d0fba211e` |  |
| `/Users/bravonode/Mira-worktrees/5669-round1-baseline-readonly` | `detached` | `4d0777b5fa4a445a54de7896121c281956a93784` |  |
| `/Users/bravonode/Mira-worktrees/5669-round4-repair-20261121` | `fix/5669-round4-repair-20261121` | `d768fad5721f6e258c80846708528fcb60c023e5` |  |
| `/Users/bravonode/Mira-worktrees/5671-combined-model-current-20261126` | `fix/5671-combined-model-current-20261126` | `421bbbb37f278f79d68c55d7bd6841a0febb0b45` |  |
| `/Users/bravonode/Mira-worktrees/5720-model-repair-20261121` | `fix/5720-model-repair-20261121` | `6d5a670f7643797d9574c4b63760abdcde787101` |  |
| `/Users/bravonode/Mira-worktrees/5721-bypass-repair-20261121` | `fix/5721-bypass-repair-20261121` | `11240a10558342ffdc0bca34c51533b0824fb10f` |  |
| `/Users/bravonode/Mira-worktrees/5863-abstain-copy` | `bravo/5863-abstain-copy` | `37030f933d3f07f09ebb545b4a5093f06c4895b4` |  |
| `/Users/bravonode/Mira-worktrees/5864-hazard-coverage` | `bravo/5864-hazard-coverage` | `cbfa0e1628dccfc119f08ce9ddef9af4325ee9d4` |  |
| `/Users/bravonode/Mira-worktrees/5910-http-candidate` | `bravo/5910-http-candidate` | `51069ff10e70c9496e0c714031aaa3b3b99be627` |  |
| `/Users/bravonode/Mira-worktrees/5942-app-link` | `bravo/5942-app-email-link` | `5d7685d3be7aaea9749377b371644aacbeb0e2bb` |  |
| `/Users/bravonode/Mira-worktrees/5942-provisioner` | `bravo/5942-provisioner-login-link` | `2096d8ea09288c8c438715c1f4519ea2f6bb326b` |  |
| `/Users/bravonode/Mira-worktrees/5955-citation-integrity-20261126` | `fix/5955-citation-integrity-20261126` | `5a8ca5dce5c140f5f737e352ca0b40008fc1c85a` |  |
| `/Users/bravonode/Mira-worktrees/5962-clause-safety-20261126` | `fix/5962-clause-safety-20261126` | `813aa49fd2073d84635e001d128becce50bb31af` |  |
| `/Users/bravonode/Mira-worktrees/6021-redraft-accounting` | `bravo/6021-on-6082-local` | `d074c217dcc0fb15264458cbe4187e817dd06f80` |  |
| `/Users/bravonode/Mira-worktrees/6030-false-refusal-20261126` | `fix/6030-takeover-20261126` | `31acc5528c9b5ac01e1f0dfdb390aea947cbe79e` |  |
| `/Users/bravonode/Mira-worktrees/6047-step-support` | `bravo/6047-redraft-step-support` | `e49d93a31b10c7a4629ae31106a1559a30a6eee7` |  |
| `/Users/bravonode/Mira-worktrees/6048-cancel-after-commit` | `bravo/6048-cancel-after-commit` | `484e64e3f02b77d389b286cc4f35245464d9d35f` |  |
| `/Users/bravonode/Mira-worktrees/6049-zero-setpoint` | `bravo/6049-zero-setpoint` | `5b157ab2b74ec38da430d2e21f254bd85374271e` |  |
| `/Users/bravonode/Mira-worktrees/6085-confirm-number` | `bravo/6085-confirm-number` | `fc00d1208daa354518ff89142edb19d2cf036871` |  |
| `/Users/bravonode/Mira-worktrees/6085-own-order-number` | `bravo/6085-own-order-number` | `c9e22f1f9dfcd66320dc9b969bb04ee7cd93f8ba` |  |
| `/Users/bravonode/Mira-worktrees/action-library` | `feat/maintenance-action-library` | `7622b8343c2d354afef698b108f20583de7bc675` |  |
| `/Users/bravonode/Mira-worktrees/ai-identity-proposal` | `feat/bravo-ai-identity-proposal-20261115` | `f61fe53a28fb24128805cfac30d6b0e92645de94` |  |
| `/Users/bravonode/Mira-worktrees/assets-chat-gemini` | `fix/assets-chat-gemini-prd4` | `3213d17d6f5584ae54363dae5eb0bf9dd185475e` |  |
| `/Users/bravonode/Mira-worktrees/autoeval` | `bravo/autoeval-r3-followups` | `44ae5dbabea92b17772a52274b326513c0ecb5c4` |  |
| `/Users/bravonode/Mira-worktrees/bm25-ident` | `fix/bm25-catalog-identifiers` | `d4e634973381101eafdf7c884c2847c1bfbbd755` |  |
| `/Users/bravonode/Mira-worktrees/bravo-1031-5006` | `bravo/5006-energized-before-unresolvable` | `fb72c4793a367f1c8ac9ef6d3cd9e985c9105db4` |  |
| `/Users/bravonode/Mira-worktrees/c1-consent` | `bravo/4902-consent-versions` | `93993316dc085c9cb83ddd123f53e25d2aface3e` |  |
| `/Users/bravonode/Mira-worktrees/cascade` | `feat/hot-swappable-cascade` | `cd9df0369e790399722a28a2fbc2e3b75f4ecdf5` |  |
| `/Users/bravonode/Mira-worktrees/context-mod` | `feat/hazard-context-modifiers` | `d971c7af792127d73802e3838367ba8febff77ca` |  |
| `/Users/bravonode/Mira-worktrees/cv101-rerun3` | `detached` | `8cd2613ec469303971384378b2f67af65c02efdf` |  |
| `/Users/bravonode/Mira-worktrees/e2e-bm25` | `eval/e2e-bm25-on-5ddeeaa5` | `be14dbb0baab9deee4ce36cc8a3eb6e7ec4211de` |  |
| `/Users/bravonode/MIRA-worktrees/edge-page-cautions` | `test/edge-cautions-5317` | `a077ca1e5a87f22993d40256c36b3f3e0a3717af` |  |
| `/Users/bravonode/MIRA-worktrees/equipment-nav-hub` | `detached` | `28d115f5799469b7d7c7d21f5e2bcda04f7da247` |  |
| `/Users/bravonode/Mira-worktrees/eval-main` | `detached` | `88c7b8e26d2b8495b9b3799848a33b6d3b8f9447` |  |
| `/Users/bravonode/Mira-worktrees/f30011-correction` | `foreman/f30011-correction` | `cf022d15c46d3ddc3ce1805a1cda83571a1c7148` |  |
| `/Users/bravonode/Mira-worktrees/f31-fail-closed` | `fix/f31-fail-closed` | `bc067dc81643f76de589682ccdf2e453c6b20e4b` |  |
| `/Users/bravonode/Mira-worktrees/feat-print-redlines` | `feat/print-redlines` | `eecf663f59c11c3cbece489995ac394e12668cc7` |  |
| `/Users/bravonode/Mira-worktrees/fix-4363-pwa` | `fix/4363-pwa-manifest` | `2a9eba4cce70198f68aace17d64a9630c713c064` |  |
| `/Users/bravonode/Mira-worktrees/fix-4836` | `fix/4836-redact-firebase-download-url` | `ae97cd1f5980cb5315a0eefd4ee5bb68b7ae09ff` |  |
| `/Users/bravonode/Mira-worktrees/fix-5315` | `fix/5315-pending-generic-mime` | `a427fd8bccd02e81ac1755243a8b7d74aaf504a0` |  |
| `/Users/bravonode/Mira-worktrees/fix-5333` | `fix/5333-phone-citation-viewer` | `7696adfa11570478b2983c8a2bf3bb040de5495a` |  |
| `/Users/bravonode/Mira-worktrees/fix-5372` | `fix/5372-pending-panel-overlap` | `02ba0fc8903e98e8666e1abebbd3e2179cbea853` |  |
| `/Users/bravonode/Mira-worktrees/fix-f31` | `fix/f31-variant-heading` | `db9ebc70a32870cd63d281baba123b151c0097dc` |  |
| `/Users/bravonode/Mira-worktrees/fix-own-print` | `fix/own-machine-print-refusal` | `572137f23c1ce4ca290e91d8e734a21de55ae1cc` |  |
| `/Users/bravonode/Mira-worktrees/fleet-gateway-mcp-v1` | `feat/fleet-gateway-mcp-v1` | `ffcd32e31c998116d822251108b14232b5eaba82` | LIVE DEPLOY SOURCE: LaunchAgent com.factorylm.fleet-gateway runs from here (#3533). Never remove. 2026-09-27 |
| `/Users/bravonode/Mira-worktrees/fleet-peernet-001a-gen2` | `feat/fleet-peer-network-001a-contract` | `4bbe1d225be8ec8952ff08e04a0a2e353e1106e8` |  |
| `/Users/bravonode/Mira-worktrees/full-workbench-integration-20261114` | `fix/drive-mlc-f07-qualification-20261115` | `f07b6bca9d9ceaa34f447e55984c4a0bbe02f274` |  |
| `/Users/bravonode/Mira-worktrees/g7-1017-tools` | `detached` | `8ca0b52be0913103b86d7325e6ef8a83440bffa9` |  |
| `/Users/bravonode/Mira-worktrees/g7-ccr-f4cd90c0-nrkkve` | `g7fix/ccr-f4cd90c0-nrkkve` | `57a60984833ca1d30b81e4105843e2afa7b8f94f` |  |
| `/Users/bravonode/Mira-worktrees/g7-codex-pilot-crew-invites` | `g7fix/codex-pilot-crew-invites` | `a6f0909e2b3b745c108210045db8f4d39753b3d0` |  |
| `/Users/bravonode/Mira-worktrees/g7-codex-pilot-manual-model-boundary` | `g7fix/codex-pilot-manual-model-boundary` | `0067b81de372221ad97970b86a527da5ca0aa680` |  |
| `/Users/bravonode/Mira-worktrees/g7-codex-pilot-safety-output` | `g7fix/codex-pilot-safety-output` | `dd4075b283288ef2f2b008ae8ec3111b61a560c7` |  |
| `/Users/bravonode/Mira-worktrees/g7b-code-like-token-boost-809b` | `g7b-code-like-token-boost-809b` | `08eaa334a8d2edb90e87e8cf1995daca1f1a701e` |  |
| `/Users/bravonode/Mira-worktrees/g7b-combo` | `detached` | `630160da4f18481d833ba084dd18d81c78f705f0` |  |
| `/Users/bravonode/Mira-worktrees/g7b-crew-invites` | `g7b-crew-invites` | `b30caf9212f14435642613d4f04d4676854c961e` |  |
| `/Users/bravonode/Mira-worktrees/g7b-deps` | `detached` | `8ca0b52be0913103b86d7325e6ef8a83440bffa9` |  |
| `/Users/bravonode/Mira-worktrees/g7b-hub-assetlinks-public-0553` | `g7b-hub-assetlinks-public-0553` | `821d485305891b24a931181c3f49c6e0be527e81` |  |
| `/Users/bravonode/Mira-worktrees/g7b-notebook-bare-citation-markers-82a3` | `g7b-notebook-bare-citation-markers-82a3` | `8e77dd2b869d50044e1efb073f29493808134f83` |  |
| `/Users/bravonode/Mira-worktrees/g7b-notebook-header-new-chat-a813` | `g7b-notebook-header-new-chat-a813` | `3261566b086dbf15e402bbe3afe4c5e9b9394ec1` |  |
| `/Users/bravonode/Mira-worktrees/g7b-notebook-sources-loading-55c0` | `g7b-notebook-sources-loading-55c0` | `c09813f15b48c5db039f02092f468d85277b8783` |  |
| `/Users/bravonode/Mira-worktrees/g7b-page-split-passage-stitch-72ba` | `g7b-page-split-passage-stitch-72ba` | `04d192292e82f70e527beb166466dc9280cb4c51` |  |
| `/Users/bravonode/Mira-worktrees/g7b-printsense-3727-remount-f9ab` | `g7b-printsense-3727-remount-f9ab` | `d8a5f04c891744a9371e54321e14934c4ab9da11` |  |
| `/Users/bravonode/Mira-worktrees/g7b-ready-gating-ingest-chunks-e823` | `g7b-ready-gating-ingest-chunks-e823` | `0160aabe319c8b14e352883b92c7732b708c9b2c` |  |
| `/Users/bravonode/Mira-worktrees/g7b-scan-ask-mira-notebook-c46b` | `g7b-scan-ask-mira-notebook-c46b` | `3408f4ade305cacf740d4db2ec8766ee181766f7` |  |
| `/Users/bravonode/Mira-worktrees/g7b-toc-frontmatter-demote-1c89` | `g7b-toc-frontmatter-demote-1c89` | `96c2d78385b026ae8c0bc74d807764fe38862475` |  |
| `/Users/bravonode/Mira-worktrees/g7b-tq29-banner-page-citation-536b` | `g7b-tq29-banner-page-citation-536b` | `d891f9550cc40ab8a14b32394361fbc43ed65eab` |  |
| `/Users/bravonode/Mira-worktrees/gs10-group-labels` | `fix/gs10-group-labels` | `7ef3a295d3adc2e9d0df2072a526e064686b4135` |  |
| `/Users/bravonode/Mira-worktrees/gs10-p26-reviewed` | `fix/gs10-p26-reviewed` | `ab5b5fb4984c96ee4eac416457fcd8dfe2536554` |  |
| `/Users/bravonode/Mira-worktrees/gs10-real-extraction` | `fix/gs10-real-extraction` | `16e09f8227a6318ec09bbca3151641b70ac7fbaf` |  |
| `/Users/bravonode/Mira-worktrees/hof-1e-4083` | `bravo/hof-4083-supersede` | `9844e996e02ba3dcb108d078591de729b810485e` |  |
| `/Users/bravonode/Mira-worktrees/hof-1e-4925` | `bravo/hof-1e-4925-attach-scope` | `1d035865b7b570dd7c0931922daaf2ff63d974ad` |  |
| `/Users/bravonode/Mira-worktrees/hof-3713` | `bravo/hof-3713-manufacturer-reask` | `d524653e431421bd4ab3bffd5c8dcefd17aba957` |  |
| `/Users/bravonode/Mira-worktrees/hof-3c-fault-rows` | `bravo/hof-fault-rows-4863` | `5a19371e4cabdc092fbfe1fa0f2cffe15fe05669` |  |
| `/Users/bravonode/Mira-worktrees/hof-4060` | `bravo/hof-4060-fix-record-created-at` | `4c28dbeb7b63a09654a136b32cb2e24a056661b4` |  |
| `/Users/bravonode/Mira-worktrees/hof-4065` | `bravo/hof-4065-fix-idempotency` | `d0e5aae3b059a8760591c5808274512e726079f4` |  |
| `/Users/bravonode/Mira-worktrees/hof-4367` | `bravo/hof-4367-unassigned-uploads` | `d5f183aefe3553e85eb1528e87669b614c355410` |  |
| `/Users/bravonode/Mira-worktrees/hof-4923` | `bravo/hof-4923-pdf-parse` | `061a335a6d101e83e06459299a4ae8ad019d9520` |  |
| `/Users/bravonode/Mira-worktrees/hof-gate1-admission` | `bravo/hof-gate1-admission` | `e2282fd5dc901342453079b2e3fe5dcd52adc03f` |  |
| `/Users/bravonode/Mira-worktrees/hof-l1-1e-indexing-status` | `bravo/hof-upload-indexing-status` | `9912b320cb017864fa669b4655a5ba35faceb07e` |  |
| `/Users/bravonode/Mira-worktrees/hof-l2` | `bravo/hof-l2-chat-span` | `140319282253362a66d7de23fda901fd744b645a` |  |
| `/Users/bravonode/Mira-worktrees/hof-L2mttr` | `bravo/hof-mttr-metric` | `9b1dcf5ac657bbafd80c51724178155354af40b6` |  |
| `/Users/bravonode/Mira-worktrees/hof-l3-3a-4867` | `bravo/hof-l3-3a-4867-remount` | `ab65700ee718ee9340428c8d6ddc0e73a8d78b53` |  |
| `/Users/bravonode/Mira-worktrees/hof-l3-3a-4867-main-baseline` | `detached` | `1d035865b7b570dd7c0931922daaf2ff63d974ad` |  |
| `/Users/bravonode/Mira-worktrees/hof-l3-3b` | `bravo/hof-smc-walks-3b` | `1d035865b7b570dd7c0931922daaf2ff63d974ad` |  |
| `/Users/bravonode/Mira-worktrees/hof-l4-4073` | `fix/4061-record-fix-live-answer` | `02d06f1d22a0a7ebaf690dc993b15dbb0fef4462` |  |
| `/Users/bravonode/Mira-worktrees/hof-l4-4074` | `bravo/hof-l4-4074` | `ab40cb3fdf02d3666e2a02951ec990703ceb0976` |  |
| `/Users/bravonode/Mira-worktrees/hof-L7-5028` | `bravo/hof-5028-privacy` | `0d017b35ac2ce211fe2a5ee2ed10c274ab84806b` |  |
| `/Users/bravonode/Mira-worktrees/hub-action-library` | `feat/4498-hub-action-library` | `7ded1b2ad14fbaec3bd21ce399c6e8eb8eeb6092` |  |
| `/Users/bravonode/Mira-worktrees/hub-qr` | `feat/hub-identification-link` | `fe39c459f05041ce343ee0dad2269373578bc980` |  |
| `/Users/bravonode/Mira-worktrees/m001-113` | `bravo/m001-113-staging-flag` | `d31ca01bbbdd80187d754cb37992199bf8f8a02b` |  |
| `/Users/bravonode/Mira-worktrees/m001-premise` | `docs/m001-premise-level3` | `e4ba51a4879b7c829a7cd171454559030e10926f` |  |
| `/Users/bravonode/Mira-worktrees/magic-link-return` | `bravo/magic-link-return-5744-port` | `e988d14dc6096a518fbd3bb5ca4588de107fe199` |  |
| `/Users/bravonode/Mira-worktrees/manual-safety-notice` | `fix/4508-manual-safety-notice` | `7f23ce232c9fdef786e0fa8ee6225673d733bd94` |  |
| `/Users/bravonode/Mira-worktrees/mc-addendum` | `docs/maintenance-compiler-addendum` | `ff6d334f7c96770861622a1594acf76a52a0c605` |  |
| `/Users/bravonode/Mira-worktrees/n1-r4-score` | `bravo/n1-r4-score` | `eebd4459c3d96e6c1bfbf5f1f3a08577f4ddcb51` |  |
| `/Users/bravonode/Mira-worktrees/onboard-mlc-run` | `detached` | `8cd2613ec469303971384378b2f67af65c02efdf` |  |
| `/Users/bravonode/Mira-worktrees/onboarding-runbook` | `docs/workbench-onboarding-runbook` | `ea911850b6aa27db55e22007c10e3c9779c640f1` |  |
| `/Users/bravonode/Mira-worktrees/photo-intake-librarian` | `docs/photo-intake-librarian-proposal` | `b2febfa22be8469ef62bdee76722c8fe34117ade` |  |
| `/Users/bravonode/Mira-worktrees/photo-model-mismatch` | `bravo/photo-model-mismatch` | `8a7d3e356781fab2f9941aa3f54c31fe2c3058db` |  |
| `/Users/bravonode/Mira-worktrees/pr-4200` | `fix/3902-energized-paraphrase-floor` | `72fc34b8f58a428a0f433cb3bafb2c3ab33b1a74` |  |
| `/Users/bravonode/Mira-worktrees/pr-completion` | `bravo/pr-completion-controller` | `199119150da752bb14a309145e9360ffd36b9f3a` |  |
| `/Users/bravonode/Mira-worktrees/pr4202-gate7-base-18764c9a` | `detached` | `18764c9a7557fc6e30574060b0d2f27699db19b9` |  |
| `/Users/bravonode/Mira-worktrees/pr4202-gate7-base-e12d4dfc` | `detached` | `e12d4dfc351fdaea23e0cfde5320182cc2ac3f34` |  |
| `/Users/bravonode/Mira-worktrees/pr4202-gate7-base-f83e9df2` | `detached` | `f83e9df255533e7c09d3f6b40e72e8aacfc91b44` |  |
| `/Users/bravonode/Mira-worktrees/pr4202-gate7-ff62af99` | `detached` | `ff62af9985ca5172772156c60350dc3a7f35a35c` |  |
| `/Users/bravonode/Mira-worktrees/pr4202-tip-4d178992` | `detached` | `4d178992c1e5c04326c01af847eb1df219ddaa21` |  |
| `/Users/bravonode/Mira-worktrees/pr4202-tip-6817e532` | `detached` | `6817e5328d05f16f2851f60930a3c37c91862be9` |  |
| `/Users/bravonode/Mira-worktrees/pr4202-tip-a0511b9a` | `detached` | `a0511b9a87057a9d2e782f10f5559094efa3bc05` |  |
| `/Users/bravonode/Mira-worktrees/pr4202-tip-b8e88088` | `detached` | `b8e88088b5136b5031cb2fbfb20b287b85d4d025` |  |
| `/Users/bravonode/Mira-worktrees/pr4202-tip-bb8b47f7` | `detached` | `bb8b47f70a9eec0a95bef7a3177f9c44351e0e0f` |  |
| `/Users/bravonode/Mira-worktrees/pr4202-tip-d705e5cf` | `detached` | `d705e5cfbdeb5d6243a466bf22446ab39109dc03` |  |
| `/Users/bravonode/Mira-worktrees/pr4570-f2f3` | `pr4570-f2f3` | `2caac106e26d7ebf65c3ef9a0b6d92cad3b3bb37` |  |
| `/Users/bravonode/Mira-worktrees/pr4570-readme-drop` | `pr4570-readme-drop` | `0315f7ea62adc0c235a5394f6d7d0336560adad5` |  |
| `/Users/bravonode/Mira-worktrees/pr4759` | `cursor/fix-cmms-wo-tenant-scope-7c67` | `88c3fdc43852aa22640d7baf69625f0ab336f1f1` |  |
| `/Users/bravonode/Mira-worktrees/prd-alignment-0930` | `docs/prd-alignment-2026-09-30` | `bdda17f86a36ff36fa1b3bcaad2d1d4c5b296727` |  |
| `/Users/bravonode/Mira-worktrees/prepare-job-5551-20261121` | `fix/prepare-job-5551-20261121` | `3eb7854e974e11fbb7d84d181f1a6a6ed8291f9d` |  |
| `/Users/bravonode/Mira-worktrees/product-convergence` | `docs/factorylm-product-convergence` | `6446e887b11be95b1c463d0c1a26b1d105ea9210` |  |
| `/Users/bravonode/Mira-worktrees/project-resume-4681-20261121` | `fix/project-resume-4681-20261121` | `f3db261aed7ad64c603a877ac45dc7f14eed4f49` |  |
| `/Users/bravonode/Mira-worktrees/promo-evidence` | `bravo/retrieval-promotion-evidence` | `4c3fe025aa0a6321eb492b75f73da4760d4944b1` |  |
| `/Users/bravonode/Mira-worktrees/qr-followups` | `fix/qr-5073-5077` | `1d7a0f48791499163641dca6a49595c63e5ab27b` |  |
| `/Users/bravonode/Mira-worktrees/qr-shortcut` | `feat/qr-identification-link` | `56ba8691761f31f735f17fa7e495a465228ad7af` |  |
| `/Users/bravonode/Mira-worktrees/remount-feat-hazard-context-modifiers-7554eab0d` | `remount/feat-hazard-context-modifiers-7554eab0d` | `a0a4f61aded64f1e66ed09125f75b6b49098c09d` |  |
| `/Users/bravonode/Mira-worktrees/review-4852` | `review/4852-942297d` | `942297d0e5e0e65d25a8afa7e079ea5356765e58` |  |
| `/Users/bravonode/Mira-worktrees/router-json` | `fix/router-fenced-json` | `92ebab0b6d6d0ee345ac9b3acd07d40ccf2142b5` |  |
| `/Users/bravonode/Mira-worktrees/safety-research` | `bravo/safety-arch-research` | `398a397e40ba843eb5487f7c18c30ccb2d1567ac` |  |
| `/Users/bravonode/Mira-worktrees/safety02` | `bravo/safety-02-decision4` | `91b35f5d78f657fb109d567d0897bb136ff4607a` |  |
| `/Users/bravonode/Mira-worktrees/scale-fixtures` | `test/scale-fixtures` | `8a119d709de10d45204480102bc5c9c9f4434441` |  |
| `/Users/bravonode/Mira-worktrees/self-review-policy` | `docs/intermediate-self-review-policy` | `b6f2b822e14a4a570a8708b363dce3e4c926f59f` |  |
| `/Users/bravonode/Mira-worktrees/stardust-photo-journey` | `detached` | `28430d68b43694f340465fccefa6f3196ee9c2fd` |  |
| `/Users/bravonode/Mira-worktrees/sw-rerun3-4ecd25cc` | `detached` | `4ecd25ccebeafb4b7f0d4299d42c35e8ee765cbe` |  |
| `/Users/bravonode/Mira-worktrees/t3-hazard` | `bravo/t3-hazard-asks` | `599607c414c1814045f8175061b5341fec73f534` |  |
| `/Users/bravonode/Mira-worktrees/t4` | `bravo/t4-4471-on-main` | `ee8d8115728aefded19eb7a8cba8a4be34bc0344` |  |
| `/Users/bravonode/Mira-worktrees/technician-navigation-followups-20261121` | `fix/technician-navigation-followups-20261121` | `f63c2ce26448147b847c9331780d9b8d88733022` |  |
| `/Users/bravonode/Mira-worktrees/technician-review-base-7401002-20261121` | `detached` | `7401002fc47785ff650837571dc99387dd61c6a7` |  |
| `/Users/bravonode/Mira-worktrees/technician-review-base-dfa-20261121` | `detached` | `dfa344f32a2e6bd5f988eeac0be01a5b2a33c662` |  |
| `/Users/bravonode/Mira-worktrees/thread-ready-line` | `bravo/thread-scoped-manual-status` | `e93798665e4034d63f3de32266f2eb5577bb6543` |  |
| `/Users/bravonode/MIRA-wt-5546` | `detached` | `eab62164db37b18c824a47de897e89fa6fce1f01` |  |
| `/Users/bravonode/MIRA-wt-5557` | `detached` | `f5751d007c3fce9c4b0cf85748e35355193a48e0` |  |
| `/Users/bravonode/Mira/.claude/worktrees/4230-quickstart` | `fix/4224-quickstart-ungrounded-honesty` | `3ebb57a7328d8d7e7941489ede5d6aab360f2ef2` |  |
| `/Users/bravonode/Mira/.claude/worktrees/agent-a0a2094ee099d5408` | `bravo/4870-calibration-kit` | `4d7746177f94bbc1c08afb50b5440ac5fc7c6162` |  |
| `/Users/bravonode/Mira/.claude/worktrees/agent-a12e8cf9cd5d09b0a` | `bravo/4880-defects-1-3-4-v2` | `991dcc225041ce267baad997363914010919f2f4` |  |
| `/Users/bravonode/Mira/.claude/worktrees/agent-a1b8a7f3cd6a1ce1a` | `bravo/4880-defects-1-3-4` | `a051e322bb5f366da9b902110072cb9ecf1aaf44` |  |
| `/Users/bravonode/Mira/.claude/worktrees/agent-add33f6e300e7e9e7` | `bravo/s2-4471-4867-compat` | `a1cceb9cc297e743adbabe2d2ee142d03570d041` |  |
| `/Users/bravonode/Mira/.claude/worktrees/agent-af3992efa58b804aa` | `bravo/4902-hub-signup-consent` | `2e2c50a3d701712c8207b81fc07d4e79b4b6f6dd` |  |
| `/Users/bravonode/MIRA/.claude/worktrees/db-region-copy` | `ops/db-region-copy-staging` | `a7fb7f01bbbe2dfab089d77c58b42ff2ed1d8649` |  |
| `/Users/bravonode/Mira/.claude/worktrees/defectA-codelane` | `fix/4224-quickstart-codelane-defectA` | `38bf006f65f1d91e3932db9b9314953e3b01bc42` |  |
| `/Users/bravonode/Mira/.claude/worktrees/universal-vfd-compiler` | `feat/universal-vfd-manual-compiler` | `436b3b9669f8cc68f0e4657d5adf59c0f64350fa` |  |
| `/Users/bravonode/Mira/.claude/worktrees/wf_45546313-1fd-1` | `bravo/fix-4880-signup-markdown` | `7aa6cdfe940d60935c6287dc93fae0f19cdae9a8` |  |
| `/Users/bravonode/Mira/.claude/worktrees/wf_45546313-1fd-12` | `detached` | `7f4dfc62b84ba66b2aa00428bd5afc7eed1fab90` |  |
| `/Users/bravonode/Mira/.claude/worktrees/wf_45546313-1fd-13` | `bravo/fix-4880-repair` | `7c6608509b909d1ef1368003a70d73e24fb4c1a5` |  |
| `/Users/bravonode/Mira/.claude/worktrees/wf_45546313-1fd-15` | `pr-4570` | `4ff6f2ef8c0f03007eefa08757029996e691dcfa` |  |
| `/Users/bravonode/Mira/.claude/worktrees/wf_45546313-1fd-17` | `bravo/4852-highs` | `f08b89c1fe8b4601441ad83527b046ffc16a947c` |  |
| `/Users/bravonode/Mira/.claude/worktrees/wf_45546313-1fd-2` | `feat/answer-requirements-gate` | `4d7746177f94bbc1c08afb50b5440ac5fc7c6162` |  |
| `/Users/bravonode/Mira/.claude/worktrees/wf_45546313-1fd-20` | `bravo/retriage-dependabot-r2` | `cf1dcc04c3d012c1295ddf00ccb10ada4249ba77` |  |
| `/Users/bravonode/Mira/.claude/worktrees/wf_45546313-1fd-23` | `bravo/fix-4880-citation-chip` | `4b191b952862a8692ac02aae044ea7f065d8c740` |  |
| `/Users/bravonode/Mira/.claude/worktrees/wf_45546313-1fd-27` | `bravo/fix-4901-4902-pilot-consent` | `6a9e8a373444e413ef68c42ff7b25cced0ede4dd` |  |
| `/Users/bravonode/Mira/.claude/worktrees/wf_45546313-1fd-3` | `bravo/rechunk` | `5a738f6c399f840020f9299b048c729c7e968a99` |  |
| `/Users/bravonode/Mira/.claude/worktrees/wf_45546313-1fd-31` | `bravo/repair-4901-4902` | `777936226c0c7b86168b25695d81757bf7024580` |  |
| `/Users/bravonode/Mira/.claude/worktrees/wf_45546313-1fd-36` | `bravo/notebook-answer-feedback` | `046926c34caf1674835ad7d612a23b713dd2c1f4` |  |
| `/Users/bravonode/Mira/.claude/worktrees/wf_45546313-1fd-4` | `bravo/d1-claims` | `4ff6f2ef8c0f03007eefa08757029996e691dcfa` |  |
| `/Users/bravonode/Mira/.claude/worktrees/wf_45546313-1fd-41` | `worktree-wf_45546313-1fd-41` | `272ce162cb1c6cc8c3acc611a81a38b9cc3dd569` |  |
| `/Users/bravonode/Mira/.claude/worktrees/wf_45546313-1fd-5` | `bravo/retriage-dependabot` | `8c9f7f9cb23d02e0df66c39d51afe6f02957b16a` |  |
| `/Users/bravonode/Mira/.claude/worktrees/wf_9ef66b61-24b-14` | `detached` | `7f4dfc62b84ba66b2aa00428bd5afc7eed1fab90` |  |
| `/Users/bravonode/Mira/.claude/worktrees/wf_9ef66b61-24b-3` | `test-4852` | `f08b89c1fe8b4601441ad83527b046ffc16a947c` |  |
| `/Users/bravonode/Mira/.claude/worktrees/wf_9ef66b61-24b-5` | `worktree-wf_9ef66b61-24b-5` | `6a9e8a373444e413ef68c42ff7b25cced0ede4dd` |  |
| `/Users/bravonode/Mira/.claude/worktrees/wf_9ef66b61-24b-6` | `bravo/release-notes-v3428` | `34c942a110e980a7db7592e8373cde8412f0de31` |  |
| `/Users/bravonode/Mira/.claude/worktrees/wf_9ef66b61-24b-8` | `detached` | `34c942a110e980a7db7592e8373cde8412f0de31` |  |
| `/Users/bravonode/Mira/.claude/worktrees/wf_9ef66b61-24b-9` | `bravo/release-notes-v3428-fix` | `7f4dfc62b84ba66b2aa00428bd5afc7eed1fab90` |  |
| `/Users/bravonode/Mira/.planning/6030-takeover-20261126/baseline-da002` | `detached` | `8571e1215c2ef41c9c136c76dc4058792d46d980` |  |
| `/Users/bravonode/Mira/.planning/factorylm-free-technicians` | `codex/factorylm-free-technicians-20261121` | `0207435161c51f3a8d811927960bd79c8030610f` |  |
| `/Users/bravonode/Mira/.planning/factorylm-free-types-base` | `detached` | `dfa344f32a2e6bd5f988eeac0be01a5b2a33c662` |  |
| `/Users/bravonode/Mira/.planning/three-fixes-20261126/trusted-base-c835` | `detached` | `c835c35f399b87acf9cc2725245d70418d5cf055` |  |
