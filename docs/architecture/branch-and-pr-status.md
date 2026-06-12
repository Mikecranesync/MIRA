# Branch & PR Status — Snapshot

> **⚠️ This doc is a point-in-time SNAPSHOT, not live state. Captured 2026-06-07.**
> Branches and PRs change daily, and a local checkout routinely runs 10+ commits behind `origin/main`. **Always regenerate before trusting** — see "How to regenerate" at the bottom. Treat anything here older than a day or two as a starting map, not truth.

`origin/main` HEAD at snapshot: `c5923b56` — *fix(engine): Q1 kiosk status-summary trim to 145-word cap*.

---

## What's on `main` (recently merged)

The last several commits on `origin/main` (newest first):

| SHA | Summary |
|---|---|
| `c5923b56` | fix(engine): Q1 kiosk status-summary trim to 145-word cap (citation-preserving) |
| `6ef06297` | docs(ops): kiosk/AskMira deploy + verify runbook + close mira-ask TARGETS gap |
| `1848e07b` | Merge PR #1752: workflow durability primitive + first surface + dashboard |
| `fb55d07e` | feat(ingest): route kg_writer edges through proposal path (no auto-verify) — Phase 3 #1662 |
| `8080dc69` | fix(engine): H4 stock admission scorer-vocab + Sources-block normalizer |
| `e5dabe7f` | fix(engine): AskMira Q1/Q2/Q5/Q7 + H4 enforcer |
| `dcdc1418` | feat(workflow): /workflows status dashboard over workflow_runs |
| `931baa42` | feat(workflow): wire Hub document ingest into the run-record primitive |

