# SimLab as MIRA's Industrial Flight Simulator — Implementation Assessment

> **Mission:** turn SimLab from an eval harness into the **complete rehearsal environment** that lets
> MIRA walk into a factory it has never seen, contextualize it, connect live data, ground itself in
> docs, diagnose, cite, and explain — ready for **ProveIt! 2027** and real unknown factories.
> **Core principle: do NOT redesign MIRA. Reuse the hard parts. Build the missing bridges.**
> Companion: `docs/plans/2026-06-22-proveit-factory-import-implementation-plan.md` (this assessment
> reframes + extends it with the flight-sim lens, the artifact inventory, and the sim-platform decision).

---

## 1. Current-state analysis — the hard parts already exist

| Capability the mission needs | Status | Where (reuse this) |
|---|---|---|
| Knowledge graph (UNS, ISA-95 ltree) | ✅ built | `kg_entities` / `kg_relationships`, Hub `/namespace`, `/knowledge/map` |
| Proposal → human-approve → audit | ✅ built | `relationship_proposals`/`ai_suggestions` → `/api/proposals/[id]/decide` → `applyHubProposalTransition` → `namespace_versions` |
| Citation **enforcement** | ✅ real | engine H4 `enforce_citation_or_gap_admission` ("cite or admit gap", default-on) + relevance strip |
| "Why MIRA Thinks This" | ✅ on main | `WhyMiraThinksThis.tsx` wired into `AssetChat`; decision-trace routes (#2081) |
| SimLab scoring framework | ✅ built | `simlab/evaluation.py` (5 dims) + `simlab/dashboard.html` (#2236) |
| Deterministic factory engine | ✅ built | `simlab/engine.py` (seeded tick, PackML, 6 faults), `simlab/baselines/` (13), `simlab/publishers.py` |
| Live-tag architecture | ✅ built | `live_signal_cache` + `mira-relay/tag_ingest.persist_batch` + freshness rollup |
| Engine live-connect support | ✅ built | `engine.process(uns_source=, live_tags=)` + gate-skip on `source="direct_connection"` |
| Grounded retrieval | ✅ built | `neon_recall.recall_knowledge` (dense+BM25+fault+product RRF over `knowledge_entries`) |

**Conclusion:** ~80% of the flight simulator is already in the repo. The work is **bridges + one broker**, not architecture.

## 2. Gap analysis — the missing bridges (front doors)

| Gap | Detail | Effort |
|---|---|---|
| **No Ignition tag-JSON parser** | `detect.py` has no branch; no `parsers/ignition_json.py`. Can't read `tags.json`. | M |
| **IR is logic-flat, not ISA-95** | `ir.py` has no asset-instance node / parent path / UDT typeId / MES binding — *the load-bearing change*. | **L** |
| **No bulk Hub tag-import job** | `/tag-import` is spec-only; wizard makes 2 entities by hand; decide is 1 edge/POST. Won't scale to 5,200 nodes. | **L** |
| **No JSON→`knowledge_entries` loader** | Pilot DB (WO/lot/state) + manuals can't be made citable; CMMS is live-API-only, non-citable. | M-L |
| **GUI upload ≠ citable** | `/api/uploads`→`/ingest/document-kb` lands in **Open WebUI KB, which `recall_knowledge` never reads**. Only batch→`knowledge_entries`+embeddings is citable. | (use batch) |
| **No MQTT subscriber** | `mira-relay` is HTTP-only; `mira-bridge` is bench-locked Node-RED. No shippable broker subscriber. | S+M |
| **No topic→UNS normalizer** | `enterprise/site/.../metric` (slash) → ltree (dot) mapping absent. | M |
| **live_signal_cache → engine** | Read only by Hub Ask-MIRA route, not the autonomous engine path. | M |
| **Dashboard scores stand-ins** | `simlab/dashboard.html` scores `oracle`/`evidence_only`, **not the real Supervisor**. | M |
| **Values/score not rendered** | `live_signal_cache` shows freshness dots, no numeric values; groundedness 1-5 stored, never shown. | M+S |

**Honest corrections (verified):** (1) the "beta gate MET (#2077)" claim is **conditional** — the gate test is still `xfail(strict)` and the GUI upload path is non-citable; ground via batch→`knowledge_entries`. (2) **Build on `origin/main`**, not `feat/vfd-analyzer-auto-map` (stale; Why-MIRA / decision-trace / SimLab dashboard are main-only).

## 3. Data-source inventory (Phase -1 catalog)

| Artifact | Source | License | Commit? | Contributes |
|---|---|---|---|---|
| **Cappy Hour `Enterprise B/tags.json`** (~5,200 tags, Ignition UDT tree) | `DMDuFresne/ProveIt-2026-UNS-Docs` | none | **local only** | The unknown-factory import target (P1) |
| `Enterprise B/cesmii-tags.json` (i3X, nameplate: Krones/Checkmat) | same | none | local only | Manufacturer/model grounding |
| `Enterprise B/Pilot Database Export/` (WO 6k, lot 33k, item, state) | same | none | local only | CMMS-like grounding (P2) |
| MES/MCP demo prompts (`uns-docs/*Demo-Prompts*.md`) | same | none | local only | Demo Q&A reference |
| **Flexware sim** (100 machines, EMQX MQTT + OPC-UA, k8s) | `Flexware-Innovation/...Community` | **MIT** | reusable | Live-feed stand-in (P4); too heavy to run whole |
| **IA official factory** (Ignition config-as-files, ProveIt2026 UDTs) | `inductiveautomation/proveit-2026-app` | none (repo) | reference | Canonical UDT model |
| **`simlab/`** (juice-bottling line, 13 baselines, 11 doc sets, 11 scenarios) | MIRA repo | own | ✅ committed | The deterministic engine to EXTEND |
| **Real CCW PLC programs** (`plc/Micro820_*.st`, Conv_Simple 1.9/2.x, anomaly rules, live CSV logs, modbus maps) | MIRA repo | own | ✅ | Real ST/tags for parser generalization + a *real* PLC demo |
| **Parser fixtures** (`conveyor.L5X`, `.st`, `.plcopen.xml`, `siemens_conveyor.xml`, `gs10_tags.csv`, modbus map, `siemens_openness_scl_mit.xml` MIT) | MIRA repo | own/MIT | ✅ | Multi-vendor parse coverage |
| **Ignition assets** (`ignition/tags/*.json`, `approved_tags.json`, gateway scripts, webdev) | MIRA repo | own | ✅ | Ignition tag shapes + the live tag-stream path |
| **KB seeds** (`gs10-vfd-knowledge.sql`, `gs11-field-guide`, `oem-manuals`, garage-conveyor) | MIRA repo | own/OEM | ✅/seed | Existing citable manuals/knowledge |
| **OEM manual corpus** (`knowledge_entries`, ~83k chunks) | NeonDB | mixed | DB | Shared grounding corpus |

**Gap in artifacts:** no real **Cappy Hour / beverage-bottling equipment manual PDF** (the corpus has only MES/tag data). One real product manual PDF must be supplied for P2's manual-grounded citation.

## 4. Simulation-platform comparison (Phase 3 research)

**Bottom line: extend `simlab/` — it already IS the deterministic, headless, PackML, fault-scenario bottling sim — and add exactly one protocol leg: a Mosquitto broker (~5 MB) fed by a hardened `MqttPublisher`. Adopt no platform.**

| Platform | Sims | Protocol | Determ. | Headless/CI | License | Verdict |
|---|---|---|---|---|---|---|
| **`simlab/` (have it)** | bottling line + PackML + 6 faults | MQTT/Relay/InMem (pluggable) | **Yes** | **Yes** | own | **The engine — extend it** |
| OpenPLC v4 | runs ST/ladder as soft-PLC | Modbus (+OPC-UA/MQTT plugin) | scan-cycle | Yes | **MIT** | optional "real PLC" Modbus demo only |
| Factory I/O | 3D plant | Modbus/OPC-UA/SDK | No | No (Win GUI) | proprietary | optional visual layer (not authoritative) |
| Flexware community | 100 machines, ISA-95 UNS | EMQX MQTT/OPC-UA | unknown | needs k3s | MIT | mine for topic shape; too heavy to run |
| mqtt-simulator / amine-amaach | generic sensors | MQTT/OPC-UA | No | Yes | MIT/Apache | topic feeder, no domain/fault model |
| pymodbus / modbus-tk | registers | Modbus | scriptable | Yes | BSD/LGPL | bridge only |
| asyncua | hand-built nodeset | OPC-UA | Yes | Yes | LGPL-3 | optional OPC-UA leg |
| Node-RED / UMH | flows / UNS infra | MQTT(+) | No | Yes | Apache | UMH = good *consumer*, not source |
| Open-Industry-Project | 3D snap line | OPC-UA/Modbus/MQTT | No | No (GUI) | MIT | visual alt to Factory I/O |

**The 3 `MqttPublisher` bugs to harden** (the abstraction is right, the impl is bench-grade): (1) publishes `BASE_EPOCH+0` instead of `Reading.ts`; (2) opens a fresh client per batch (need one long-lived client); (3) `retain=True` on high-rate telemetry (make retain per-category). ~30 lines, unit-testable, doesn't touch the deterministic core.

**Tier-1 meaningful-signals strategy (Phase 1.5 — collapse 5,200 → ~120):** keep a tag iff it answers *"what state / is it healthy / what is it producing / why did it stop"* — one PackML run-state per machine, the KPI it controls (+setpoint+tolerance), the drive signal (`motor_current`/`vfd_speed`), flow/accumulation (propagates multi-machine faults), the fault/alarm surface, shared utilities once. Drop config constants, HMI scratch, internal timers, per-station duplicates. **This is the same heuristic the `plc-tag-mapper` auto-classification needs — simulator curation and product tag-triage are one job.**

## 5. Recommended architecture (build bridges, not architecture)

```
UNKNOWN FACTORY (tags.json, pilot DB, manual PDF)
   │  [BRIDGE 1] Ignition-JSON parser + ISA-95-hierarchy IR  (NEW, mira-plc-parser)
   ▼
PROPOSALS → human approve → kg_entities (UNS)        [REUSE: proposal/approve/audit]
   │  [BRIDGE 2] Simulation Manifest (Tier-1 classify per asset)  (NEW)
   ▼
simlab.SimEngine  (EXTEND: generate from the manifest, not just the juice line)
   │  [BRIDGE 3] hardened MqttPublisher → Mosquitto broker (~5MB)   (HARDEN + 1 container)
   ▼
[BRIDGE 4] read-only MQTT subscriber → topic→UNS → live_signal_cache → engine.process(live_tags=)  (NEW)
   │                                                   [REUSE: live cache, direct-connection gate-skip]
   ▼
GROUNDING: pilot DB + manual → knowledge_entries (batch+embeddings)  [BRIDGE 5, NEW; REUSE recall]
   ▼
DIAGNOSE → cited answer + Why-MIRA + groundedness 1-5   [REUSE: engine, citation H4, Why panel]
   ▼
SCORE: real Supervisor wired into the SimLab dashboard   [BRIDGE 6: register 3rd answerer; REUSE dashboard]
```

Five new bridges + one harden + one broker. Everything else is reuse. **No new MIRA architecture.**

## 6. Reuse opportunities (explicit)

- **Reuse:** kg_entities/proposals/approve/audit · engine live_tags + direct-connection gate-skip · live_signal_cache + persist_batch · recall_knowledge · citation H4 · Why-MIRA panel · SimLab dashboard + evaluation · `simlab/` engine + publishers + scenarios · the `plc-tag-mapper` classification logic (shared with the Tier-1 manifest).
- **Build (bridges):** Ignition-JSON parser + IR hierarchy · simulation manifest generator · MQTT subscriber + topic→UNS · JSON→knowledge_entries loaders · real-Supervisor dashboard answerer · value/score rendering.
- **Add (infra):** one Mosquitto container · harden `MqttPublisher`.

## 7. Risk assessment

| Risk | Severity | Mitigation |
|---|---|---|
| **Scale** (5,200 nodes, 6k WOs) | High | Tier-1 manifest (sim ~120); background ingest job; batch approve |
| **Determinism vs MQTT live-ness** | Med | Keep CI/eval on in-memory/RelayIngest path; MQTT only for live demo (don't let broker into determinism tests) |
| **License — corpus is local-only** | Med | DMDuFresne/IA = no license → never commit; rehearse locally; Flexware MIT OK; sponsor for the real 2027 factory |
| **No real Cappy Hour manual PDF** | Med | Supply one product/equipment manual; do NOT fake a manual (critical rule) |
| **Beta-gate citable-path confusion** | Med | Ground via batch→knowledge_entries only; treat GUI-upload as non-citable until the OW→KB sync is built |
| **MqttPublisher bench bugs** | Low | 3-line harden + unit tests before relying on the MQTT leg |
| **Scope creep (rebuild MIRA)** | High | The core principle: bridges only; every PR must reuse, not redesign |
| **Faking confidence/citations** | High | Honor the critical rules: admit gaps explicitly (engine H4 already does this); never fake a manual/citation |

## 8. Prioritized execution plan (mission phases → concrete work)

| Mission phase | Concrete work | Effort | Closes |
|---|---|---|---|
| **-1 Discovery** | This inventory (§3) — **DONE** | — | catalog |
| **0 Rehearsal tenant** | `proveit` tenant (UUID), scriptable reset/reload from artifacts, deterministic | S-M | foundation |
| **1 Cappy Hour import** | Ignition-JSON parser + **ISA-95 IR** + i3x hierarchy → proposals → approve → kg_entities. *"MIRA explains the factory structure."* | M-L | runbook #3,#7 |
| **1.5 Sim manifest** | Per-asset Tier-1/2/3 classify; Tier-1 behavior/ranges/faults/docs → the sim source of truth | M | enables P3 |
| **2 Grounding** | Pilot DB + manual → `knowledge_entries` (batch+embeddings); tag→component→machine→manual→WO→failure links | M-L | #1,#2 |
| **3 Flight simulator** | **Extend `simlab/` to generate from the manifest** + harden `MqttPublisher` + Mosquitto; Tier-1-only telemetry | M | the generator |
| **4 Live connectivity** | Read-only MQTT subscriber → topic→UNS → live_signal_cache → engine; no writes | S+M | #4,#9 |
| **5 Trust/explainability** | Render values + groundedness 1-5 badge + Why-MIRA on the imported factory | M+S | #5,#6 |
| **6 Real MIRA eval** | Wire real Supervisor into the SimLab dashboard ("MIRA (live)" answerer) | M | #8,#12 |
| **7 ProveIt rehearsal** | Full stranger-factory arc on Cappy Hour static + Flexware live; record fallback; dry-run to Feb | M | #10 |

**Sequencing:** 0 → (1, 2 parallel) → 1.5 → 3 → 4 → (5, 6) → 7. Same builder+reviewer sub-agent model + human gate per phase.

## 9. Estimated effort by phase
P-1 done · P0 **S-M** · P1 **M-L** (IR extension is the L) · P1.5 **M** · P2 **M-L** · P3 **M** · P4 **M** · P5 **M** · P6 **M** · P7 **M**. Two load-bearing items: the **ISA-95 IR extension** (P1) and the **simulation manifest** (P1.5) — everything downstream hangs off them.

## 10. Recommended FIRST PR — max ProveIt readiness, min churn

**The Cappy Hour Import Engine (parser-side only).** Add to `mira-plc-parser`: (a) detect Ignition tag-export JSON, (b) `parsers/ignition_json.py` that walks the tree preserving hierarchy + UDT typeId + MES bindings + engUnits + CESMII nameplate, (c) the **additive ISA-95 hierarchy extension to the IR** (asset node + parent_path + udt_type + mes_path), (d) make `i3x.py` honor the real `enterprise.site.area.line.equipment` path, (e) a trimmed `tags.json` fixture + tests asserting site/line/machine/device/signal counts.

**Why this first:**
- It is the literal mission capability — *"walk into a factory it's never seen and contextualize it"* — and its **success criterion ("MIRA can explain the structure of the Cappy Hour factory") is met by this PR alone.**
- **Zero architectural churn:** self-contained in the parser package; the IR change is additive (L5X/CSV/analyze untouched); no DB, no Hub, no engine change. Fully testable offline on the acquired `tags.json`.
- It is the **prerequisite for everything else** — the namespace must exist before you can ground, simulate, connect, visualize, or score on it.
- It directly de-risks the ProveIt showstopper (the live "contextualize a factory we've never seen" moment).

The Hub bulk-ingest/approve (the churn-ier half) is the **second** PR; keep them separate so the parser win ships clean and testable first.

## Critical rules (non-negotiable, baked into every phase)
Do not fake confidence, citations, or manuals. Do not bypass approval. **If evidence is missing, admit the gap explicitly** (engine H4 already does). Read-only for OT, always. Reuse, don't redesign.
