# FactoryLM / MIRA Connect — Interoperability & Gap Report

*Decision-grade discovery + architecture synthesis. Phase 1 (7-agent read-only inventory) → Phase 2
(2-agent synthesis) → Phase 3 (this document). Docs-only; no code was changed. Every repo claim
cites a file path; unproven items are marked **Unknown**. Written to be read by a non-programmer
founder and turned into engineering issues.*

Companion docs: connector matrix (`docs/discovery/mira_connect_connector_matrix.md`), PRD outline
(`docs/product/mira_connect_prd_gap_outline.md`), build-in-public plan
(`docs/product/mira_connect_video_proof_plan.md`).

---

## 1. Executive summary

**The business is not "we build one-off integrations." The business is: FactoryLM/MIRA is the
contextualizing interconnect layer between factory data systems and maintenance outcomes.** Two
promises: (1) **connectivity** — get factory data in through a small number of universal surfaces;
(2) **maintenance value** — turn contextualized live data into accountable outcomes (cause, failure
mode, next check, work-order draft, parts, labor, cited evidence).

What the code actually shows today:

- **Connectivity is stronger than expected.** Three of the four universal surfaces are already in
  production: **REST/JSON** (`/api/v1/tags/ingest`), **MQTT/Sparkplug** (full Sparkplug B stack,
  shipped as an opt-in compose profile), and **Ignition push**. All converge on **one canonical, allowlisted, tenant-scoped
  pipeline** with a **CI-enforced one-pipeline law**. **OPC UA is the one missing surface.**
- **The contextualization wedge is mostly built (~6/10).** Propose → human-approve → cite is real:
  `relationship_proposals` + `relationship_evidence` (9 evidence types incl. `plc_rung`, `live_data`),
  an ADR-0017 state machine, no-auto-verify governance, and a DB-tested interlock flywheel.
- **The maintenance-outcome layer is the weakest (~60%) and it is the core value gap.** Detection
  (A0–A12) and a work-order draft exist, but there is **no formal Outcome object** and **no
  queryable cloud-side anomaly store** — the two things that make MIRA a maintenance-outcome engine
  rather than a chatbot over tags.
- **Security is beta-safe and enforced hard** — read-only-first, outbound-only, tenant RLS, fail-closed
  allowlist, HMAC/JWT, PII-sanitize default-on.

**Two gaps, kept separate throughout this report:**
- **The one strategic *connectivity* gap = OPC UA** (unlocks Kepware, HighByte, Siemens Edge, OPC
  Router at once).
- **The core *value* gap = the maintenance Outcome model + cloud anomaly persistence.**

**Smallest path to a serious beta:** ship **P0-3 (Context Packet) + P0-4 (Outcome model) + P0-5
(cloud anomaly persistence)** on the **already-built REST / Ignition / Sparkplug** connectivity.
**Do not block first beta on new connectors.** Add **OPC UA (P0-2)** in parallel to widen which
plants can join.

---

## 2. Corrected Phase 1 / Phase 2 inventory

*Built(prod) = shipped + tested; Built(demo) = works, demo-scoped; Mock/test = fixture-backed with a
clear real path; Plan-only = design doc, no code; Missing = no code; Partial = some of it.*

