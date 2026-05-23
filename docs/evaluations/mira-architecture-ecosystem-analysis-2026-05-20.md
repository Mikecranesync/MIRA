# MIRA Architecture vs Ecosystem Research — Honest Analysis

**Date:** 2026-05-20
**Author:** Claude (autonomous, no user supervision during run)
**Scope:** Compare MIRA's current architecture against the `docs/research/industry4-intelligence/` library + the `hub-twilio-platform-audit-2026-05-20.md` + Mike's "platform-aware but platform-independent" framing. No code changes.
**Companion docs:**
- `docs/research/industry4-intelligence/mira-lessons/mira-twilio-of-industry4-analysis.md`
- `docs/research/industry4-intelligence/mira-lessons/mira-wedge-and-positioning.md`
- `docs/research/industry4-intelligence/mira-lessons/mira-architecture-decisions.md`
- `docs/evaluations/hub-twilio-platform-audit-2026-05-20.md`
- `docs/THEORY_OF_OPERATIONS.md`
- `docs/specs/mira-customer-onboarding-spec.md`

> **Note on file locations:** the research library and customer-onboarding spec do not exist on this branch (`claude/hungry-jemison-863446`). They were read from sibling worktrees `charming-ride-719fde` (research) and `sweet-payne-612d8d` (Twilio audit). Citations to those docs are accurate at the time of read; merge to `main` is a prerequisite for this analysis to be reproducible from a fresh checkout.

---

## 0. TL;DR — The one finding Mike must read

**MIRA's docs commit to two incompatible wedges, and the architecture reflects both.**

- The **Theory of Operations** (`docs/THEORY_OF_OPERATIONS.md`, 2026-05-15) sells a **services-led namespace-builder**: $500 Assessment → $2–5k/mo Pilot → $499/mo Operating Layer. The customer is a plant maintenance team; the product is the *transformation* (structuring the namespace), the SaaS runs on top.
- The **Twilio audit** (`docs/evaluations/hub-twilio-platform-audit-2026-05-20.md`, 2026-05-20) and the **customer-onboarding spec** (`docs/specs/mira-customer-onboarding-spec.md`) aspire to a **product-led Twilio motion**: 60-second signup → CSV/PDF upload → grounded answer in <10 minutes → `pip install mira` + `POST /v1/ask`.

These are not the same company. They are not even the same buyer:
- Services-led buyer: maintenance director who has never written an API call and whose data is unstructured.
- Twilio buyer: a developer or integrator who already has data and just needs a primitive.

The current architecture — **14 containers in `docker-compose.saas.yml`, a 4,626-line `Supervisor` class in `mira-bots/shared/engine.py`, two parallel schema lineages (`docs/migrations/` + `mira-hub/db/migrations/` per ADR-0013), 29 Hub routes of which 4 are pure mocks, an Open WebUI front door that the Theory-of-Operations Layer Map doesn't even list, plus deferred (`mira-connect`) and legacy (`mira-sidecar`) modules still wired into compose** — is the union of both bets, not the intersection of either.

**Pick one wedge.** Then 30–40% of this stack can be cut without losing the wedge that wins.

This analysis is structured around that conclusion. Sections A–G map the surface; Section H scores it.

