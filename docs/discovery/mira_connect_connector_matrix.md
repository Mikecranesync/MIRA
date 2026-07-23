# FactoryLM / MIRA Connect — Connector Compatibility Matrix

*Phase 3 deliverable. Synthesis of the Phase 1 read-only inventory + Phase 2 architecture pass.
Every "evidence" cell cites a repo path; unproven items are marked **Unknown**. Status vocabulary:
**Built(prod) · Built(demo) · Mock/test · Plan-only · Missing · Recipe-only · Unknown**. The
`Class` column marks whether a row is **core** (a generic surface), a **recipe** (thin config over a
surface), **beta**, **enterprise**, or **deferred**.*

> **The one-line story this table exists to prove:** MIRA Connect is **not twelve integrations** — it
> is **four generic surfaces (REST/JSON, MQTT/Sparkplug, OPC UA, historian/file)** with **vendor
> recipes layered on top.** Three of the four surfaces already exist in production; **OPC UA is the
> single missing surface**, and it alone unlocks four platforms at once.

## Matrix

| # | Platform / source | Status | Best surface | Evidence (paths) | Reusable today | Missing | OPC UA unlocks? | Setup | Phase | Class | Business meaning |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | **Generic REST/JSON** | Built(prod) | REST/JSON | `mira-relay/relay_server.py` (`POST /api/v1/tags/ingest`, `/ws/tags`); `ingest_contract.py`; `tag_ingest.py`; relay HMAC `mira-relay/auth.py` (`verify_hmac`) | Full ingest path + HMAC + canonical normalize/batch/persist | First-class Context Packet on top of raw tags | No | Low | **P0** | core | Anyone who can POST JSON is already a customer — the universal front door. |
| 2 | **Generic MQTT + Sparkplug** | Built(prod), opt-in deploy | MQTT/Sparkplug | `mira-relay/mqtt_ingest/{codecs/sparkplug_b.py,decode.py,subscriber.py,config.py}`; tests `test_sparkplug_{codec,decoder,loop,consumer,seed}.py`; `simlab/publishers.py` | Sparkplug B decode + subscriber loop + one-pipeline routing | Enable the opt-in `sparkplug` compose profile (`docker-compose.saas.yml`); plain-JSON codec (planned `docs/plans/2026-06-23-lane3-phase3a-plain-json-mqtt-codec.md`) | No | Med | **P0** | core | The industrial-standard pipe is built — flipping it on covers a class of plants at once. |
| 3 | **Ignition (push)** | Built(prod) | REST/JSON | `ignition/gateway-scripts/tag-stream.py`; `ignition/webdev/FactoryLM/api/tags/collector.py` (HMAC, fail-closed allowlist both ends) | Config-as-files deploy, HMAC, allowlist | Context Packet; validation-gated "Ask MIRA" surface | No | Low | **P0** | core/beta | The most common SCADA platform pushes tags to us today with no new plumbing. |
| 4 | **CSV import** | Built(prod) | file/import | `mira-plc-parser/parsers/csv_tags.py`; `ignition/webdev/FactoryLM/api/diagnose/tag_csv.py` (Rockwell/Siemens/Kepware/generic dialect detect) | Multi-dialect CSV → canonical tag IR | Excel/SQL extension (row 17) | No | Low | **P1** | core/beta | A tech emails a tag-list CSV and we onboard it — zero live connection required. |
| 5 | **Modbus TCP driver** | Built(prod, bench) | driver | `mira-connect/drivers/modbus_driver.py` (pymodbus, read-only, ADR-0021); `mira-connect/tests/test_modbus_driver.py` | Read-only Modbus polling driver + tests | **Consolidate** into one registry (`mira-connectors/` overlap) | No | Med | **P0** | core | Direct PLC read for bench/edge; needs merging into one connector framework, not two. |
| 6 | **Litmus Edge** | Built(demo) | MQTT/Sparkplug (egress) | `plc/litmus/demo_context_model.py`, `dashboard_api.py`; `docs/discovery/litmus_mira_demo_decision.md`; `docs/integrations/litmus_supported_connector_plan.md` | Demo context model + dashboard; supported-egress plan written | Real supported egress (internal `:8094` read was blocked) | No | Med | **P1** | recipe/beta | Proven in a demo; needs the vendor-supported outbound path to be a real customer story. |
| 7 | **AVEVA PI** | Mock/test | historian | `mira-connectors/mocks/pi_mock.py` + `fixtures/pi.json` (AF→ISA-95); `mira-connectors/types/historian.py`; `factory.py` (real stub) | Canonical Asset/Tag/Meter + AF→ISA-95 map + mock | **Real** PI Web API connector | No | High | **P1** | recipe/enterprise | The dominant plant historian — the mock proves the shape; a real connector is a paid unlock. |
| 8 | **Cognite Data Fusion** | Plan-only | REST/JSON | `docs/plans/2026-06-14-cognite-contextualization-replication-plan.md` | Replication/contextualization plan doc | All connector code | No | High | **P2** | deferred/enterprise | Competitor-adjacent data platform; a cloud recipe, not a near-term build. |
| 9 | **EMQX Neuron** | Missing | MQTT/Sparkplug | None — routes via row 2 | Existing MQTT/Sparkplug substrate | Vendor recipe/config guide | No | Med | **P2** | recipe | An MQTT gateway we already speak — needs a setup recipe, not new engineering. |
| 10 | **HiveMQ Edge** | Missing | MQTT/Sparkplug | None — routes via row 2 | Existing MQTT/Sparkplug substrate | Vendor recipe/config guide | No | Med | **P2** | recipe | Same pipe as row 2 — a documentation/recipe task. |
| 11 | **Generic Sparkplug sources** | Recipe-only (substrate built) | MQTT/Sparkplug | `mira-relay/mqtt_ingest/codecs/sparkplug_b.py` + subscriber | Sparkplug decode + canonical routing | "Point-any-Sparkplug-source-at-us" onboarding recipe | No | Med | **P1** | recipe | The engine handles any Sparkplug emitter; we need a repeatable customer-facing recipe. |
| 12 | **Kepware KEPServerEX** | Missing | OPC UA | None (0 grep matches) | Connector registry (`mira-connectors/base.py`) as landing spot | Generic **OPC UA** client connector | **Yes** | Med | **P0** | recipe | The #1 industrial OPC server — one OPC UA connector turns its huge install base into customers. |
| 13 | **HighByte Intelligence Hub** | Missing | OPC UA | None (0 grep matches) | Connector registry framework | Generic OPC UA client connector | **Yes** | Med | **P0** | recipe | A popular DataOps layer; the same single OPC UA connector unlocks it. |
| 14 | **Siemens Industrial Edge** | Missing | OPC UA | None (0 grep matches) | Connector registry framework | Generic OPC UA client connector | **Yes** | High | **P0** | recipe/enterprise | Opens the Siemens-shop segment via the same OPC UA connector — no Siemens-specific build. |
| 15 | **OPC Router** | Missing | OPC UA | None (0 grep matches) | Connector registry framework | Generic OPC UA client connector | **Yes** | Med | **P0** | recipe | A common integration hub; unlocked by the same one connector as rows 12–14. |
| 16 | **AWS SiteWise / Azure IoT Ops** | Missing | REST or MQTT | None | REST + MQTT surfaces (rows 1–2) | Cloud-specific recipes/auth | No | High | **P2** | recipe/enterprise | The hyperscaler IoT clouds — reachable via existing pipes with cloud recipes. |
| 17 | **SQL historian / Excel (xlsx)** | Missing | file/import + historian | `mira-connectors/types/historian.py` (base); `plc/conv_simple_anomaly/trend_historian.py` (SQLite bench) | Historian base type + CSV importer pattern (row 4) | Real Excel + SQL readers | No | Low | **P1** | recipe/beta | Small/older plants live in spreadsheets and SQL logs — a cheap, broad onboarding win. |
| 18 | **Cirrus Link / Node-RED** | Unknown | MQTT/Sparkplug | None — likely routes via row 2 (verify) | Existing MQTT/Sparkplug substrate | Verification + recipe | No | Med | **P2** | recipe | Almost certainly reachable via our Sparkplug pipe — needs a quick confirm, then a recipe. |

