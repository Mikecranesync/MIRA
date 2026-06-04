# Audit — FlowFuse / Node-RED / Ignition alignment (2026-06-04)

**Auditor stance:** outside reviewer, repo-grounded.
**Scope:** verify an alignment audit that compared the repo against a FlowFuse / Node-RED / Ignition / MQTT / Sparkplug B / UNS research-and-design prompt.
**Method:** every claim below was checked against files on `origin/main` (worktree at `1b535a76`). File paths and line counts are real as of this commit. Where something is simulated, spec-only, or deferred, it is labelled as such.

---

## 1. The original research-prompt goal

Investigate FlowFuse, Node-RED, Ignition, MQTT, Sparkplug B and Unified Namespace, then determine how Node-RED could feed Ignition, how Ignition could feed Node-RED, and how both could communicate bi-directionally inside a MIRA / FactoryLM architecture — and produce five durable docs (one overview, one bidirectional-patterns comparison, one MIRA-application doc, one conveyor demo plan, one next-steps plan). MIRA = **Maintenance Intelligence Resource Agent**: a maintenance-reasoning layer that uses chat as its interface, confirms the technician's exact UNS/asset context before troubleshooting, and answers with citations grounded in manuals, wiring, work history, live tag snapshots, and the knowledge graph.

## 2. The five requested deliverables — all were missing

Checked `main`, the working tree, and **every remote branch**. None existed:

| Requested file | Status before this audit |
|---|---|
| `docs/research/flowfuse-node-red-ignition-overview.md` | missing |
| `docs/architecture/node-red-ignition-bidirectional-patterns.md` | missing |
| `docs/architecture/mira-flowfuse-ignition-application.md` | missing |
| `docs/plans/conveyor-demo-node-red-ignition-plan.md` | missing |
| `docs/plans/flowfuse-node-red-next-steps.md` | missing |

These are now created alongside this audit (see §11).

## 3. What the repo already has (verified)

| Area | Real file(s) | Note |
|---|---|---|
| Ignition-module-first architecture | `docs/adr/0021-ignition-module-first-edge.md` (Accepted 2026-06-01), `docs/mira-ignition-secure-architecture.md` (33 KB) | The durable decision: customer surface is an Ignition Module; all plant I/O stays in Ignition; outbound-HTTPS-only; allowlist read-only. |
| Ignition edge code | `ignition/gateway-scripts/tag-stream.py` (161 lines), `ignition/webdev/…`, `ignition/deploy_ignition.ps1`, `ignition/project/…` (Perspective) | Gateway script POSTs tag JSON to the cloud relay over HTTP. |
| Cloud relay (ingest) | `mira-relay/relay_server.py` (341 lines) | HTTP/WebSocket ingest, HMAC verify, upsert into `equipment_status`/`faults`. Cloud-side only; **no plant write path**. |
| UNS path model | `mira-crawler/ingest/uns.py` (350 lines), `docs/specs/uns-kg-standards-compliance.md` (519 lines) | ISA-95-derived 6–7 segment paths; ISA-95/ISO-14224/Sparkplug-B compliance audit. |
| UNS message resolution + confirmation gate | `mira-bots/shared/uns_resolver.py` (975 lines), `mira-bots/shared/engine.py` (4774 lines) | The non-negotiable location-confirmation gate lives in the engine. |
| Retrieval + citations | `mira-bots/shared/workers/rag_worker.py` (1060), `mira-bots/shared/neon_recall.py` (959), `mira-bots/shared/citation_compliance.py` (96) | Hybrid pgvector + BM25 + RRF; observational citation gate. |
| Live-tag chat front door | `mira-bots/ask_api/app.py` (171), `mira-bots/ask_api/machine_context.py` | Ignition HMI POSTs `{question, tags}`; decodes GS10/Micro820 tags into a `[LIVE CONVEYOR STATUS]` block, calls `engine.process()`. |
| Node-RED orchestration | `mira-bridge/` (Node-RED 4.1.7), `mira-bridge/flows/fault-detective.json` (2865 lines) | Message routing + demo HMI flow + Modbus poll stub. |
| Conveyor demo (bench) | `docker-compose.fault-detective.yml`, `mira-fault-detective/engine.py` (289), `mira-fault-sim/`, `docs/conveyor-fault-detective-demo/README.md`, `docs/superpowers/plans/2026-05-13-mira-conveyor-demo-mvp.md` | Working rule-engine demo driven by a simulator. |
| Honest gap record | `docs/runbooks/2026-05-15_physical-conveyor-readiness.md` (254 lines) | States "the PLC → MIRA data path is half-built"; lays out Options A/B/C. |
| FlowFuse decision | `docs/adr/0016-mira-bridge-flowfuse.md` (175 lines) | **Defer**; stay on stock Node-RED; revisit at 500 paying tenants. |
| PLC bench tools | `plc/live-plc-bridge/bridge.py` (196), `plc/live_monitor.py`, `plc/discover.py` | Read-only / bench-only; never shipped to customers (ADR-0021 §"What we now forbid"). |
| Read-only safety rules | `.claude/rules/fieldbus-readonly.md` (100), `.claude/skills/mira-saas-scope-guard/SKILL.md` (91) | Discovery is read-only; arbitrary PLC writes are DEFER-tier. |
| PLC worker | `mira-bots/shared/workers/plc_worker.py` (22) | A **stub** that returns "Live PLC data is not connected yet." |

## 4. What is real working code

