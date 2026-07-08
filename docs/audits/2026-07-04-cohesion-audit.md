# FactoryLM / MIRA Cohesion Audit — 2026-07-04

**Question answered:** what is keeping ~30 subprojects from being one cohesive program a customer can buy and use?

**Short answer:** the engine and the beta gate work. What's fragmented is everything *around* them: three login systems, billing enforced on only one of six chat surfaces, three diagnostic engines, and roughly a dozen modules that build but never ship. The product core is one program; the repo is five.

---

## 1. Module catalog

Status legend: **DEPLOYED** = in `docker-compose.saas.yml` (prod) · **BENCH** = dev/demo only · **ORPHAN** = in no compose file, imported by nothing deployed · **LEGACY** = superseded, awaiting removal.

| Module | Purpose | Status |
|---|---|---|
| mira-core | Open WebUI + MCPO + ingest | DEPLOYED |
| mira-pipeline | OpenAI-compat API → Supervisor (active chat path) | DEPLOYED |
| mira-bots | Telegram/Slack adapters + shared engine (the brain) | DEPLOYED |
| mira-hub | Command Center (app.factorylm.com) | DEPLOYED |
| mira-web | PLG funnel, Stripe (factorylm.com) | DEPLOYED |
| mira-cmms | Atlas CMMS | DEPLOYED (but an island — see §3.5) |
| mira-mcp | FastMCP server, NeonDB recall | DEPLOYED |
| mira-crawler | KB ingest + manual chunker | DEPLOYED |
| mira-relay | Ignition→cloud tag streaming | DEPLOYED |
| mira-bridge | Node-RED orchestration | DEPLOYED |
| mira-ops | Observability (Prometheus/Grafana) | DEPLOYED (separate compose) |
| simlab | Headless juice-line benchmark | DEV/CI (intentional) |
| tests/, evals/ | 5-regime test framework | CI (intentional) |
| mira-sidecar | ChromaDB RAG | LEGACY — sunset pending since ADR-0008 |
| mira-fault-detective | Fault diagnosis demo | BENCH-ONLY — marketed as a headline feature, never ships to customers |
| mira-fault-sim | Fault simulator | BENCH |
| plc/, ignition/ | Bench PLC programs, gateway scripts | BENCH (mixed into repo root) |
| mira-connect | Modbus/PLC drivers | DEFERRED (documented — OK) |
| mira-scan-monday | monday.com app | ORPHAN |
| mira-trend-viewer | Trend visualization | ORPHAN (parts deployed via plc/ historian work) |
| mira-machine-logic-graph | Logic graph experiments | ORPHAN |
| mira-contextualizer | Contextualization GUI | ORPHAN |
| mira-connectors | Connector experiments | ORPHAN |
| mira-ignition-exchange | Ignition Exchange packaging | ORPHAN |
| mira-plc-parser | PLC program parser | ORPHAN (standalone tool) |
| mira_copy | Stale copy of mira-core | DEAD — delete |
| paperclip | Agent instruction experiments | ORPHAN |
| nango-integrations | MaintainX integration stub | ORPHAN |
| Root clutter | 8 competitor reports, 6 handoff files, 8 PNGs, 3 legacy nginx confs, err.txt, mira_copy | DEAD WEIGHT |

**Ratio: ~11 modules ship to customers; ~12 are orphans/bench/dead.** Nothing marks which is which — every module looks equally alive (all touched by repo-wide commits), so effort and attention scatter evenly across code that matters and code that doesn't.

---

## 2. What already works (don't break it)