## Surface roll-up

| Surface | Status | Rows served |
|---|---|---|
| **REST / JSON** | Built(prod) | 1, 3, 8, 16 |
| **MQTT / Sparkplug** | Built(prod), opt-in `sparkplug` compose profile | 2, 9, 10, 11, 18 (+ cloud fallback for 16) |
| **OPC UA** | **Missing** — ADR-0001 defers; 0 client/server code | 12, 13, 14, 15 |
| **Historian / file** | Partial — file/CSV + PLC-export built; real PI/SQL/xlsx stubbed | 4, 5, 6, 7, 17 |

## "One platform, many recipes" — the anti-twelve-products point

1. **One MQTT/Sparkplug surface already covers 5+ platforms** — generic MQTT+Sparkplug, EMQX Neuron, HiveMQ Edge, generic Sparkplug sources, Cirrus Link/Node-RED are all the *same* built pipe (`mira-relay/mqtt_ingest/`). Recipes, not products.
2. **One REST/JSON surface covers 4** — generic REST/JSON, Ignition push, and the cloud IoT stacks land through `mira-relay/relay_server.py`; no per-vendor engine.
3. **One historian/file base covers 5** — CSV, PI, SQL/Excel, Litmus, and the bench trend historian all normalize through `mira-connectors/types/historian.py` + the `mira-plc-parser` CSV path; the shape is proven, the readers are the gap.
4. **The single highest-leverage build is a generic OPC UA client** — the *only* thing between MIRA and Kepware, HighByte, Siemens Industrial Edge, and OPC Router (**4 rows, one connector**), converting the largest currently-Missing segment.
5. **Consolidate first, then add one connector.** `mira-connectors/` (vendor-recipe registry) and `mira-connect/` (driver framework) overlap; merging them (P0-1) plus the OPC UA connector (P0-2) makes every remaining row a recipe on an existing surface — not a new codebase.

## Cross-references
- Main report: `docs/discovery/mira_connect_interoperability_gap_report.md`
- PRD outline: `docs/product/mira_connect_prd_gap_outline.md`
- Build-in-public plan: `docs/product/mira_connect_video_proof_plan.md`