- The **reasoning layer**: UNS resolver + confirmation gate, hybrid retrieval, citation compliance, the Supervisor FSM (not LangGraph — PRD §4 bans framework abstraction).
- The **Ignition → cloud ingest path**: `tag-stream.py` (HTTP POST) → `mira-relay` (HMAC + upsert).
- The **live-tag chat front door** for the garage conveyor kiosk: `ask_api/app.py` decodes real GS10/Micro820 tags and grounds the answer in `machine_context.py`.
- The **bench fault-detective demo**: rule engine + simulator + MQTT broker, all running.

## 5. What is simulated (not live machine data)

- `docker-compose.fault-detective.yml` is headed **"BENCH HARNESS — NOT a customer architecture."** Its `fault-sim` service publishes fake PE/PX/fuse/vision values to MQTT. The diagnoses the demo shows are computed from **simulated** signals unless a real PLC is attached via the bench-only bridge.
- `plc/live-plc-bridge/bridge.py` can poll a real Micro820 at `192.168.1.100:502`, but it is **bench-only** (ADR-0021 §"What we now forbid") and never ships to a customer.

## 6. What is spec-only

- **Sparkplug B.** `docs/specs/uns-kg-standards-compliance.md §6` describes the UNS↔Sparkplug mapping (NBIRTH/DBIRTH/NDATA/…, `spBv1.0/{group}/{type}/{node}/{device}`) in detail and calls it a "future MIRA Layer 4 (event stream)" with "a 10-line transform" to bridge `.`↔`/`. **There is no Sparkplug publisher or subscriber in the codebase** (`uns.py` has no topic builders). Sparkplug is intent + schema mapping, not runtime.
- **`mira-connect`** (the non-Ignition MQTT/Sparkplug edge subscriber) is referenced by ADR-0021 §"What this decision enables" and tracked at issue **#1627** — spec, not shipped.

## 7. What is deferred (by ADR or design)

- **FlowFuse** — deferred per ADR-0016 (revisit at 500 tenants; conditional triggers documented).
- **Cloud→plant inbound / writes** — forbidden by ADR-0021 (outbound-HTTPS-only; "Writing to tags from the MVP. The code path does not ship.").
- **Sparkplug B runtime + `mira-connect`** — deferred to #1627.
- **Live PLC→NeonDB UNS path** (Option B in the readiness runbook) — deferred post-expo.

## 8. Safety posture today

Strong and enforced, not aspirational:
- **Read-only by construction.** No PLC/VFD write path ships; `plc_worker.py` is a stub; relay only ingests; ADR-0021 forbids writes and cloud-initiated connections.
- **Allowlist-first tag reads** (ADR-0021 §Decision-4; `ignition/webdev/.../tags/doGet.py` fail-closed).
- **Fieldbus discovery is read-only** (`.claude/rules/fieldbus-readonly.md`); the RS-485 sweep refuses to run on a live PLC-mastered bus without `--serial-bus-idle`.
- **Scope guard** classifies arbitrary PLC control as DEFER-tier.
- **UNS confirmation gate** must pass before troubleshooting (`engine.py`).

## 9. Alignment with the hybrid architecture

The repo has independently converged on the hybrid shape the prompt points toward:
- **Ignition = trusted SCADA/HMI/source-of-truth** (ADR-0021).
- **Node-RED = edge/protocol-conversion + routing** (mira-bridge), with FlowFuse explicitly *not* a dependency (ADR-0016).
- **MQTT/UNS = shared nervous system** — UNS modelled and ISA-95/Sparkplug-mapped; MQTT used on the bench; Sparkplug runtime deferred.
- **MIRA = reasoning/troubleshooting layer** — the strongest, most complete part.
- **Read-only from cloud toward plant** — enforced.

Estimated alignment: **deliverables ≈ 0/5 (now remediated); architectural substance ≈ 60–70%.** The brain is real; the live nervous system is the weak link.

## 10. Biggest gaps

1. **Live machine data rarely reaches the reasoning workflow.** Only the single-machine `ask_api` kiosk injects live tags, and it prepends them as a text block rather than attaching a UNS-keyed snapshot *after* the confirmation gate. `plc_worker.py` is a stub; the Telegram path has no live context.
2. **No general, UNS-keyed, logged live-tag snapshot adapter** that any front door can reuse.
3. **Sparkplug B is spec-only** — fine for now, but the docs imply more than exists.
4. **The conveyor demo's live path is half-built** (readiness runbook), and the bench compose is explicitly not a customer architecture.

## 11. Recommended next move

Consolidate the documentation (done — see the five new files) and then make **one boring, reliable, read-only live data path** real: a small **read-only live-tag snapshot adapter** that normalizes whatever source is easiest today (the Ignition `tag-stream`/`ask_api` tags, or the bench MQTT bridge) into a UNS-keyed structure, attaches it to the conversation **after** the UNS confirmation gate, and logs each snapshot for traceability. Keep plain MQTT before Sparkplug B; keep FlowFuse out until the business case changes; never add a write path.

### Bottom line

> **MIRA's reasoning brain is ahead of the live industrial nervous system. The next hard push should be getting real conveyor/PLC/VFD data into the reasoning workflow in a boring, reliable, read-only way.**

---

**Companion documents created with this audit:**
- `docs/research/flowfuse-node-red-ignition-overview.md`
- `docs/architecture/node-red-ignition-bidirectional-patterns.md`
- `docs/architecture/mira-flowfuse-ignition-application.md`
- `docs/plans/conveyor-demo-node-red-ignition-plan.md`
- `docs/plans/flowfuse-node-red-next-steps.md`