| Area | Verdict | Evidence |
|---|---|---|
| REST/JSON ingest | **Built(prod)** | `mira-relay/relay_server.py` (`/api/v1/tags/ingest`, `/ws`, `/ws/tags`), `ingest_contract.py`, `tag_ingest.py`, relay HMAC `mira-relay/auth.py` |
| MQTT/Sparkplug ingest | **Built(prod), opt-in deploy** | `mira-relay/mqtt_ingest/**`; `test_sparkplug_*`; ships as opt-in `sparkplug` compose profile in `docker-compose.saas.yml` (default deploy does not start it); plain-JSON codec planned |
| Ignition push | **Built(prod)** | `ignition/gateway-scripts/tag-stream.py`, `ignition/webdev/FactoryLM/api/tags/collector.py` |
| File / PLC-export import | **Built(prod)** | `mira-plc-parser/parsers/{rockwell_l5x,csv_tags,plcopen_xml,ignition_json,structured_text}.py`, `tag_csv.py` |
| Modbus TCP driver | **Built(prod, bench)** | `mira-connect/drivers/modbus_driver.py` (read-only, ADR-0021) |
| OPC UA | **Missing (conscious)** | ADR `docs/adr/0001-plc-protocol-choice.md`; 0 client/server code |
| Historian connector framework | **Mock/test** | `mira-connectors/{base.py,types/historian.py,mocks/pi_mock.py,factory.py}` (real providers stubbed) |
| Litmus Edge | **Built(demo)** | `plc/litmus/demo_context_model.py`, `dashboard_api.py`; egress plan `docs/integrations/litmus_supported_connector_plan.md` |
| Contextualize → approve → cite | **Built (~6/10)** | `mira-crawler/ingest/uns.py`; `relationship_proposals`/`relationship_evidence`; `proposal_transition.py` (ADR-0017); `interlock_context.py` |
| Maintenance outcome | **Partial (~60%)** | `engine.py`, `work_order.py`, `atlas_cmms.py`, `rules_core.py` A0–A12; **no Outcome object**; **cloud anomaly persistence disconnected** |
| Security | **Built (beta-safe)** | read-only-first, outbound-only, RLS, HMAC/JWT, allowlist, PII-sanitize |

### 2.1 Correction carried forward (do not regress this wording)

Earlier drafts said *"`mira_anomalies` has no writer."* **That is inaccurate.** The corrected gap is:

> **Ignition gateway-local anomaly writers exist in Jython and write to a gateway-local DB, but the
> cloud A0–A12 path computes anomalies and discards them. There is no queryable cloud-side anomaly
> store that the Supervisor / outcome layer reads.**

Evidence:
- `ignition/gateway-scripts/timer-stuck-state.py` — in-gateway Jython, `INSERT INTO mira_anomalies`.
- `ignition/gateway-scripts/tag-change-fsm-monitor.py` — in-gateway Jython FSM monitor, same local write.
- `ignition/db/schema.sql` — the **gateway-local** `mira_anomalies` schema those writers target.
- Cloud path: `plc/conv_simple_anomaly/rules_core.py` + vendored `ignition/webdev/FactoryLM/api/diagnose/`
  + the relay pipeline — computes A0–A12 but **persists nothing** to a store the cloud Supervisor reads.

---

## 3. Connector surface verdicts (the four universal surfaces)

| Surface | Verdict | Why it matters |
|---|---|---|
| **1. REST / JSON** | **Built(prod)** | Universal front door; anyone who can POST JSON is a customer. |
| **2. MQTT / Sparkplug** | **Built(prod), opt-in deploy** | The industrial-standard pipe; covers a class of plants (+ EMQX/HiveMQ/Cirrus/Node-RED as recipes). Ships as an opt-in `sparkplug` compose profile. |
| **3. OPC UA** | **Missing (conscious deferral, ADR-0001)** | The **one strategic connectivity gap**; one connector unlocks Kepware/HighByte/Siemens Edge/OPC Router. |
| **4. Historian / file** | **Partial** | File/CSV/PLC-export built; real PI/SQL/xlsx are recipes over a proven shape. |

Full 18-row platform table: `docs/discovery/mira_connect_connector_matrix.md`.

---

## 4. Current architecture

Three layers, one canonical spine.

