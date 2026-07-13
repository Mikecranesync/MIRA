# Litmus Connector — Product Gap Register

**Purpose:** separate what is *built*, *demo-only*, *missing*, and *roadmap* for the Litmus → MIRA story,
so we neither overclaim to a customer nor rebuild what already exists.

**Method:** claims from `factorylm_mira_litmus_usage_guide.pdf` were each verified against the repo on
2026-07-02 by a four-agent pass (file:line evidence). This register records the **corrected** truth.
Where the PDF was wrong, it's marked ❌ **CORRECTION**.

**Framing (unchanged and correct):** we do **not** replace Litmus. Litmus is one plant-data source.
FactoryLM approves and contextualizes the data; MIRA turns that context into explanations, next-checks,
and work-order drafts. Read-only-first: no PLC writes, no cloud-to-PLC control, no unsupported claims.

---

## Built — production or near-production (verified)

| Capability | Evidence | Notes |
|---|---|---|
| **REST/JSON signed ingest** | `mira-relay/relay_server.py:385` (`POST /api/v1/tags/ingest`); HMAC in `mira-relay/auth.py:70` | `X-MIRA-Tenant/Nonce/Timestamp/Signature` headers; key `MIRA_IGNITION_HMAC_KEY`; ±300 s skew; replay guard |
| **One-pipeline ingest contract** | `mira-relay/ingest_contract.py:38-118`, `mira-relay/tag_ingest.py:161` | Canonical `build_tag_entry`/`build_ingest_batch`/`ingest_batch`; source ∈ {ignition, plc_bridge, relay, simulator} |
| **Allowlist fail-closed** | `mira-relay/tag_ingest.py:195-199,286-305` | Non-approved tags rejected, never stored; queried from `approved_tags` |
| **Ignition push path** | `ignition/gateway-scripts/tag-stream.py`, `signing.py:63-91` | HMAC-signed, targets the same `/api/v1/tags/ingest`, gateway-side allowlist |
| **PLC / file import (6 formats)** | `mira-plc-parser/.../parsers/` | L5X, CSV (vendor dialects), PLCopen XML, Ignition JSON, Structured Text — all built |
| **CMMS integration (Nango)** | `mira-hub/src/lib/nango.ts`, `nango-integrations/` | CMMS-to-CMMS read + work-order writeback only — **not** plant-facing |
| **High-level connector framework** | `mira-connectors/` (PR #1702, 67 tests) | Connector ABC + canonical model + confirmation gate + mocks (Maximo/SAP/PI/MaintainX/Ignition) |

---

## Demo-only / bench (verified)

| Capability | Evidence | Honest status |
|---|---|---|
| **Litmus collects the Micro820** | `docs/RESUME_2026-07-01_litmus-devicehub-bench.md:28` | ✅ Proven — `conv-101`, 11 registers, 0 Modbus exceptions, live in DeviceHub UI |
| **MIRA contextualizes the conveyor** | `plc/litmus/mira_on_litmus.py`, 10 passing tests | ✅ Proven via `--source plc` (same brain, same verdict as through-Litmus would give) |
| **Approved context packet (CV-101)** | `plc/conv_simple_anomaly/context_model.cv101.json` | ✅ 11 signals with evidence + approval; 2 unmapped signals with refusal text |
| **Modbus TCP driver** | `mira-connect/mira_connect/drivers/modbus_driver.py` | ⚠️ Exists, read-only (FC3), but **DEFERRED** ("Config 4", dormant) — not shipped in MVP |

---

## Missing / incomplete (verified gaps)

| Gap | Evidence | Impact |
|---|---|---|
| **Automated read *through* Litmus's API** | `docs/RESUME_2026-07-01_litmus-devicehub-bench.md:47-59` | ⏳ `loopedge-access :8094` wants a UUID `apiKey`; UI keys are base32; `:8094` not host-exposed. The one unproven hop of the thesis |
| **MQTT / Sparkplug subscriber** | `docs/design/2026-06-23-lane3-mqtt-subscriber-design.md` ("DESIGN ONLY, no implementation") | ❌ **CORRECTION:** PDF says "MQTT/Sparkplug ingest is built." It is **not** — design only. Do not recommend it as a live path yet |
| **OPC UA client** | ADR-0001 (`docs/adr/0001-plc-protocol-choice.md:29`) | Deferred indefinitely. Real surface gap for Kepware/HighByte/Siemens Edge/OPC Router. No `opcua`/`asyncua` code in repo |
| **Maintenance OUTCOME model** | `mira-fault-detective/rules.py:69-76` (`Diagnosis` dataclass) | ⚠️ Partial: has fault/confidence/evidence/affected_components/first_check, **missing** parts, labor, approval_state, and a queryable outcome table |
| **Anomaly persistence** | `plc/conv_simple_anomaly/rules_core.py`; no anomaly table in 56 migrations | A0–A12 anomalies are **computed and discarded** (returned as JSON from the Ignition endpoint, never saved). No queryable outcome layer |
| **Production Litmus ingest** | `docs/integrations/litmus_supported_connector_plan.md:41-44` | 🚫 On HOLD pending #2280/#2281; must route through the one-pipeline contract when built |

---

## Corrections to the source PDF

1. ❌ **"MQTT/Sparkplug ingest is built."** — It is **design-only**; no subscriber code exists. The only
   live ingest surface is **REST**. Recommend REST-first, not MQTT-first, until Lane 3 ships.
2. ❌ **"Merge `mira-connect` and `mira-connectors` — they overlap (P0)."** — They **don't** overlap.
   `mira-connect` = low-level protocol drivers (deferred); `mira-connectors` = high-level connector
   framework (shipped, 67 tests). Different layers by design (ADR-0021). This P0 is misguided — drop it.
3. ⚠️ **"MIRA reads Micro820 through Litmus" (bench proof).** — True for *collect + contextualize*; the
   *automated API read hop* is blocked. Don't demo it as live pull-through.
4. ⚠️ **"Context Packet contract is missing."** — A concrete, approved context packet **exists**
   (`context_model.cv101.json`) and the ingest tag-entry shape is formalized in `ingest_contract.py`.
   What's missing is a **single unified, reusable schema** spanning both — a formalization task, not a
   greenfield one.

---

## Roadmap

**P0 — for a strong Litmus demo/beta (corrected):**
1. **Close the through-Litmus read hop** — find the UUID-format credential for `loopedge-access :8094`
   (Access Control → Tokens vs API Keys), or accept `--source plc` as the demo path and document *why*.
2. **Formalize the Context Packet schema** — unify `ingest_contract.py`'s tag-entry shape with the
   `context_model.*.json` structure into one documented contract (asset path, tag id, source platform,
   unit, quality, timestamp, evidence, approval state).
3. **Maintenance OUTCOME model** — add cause, failure mode, next check, severity, confidence, evidence,
   parts, labor, and work-order-draft fields; persist it.
4. **Anomaly persistence** — save A0–A12 anomalies + context transitions to a queryable table instead of
   discarding them.
5. ~~Consolidate mira-connect + mira-connectors~~ — **dropped** (not duplication; see corrections).

**P1:**
- Supported Litmus egress recipe (MQTT/Sparkplug **once the subscriber exists**, else REST) with example
  topic/JSON shape, HMAC rules, tenant/source IDs, allowlist behavior.
- Real PI / SQL historian connector (mock exists; real one needed).
- Excel / SQL import for beta customers without clean live egress.
- Technician feedback loop (mark answers right/wrong/incomplete/useful).

**P2 / P3:** more vendor recipes, contradiction detection, visual mapping UI, broader CMMS writeback,
marketplace-style packaging.

---

## Cross-references

- `docs/runbooks/litmus_to_mira_demo_runbook.md` — the operator runbook (how to drive the demo).
- `docs/integrations/litmus_supported_connector_plan.md` — the future supported-connector investigation.
- `docs/RESUME_2026-07-01_litmus-devicehub-bench.md` — bench state + the read-key OPEN ITEM.
- `.claude/rules/one-pipeline-ingest.md` — the canonical ingest law any future connector must obey.
- `docs/adr/0001-plc-protocol-choice.md` — why OPC UA is deferred.
