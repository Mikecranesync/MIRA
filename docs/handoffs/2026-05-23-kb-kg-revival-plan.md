# KB + KG ingest revival — fixes plan

**Date:** 2026-05-23
**Owner:** Mike Harper
**Goal:** Get fresh maintenance documents flowing into the KB (NeonDB `knowledge_entries`) and proposed edges flowing into the KG (NeonDB `kg_entities` / `kg_relationships`), without re-triggering the May 2026 OOM lineage.

## TL;DR — order of operations

| # | Action | Blocked by | Owner | Reversible? |
|---|---|---|---|---|
| 1 | **CHARLIE disk cleanup (worktrees, Claude data)** | needs Mike's auth on worktree mass-remove | Mike + me | yes (worktree add re-creates) |
| 2 | **Merge PR #1513** (benchmark code) | code review | Mike | yes (revert) |
| 3 | **Merge PR #1514** (weekly bench workflow + paused audit) | code review | Mike | yes (revert) |
| 4 | **Merge PR #1515** (AB hunter + guardrails + compose lint) | code review | Mike | yes (revert) |
| 5 | **Install launchd plists on CHARLIE** | PR #1515 merged | Mike | yes (launchctl unload) |
| 6 | **First live ab-hunter run** | plists installed, disk OK | me (after plists) | yes (delete the downloaded PDF) |
| 7 | **Verify KB + KG row count grew** | hunter run done | me | n/a (read-only) |
| 8 | **Fix `com.factorylm.mira-offline-eval` plist** | none | Mike (local) | yes |
| 9 | **Resolve `~/factorylm` brain-mcp conflict** | none | Mike (local) | yes |
| 10 | **Open follow-up PR — cap `saas.yml` mem_limits (Issue #1516)** | optional | me or Mike | yes |
| 11 | **Decide Trigger.dev fate** | none, but needs #10 first | Mike | n/a |
| 12 | **Tighten ab-hunter targets (cohorts 2+3) + add VFD/GS family** | first live run successful | me | yes |

Steps 1-7 unblock the **active flywheel**: documents → chunks → KG proposals. Steps 8-12 are debt cleanup + future expansion.

---

## 1 — CHARLIE disk cleanup (status: in progress)

**Done this session:**
- `docker system prune -af` → reclaimed 7.16 GB build cache + freed ~7 GB unused images (inside Colima VM)
- `brew cleanup -s` + `pip cache purge` → minimal (~100 KB)

**Not done — need Mike's nod:**
- **Prune 20 merged worktrees** (~5-10 GB). The auto-classifier blocked the mass-remove because it's pre-existing local state. Run yourself or grant the agent permission:
  ```bash
  cat /tmp/safe-to-prune.txt  # verify the list first
  while IFS= read -r p; do git -C ~/MIRA worktree remove "$p"; done < /tmp/safe-to-prune.txt
  git -C ~/MIRA worktree prune
  ```
- **`~/Library/Application Support/Claude` is 15 GB** — Claude desktop session history. Cleanup would wipe history. Recommend leaving unless you don't use the desktop app.
- **Colima diffdisk is 21 GB sparse** — `docker system prune` freed space INSIDE the VM but the host file doesn't shrink. To actually reclaim, stop Colima + `qemu-img convert` to compact + restart. **Skip** — would interrupt MiraDrop ingest + the Slack bot + mira-core.

**Current state:** APFS container is still at 89.0% used (218 / 245 GB). 27 GB free, which IS enough headroom for the AB hunter to operate (typical PDF is 3-8 MB, per-run cap 3 = ~25 MB max), but the warn threshold is still tripped on every guardrails run.

**Recommendation:** authorize the worktree prune to drop us under 80%. That's the next clear win.

---

## 2-4 — Merge the three open PRs (the meat)

Three PRs are stacked on this session's work:

| PR | What | Status | Notes |
|---|---|---|---|
| [#1513](https://github.com/Mikecranesync/MIRA/pull/1513) | `feat(bench): Phase 2 — objective scoring + equipment retrieval` | open | The benchmark code itself (282 vs 255 result). PRs #1514/#1515 reference it. |
| [#1514](https://github.com/Mikecranesync/MIRA/pull/1514) | `chore(ops): weekly mira-bench schedule + paused-ingest audit` | open | Weekly workflow + locked baseline + regression detector + paused-services audit |
| [#1515](https://github.com/Mikecranesync/MIRA/pull/1515) | `feat(ingest): small-scale AB manual hunter + guardrails + compose mem-limit lint` | open | The action piece — runs on CHARLIE, drops PDFs to MiraDrop |

**Merge order:** #1513 → #1514 → #1515. (#1515 is independent of #1513 in execution but the workflow in #1514 needs #1513's bench files to be on main.)

---

## 5 — Install launchd plists on CHARLIE (after #1515 merges)

```bash
cd ~/MIRA && git pull origin main
cp scripts/ab_manual_hunter/launchd/com.factorylm.ab-manual-hunter.plist ~/Library/LaunchAgents/
cp scripts/ab_manual_hunter/launchd/com.factorylm.ingest-guardrails.plist ~/Library/LaunchAgents/
launchctl load ~/Library/LaunchAgents/com.factorylm.ab-manual-hunter.plist
launchctl load ~/Library/LaunchAgents/com.factorylm.ingest-guardrails.plist
launchctl list | grep -E "ab-manual-hunter|ingest-guardrails"
```

After this, the guardrails run every 15 min and report state to `~/.mira/guardrails-state.json`. The hunter sits dormant (RunAtLoad=false) until the first cron tick at minute 17 of the next 6-hour boundary.

---

## 6 — First live ab-hunter run

The plist defaults to `MIRA_AB_HUNTER_LIVE=0` (dry-run). After confirming the first scheduled dry-run succeeded:

```bash
# 1. Inspect the dry-run report
ls -t ~/.mira/ab-hunter/run-*.json | head -1 | xargs python3 -m json.tool

# 2. Force a live run from the CLI (bypasses plist; doesn't wait for next cron)
MIRA_AB_HUNTER_LIVE=1 doppler run --project factorylm --config prd -- \
    python3 scripts/ab_manual_hunter/run.py --max-new 1

# 3. Watch MiraDrop pick it up (~60s)
ls -la ~/MiraDrop/inbox/    # PDF here briefly
ls -la ~/MiraDrop/done/     # then here
tail -f ~/Library/Logs/mira-drop-watcher.out.log
```

When happy, edit the plist to set `MIRA_AB_HUNTER_LIVE=1` + `launchctl unload && load`.

---

## 7 — Verify KB + KG grew

```sql
-- Run via db-inspect.yml or staging psql, NOT prod psql.

-- KB: did chunks land?
select count(*) from knowledge_entries
where source_url ilike '%rockwell%'
  and inserted_at > now() - interval '1 hour';
-- Expect: > 0 (per the PDF, usually 10-50 chunks)

-- KG entities: were entity rows proposed?
select entity_type, status, count(*)
from kg_entities
where created_at > now() - interval '1 hour'
group by 1, 2;
-- Expect: at least 'manufacturer' (Rockwell) + 'product_family' (Micro820/CCW) + 'document' (the manual)

-- KG relationships: were edges proposed?
select status, count(*)
from kg_relationships
where created_at > now() - interval '1 hour'
group by 1;
-- Expect: rows with status='proposed' — manual review owns 'verified' promotion
```

If KG rows don't appear: the `mira-crawler/ingest/kg_writer.py` path isn't being invoked by the Hub ingest pipeline. That's a separate fix (Hub's chunker writes `knowledge_entries` but may not invoke kg_writer). Add to the follow-up list.

---

## 8 — Fix `com.factorylm.mira-offline-eval` plist (local-only)

200+ failed runs since 2026-05-22. Fix from audit doc § 3 (PR #1514):

```bash
# Edit ~/Library/LaunchAgents/com.factorylm.mira-offline-eval.plist
# Remove the substring: ` --output tests/eval/runs/offline-$(date +%Y%m%dT%H%M).md`
launchctl unload ~/Library/LaunchAgents/com.factorylm.mira-offline-eval.plist
launchctl load ~/Library/LaunchAgents/com.factorylm.mira-offline-eval.plist
```

---

## 9 — Resolve `~/factorylm` brain-mcp conflict (local-only)

```bash
cd ~/factorylm
git status
git grep -nE '^<<<<<<< |^>>>>>>> |^=======$' services/
# resolve, commit, then:
launchctl kickstart -k gui/$(id -u)/com.factorylm.brain-mcp
```

---

## 10 — Cap `saas.yml` mem_limits (separate PR — Issue #1516)

P0 finding from PR #1515: **59 services across 16 compose files have no `mem_limit` set**. PR #1336 fixed `mira-docling` after the 8.7-hour outage but never propagated to the other 13 services in `saas.yml`. The lint added in PR #1515 catches it; the actual fixes belong in their own small PR.

Suggested defaults for `saas.yml` (match existing `deploy.resources` values):

| Service | mem_limit | memswap_limit |
|---|---|---|
| mira-core | 4g | 4g |
| mira-ingest | 1g | 1g |
| mira-mcp | 512m | 512m |
| mira-web | 512m | 512m |
| mira-pipeline | 1g | 1g |
| mira-bot-telegram | 512m | 512m |
| mira-bot-slack | 512m | 512m |
| mira-relay | 256m | 256m |
| nango-db | 512m | 512m |
| nango-server | 768m | 768m |
| mira-hub | 768m | 768m |
| mira-cmms-sync | 512m | 512m |

After the PR lands: flip `.github/workflows/compose-mem-lint.yml` from `continue-on-error: true` to required.

---

## 11 — Decide Trigger.dev fate

Three options documented in PR #1514's audit (§ 1). My recommendation: **leave paused** — the AB hunter + lead-hunter + MiraDrop now cover the day-to-day. Revisit only if an enterprise prospect demands "show me you ingest fresh OEM docs nightly."

If you DO revive: requirement is steps 1-10 done first (especially #10 — mem-limit fixes). Otherwise reviving the Trigger.dev → task-bridge → celery → docling chain is asking for another VPS hang.

---

## 12 — Expand ab-hunter targets

After first 3 successful live runs, uncomment cohort 3 in `scripts/ab_manual_hunter/targets.yaml` (wiring diagrams, installation, quick-start). Then add a separate hunter for AutomationDirect (GS10/GS11) — different URL family, needs its own targets file but can reuse `run.py`.

---

## What "ingest running again" looks like — end state

| Layer | Component | Cadence | Source of truth |
|---|---|---|---|
| Scrape | `ab_manual_hunter` (CHARLIE launchd) | every 6 h, max 3 PDFs/run | Rockwell literature CDN |
| Drop | `mira-drop-watcher` (CHARLIE launchd) | continuous | `~/MiraDrop/inbox/` |
| Ingest | Hub `/api/uploads/folder` | per-file | mira-core chunker |
| KB | NeonDB `knowledge_entries` | per-chunk | chunker output |
| KG | NeonDB `kg_entities` + `kg_relationships` (status='proposed') | per-document | `kg_writer.py` |
| Review | Hub `/admin/review` | human pull | admin verifies → status='verified' |
| Bench | GitHub Actions weekly + manual `mira_bench.py` | Wed 05:00 UTC | tests/mira_bench.py |
| Regression alert | `scripts/check_benchmark_regression.py` | per bench run | `.github/baselines/mira-bench.json` |
| Health | `ingest_guardrails.py` (CHARLIE launchd) | every 15 min | disk/mem/queue/OOM |
| Kill switch | `~/.mira/STOP_INGEST` | always-on | operator or guardrails |

All on CHARLIE. None on the 8 GB VPS. Hub does the chunking, not docling. Failures alert Telegram. Regression auto-files a GitHub issue. The bench measures whether new docs are actually helping (Q06/Q10 should improve as Micro820/CCW manuals land).

---

## What's deliberately NOT in this plan

- Reviving Trigger.dev / Celery / Redis on CHARLIE (see PR #1515 PR description — that's a yes/no for Mike, not a default)
- Auto-promotion of `kg_relationships.proposed → verified` (admin gates this, by design — see CLAUDE.md "knowledge graph proposals" rules)
- KB-gap surfacing → suggested ingest sources from bench failures (Phase 2 of `docs/evaluations/SELF_IMPROVEMENT.md`)
- Touching the VPS compose stack directly (use `apply-migrations.yml` / `deploy-vps.yml` per `docs/environments.md`)

---

## Reference

- Memory: `project_vps_oom_docling_incidents.md` (why we sidestep Celery+docling)
- Audit: `docs/handoffs/2026-05-23-paused-ingest-audit.md` (PR #1514)
- AB hunter: `docs/handoffs/2026-05-23-ab-ingest-revival.md` (PR #1515)
- Self-improvement: `docs/evaluations/SELF_IMPROVEMENT.md`
- Open issues: #1516 (P0 compose mem-limits)
- Runbook: `docs/runbooks/vps-hang-recovery.md`