```
  SOURCES                 INGRESS SURFACES                CANONICAL PIPELINE            STORES
  Ignition tags ─push──►  tag-stream.py ─HMAC─┐
  REST/JSON     ─POST──►  relay_server.py     │   ingest_contract.py               ┌ tag_events (mig 033)
  MQTT/Sparkplug ────►    mqtt_ingest/…       ├─► normalize_tag_path/build_*  ────► ├ live_signal_cache
  Modbus (bench) ────►    modbus_driver.py    │   tag_ingest.ingest_batch           │  (mig 020/036, diffs 037)
  PLC/file exports ──►    mira-plc-parser/…   │   + NeonTagStore                    └ approved_tags (mig 035)
  Historian (PI/SQL) ►    mira-connectors/…   │   ── one-pipeline Contract 5 ──         ▲ fail-closed allowlist
                          (mostly MOCK)       └──────────────────────────────────────────┘

  CONTEXTUALIZE→APPROVE→CITE:  uns.py → kg_entities/kg_relationships → relationship_proposals
     (+relationship_evidence, 9 types) → ai_suggestions → proposal_transition (ADR-0017)
     → /api/proposals/[id]/decide · ctx_enrichment (verified-only) · citation_compliance · interlock flywheel

  MAINTENANCE-OUTCOME:  engine.py Supervisor · ignition_chat.py · rag_worker · router
     · anomaly rules A0–A12 (rules_core.py) · work_order.py · pm_suggestions · atlas_cmms · Nango
     └─ OUTPUT: cited chat answer   (formal Outcome object: MISSING)
```

**Canonical pipeline (Built, prod).** Every transport converges on
`ingest_contract.{normalize_tag_path, build_tag_entry, build_ingest_batch}` →
`tag_ingest.ingest_batch` → `tag_events` (mig 033) + `live_signal_cache` (mig 020/036, diffs 037).
The `approved_tags` allowlist is **fail-closed** (`ignition/webdev/FactoryLM/api/tags/allowlist.py`;
mig 035; seeds). The **one-pipeline law is CI-enforced** — `tests/test_architecture.py` Contract 5
default-denies any transport that forks its own normalizer/allowlist/persistence/batch-shape
(`.claude/rules/one-pipeline-ingest.md`). `tag_diff_logger.py` groups differences into events but its
**scheduler is deferred** (verify whether it is a prerequisite for cloud anomaly persistence — §11).

**Two connector packages overlap (confirmed).**
- `mira-connect/` → **drivers** (`drivers/{base.py,modbus_driver.py}`, read-only Modbus, ADR-0021) — wire-protocol layer.
- `mira-connectors/` → **registry + recipes** (`base.py` `Connector` ~10 caps; canonical model; `types/{historian,cmms,mqtt,scada,document}.py`; `factory.py`; mocks for pi/maximo/ignition/sap/maintainx — real integrations stubbed) — product-registry layer.

Two packages, near-identical intent, no shared registry → **consolidation target (P0-1)**.

**Contextualize → approve → cite (the wedge, ~6/10).** Built: UNS builders (`uns.py`);
`kg_entities`/`kg_relationships` (migs 004/005, hub 001/018/027/029); 9 evidence types;
no-auto-verify (`MIRA_KG_INGEST_AUTOVERIFY` default off; `proposal_transition.py` +
`proposal-transition.ts` + `/api/proposals/[id]/decide/route.ts`); verified-only enrichment
(`ctx_enrichment.py`); citation compliance; interlock flywheel (`interlock_context.py`,
`tools/flywheel/`, DB round-trip test). **Missing:** contradiction-detection job,
live-data-as-evidence producer, field feedback loop.

**Maintenance-outcome (~60%).** Built: Supervisor (`engine.py`), `ignition_chat.py`, `rag_worker.py`,
`inference/router.py`; anomaly rules A0–A12 (`rules_core.py`, parity-tested); work-order draft
(`work_order.py` `UNSWorkOrder`, `pm_suggestions.py`); CMMS (`atlas_cmms.py`, `mira-mcp/cmms/atlas.py`,
`hub_neon.py`, Nango `nango-integrations/providers.yaml`). **Missing:** formal Outcome object; cloud
anomaly persistence (§2.1). `decision_trace.py` is observational only.

---

## 5. Proposed architecture

**Governing principle: a hard line between the Connectivity Layer and the Maintenance-Outcome Layer.**
Reuse ~everything; add four things — one registry, four generic surfaces, an explicit Context Packet,
and a formal Outcome object.

### 5.1 One connector registry over four generic surfaces

Collapse `mira-connect` (drivers) + `mira-connectors` (registry) into a **single registry keyed by
surface**, with **vendor recipes as thin declarative config**.