The **beta gate is MET and CI-enforced**: a stranger can upload a manual and get a cited answer (`tests/beta/beta_ready_upload_retrieval_citation.py`, `.github/workflows/beta-gate.yml`, green since 2026-06-17). Upload→retrieval is closed (#1592, #1863, #1911, #2100). The Supervisor engine, UNS gate, citation compliance, and the staging→prod promotion discipline are real and working.

---

## 3. The seven seams keeping it from being one program

**3.1 — Billing is enforced on one surface out of six.** Stripe/tier limits exist in mira-web, but Telegram, Slack, and Ignition chat let any user query without quota or plan checks. A customer who stops paying keeps full product access on the bots. Until every surface checks the same tenant/plan, "the product" has no commercial boundary.

**3.2 — Three separate login systems.** mira-web (JWT), mira-hub (NextAuth), Open WebUI (own accounts, public signup enabled). A paying customer creates up to three accounts and none of them know about each other. Open WebUI signup also creates orphan accounts outside tenancy entirely. This is the single biggest "feels like three products" problem.

**3.3 — Stripe → Hub provisioning is best-effort.** If the Hub user doesn't exist when the webhook fires, there's no retry — a paying customer can end up with no tenant. First-dollar path must be transactional.

**3.4 — Three diagnostic engines.** GSD/Supervisor (`mira-bots/shared/engine.py`, deployed), mira-fault-detective (bench), simlab's diagnostic (CI). Three implementations of "diagnose a fault" means three sets of answers and triple maintenance. One engine should be the product; the others should be test harnesses that *call* it.

**3.5 — CMMS is a parallel island.** Atlas is provisioned and deployed, but the diagnostic path doesn't read work-order history from it in practice. The pitch (context layer that includes maintenance history) isn't wired through.

**3.6 — No module lifecycle discipline.** No badge/manifest says deployed vs bench vs orphan vs dead. CLAUDE.md tracks 5 of the ~12 non-shipping modules; the rest silently accumulate. This is *why* the repo drifted into fragments.

**3.7 — Quality inverts the architecture.** The modules customers actually touch have the worst test grades: mira-pipeline **F** (zero tests — it's the live chat path), mira-cmms **F**, mira-web **D**, mira-crawler **D+**. Meanwhile bench code has 200+ tests. Confidence is concentrated where customers aren't.

---

## 4. Unfinished work found (feeding the issues)

From `docs/known-issues.md`: zip-bomb/OOM in contextualization import (A13-1, fix branch `fix/ctx-zipbomb-cap` ready), publish-gate test missing (B12-1, branch ready), ctx signals show wrong approval state (C12-1, branch ready, needs staging gate), demo PLC poller uses wrong `live_signal_cache` schema, default deploy TARGETS excludes mira-web, DOPPLER_TOKEN drift.

From `.planning/STATE.md`: interlock flywheel ~6 of 7 checklist items open (`plc_permissive_extract.py` in progress, engine wiring not done).

From the 90-day MVP plan (window closes **2026-07-19, 15 days**): Units 3 (magic inbox), 5 (UNS asset model), 7 (QR pre-load), 8 (Atlas sync hardening) never started; Units 2 (citation metadata transport) and 9a (landing Lighthouse/Stripe verify) still partial. The plan needs a rescope decision, not silence.

---

## 5. Recommended order of attack

1. Merge the three ready fix branches (zip-bomb first — it's a security hole in a customer-facing upload).
2. One identity: pick Hub (NextAuth) as the account of record; make mira-web hand off a session to it; disable Open WebUI public signup and auto-provision OWUI accounts from the tenant. (Issue #2 below.)
3. One commercial boundary: tenant/plan check in `shared/engine.py` entry (one place, every surface inherits it). (Issue #1.)
4. Make Stripe provisioning transactional with retry. (Issue #3.)
5. Declare module status: add a `MODULES.md` manifest + archive/delete the orphans the way mira-hud was archived. Delete `mira_copy` and root clutter outright. (Issues #7, #15.)
6. Bootstrap tests on mira-pipeline (the live path) before adding any new feature there.
7. Decide the 90-day plan endgame this week — rescope units 3/5/7/8 or cut them.

---

## 6. GitHub issues

18 issues drafted in `2026-07-04-create-issues.sh` (same folder). Run:

```bash
cd ~/MIRA && bash docs/audits/2026-07-04-create-issues.sh
```

Requires `gh auth status` to pass. Every issue is labeled `needs-triage` plus a priority label; the script creates missing labels first.
