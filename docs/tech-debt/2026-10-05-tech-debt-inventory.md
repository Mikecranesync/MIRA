# MIRA Tech-Debt Inventory — 2026-10-05

**Method:** six parallel read-only sweeps (tracked-debt docs · code markers & disabled tests · built-but-not-enabled capabilities · architecture/convergence · migrations/schema/data · open-PR & process debt). Point-in-time snapshot of `main` + this session's worktree.

**Caveat:** a flag's *real* production state is owned by Doppler, not the repo — every "off-by-default" below is `needs-Doppler-check`, not an assertion. Issue/PR numbers are as observed.

---

## The headline: the bottleneck is decisions and merges, not code

The single largest category of debt is **work that is finished and gated, waiting on a human**. This is not an inference — it recurs in every sweep:

- **100 open PRs** · 67 BEHIND main · 64 DRAFT · 13 stale >30d · explicit "Mike decides" holds (#4023, #3542, #3545, #3563).
- **~8 capabilities shipped dark**, code-ready + offline-tested, awaiting a Doppler flip or an ADR ratification (`photo_ocr_evidence`, `nameplate_identification`, `manual_discovery_judge`, `machine_memory_observer_cv101`, `technician_context_contract`, `ENABLE_WO_EVIDENCE`, …).
- Several **ADRs "Proposed, awaiting Mike"** block live code paths (ADR-0033 most consequentially).

Throughput is not the problem — 6 tech-debt items were *closed* in the last audit cycle (see § Recently resolved). The queue depth is. **Fastest ROI is a decision/merge triage sitting, not new engineering.**

---

## P0 — risk or truth-integrity (small set, act first)

| # | Item | Evidence | Why P0 | Disposition |
|---|------|----------|--------|-------------|
| P0-1 | **`run_diff_engine` enabled in prod, UNPROVEN, no owner** | `CAPABILITY_CLOSURE.yaml` (production_enabled); 3 test suites in no CI job (#3089 class); `#3886` owner-missing | A capability live in production with no proof artifact and nobody named for it. Enabled ≠ proven. | Assign owner (#3886); enumerate the 3 suites in a named CI job; produce one real NeonRunStore diff for review. |
| P0-2 | **Asset identity is 5-way split; cross-tenant asset-isolation test is *unconditionally skipped*** | `OWNERSHIP.md` (5 id schemes, no FK bridges); `mira-hub/tests/e2e/money-path.spec.ts:136` skip — `asset_id` tenant boundary unenforced; CU-05 designed-not-enforced | Dual-truth asset creation + an IDOR-shaped gap with its guard test disabled. Grounding + tenancy both ride on asset identity. | Launch CU-05 (contract→shadow→bridges→flip→gates); un-skip money-path asset isolation and make it fail-closed. |
| P0-3 | **Nightly eval truth broken — 30s timeout masks 33/65 results** | `docs/tech-debt/2026-08-25-tech-debt-audit.md` §Re-rank 1; #2759/#2952/#3301/#2258 open | Every "+N eval" claim is unreliable while half the suite silently times out. We're flying partially blind on diagnostic quality. | Raise `MIRA_PROCESS_TIMEOUT` plist + record/replay cascade; re-baseline. |
| P0-4 | **Decision/merge backlog (the headline, as a tracked item)** | 100 open PRs, 67 behind, 13 stale >30d, 4 explicit owner-holds | Finished work rots (rebase drift, stale reviews) and the golden-walk/beta fixes sit un-shipped. | One triage sitting: a Mike-decision list w/ SLA + a rebase/merge pass on the ready ones. |
| P0-5 | **CRITICAL Next.js RCE CVE in prod dependency — `next@16.3.5`** | `mira-hub/package.json` `"next": "16.3.5"` (same on `main`); Trivy on the `Docker Build Check` reports GHSA-vcvr-r3jv-pc5j (RCE in `next/og` ImageResponse), **fixed in 16.3.6** — surfaced live on PR #4245's scan 2026-10-05 | A known-fixed CRITICAL RCE sitting in the shipped Hub dependency; fails the `Docker Build Check`/Trivy scan on *every* mira-hub PR (observed red on #4245, which touched no deps). One-version patch bump. | Patch bump `next` 16.3.5→16.3.6 in `mira-hub/package.json` + lockfile, on its **own** branch/PR (not a retrieval PR). Verify `next/og` usage for exploitability but bump regardless. |

---

## P1 — meaningful (grounding, security, safety, maintainability)

| # | Item | Evidence | Disposition |
|---|------|----------|-------------|
| P1-1 | **`knowledge_entries` hybrid read filter missing on 2 surfaces → OEM corpus invisible** | `api/assets/[id]/documents/route.ts:112` and `lib/agents/asset-intelligence.ts:139,158` query `tenant_id=$1` alone (disappeared-corpus #1761 class) | Apply `(is_private=false OR tenant_id=$1)` on the raw owner pool (per `knowledge-entries-tenant-scoping.md` ⏳). Beta-relevant: the customer asset view sees 0 OEM chunks. |
| P1-2 | **Hub role defaults to `owner`** | `session.ts` / `access-control.ts` / `users.ts` use `?? "owner"` | Silent privilege escalation. Fail closed (`viewer` / throw) + test. ~2h. |
| P1-3 | **`evidence_provenance_gate` CI job declared but never run green on main** | `CAPABILITY_CLOSURE.yaml` connected_ci_missing; 37 rules + 2 mutation tests exist | A provenance guard that doesn't run is documentation. Run `capability-closure` green once, then promote. |
| P1-4 | **Evidence-binding hallucination guard is a `NotImplementedError` placeholder** | `docs/eval/print-translator-benchmark/.../test_known_hallucinations.py:53` (4 skip; K1/K2 mislabel, XC00/XC90 phantom) | 4 known fabrication cases unguarded. Implement the guard; un-skip. Safety/citation. |
| P1-5 | **Print-translator classifier gate — 5 xfail (vision mis-classify)** | `docs/eval/print-translator-campaign/.../test_classifier_gate.py` ("titled" matches "led" substring) | Word-boundary + print-precedence matching; un-xfail. Beta-gate for the print lane. |
| P1-6 | **ADR-0033 governance drift — code adopted, status still "Proposed"** | `docs/adr/0033`; `technician_context.py` depends on the contract seam; DRIFT D-3; `technician_context_contract` staging_enabled, zero runtime evidence | Architecture behaves as ratified while the decision is pending. Ratify or mark explicitly experimental; gates WS1 runtime adoption + eval slice 13 + any training spend. |
| P1-7 | **`engine.py` ~8,400 lines / `telegram/bot.py` ~2,800 lines** | 2026-08-25 audit §Row 6 | Monoliths; every engine PR needs `codegraph_impact` + "expect surprises". Gated multi-PR refactor (R0 + review), not a drive-by. |
| P1-8 | **Three diagnostic engines coexist, no owner** | Supervisor + Fault-Detective + factorylm predecessors; #2442/#2444/#2446 | Product decision + convergence unit. Clarify the one engine; retire the rest. |
| P1-9 | **CU-03 (ingest write-path) Gate 9 human GO unresolved** | `BACKLOG.md:CU-03` PARTIAL; `#3343`; PR #3268 merged with no APPROVED review | Code locked + tested; close #3343 with an owner approval, then DONE. |
| P1-10 | **`mira-sidecar` dead code still in repo (~2,815 LOC)** | root `CLAUDE.md` deferred table; Gate 11 deletion pending; #2446 | Delete under the convergence deletion unit after a CHARLIE runtime-consumer sweep. |

---

## P2 — hygiene / process / minor

- **Worktree clutter + branch sprawl:** 12 local worktrees (4 stale, oldest 82d), **1,439 remote branches**. Run `tools/worktree-health.sh`; monthly branch prune. (`docs/tech-debt/2026-07-27-worktree-clutter-rca.md`)
- **Duplicate migration numeric prefixes** (12 pairs): WONTFIX-by-design — ledger keys on basename; renaming an applied migration is the real footgun (`mira-hub-migrations.md` §7).
- **Base-schema bootstrap gap:** `001`/`002` deleted from repo; a from-scratch `mira-hub/db/migrations` apply fails at `003`. Dev/test-ephemeral only; prod/staging unaffected. Needs a seed-base DDL before any ephemeral-verify job.
- **CLAUDE.md drift:** ~373 lines vs ~120 target; stale counts ("76 offline tests"→122, "25 env vars"→122). Cut to a map; add a CI line-count drift check.
- **26 issues mislabeled P0** (oldest 66d untriaged): triage sweep; keep ≤3 true P0s.
- **Legacy UI Lifecycle Guard is advisory-only** (not merge-blocking; #3657) — the co-located-test false-positive this session hit is the same class; binding it to branch protection needs an admin + a non-spoofable status source.
- **OEM orphaned garage-tenant rows** (pre-SP1 writes): `verified=false`, invisible to retrieval (harmless); re-acquire via `sources.yaml` rather than backfill (`oem-crawler-trusted.md`). Global dedup-hash race between crawlers is rule-asserted, not independently reproduced.
- **PrintSense prod-activation posts ❌ on every `main` deploy** since 2026-08-26 (post-deploy workflow outside the merge gate): CI signal-to-noise.
- **Container-map secondary drifts** #3259 (phantom `mira-ops/` in root compose) / #3260 (mira-relay "SaaS-only" prose vs dev compose) — now auto-detected by `tools/gen_container_map.py --check`.
- **~15 substantive TODO/FIXME in production code** (low): notable — `mira-mcp/server.py:1165,1314` audit-log table missing (stdout-only audit trail); `i3x/v1/objects/route.ts:15` 500-entity pagination cap; `run_engine/models.py:18` historian `list_runs()` not wired (#2339); `atlas/sync.ts:132` per-tenant breaker keying.

---

## Recently resolved (last audit cycle — throughput evidence)

approved-context gate (P0→closed, #3416–#3425) · library-routes OEM visibility (#3422) · 50 unrun test files now in the gate (#3425) · staging `tag_events`/`approved_tags` drift + **permanent prevention** via content-fingerprinted ledger (migrations 063/066) · `knowledge_entries` UPDATE grant (079) · lifecycle-invariant structural CHECK (094) · container-map automation (CU-02) · `private_notebook_turns` (runtime-proven, v3.320.1).

## Stale-doc corrections surfaced by the sweep (fix in place)

- `knowledge-entries-tenant-scoping.md` still says folder=brain uploads land `is_private=false` — **stale**: now structurally enforced (`store.py::insert_chunk` keyword-only required; `node-knowledge-ingest.ts` writes `true` with a dedicated test). Update the rule's ⏳.
- `CLAUDE.md` test/env-var counts stale (see P2).
- Issue #2341 describes `run_diff_engine` as not existing — stale; it's in prod.

---

## Suggested next actions (ranked by ROI)

1. **Hold a decision+merge triage sitting** (P0-4) — the highest-leverage single act; unblocks the shipped-dark capabilities and the golden-walk PR cluster.
2. **P0-1 `run_diff_engine`**: assign owner + wire tests to CI (a live-in-prod-unproven capability is the sharpest standalone risk).
3. **P1-1 hybrid read filter** on the two asset surfaces — small, mechanical, directly improves grounding (beta-relevant).
4. **P1-2 Hub `owner` default** — ~2h security fix.
5. **P0-3 eval timeout** — restores trust in every downstream eval number.

> This inventory is a point-in-time map, not a work order. Items marked OPEN against a rule/issue were spot-checked against the referenced file where feasible; confirm a flag's prod state in Doppler and a PR's live mergeability (`tools/pr-merge-blocker.sh`) before acting.