```
              ┌──────────── ONE CONNECTOR REGISTRY (home: mira-connectors/) ─────────────┐
  FOUR        │  1. REST/JSON   2. MQTT/Sparkplug   3. OPC UA (NEW)   4. Historian/File   │
  SURFACES ───┤       │              │                    │                │              │
  RECIPES  ───┤  thin declarative config: Kepware · HighByte · Litmus · PI · Siemens Edge │
  (YAML/JSON) │  · OPC Router · SiteWise · EMQX · HiveMQ · Node-RED                        │
              │       └── each recipe DECODES its wire format then calls the SAME contract │
              └───────┼──────────────────────────────────────────────────────────────────┘
                      ▼  build_tag_entry → build_ingest_batch → ingest_batch  (Contract-5 still guards this)
                      ▼  Context Packet (NEW, explicit) → tag_events / live_signal_cache
```

**Registry rules (preserve the one-pipeline law):** the registry hosts **surface adapters + vendor
recipes**; it is **not** added to the Contract-5 allowlist. Each adapter/recipe decodes wire format,
then calls `build_tag_entry` → `build_ingest_batch` → `ingest_batch` (worked-example shape:
`simlab/publishers.py::RelayIngestPublisher`). `modbus_driver.py` becomes the Modbus **surface
adapter** inside the unified registry (keeping its bench-only banner). The ~10-capability `Connector`
base becomes the registry interface; mocks remain as test doubles / demo mode.

**A new integration is either (a) a generic surface already covered, or (b) a thin recipe — never a
new core.**

### 5.2 Context Packet — the versioned boundary artifact (see §6)
### 5.3 Vendor-recipe layer — Kepware/HighByte/Litmus/PI as thin recipes

| Vendor | Generic surface | Recipe = |
|---|---|---|
| Kepware | OPC UA | endpoint + security policy + namespace→UNS map |
| HighByte | OPC UA / REST | model-schema → Context Packet field map |
| Siemens Edge / OPC Router | OPC UA | namespace map |
| Litmus | MQTT/Sparkplug (demo → supported) | topic→UNS map + auth |
| PI | Historian/File | server + tag-search + interval (reuse `pi_mock` contract) |
| SiteWise / Azure IoT Ops / EMQX / HiveMQ / Node-RED | MQTT or REST | broker/endpoint + topic map |

A recipe = surface id + Doppler credential ref + tag/namespace→UNS mapping + envelope defaults, shipped
as YAML/JSON validated by the registry.

### 5.4 Outcome engine (see §7)

---

## 6. The Context Packet boundary

Today a normalized "tag entry" is produced by `build_tag_entry`, but the **rich maintenance context
is implicit and scattered** (some in `tag_events`, some in `kg_*`, some computed at chat time). Make
it an **explicit, versioned contract** — the single object every surface produces and every downstream
consumer reads.

**The Packet is the clean boundary artifact:**
- **Connectivity fills provenance / envelope.**
- **Contextualization fills grounding.**
- **Outcome fills maintenance meaning.**
- **Approval status on the Packet gates deployment** (train-before-deploy).

| Group | Fields | Filled by | Source today |
|---|---|---|---|
| Provenance | source platform · connection type · read/write | Connectivity | connection metadata (new) |
| UNS location | site · area · line · machine · component | Connectivity | `uns.py` |
| Signal identity | source tag path · signal metadata | Connectivity | `normalize_tag_path`, `build_tag_entry` |
| Live value | value · quality · timestamp · unit · data type | Connectivity | `tag_events` / `live_signal_cache` |
| Envelope | normal range · alarm range | Connectivity | `approved_tags` (partial) — extend |
| Grounding | related docs/manuals/wiring/nameplates · evidence source · confidence · approval status | Contextualization | `kg_*`, `relationship_evidence`, `citation_compliance` |
| Maintenance meaning | maintenance meaning · failure modes · technician checks · work-order template | Outcome | **mostly NEW** |

**Where it lives:** define the value half in `mira-relay/ingest_contract.py`; extend the grounding half
in `ctx_enrichment.py` + `kg_*`; the outcome layer fills the meaning half. Enforce shape in Contract-5.

---

## 7. The Outcome object boundary

The outcome layer consumes **approved Context Packets** and emits a **formal Outcome object** that is
persisted and cited. This is the business-value layer.