**Themes currently landing on main:** the **AskMira / Ignition kiosk** path (engine answer-quality fixes, kiosk deploy runbook), the **workflow-durability** primitive (`workflow_runs` + `/workflows` dashboard), and the **KG proposal path** (kg_writer edges now route through proposals, no auto-verify — Phase 3 of #1662).

> Note: a local `main` checkout was 14 commits behind `origin/main` at snapshot time. The recent eval/KG/RAG fixes (#1741, #1742, #1733, #1731) that a stale local log shows as "HEAD" are already merged upstream. Run `git fetch` before reasoning about what's on main.

---

## Open PRs (snapshot)

Grouped by theme. Draft status noted. Regenerate with `gh pr list` for current state.

### Ignition / AskMira / Command Center (the live demo spine)
| PR | Branch | Draft | Title |
|---|---|---|---|
| [#1772](https://github.com/Mikecranesync/MIRA/pull/1772) | fix/cc-e2e-freshness-schema | | Command Center e2e — align mock with tagFreshness + Open Live View handoff |
| [#1711](https://github.com/Mikecranesync/MIRA/pull/1711) | feat/ask-uns-gate-state | | Expose UNS gate state for the Perspective confirm panel |
| [#1709](https://github.com/Mikecranesync/MIRA/pull/1709) | feat/phase6-direct-connection-gate-1658 | draft | Phase 6 direct_connection UNS gate — 422 on missing identifier |
| [#1668](https://github.com/Mikecranesync/MIRA/pull/1668) | feat/ignition-module-self-serve | | Self-serve Ignition Module + Walker current-state spine (Phases A–G) |
| [#1619](https://github.com/Mikecranesync/MIRA/pull/1619) | feat/cc-ignition-qa | | Command Center → Ignition QA gates |
| [#1603](https://github.com/Mikecranesync/MIRA/pull/1603) | feat/hub-command-center-phase2 | | Command Center Phase 2 — cloud-reach proxy + display registry CRUD |
| [#1751](https://github.com/Mikecranesync/MIRA/pull/1751) | docs/askmira-ignition-deploy-handoff | | AskMira ignition deploy goal + reading list |

### Demo readiness
| PR | Branch | Draft | Title |
|---|---|---|---|
| [#1750](https://github.com/Mikecranesync/MIRA/pull/1750) | chore/demo-hub-seed | | Demo-tenant Hub seed (garage conveyor cell) |
| [#1746](https://github.com/Mikecranesync/MIRA/pull/1746) | chore/demo-readiness-docs | | Demo-readiness audit + punch list |
| [#1745](https://github.com/Mikecranesync/MIRA/pull/1745) | fix/web-demo-blockers | | Unblock /assess radar + align free-account messaging |

### Ingest / upload / knowledge
| PR | Branch | Draft | Title |
|---|---|---|---|
| [#1753](https://github.com/Mikecranesync/MIRA/pull/1753) | fix/docling-to-tika-upload-recovery | | Docling→Tika + upload recovery loop + local-retry |
| [#1592](https://github.com/Mikecranesync/MIRA/pull/1592) | feat/hub-folder-brain | draft | folder = brain — UNS node-centric knowledge + subtree-grounded chat |

### Connectors & canonical asset graph
| PR | Branch | Draft | Title |
|---|---|---|---|
| [#1702](https://github.com/Mikecranesync/MIRA/pull/1702) | feat/mira-connectors | | Generic connector framework + 5 mock connectors + 67 tests |
| [#1710](https://github.com/Mikecranesync/MIRA/pull/1710) | feat/dt2026-source-identity-migrations | | Source identity foundations for canonical asset graph |

### Engine / guardrails / conversational
| PR | Branch | Draft | Title |
|---|---|---|---|
| [#1718](https://github.com/Mikecranesync/MIRA/pull/1718) | fix/parameter-lookup-instructional | | Route parameter-lookup queries to instructional → IDLE |
| [#1563](https://github.com/Mikecranesync/MIRA/pull/1563) | feat/conversational-engine-v2 | | Conversational layer v2 — 3-layer front desk |
| [#1531](https://github.com/Mikecranesync/MIRA/pull/1531) | feat/conversational-engine-spec | | Conversational engine upgrade spec — 3-layer model |
| [#1573](https://github.com/Mikecranesync/MIRA/pull/1573) | fix/eval-cluster1-uns-family-marker | | Family-marker alias falls back to model — unblocks UNS gate loop |

### Ops / self-healer / CI
| PR | Branch | Draft | Title |
|---|---|---|---|
| [#1748](https://github.com/Mikecranesync/MIRA/pull/1748) | fix/self-healer-recreate-and-alerts | | Self-healer recreates removed containers + Telegram alert fallback |
| [#1712](https://github.com/Mikecranesync/MIRA/pull/1712) | chore/orchestrator-routine | | Make the 4h pulse useful — dedup twins, kill superseded |
| [#1759](https://github.com/Mikecranesync/MIRA/pull/1759) | fix/web-review-canary-push-race | | web-review canary rebases before pushing (push race) |
| [#1757](https://github.com/Mikecranesync/MIRA/pull/1757) | fix/oauth-canary-no-secret | | oauth-redirect canary tests the real signin flow |

### PLC / fieldbus
| PR | Branch | Draft | Title |
|---|---|---|---|
| [#1638](https://github.com/Mikecranesync/MIRA/pull/1638) | feat/conv-simple-anomaly-a2a7a12 | | A2/A7/A12 anomaly rules + bridge runs on Windows bench laptop |

### Docs / status-sync / promo (low-stakes, often draft)
Several recurring auto-generated PRs: `docs/gap-closure-*` status syncs (#1701, #1694, #1687, #1679), `chore/promo-director-refresh-*` (#1730, #1630, #1607, #1590, #1574), and docs branches (#1751, #1633, #1631). These are housekeeping; many are stale drafts. **Candidates for cleanup** — a pile of superseded `promo-director-refresh` and `gap-closure` drafts suggests the orchestrator routine (#1712) is creating twins faster than they merge.

### Dependabot
- [#1656](https://github.com/Mikecranesync/MIRA/pull/1656) openviking bump (mira-mcp)
- [#1651](https://github.com/Mikecranesync/MIRA/pull/1651) anthropic requirement bump in mira-bots/telegram — **note:** the `anthropic` package is still a *transitive/test* dependency even though Anthropic is removed as a runtime provider (PR #610); a dependency bump is not a provider reintroduction.

---

## Notable feature branches (local + remote, not all have PRs)

`feat/hub-command-center`, `feat/dt2026-gap-closure`, `feat/hub-discovery-scan`, `feat/hub-folder-brain`, `feat/1347-namespace-node-detail`, plus rescue branches `rescue/cc-view-wip-2026-06-04`, `rescue/dt2026-gap-closure-wip-2026-06-04` (preserved WIP from the 2026-06-04 git cleanup — see memory). Don't assume a local branch is current; many predate recent main.

---

## What can go wrong (reading this doc)
- **It's stale.** This is a snapshot. The day after capture, several of these PRs may be merged or closed. Regenerate.
- **Local-vs-origin drift.** Your local `main` is probably behind. `git fetch` first, always.
- **Draft ≠ abandoned, and open ≠ active.** Some long-lived drafts (folder-brain #1592, conversational-engine #1563) are real in-flight work; some open PRs (promo/gap-closure) are auto-generated noise. Don't infer priority from open/draft alone — check `updatedAt` and the author.

## How to regenerate this doc
```bash
git -C ~/MIRA fetch origin
git -C ~/MIRA log origin/main --oneline -10
gh pr list --state open --limit 60 \
  --json number,title,headRefName,isDraft,updatedAt \
  --jq '.[] | "\(.number)\t\(.headRefName)\tdraft=\(.isDraft)\t\(.title)"'
git -C ~/MIRA for-each-ref --sort=-committerdate refs/heads --format='%(refname:short)' | head -25
```
Then re-bucket by theme and re-stamp the snapshot date at the top.

## Cross-references
- [environment-quick-ref.md](environment-quick-ref.md) — where each branch deploys
- [../runbooks/merge-prs.md](../runbooks/merge-prs.md) — how PRs merge (staging gate, required checks)
- [../runbooks/deploy-to-production.md](../runbooks/deploy-to-production.md) — merge → VPS