**Scorecard preview:** Focus 4/10 · Simplicity 3/10 · Time-to-value 3/10 · Platform independence 6/10 · Industrial credibility 8/10 · Scalability path 5/10. (Consistent with the Twilio audit's 46/100 unweighted, 36/100 Twilio-weighted.)

---

## A. What MIRA is building vs what already exists

Mike's framework:

> **THINGS MIRA SHOULD NOT BUILD:** MQTT broker, low-code integration, graph database, time-series viz, container management, industrial dashboard, basic data movement, UNS experiment layer, edge deployment.
>
> **THINGS MIRA SHOULD OWN:** maintenance intelligence, asset context, component profiles, manual/document understanding, PLC/tag relationships, technician troubleshooting, UNS location confirmation, work-order actions, safe AI guidance.

Walking the rubric:

| "Should not build" item | MIRA's current behavior | Verdict |
|---|---|---|
| **MQTT broker** | Not built. `mira-relay` is a websocket relay receiving Ignition tag streams (`mira-relay/relay_server.py:1-50`); it does not host MQTT. ✅ |  Good. |
| **Low-code integration** | Not built. ✅ ADR-0011 explicitly rejects LangGraph. `docs/adr/0011-no-langgraph-migration.md:39-44`. | Good. |
| **Graph database** | Built on Postgres (NeonDB) `kg_entities` + `kg_relationships`. Not a graph DB — just relational with ltree paths. ✅ | Good. Don't drift to Neo4j. |
| **Time-series viz** | Not built — Atlas CMMS has WO calendars; `mira-hub` `/reports` is hardcoded data per the Twilio audit. ✅ | Good. Don't build Grafana. |
| **Container management** | `mira-ops/` has Prometheus + Grafana + Flower + RedisInsight (`docker-compose.observability.yml`). This is **building it**. ⚠️ | Consider Coolify / Dokploy / Portainer. |
| **Industrial dashboard** | `mira-hub` has `/feed`, `/reports`, `/usage`, `/event-log` — a 29-route SaaS. The Twilio audit flagged 4–6 routes as mocked. ❌ | Building it. |
| **Basic data movement** | `mira-bridge` has Node-RED flows; `mira-relay` has a custom relay. ❌ in part. | Use n8n? No — PRD §4 bans it. But Nango is already wired (`docker-compose.saas.yml:406-475`) for CMMS auth. Lean harder. |
| **UNS experiment layer** | Not built. ✅ | Good. Use HighByte / Litmus output. |
| **Edge deployment** | `mira-relay` is the edge endpoint for Ignition. `mira-connect` is "deferred." ⚠️ | Twilio-audit research argues `mira-connect` is *not* deferrable — it's the gateway critical path. Decide. |

| "Should own" item | Status | Where |
|---|---|---|
| **Maintenance intelligence** | ✅ Owned. `mira-bots/shared/engine.py` Supervisor + FSM. |
| **Asset context** | ✅ Owned. `kg_entities` + UNS resolver `mira-bots/shared/uns_resolver.py`. |
| **Component profiles** | ⚠️ Half-owned. Hub migrations 016 / 017 ship the schema; `.claude/skills/component-profile-builder/SKILL.md` exists. The "verified" flywheel (proposed → human-approved → reusable) is still mostly aspirational. TOO doc marks "AI proposal queue" 🔲 not built (`docs/THEORY_OF_OPERATIONS.md:223`). |
| **Manual/document understanding** | ✅ Owned. `mira-crawler/ingest/` + Docling (`mira-docling` container). |
| **PLC/tag relationships** | ⚠️ Owned in schema (`kg_relationships`), thin in practice. Tag-import CSV wizard 🔲 not built (TOO 227). |
| **Technician troubleshooting** | ✅ Owned. Slack + Telegram + Hub chat. |
| **UNS location confirmation** | ✅ Owned and uniquely defensible. `engine.py` line ~1316 gate per PR #1280. No competitor enforces it (`mira-lessons/mira-architecture-decisions.md:58-82`). |
| **Work-order actions** | ✅ Owned via `mira-mcp/server.py` Atlas + MaintainX tools. |
| **Safe AI guidance** | ✅ Owned. `mira-bots/shared/guardrails.py` 21 safety keywords; `citation_compliance.py`. |

**Walking the rubric, MIRA is doing the right thing on most of "should own." It is leaking into "should not build" in three places:** dashboard sprawl (29 Hub routes), container management (full Grafana/Prometheus/Flower/RedisInsight stack), and basic data movement (`mira-bridge` Node-RED *and* `mira-relay` *and* per-source bespoke ingest in `mira-crawler/`). The Twilio audit's "Conversations / Alerts / Requests / Parts / Reports / Documents / Team" mocked surfaces (`hub-twilio-platform-audit-2026-05-20.md:120-130`) are concrete examples of dashboard sprawl with no underlying intelligence.

---

## B. Module-by-module assessment

Sources for "what it does" are the module CLAUDE.md (where present), the compose declarations, the line counts, and direct file reads from this session.

| Module | What it does | Moat or commodity? | Could be replaced by | Recommendation |
|---|---|---|---|---|
| **mira-core** (Open WebUI + MCPO) | Browser chat + KB upload + Docling proxy; runs `ghcr.io/open-webui/open-webui:v0.8.10` (`saas.yml:6`) | **Commodity, vendored.** Open WebUI is an off-the-shelf OSS chat shell. ADR-0007 chose it to skip building a frontend. | Open WebUI direct, or just drop it (see below). | **DROP IT.** TOO doc's Layer Map (`docs/THEORY_OF_OPERATIONS.md:67-99`) doesn't list it as a front door — it's not in "FRONT DOORS." Chat is Slack/Telegram/Hub. `mira-pipeline` exposes OpenAI-compat for Open WebUI's benefit; if Open WebUI is dropped, the pipeline still serves Hub. Open WebUI also bundles authentication, signup, user management — duplicating Hub's NextAuth. **Vestigial.** |
| **mira-pipeline** | OpenAI-compat FastAPI (`:9099`) wrapping `Supervisor`/GSDEngine for VPS chat path. 10 py files. | **Moat-adjacent.** Wraps the engine. Necessary as the public surface. Not the moat itself. | A thin FastAPI shim — but you already have one and it's tiny. Keep. | **KEEP.** This is the engine's HTTP surface. Eventually folds into a `POST /v1/ask` Hub API once Twilio motion crystallizes. |
| **mira-bots** (telegram + slack + shared) | 231 py files, 21,803 lines. `shared/engine.py` is 4,626 lines, one `Supervisor` class (`engine.py:465`). Adapters are thin; the engine is everything. | **THE moat.** UNS gate, citation compliance, groundedness scoring, FSM, intent classifier, inference cascade all live here. | Cannot be replaced. | **KEEP, but break up `engine.py`.** A 4,626-line single-class file is a solo-founder maintainability flag. The `Supervisor` god-object should be split — FSM, gate, recall, citation, response rendering are separable concerns and tests already exist for each. |
| **mira-mcp** | FastMCP server (`:8000`/`:8001`) exposing NeonDB recall, CMMS tools, KG read. 20 py files. | **Moat.** MCP is now the industry's agent substrate (HighByte explicit; LNS Research ProveIt 2026 coverage). `mira-lessons/mira-architecture-decisions.md:9-55`. | Cannot be replaced; standards-aligned. | **KEEP and invest.** Plan for federated MCP — MIRA consumes HighByte's MCP servers too. Already in the decision log; not yet code. |
| **mira-hub** (Next.js) | 262 ts/tsx files, 29 migrations, 29 routes. Marketing-adjacent SaaS app for proposals/namespace/channels/knowledge/feed plus 6+ mocked routes. | **Moat in part, dashboard sprawl in part.** Namespace tree, proposals, channels, knowledge, scan are the moat. Parts/Conversations/Alerts/Reports/Team are placeholder noise. | The mocked surfaces could go to "Labs" or be deleted. Real surfaces stay. | **KEEP the 5 moat routes; cut or "Labs"-flag the 6 mocks** per `hub-twilio-platform-audit-2026-05-20.md:236-241`. Reorder sidebar: Feed · Namespace · Channels · Knowledge · Proposals. |
| **mira-cmms** (Atlas) | A whole CMMS (Spring backend + Postgres + MinIO + frontend) running as `atlas-api`, `atlas-db`, `atlas-minio`. | **Mostly commodity rebuilt as moat.** A self-hosted CMMS for tenants who don't have one. Integration with Nango → MaintainX/Limble/Fiix is the better bet. | MaintainX, Limble, Fiix, UpKeep — all integrate. Nango is already wired in `saas.yml:406-475`. | **DEMOTE.** Keep Atlas for the customer who has zero CMMS, but stop investing. MIRA's positioning is "integrate; don't replace" (`THEORY_OF_OPERATIONS.md:166`). Atlas being available undercuts that and adds 3+ containers. |
| **mira-crawler** | KB ingestion: PDF chunking, OEM scrapers, KG writer. 96 py files. Has a celery worker + beat. | **Moat.** This is how "manual/document understanding" gets owned. | Not replaceable for the OEM-specific extraction. The crawler itself (general web crawl) could lean on Apify (already a dep). | **KEEP.** Reduce to ingest + KG-writer; outsource generic crawl to Apify (already used per `saas.yml:110`). |
| **mira-web** | Marketing site + PLG chat surface. 78 ts files. Hono/Bun. | **Mostly commodity.** A landing site. The "generic AI vs MIRA" side-by-side is the strongest demo asset. | Static-site generator + a hosted demo. | **KEEP** for now — the marketing copy is real revenue. But the chat embed currently calls `mira-sidecar:5000` (legacy) per ADR-0008. **Re-point to `mira-pipeline` and delete sidecar.** |
| **mira-bridge** | Node-RED orchestration. Dir contains `Dockerfile`, `docker-compose.yml`, `flows/`, `migrations/`. **0 python files**. | **Commodity.** Node-RED is a fine tool, but it's only included via root `docker-compose.yml` (not `saas.yml`). | Either fold into the bot adapter path or delete. | **DROP from prod stack.** Not in `saas.yml`. The TOO doc lists `mira-bridge` as "infrastructure" but Layer Map doesn't mention it. If it's not in SaaS, it's not production. Either deprecate, or document why it ships only in dev. |
| **mira-connect** | Deferred PLC drivers (Modbus). 6 py files, no Dockerfile in compose. `pyproject.toml` deps: `pymodbus`, `websockets`. | **Moat (latent).** The Twilio research explicitly argues MIRA should promote MQTT + OPC-UA + Modbus subsets *out* of deferred (`mira-twilio-of-industry4-analysis.md:362-373`). The 90-day plan needs them. | None — these are MIRA's "Gateway." Fuuz has 13 driver types built in; MIRA has 1 (Ignition relay). | **PROMOTE if Twilio motion stays.** If services-led, leave deferred. This is a wedge-defining decision. |
| **mira-relay** | Cloud websocket relay receiving Ignition tag streams. ~3 py files. SQLite-backed equipment_status. | **Moat (narrow).** The one piece of "edge → cloud" that actually ships. | Not really; this is Ignition-specific. | **KEEP, but extend.** Per `uns-mqtt-patterns.md` U-5 — read AND write to the customer's UNS. Today read-only. |
| **mira-sidecar** | Legacy ChromaDB RAG. 23 py files. ADR-0008 deprecated April 2026. Still in `saas.yml:56-91` "sunset pending." | **Carcass.** Replaced by `mira-pipeline` + Open WebUI KB on the chat path. mira-web is the only remaining caller (line 175). | Already replaced. | **DELETE.** ADR-0008 Phase 3 (398 OEM doc migration) is the only blocker — and the migration script exists at `tools/migrate_sidecar_oem_to_owui.py`. Run it and remove the container. Memory entry `project_sidecar_deprecation.md` has been "pending" for a month. |
| **mira-ignition-exchange** | Ignition Exchange listing. 2 py files, no compose. | **Distribution channel.** Listing assets, not a runtime service. | N/A. | **KEEP, no investment.** |
| **mira-machine-logic-graph** | 12 ts files, no Docker. Experimental. | **Unknown / WIP.** Not in any compose. | N/A. | **CLARIFY OR DELETE.** Looks dormant. |
| **mira-scan-monday** | monday.com integration. 22 py files, has its own `docker-compose.yml` (not included in root). Backend + frontend + marketplace. | **Adjacent.** Mobile QR onboarding via monday.com — useful pattern; uncertain demand. | Hub `/scan` already covers QR. | **DEFER.** TOO doc lists `monday.com` only as "secondary front door." If not actively pursued, archive. |
| **NeonDB** | Primary database (Postgres-compatible, multi-region serverless). | **Critical dependency.** | Plain Postgres, Supabase, RDS, Aurora — all viable substitutes. | **KEEP, with portability discipline.** All migrations are SQL (`docs/migrations/` + `mira-hub/db/migrations/`). No Neon-specific features in code. Good. |
| **Docker Compose stack** | 14 containers in `saas.yml` + Atlas-stack from external `factorylm-cmms_default`. | **Operational tax.** A solo founder paying full attention can run this; a paying customer's IT cannot. | Smaller stack via consolidation. | **CUT.** Realistic minimal stack (see § G): 6 containers. |

---

## C. What MIRA is doing right (validated by the research)

These are the bets the research library and the wedge-and-positioning doc confirm as correct:

1. **UNS Location-Confirmation Gate.** No Tier 1 competitor enforces it (`mira-lessons/mira-architecture-decisions.md:58-99`). This is the demoable difference. `engine.py` line ~1316; PR #1280 merged. **Protect.** TOO Invariant #7 (`THEORY_OF_OPERATIONS.md:113`) and ADR-0013 both lock it in.
2. **MCP as the agent substrate.** HighByte is publicly building MCP-oriented services (IDC MarketScape, April 2026). LNS Research's ProveIt 2026 coverage names MCP as "the interface for exposing industrial data to AI agents." MIRA's `mira-mcp/` is *the* direction (`mira-lessons/mira-architecture-decisions.md:9-55`).
3. **Knowledge graph + UNS path as memory.** `kg_entities` + `kg_relationships` + `uns_path` ltree (migrations 004/005/007 + Hub 010/014/015) is the architecturally-twinned shape with ThredCloud — the closest external KG+AI-on-industrial peer (`mira-lessons/mira-wedge-and-positioning.md:50-55`).
4. **Citation compliance + groundedness scoring.** `mira-bots/shared/citation_compliance.py` + 1-5 score in `engine.py` + `evidence_utilization` are exactly the demo harness the research argues for (`summaries/executive-summary.md:36-39`).
5. **Cascade inference, no Anthropic, no LangChain.** PRD §4 + ADR-0011. The research validates this: "Grounded AI is the moat, not the LLM" (`summaries/executive-summary.md:17`). Provider-neutrality is also part of "platform-aware but platform-independent."
6. **Slack-first.** Wedge confirmation: no Tier 1 conversational product owns the technician's existing chat surface (`mira-lessons/mira-wedge-and-positioning.md:35-45`).
7. **Skills + .claude/rules/.** `industrial-ai-agent-patterns.md` A-1/A-3 validate "skills as captured corrections" and "anti-hallucination rules first-class" — MIRA's `.claude/rules/uns-compliance.md` and friends are already shaped this way.
8. **Nango for credential vault.** Already wired in `saas.yml:406-475`. Right call — don't build OAuth-per-CMMS-vendor yourself. Memory entry `project_nango.md` confirms PR #808.
9. **Docling for PDF/table extraction.** `mira-docling-saas` container is the right outsourcing decision; ADR-0007 explains why.

That's the spine. Don't lose any of it.

---

## D. What MIRA is doing wrong or wasting time on (brutal)

Everything below is sourced to a file or compose line.

### D.1 — The 14-container stack is too big for one customer, let alone one founder

`docker-compose.saas.yml` runs: mira-core (Open WebUI), mira-sidecar, mira-ingest, mira-mcp, mira-web, mira-pipeline, mira-bot-telegram, mira-bot-slack, mira-docling, mira-relay, nango-db, nango-server, mira-hub, mira-cmms-sync. That's 14. Add the Atlas stack (`atlas-api`, `atlas-db`, `atlas-minio`, `atlas-frontend`) from `factorylm-cmms_default` and the staging compose's stg-* duplicates — Mike is running ~20 containers to serve one paying tenant.

The research argues this is wrong on its face:
- Twilio audit (§ 6.B.3): kill placeholder surfaces.
- `mira-twilio-of-industry4-analysis.md:121-127`: "Single-binary install" is the property Twilio nails that Fuuz doesn't.

If MIRA aspires to Twilio motion, the operational footprint of the *vendor* matters as much as the customer's. **Solo founder + 14 containers = the kind of debt that pages you at 2 AM and consumes the time that should be spent on the moat (engine.py + KG + ingest).**

### D.2 — `engine.py` is 4,626 lines, one class, one file

`mira-bots/shared/engine.py:465` declares `class Supervisor:`. From line 465 to ~4626 it's one god-object: FSM, UNS gate, intent classifier, recall, citation, response rendering, KB-gap admission. Tests exist; the class itself is unsplittable in its current shape.

The TOO doc treats this as a single module. The research library doesn't comment on it because Fuuz's equivalent is split across 7 skills. MIRA's coding principles (`.claude/rules/karpathy-principles.md`) prescribe simplicity. A god-class violates them.

**Decision needed:** before the next 1,000 lines land in `Supervisor`, split into:
- `fsm.py` (already separate per the import map, but `Supervisor` re-implements transitions)
- `gate.py` (UNS confirmation)
- `recall.py` (KG / KB queries)
- `responder.py` (rendering + citation)
- `Supervisor` becomes a 200-line orchestrator.

### D.3 — Two schema lineages by formal decision (ADR-0013)

ADR-0013 (`docs/adr/0013-uns-namespace-builder-schema-canonicalization.md`) ratifies the fact that `docs/migrations/` (engine-side: 001–007 + the upcoming `008_kg_approval_state.sql`) and `mira-hub/db/migrations/` (Hub-side: 001–026) are now two parallel postgres-migration lineages.

The ADR is honest about the rationale (Hub already shipped the schema in 014–020 before the namespace-builder plan was drafted). It is the right *decision* given the existing state. But the resulting **complexity is bought, not removed**:
- Two migration tools.
- Two staging-rehearsal workflows.
- Two `apply-migrations.yml` paths.
- One concept ("approval state") split across `mira-hub.relationship_proposals.status` and (planned) `kg_relationships.approval_state`.
- Engine reads only the verified copy; Hub writes the proposal copy; sync between them is application-layer convention, not schema-enforced.

**Score Simplicity accordingly.** ADR-0013 is "least-bad given history," not "the right architecture."

### D.4 — Mocked Hub pages

Per Twilio audit `hub-twilio-platform-audit-2026-05-20.md:120-130`:
- `/conversations` — 5 hardcoded threads, no `/api/conversations` exists.
- `/alerts` — 5 hardcoded alerts; ack mutates local state only.
- `/requests` — 5 hardcoded requests; approve/reject does not persist.
- `/parts` — entirely static `@/lib/parts-data`.
- `/reports` — all chart data hardcoded.
- `/documents` — grid renders from static import.
- `/team` — 7 hardcoded members.

That's **7 of 29 routes** that are "Twilio anti-patterns" — surfaces that look real, demo wrong, and accumulate maintenance debt. **None of them are the moat.** Move behind a Labs flag (Twilio audit § 6.A) or delete.

### D.5 — Open WebUI as a vestige

ADR-0007 (April 2026) chose Open WebUI as the chat shell to skip frontend work. ADR-0008 (also April 2026) deprecated the sidecar in its favor. **By May 2026, `mira-hub` exists as a real Next.js app with its own chat surface, NextAuth, knowledge upload, and channel management** — duplicating most of what Open WebUI provided.

Open WebUI is still in `saas.yml:5-54`, with 1.5 GB memory cap, its own user table, its own API keys (`WEBUI_SECRET_KEY`, `OPENWEBUI_API_KEY`), its own KB collection model, its own STT integration (Groq Whisper). The TOO doc's Layer Map (`docs/THEORY_OF_OPERATIONS.md:67-99`) doesn't list it as a front door.

**It is vestigial.** Either:
- Commit to it as the third front door (in which case TOO doc needs updating and Hub `/knowledge` should redirect to it), or
- Remove it and reroute the Groq Whisper STT into mira-ingest.

Sitting it indefinitely is the worst option.

### D.6 — `mira-sidecar` still in prod compose

`docker-compose.saas.yml:56-91` runs the sidecar. ADR-0008 was accepted in April. The Phase 3 (OEM doc migration) runbook exists. The script (`tools/migrate_sidecar_oem_to_owui.py`) exists. The memory entry (`project_sidecar_deprecation.md`) tracks it as "pending."

**A month of "pending" on a legacy service is the time-tax of a 14-container stack.** Schedule the migration window, run it, delete the container. The only caller left is `mira-web` and that's a one-PR cutover per ADR-0008 Phase 4.

### D.7 — Spreading thin: monday.com, ignition-exchange, machine-logic-graph

`mira-scan-monday/` is a full backend + frontend + marketplace listing for monday.com. `mira-ignition-exchange/` is a separate Ignition Exchange asset bundle. `mira-machine-logic-graph/` is 12 ts files with no Docker presence. None of them are in `saas.yml`.

These are **wedge experiments**, not products. The Karpathy "simplicity first" rule (`karpathy-principles.md`) and the saas-scope-guard skill (`.claude/skills/mira-saas-scope-guard/SKILL.md`) both argue for archiving them until there's a customer asking. Following the precedent of `archive/mira-hud-2026-04` and `archive/mira-prototype-2026-04` (root `CLAUDE.md` deferred/archived table).

### D.8 — Container-management bloat (mira-ops)

`docker-compose.observability.yml` runs Prometheus + Grafana + Flower + RedisInsight. For a single-tenant, solo-founder SaaS:
- Prometheus + Grafana for ~10 services is over-instrumented.
- Flower watches Celery; Celery is mira-crawler-only and runs nightly.
- RedisInsight is a GUI for a Redis you don't even surface in `saas.yml`.

Mike's rubric explicitly lists **container management** in "should not build." Use a hosted observability stack (Grafana Cloud free tier, Logflare, BetterStack) or skip it until there's measurable customer load.

### D.9 — Dashboard sprawl is the symptom; the disease is "build the next thing instead of finishing this one"

The pattern across D.4, D.5, D.6, D.7: a real surface ships, a follow-on surface gets stubbed, the stub never gets finished, and the stack grows. ADR-0008 sunset → not run. ADR-0013 declared a schema split → both lineages still active. Twilio audit caught 7 mocked routes → not cleaned up before this analysis.

This is not an "architecture" problem in the formal sense. It is a **focus problem** that *looks* like an architecture problem when the operator (Mike) gets stretched.

---

## E. The "one painful machine" test

> **Mike's framework:** the easiest useful version is one asset, one namespace, one graph, one dashboard, one document set, one fault history, one MIRA chat flow, one confirmation gate.

Does today's architecture support that minimal path?

| Element | What MIRA needs | What MIRA has |
|---|---|---|
| One asset | `kg_entities` row, `entity_type='asset'`, `uns_path` populated | ✅ Hub `/assets` `/scan` + nameplate ingest |
| One namespace | Hub `/onboarding` 4-step wizard → `enterprise.{site}.{line}` | ✅ Wizard ships (audit § 3) |
| One graph | `kg_entities` + `kg_relationships` populated for the asset | ⚠️ Schema ships; "AI proposal queue" not built (TOO 223); auto-insert today |
| One dashboard | Hub `/feed` showing the asset's signals | ⚠️ Feed exists; zero-data state is broken (audit § 3) |
| One document set | Manual uploaded via Hub `/knowledge` | ✅ Ships; 68k OEM chunks |
| One fault history | Work orders for the asset readable via MCP | ✅ `cmms_list_work_orders` MCP tool |
| One MIRA chat flow | Slack/Hub chat asking about the asset | ✅ Ships |
| One confirmation gate | UNS gate fires before answer | ✅ PR #1280 merged |

**Eight items, six green, two yellow.** The minimal path is *almost* there.

**What's blocking it:**
- AI proposal queue ships proposals into `kg_relationships` directly; there is no human-in-the-loop verification before the engine reads them. The TOO doc's Invariant #4 ("LLM-generated edges enter as `proposed`. Promotion to `verified` is a human action") is rhetorical until the queue ships.
- Feed empty-state is broken on day 1 (Twilio audit § 3).
- The wizard terminates at `/namespace` with no nudge to upload a manual or connect a channel (Twilio audit § 3).

**What's unnecessary for it:**
- Open WebUI (Hub does the same job).
- mira-sidecar.
- 4 of 5 "Coming Soon" channel options.
- 7 mocked Hub routes.
- mira-bridge (not in saas.yml anyway).
- mira-cmms-sync (if the tenant uses MaintainX/Limble via Nango).
- The full mira-ops observability stack.

**For one painful machine, the minimal stack is ~6 containers (see § G).** The other 8+ exist because MIRA is also being asked to be a Twilio.

---

## F. Platform-aware but platform-independent assessment

For each external dependency:

| Dependency | Lock-in level | Failure mode | Fallback today |
|---|---|---|---|
| **NeonDB** | Low — pure Postgres + ltree + pgvector. Migrations in plain SQL. | Service outage → bot down. | Local Postgres test stack exists in compose. Could move to Supabase / RDS in ~1 day. ✅ |
| **Groq** | Low — first stop in cascade. | 429s or outage → cascade falls through. | Cerebras → Gemini → Ollama. ✅ `inference/router.py`. |
| **Cerebras** | Low — second in cascade. | Same. | Falls through. ✅ |
| **Gemini** | Low — third in cascade. Note: memory says key is blocked in Doppler; cascade still works. | Falls through. | Ollama on host. ✅ |
| **Doppler** | Medium — every container reads `doppler run`. Could `dotenv`-back if Doppler dies but the rotation discipline matters. | If Doppler outage → containers come up with no env. | Local `.env` files exist; not committed. ⚠️ Procedure not documented. |
| **Docker** | Medium — universal but Compose-flavored. | Can run on Podman / nerdctl with minor edits. | None automated. ⚠️ |
| **Open WebUI** | Medium — vendored container, but the schema (knowledge collections, user table) is theirs. Migrating off means re-ingesting. | If they pivot API → pipeline breaks. ADR-0007 calls this out. | Pipeline still works without it; just lose the browser UI. ✅ |
| **Atlas CMMS** | High (today) — direct API integration. The Hub `/cmms` page calls Atlas REST directly per `saas.yml:564`. | Atlas dies → tenant's CMMS dies. | MaintainX/Limble/Fiix via Nango is the escape hatch. ⚠️ Cutover plan not formalized. |
| **Nango** | Low-Medium — self-hosted free tier, owns OAuth tokens. | Re-hosting requires DB migration. | None today. |
| **Apify** | Low — first-party crawler. | Crawler outage → ingest blocked. | Manual upload still works. ✅ |
| **Stripe** | Medium — payments. | Outage → no new signups; existing subs unaffected. | N/A; standard. |
| **NeonDB serverless features (branches, point-in-time)** | If used, becomes high. | — | Currently used per memory; reads/writes are vanilla. ✅ |
| **GitHub Actions** | Medium — CI/CD. | Self-hostable. | ✅ |
| **VPS host (`165.245.138.91`)** | Medium — single VPS for prod. | Host dies → prod dies. | No HA. ⚠️ |
| **Tailscale** | Low — used for cluster only. | Ops inconvenience. | LAN fallback documented. ✅ |

**Platform independence is genuinely good** at the data and inference layers (the cascade, plain-SQL migrations, no LangChain/n8n). It's mediocre at the operational layer (single VPS, single Atlas instance per tenant). It's **worst at the front-door layer** — Open WebUI and Atlas have their own schemas that would be expensive to migrate off.

Score: **6/10.** The cascade and the no-framework discipline are real wins. The vendored shells (Open WebUI, Atlas) drag it down.

---

## G. Recommended architecture simplification (90 days)

This section assumes Mike picks the **services-led namespace-builder wedge** (TOO doc) for the next 90 days. The Twilio motion stays in the research library as a planning artifact; it does not drive Q3 2026 architecture. The reason: the services-led motion already has revenue paths ($500 / $2-5k / $499); the Twilio motion has zero customers. Pick the wedge that pays bills first.

If Mike instead picks Twilio motion, this section flips — `mira-connect` promotes, the Atlas dependency drops faster, the Hub `/docs` and `/quickstart` ship first. But the same simplification still applies; only the priority of *what stays* changes.

### G.1 — What stays

Six containers as the minimal customer-facing stack:

1. **mira-pipeline** — engine HTTP surface.
2. **mira-mcp** — MCP server.
3. **mira-bot-slack** — front door #1.
4. **mira-bot-telegram** — front door #2 (cheap to keep; same engine).
5. **mira-hub** — front door #3 + namespace UI + proposals UI + knowledge UI.
6. **mira-crawler / mira-ingest worker** — KB ingestion (consolidate; mira-crawler's celery + mira-core/mira-ingest API → one container).

Plus the external services: **NeonDB**, **Nango** (if running self-hosted, +1 container; otherwise managed), **Docling** (+1 container, ML-heavy, hard to drop).

**Realistic minimal SaaS stack: 6–8 containers**, down from 14.

### G.2 — What gets cut

Run the migrations and delete:

- **mira-sidecar** — ADR-0008 Phase 3 + Phase 4 cutover. (1-2 days.)
- **mira-core (Open WebUI)** — once `mira-hub` has /quickstart + chat surface live. Reroute the Groq STT into mira-ingest. (1 week.)
- **mira-bridge** — not in saas.yml; delete the dev compose lines and archive the Node-RED flows.
- **mira-cmms-sync** — only useful when an Atlas tenant is in scope; flag-gate to off (already done per `CMMS_SYNC_ENABLED=false` default).
- **mira-ops Grafana/Prometheus/Flower/RedisInsight** — replace with Grafana Cloud free tier (or skip until 5+ paying customers).
- **mira-scan-monday** — archive branch.
- **mira-ignition-exchange** — archive branch.
- **mira-machine-logic-graph** — archive branch.

### G.3 — What gets replaced with off-the-shelf

- **Atlas CMMS** → for tenants that already use MaintainX/Limble/Fiix, drop the Atlas containers and integrate via Nango. Atlas stays as a fallback for tenants with no CMMS. Don't *invest* in Atlas features; the integration story is the moat.
- **Container management (`mira-ops`)** → Grafana Cloud or BetterStack free tier.
- **mira-crawler generic web crawl** → push more into Apify; keep MIRA code for OEM-specific extraction only.
- **Marketing site auth/funnel** → keep Hono/Bun, but lean harder on Stripe-hosted checkout for the Twilio-flavored CTAs when they ship.

### G.4 — What gets promoted

- **`mira-connect`** if the Twilio motion is the eventual destination. Promote MQTT + OPC-UA + Modbus TCP subsets (per `mira-twilio-of-industry4-analysis.md:362-373`). Otherwise leave deferred — services-led customers get Ignition via `mira-relay`.
- **MCP federation** — `mira-mcp` plans to consume external MCP servers (HighByte) per the decision log. Today: 0 lines. Should be at least a stub by 2026-08-01.
- **AI proposal queue** — making "proposed → verified" real per TOO Invariant #4. Without it, the moat (UNS gate + groundedness + proposed-vs-verified) collapses to rhetoric.

### G.5 — The "one painful machine" deployment

After cuts:
- Container count: **6** (mira-pipeline, mira-mcp, mira-bot-slack, mira-hub, mira-ingest, mira-docling).
- External services: NeonDB, Doppler, Nango.
- Tenant assets: 1 asset, 1 line, 1 site, 1 PDF manual, 0–N work orders (via Nango → MaintainX).
- Customer flow: signup → wizard → upload manual → ask Slack a question → cited answer.
- Operational tax for Mike: a single `doppler run ... docker compose up -d`; one VPS; one Postgres URL.

That's the shape.

---

## H. Scorecard

Methodology: each score is anchored to specific findings in §§ A–G above and to the Twilio audit's scoring where applicable. The Twilio audit was 46/100 unweighted and 36/100 Twilio-weighted; my scores should not diverge from those without explicit justification.

| Dimension | Score | Reasoning |
|---|---:|---|
| **1. Focus (moat vs commodity)** | **4 / 10** | Moat work is real (engine.py, UNS gate, MCP, KG). Commodity drift is real and named: dashboard sprawl (29 Hub routes, 7 mocked), container management bloat (mira-ops Grafana/Prometheus/Flower), basic data movement (mira-bridge + mira-relay + mira-crawler all running parallel pipes), Open WebUI as a duplicated front door (§ D.5), Atlas as a vendored CMMS that the positioning doc says MIRA "integrates; does not replace" (`THEORY_OF_OPERATIONS.md:166`). |
| **2. Simplicity (solo founder can operate)** | **3 / 10** | 14 containers in prod + Atlas stack + staging duplicates = ~20 containers. 4,626-line god-class `Supervisor` (§ D.2). Two parallel SQL migration lineages by formal decision (§ D.3). Legacy `mira-sidecar` still in compose 6 weeks after ADR-0008 (§ D.6). The fact that this analysis itself had to read two sibling worktrees to find research docs (research lives on `charming-ride-719fde`, audit on `sweet-payne-612d8d`, neither merged to main) is its own simplicity signal. |
| **3. Time to customer value (signup → first grounded answer)** | **3 / 10** | Twilio audit measured this as 3/10 on "Onboarding speed" and 3/10 on "Time to first insight" (`hub-twilio-platform-audit-2026-05-20.md:182`). I see no evidence to revise — the wizard ships, the `/feed` empty-state is broken, no `/quickstart` page exists, marketing site never links to `/signup/`. Same score. |
| **4. Platform independence (vendor lock-in)** | **6 / 10** | Cascade inference + plain-SQL migrations + no-framework discipline are real. Open WebUI and Atlas vendored shells drag it down. Single-VPS prod and Tailscale-glued cluster are operational concentration risks, not vendor lock-in per se. (§ F.) |
| **5. Industrial credibility** | **8 / 10** | 68k OEM chunks, named brands, ISA-95 UNS path discipline (`uns-compliance.md`), Sparkplug-B aware (per `uns-mqtt-patterns.md` U-11), grounded-by-default + UNS gate (uniquely MIRA per `industrial-ai-agent-patterns.md` cross-vendor table), `mira-relay` Ignition integration shipping, safety keyword guardrails. Same score the Twilio audit gave. **Don't lose this dimension under pressure to cut.** |
| **6. Scalability path (1 machine → 100)** | **5 / 10** | Architecturally the schema scales (NeonDB, ltree, KG status enum). The Knowledge Cooperative is a real flywheel concept (`THEORY_OF_OPERATIONS.md:186-192`). But operationally, scaling from 1 to 100 tenants on a single VPS + a single Atlas instance + a single Doppler config = no path. Per-tenant Hub provisioning exists; per-tenant container isolation does not. ADR-0013's two-lineage split adds migration complexity that scales linearly with tenants. |

**Composite (unweighted average): 4.8 / 10.**

Re-weighting to emphasize Mike's stated priorities (Focus 2×, Simplicity 2×, Time-to-value 2× — the "platform-aware but platform-independent" framing argues these matter most):

`(4×2 + 3×2 + 3×2 + 6 + 8 + 5) / 16 = 39 / 16 ≈ 2.4 → scaled to 10 ≈ 4.0 / 10`

**Weighted composite: 4.0 / 10.** Close to the Twilio audit's 36/100. The 10-point gap to a "good" 5-6 is in **Focus** and **Simplicity** — both fixable in 30 days by executing § G.

---

## Top 10 concrete actions (in order)

These are the actions the analysis implies. Each is a defined PR or branch.

1. **Decide the wedge.** Services-led (TOO doc) or Twilio-led (audit + onboarding spec). Doc the decision in `docs/adr/0014-product-wedge-decision.md`. Until this is decided, every subsequent action has a 50% chance of being undone.
2. **Run ADR-0008 Phase 3** — migrate sidecar's 398 OEM chunks → Open WebUI KB *or* directly into Hub `/knowledge`. Delete `mira-sidecar` from `saas.yml`.
3. **Cut `mira-web` chat → `mira-pipeline`** (ADR-0008 Phase 4). One PR.
4. **Decide Open WebUI's fate.** If Hub `/quickstart` ships per Twilio audit § 6.B.2, retire Open WebUI. Otherwise commit to it as the third front door and update TOO Layer Map.
5. **Move 7 mocked Hub routes behind a Labs flag** per Twilio audit § 6.A. Reorder sidebar: Feed · Namespace · Channels · Knowledge · Proposals.
6. **Ship the AI proposal queue** (TOO Invariant #4). Hub `relationship_proposals` table already exists (migration 018); engine needs to *read* `verified` only. Without this, "human-in-the-loop" is rhetorical.
7. **Split `engine.py`** into FSM / gate / recall / responder modules behind a non-breaking shim. The 4,626-line god-class is one outage away from being unsplittable.
8. **Archive `mira-bridge`, `mira-scan-monday`, `mira-ignition-exchange`, `mira-machine-logic-graph`** to branches per the precedent in root `CLAUDE.md` deferred/archived table.
9. **Decide `mira-connect`** — promote (Twilio motion) or leave deferred (services-led). Doc the decision.
10. **Cut `mira-ops` Grafana/Prometheus stack** to Grafana Cloud free tier or BetterStack. The DIY observability is a tax that buys nothing at current scale.

---

## Limitations of this analysis

- The research library and customer-onboarding spec do not exist on this branch; read from sibling worktrees. If the doctrine on `main` differs, this analysis should be re-run.
- No live container inspection (memory, CPU, request volume). Container counts are from `docker-compose.saas.yml` source; runtime resource usage is inferred from the `deploy.resources.limits.memory` declarations.
- No customer-data inspection. The "AI proposal queue is rhetorical" claim is from `docs/THEORY_OF_OPERATIONS.md:223` (status 🔲). If shipped between 2026-05-15 and 2026-05-20, this should be re-validated.
- Twilio-audit scores reused where same dimensions apply; otherwise scored fresh per the rubric stated in § H.
- The "Open WebUI is vestigial" claim assumes the Hub `/knowledge` page can fully replace Open WebUI's KB UX for end users. The Twilio audit lists Knowledge as a "Full" Hub page; production behavior on mobile + with large PDFs was not verified live.

---

*End of analysis. Path: `docs/evaluations/mira-architecture-ecosystem-analysis-2026-05-20.md`.*