```
approved Context Packet ─► anomaly A0–A12 (persisted, P0-5) ─► Supervisor (engine.py)
        └── grounded evidence (kg_*, citations) ─────────────────────┘
                                                                     ▼
   OUTCOME OBJECT = { cause, failure_mode, next_check, recommendation,
                      parts, labor_estimate, work_order_draft, evidence[], confidence }
                                                                     ▼
   render on any surface (Ignition Ask MIRA / Slack / Hub) · draft WO via work_order.py → Atlas/Nango
```

**Hard architectural boundary:**
- **Connectivity never reasons about failure modes.**
- **Outcome never opens a socket.**
- **The Context Packet is the only thing that crosses.**

Reuse: `build_uns_wo_from_state` for the WO draft; `citation_compliance` to attach evidence;
`decision_trace.py` to record. Every Outcome field carries evidence — no ungrounded claim.

---

## 8. P0–P3 gap report

*Each gap labeled **[Connectivity]** or **[Outcome]**. Complexity S/M/L/XL.*

### P0 — serious-beta blockers

**P0-1 · Consolidate connector registry [Connectivity] — M.** Merge `mira-connect` + `mira-connectors`
into one registry; Modbus driver becomes a surface adapter; deprecate the old path with a shim.
*Evidence:* both packages exist (`mira-connect/mira_connect/drivers/*`, `mira-connectors/mira_connectors/*`).
*Test:* one suite; Contract-5 stays green; registry-resolves-recipe test per surface. *Risk if ignored:*
drift + erosion of the one-pipeline law.

**P0-2 · Generic OPC UA connector [Connectivity — THE strategic connectivity gap] — L.** Read-only OPC
UA client (browse/subscribe, no writes per `.claude/rules/fieldbus-readonly.md`); browse namespace →
propose UNS mapping (feed `kg_*`); decode → `build_tag_entry` → `ingest_batch`. *Evidence:* ADR-0001;
0 code. *Unknown:* client library + license (must be Apache/MIT per PRD §4 — verify before adoption).
*Test:* integration against a public OPC UA reference server; read-only assertion; Contract-5 conformance.
*Risk if ignored:* locked out of most brownfield plants; "industrial-stack credibility" unsupported.

**P0-3 · First-class Context Packet contract [Boundary] — M.** Versioned schema (§6); connectivity fills
provenance→envelope, contextualize fills grounding, outcome fills meaning; approval-status gates deploy.
*Affected:* `ingest_contract.py`, `ctx_enrichment.py` + `kg_*`, outcome layer, Contract-5.
*Risk if ignored:* boundary blur; outcome fields never get a canonical home.

**P0-4 · Maintenance OUTCOME model [Outcome — CORE VALUE] — L.** Define
`Outcome{cause, failure_mode, next_check, recommendation, parts[], labor_estimate, work_order_draft,
evidence[], confidence, approval_status}`; Supervisor populates from grounded context + anomaly result;
reuse `build_uns_wo_from_state`. *Evidence:* `engine.py`, `work_order.py`, `pm_suggestions.py`;
`decision_trace.py` observational only. *Test:* golden cases assert outcome fields + citations;
`mira-run-hallucination-audit` confirms no ungrounded outcome. *Risk if ignored:* indistinguishable
from a generic copilot (the exact anti-position in `NORTH_STAR.md`).

**P0-5 · Cloud anomaly persistence [Outcome — CORE VALUE] — M.** Persist cloud A0–A12 results to a
queryable store keyed to UNS + Context Packet + timestamp + rule id; expose a read for the outcome
engine; keep the in-gateway FSM writer as an optional producer that also posts through the relay
(one-pipeline). *Evidence:* the corrected gap in §2.1 (`ignition/gateway-scripts/timer-stuck-state.py`,
`tag-change-fsm-monitor.py`, `ignition/db/schema.sql` are gateway-local; cloud `rules_core.py` /
vendored diagnose persist nothing). *Test:* DB round-trip (anomaly fires → row persisted → Supervisor
reads); `test_diagnose_parity.py` unaffected. *Risk if ignored:* no anomaly history / learned baselines /
outcome inputs — the difference-engine story has no memory.

### P1 — serious-beta hardening
- **P1-6 · Real PI connector [Connectivity] — M.** Real client behind the historian surface; reuse
  `pi_mock` as test double (`mira-connectors/mocks/pi_mock.py`, `types/historian.py`, `factory.py`).
- **P1-7 · Excel / SQL import [Connectivity] — S–M.** xlsx reader + SQL-query recipe over the
  historian/file surface (CSV done via `tag_csv.py`; xlsx/SQL missing).
- **P1-8 · Litmus supported egress recipe [Connectivity] — S.** Package the Litmus demo
  (`plc/litmus/**`, commit `30eb2e2c`) as a topic→UNS recipe over the MQTT surface.

### P2 — cloud/edge recipes
- **P2-9 · AWS SiteWise / Azure IoT Ops / EMQX Neuron / HiveMQ Edge / Node-RED [Connectivity] — S each.**
  Each = declarative recipe over MQTT or REST; **no new core.**

### P3 — deferred / unknown
- **P3-10 · Deferred/unknown recipes [Connectivity] — Unknown.** Build only on paid demand; if the
  vendor speaks OPC UA/MQTT/REST/file it is already a thin recipe. Truly proprietary protocols =
  a new surface adapter, gated on a signed customer.

### Framing (explicit)
- **Connectivity gaps** = P0-2 (OPC UA, the *one* strategic gap), P0-1, P1-6/7/8, P2-9, P3-10. With
  REST + Ignition + Sparkplug in prod, **OPC UA is the only connectivity hole that changes the market;
  everything else is thin recipes over four surfaces.**
- **Maintenance-OUTCOME gaps (the core value)** = **P0-4 (Outcome model)** and **P0-5 (anomaly
  persistence)**, enabled by **P0-3 (Context Packet)**. **Do not let connectivity work crowd these out.**

---

## 9. Security model

Beta-safe and **enforced hard** (not just doctrine):

| Control | Status | Evidence |
|---|---|---|
| Read-only-first / no PLC writes | Built (CI-enforced) | `.claude/rules/fieldbus-readonly.md`; `tests/regime7_ignition/test_no_customer_write_paths.py`; ADR-0021 |
| Outbound-only / no inbound to gateway | Built (by design) | `docs/mira-ignition-secure-architecture.md` |
| Tenant isolation (RLS + UUID sessions) | Built (DB-enforced) | `mira-hub/src/lib/tenant-context.ts`, `session.ts` |
| AuthN (HMAC / Bearer / JWT) | Built | relay ingest HMAC `mira-relay/auth.py` (`verify_hmac`); Ignition/MCP HMAC `mira-mcp/ignition_auth.py`; Bearer `MCP_REST_API_KEY`; JWT `PLG_JWT_SECRET` |
| Fail-closed tag allowlist | Built | `ignition/webdev/FactoryLM/api/tags/allowlist.py` |
| PII sanitize (default-on) | Built | `mira-bots/shared/inference/router.py` |
| Secrets via Doppler refs | Built | `tenant_cmms_config.auth_credential_ref` |
| Full `audit_log` | **Deferred** | `api_usage` exists; per-tag audit is future |
| Distributed nonce store | **Deferred** | in-process only (single-node beta OK; scaled beta needs Redis/NeonDB) |

**New-surface security posture (OPC UA):** read-only client, browse/subscribe only, no write function
codes, credentials via Doppler ref — same posture as the existing surfaces. **No control writes in beta.**

---

## 10. Demo / beta plan

**Beta message:** *"Bring your own industrial data stack; MIRA turns it into maintenance outcomes."*

**Smallest serious beta (no new connector required):** ship **P0-3 + P0-4 + P0-5** on the already-built
**REST / Ignition / Sparkplug** connectivity. The bench (Micro820 → Litmus → relay, commit `30eb2e2c`)
and SimLab already feed the pipeline, so the end-to-end proof —
*contextualized telemetry → cited, accountable recommendation with a WO draft* — is demonstrable today.

Staged demos:

| Demo | Inputs | Proves | Does NOT prove | Pass criteria |
|---|---|---|---|---|
| **A. Ignition + Sparkplug live** | Ignition gateway pushing tags (or SimLab MqttPublisher) | REST/Ignition/Sparkplug ingress → `live_signal_cache` | OPC UA; cloud anomaly history | tags land, allowlist-filtered, tenant-scoped |
| **B. Context Packet** | one asset's tags + approved KB | the explicit boundary artifact (source→failure-modes as one object) | autonomous action | Packet JSON renders all §6 groups |
| **C. Anomaly → Outcome** | bench fault (or replay) | detection → **cited Outcome** (cause/next-check/parts) + one-click WO draft | multi-plant scale | Outcome fields present + each line cited |
| **D. Anomaly history** | repeated bench faults (needs P0-5) | durable cloud anomaly store feeding the outcome loop | learned baselines | anomaly rows queryable by the Supervisor |
| **E. OPC UA (after P0-2)** | public OPC UA / Kepware demo server | the missing surface + auto-UNS proposal | production hardening | tags flow + UNS proposals appear |
| **F. Bring-your-own-stack** | customer CSV / MQTT broker | onboarding over an existing surface, no bespoke core | every vendor recipe | data normalized into the Context Packet |

---

## 11. Discovery Recorder

**Questions asked:** How does MIRA connect to each industrial platform today? Which of the four
universal surfaces are built? What is the smallest path to a serious beta? Where is the connectivity
gap vs. the maintenance-value gap?

**Method:** Phase 1 = 7 parallel read-only Explore agents (MQTT/UNS, OPC UA, REST/cloud+Litmus,
historian/file/PLC-import, contextualization, outcome/presentation, security). Phase 2 = 2 synthesis
agents (connector matrix; architecture + gap report). Phase 3 = this authoring pass. No code changed.

**Commands / tools:** `Glob`/`Grep`/`Read` across `mira-relay/`, `mira-connect/`, `mira-connectors/`,
`mira-plc-parser/`, `plc/`, `ignition/`, `mira-bots/`, `mira-hub/`, `docs/`, `tests/`; absence-of-grep
evidence for OPC UA vendors (0 matches for Kepware/HighByte/Siemens Edge/OPC Router/`asyncua`/`open62541`).

**Observed results:** 3 of 4 surfaces Built(prod); OPC UA Missing; two overlapping connector packages;
strong contextualize→approve→cite wedge; weakest link = the outcome layer + cloud anomaly persistence.

**Key downgrade during writing:** the "`mira_anomalies` has no writer" claim was **corrected** to
"gateway-local writers exist; the cloud path discards anomalies" (§2.1) after a Phase-2 spot-check.

**Reusable workflows created:** the 7-slice inventory fan-out and 2-agent synthesis pattern are
repeatable for future audits. **Fixtures/tests recommended:** a Context-Packet schema-conformance test
(Contract 5); an anomaly-persistence DB round-trip test (P0-5); an OPC UA read-only integration test.

---

## 12. Explicit Unknowns

- **OPC UA client library + license** (P0-2) — must be Apache/MIT per PRD §4; not yet chosen. **Unknown.**
- **`tag_diff_logger` scheduler** — deferred today; whether its activation is a prerequisite for cloud
  anomaly persistence (P0-5) is **Unknown** — verify before P0-5.
- **Cirrus Link / Node-RED** — almost certainly reachable via the Sparkplug/MQTT surface, but **not
  verified** in code. **Unknown.**
- **Scope of proprietary P3 protocols** — **Unknown** until a signed customer scopes one.
- **Sparkplug deployment** ships as an **opt-in `sparkplug` compose profile** (`docker-compose.saas.yml`;
  a default VPS deploy does not start it). Whether it is enabled in any live prod environment is
  **Unknown**; verify before claiming MQTT/Sparkplug is live in prod. (Note: earlier drafts cited
  "PR #2280" as the gate — that PR is the broader one-pipeline/relay rollout, not the Sparkplug deploy.)

---

*Phase 4 (verification) is required next: spot-check every cited path and flag any "Built" claim that
is actually demo-only, test-only, local-only, or disconnected from the cloud/outcome path.*
