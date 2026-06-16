# Node-RED ↔ Ignition integration patterns

**Purpose:** compare the realistic ways Node-RED and Ignition can exchange data, and state which MIRA should use **now** vs. defer. Grounded in the decisions already made: `docs/adr/0021-ignition-module-first-edge.md` (Ignition-module-first, outbound-only, read-only), `docs/adr/0016-mira-bridge-flowfuse.md` (FlowFuse deferred), `.claude/rules/fieldbus-readonly.md`.

**Non-negotiables that constrain every pattern below:**
- MIRA is **read-only toward the plant**. No PLC/VFD writes ship (ADR-0021 §"What we now forbid"; `plc_worker.py` is a stub).
- **No cloud→plant inbound.** The customer opens only `outbound 443`.
- MIRA **does not replace Ignition** and **does not host the customer's broker**.
- MIRA's **UNS confirmation gate** and **citation/traceability** requirements survive intact.

---

## Quick comparison

| # | Pattern | Direction | Read | Write to plant | Reliability | Security risk | Demo | Production | MIRA use now? |
|---|---|---|---|---|---|---|---|---|---|
| 1 | Node-RED → Ignition (Node-RED feeds tags) | edge→SCADA | ✓ | (Ignition writes, not MIRA) | Med-High | Med | ✓ | ✓ (if Node-RED is trusted) | **Not via MIRA** |
| 2 | Ignition → Node-RED (Ignition publishes) | SCADA→edge | ✓ | n/a | High | Low | ✓ | ✓ | Indirect |
| 3 | Both share MQTT (plain) | bus | ✓ | n/a | Med-High | Med (broker auth) | ✓ | ✓ | **Yes — bench/edge** |
| 4 | Sparkplug B / Cirrus Link style | bus (stateful) | ✓ | n/a | High | Med | ◑ | ✓✓ | **Defer (#1627)** |
| 5 | REST bridge (HTTP both ways) | either | ✓ | gated | High | Low (outbound) | ✓ | ✓ | **Yes — the shipping path** |
| 6 | Database as exchange | either | ✓ | n/a | Med | Med | ✓ | ◑ | Already used (relay→DB) |
| 7 | Direct device reads (Node-RED/Ignition → PLC) | edge→device | ✓ | ✗ for MIRA | Med | High on serial | ✓ | bench-only | **Bench-only** |
| 8 | Command / write path | cloud→plant | — | ✗ | — | **Highest** | ✗ | ✗ | **Forbidden** |

Legend: ✓ good / ◑ partial / ✗ no.

---

## Pattern 1 — Node-RED feeds Ignition

**How:** Node-RED reads devices (Modbus/OPC UA) at the edge and pushes values into Ignition — via MQTT (Ignition's MQTT Engine subscribes) or by writing to an Ignition tag provider.
**Read/write:** Node-RED reads the device; *Ignition* owns any write-back, not MIRA.
**Reliability:** good if MQTT-brokered; brittle if it's a bespoke HTTP push.
**Security:** Node-RED becomes a data source Ignition trusts — needs broker auth + topic ACLs.
**Demo/Prod:** fine for both **where the customer accepts Node-RED on their edge**. Many Ignition shops do not.
**MIRA now?** Not MIRA's concern directly. If a customer already does this, MIRA still reads the resulting *Ignition tags*, keeping the trust boundary clean.

## Pattern 2 — Ignition feeds Node-RED

**How:** Ignition publishes tag changes / alarms to MQTT (via its MQTT Transmission module) or to an HTTP endpoint; Node-RED subscribes and does downstream automation (enrich, forward, call APIs).
**Read/write:** read/event only; no plant write.
**Reliability:** high — Ignition is the stable producer.
**Security:** low risk (Ignition → broker → Node-RED, all internal/outbound).
**Demo/Prod:** good for both, and especially attractive when the customer **already trusts Ignition** and wants event-driven workflows downstream.
**MIRA now?** Indirectly useful: this is the natural way a customer's Ignition could feed a UNS/MQTT bus that MIRA's future `mira-connect` (#1627) subscribes to. Today MIRA gets the same data more simply via Pattern 5.

## Pattern 3 — Both share a plain MQTT bus (UNS)

**How:** Ignition and Node-RED both publish/subscribe to one broker, addressed by UNS topics. The classic Unified Namespace.
**Read/write:** read/stream; no plant write.
**Reliability:** good with retained messages + last-will; **plain MQTT has no birth/death**, so consumers can't always tell "stale vs. offline" — that's what Sparkplug adds.
**Security:** broker auth + per-topic ACLs are mandatory; a shared broker is a juicy target.
**Demo/Prod:** demo today (bench: `docker-compose.fault-detective.yml` + `plc/live-plc-bridge/bridge.py` → Mosquitto → `mira-fault-detective/engine.py`). Production-capable, but in the customer architecture MIRA does **not** host the broker (ADR-0021).
**MIRA now?** **Yes, as the bench/edge bus.** Prefer plain MQTT before Sparkplug. Carry `value, ts, quality, source` in every payload so timestamp/quality survive.

## Pattern 4 — Sparkplug B / Cirrus Link style

**How:** Ignition's Cirrus Link **MQTT Transmission** publishes Sparkplug B (birth/death certs, typed metrics) and **MQTT Engine** subscribes; a Node-RED Sparkplug node or `mira-connect` consumes.
**Read/write:** read/stream; stateful (knows device online/offline via NBIRTH/NDEATH).
**Reliability:** the highest of the bus options — quality, timestamp, and liveness are first-class.
**Security:** broker auth; Sparkplug doesn't add security by itself.
**Demo/Prod:** the production-grade UNS answer; more moving parts than plain MQTT.
**MIRA now?** **Defer.** Sparkplug is **spec-only** in this repo (`docs/specs/uns-kg-standards-compliance.md §6`; no publisher/subscriber in code). Implement only when a customer's UNS requires it. `mira-connect` is tracked at #1627.

## Pattern 5 — REST bridge (HTTP both ways)

**How:** Ignition gateway scripts POST to MIRA cloud endpoints; MIRA responds. No inbound to the plant.
**Read/write:** read + chat round-trips; any "write" is a cloud→gateway *response the gateway chooses to act on*, never a forced command.
**Reliability:** high; simple to reason about and audit.
**Security:** lowest — outbound-443-only, HMAC-SHA256 per tenant (ADR-0021 §Decision-3).
**Demo/Prod:** both. **This is the shipping path today:** `ignition/gateway-scripts/tag-stream.py` → `mira-relay/relay_server.py` (ingest), and the Ignition HMI → `mira-bots/ask_api/app.py` (chat with live tags).
**MIRA now?** **Yes — this is the spine.** It satisfies the trust boundary by construction.

## Pattern 6 — Database as the exchange layer

**How:** one side writes rows; the other reads them. MIRA already does a version of this: the relay upserts `equipment_status`/`faults`, and the engine reads them.
**Read/write:** read; no plant write.
**Reliability:** good for state caches; not ideal for high-rate streaming.
**Security:** medium — depends on DB access scoping.
**Demo/Prod:** demo/light-prod. Fine as a **landing table for snapshots**, which is exactly how the proposed snapshot adapter (see next-steps) should persist for traceability.
**MIRA now?** Already used for ingested status; reuse it as the snapshot/trace store.

## Pattern 7 — Direct device reads

**How:** Node-RED or Ignition (or a bench script) opens a Modbus/OPC UA socket straight to the PLC/VFD.
**Read/write:** read for monitoring; **MIRA never writes**.
**Reliability:** medium; RS-485 is single-master and a second master can fault-stop a motor (`.claude/rules/fieldbus-readonly.md`).
**Security:** high risk if a *cloud* component does it — ADR-0021 forbids any customer-shipped fieldbus socket.
**Demo/Prod:** **bench-only** (`plc/live-plc-bridge/bridge.py`, `plc/live_monitor.py` carry BENCH-ONLY headers and never ship).
**MIRA now?** Bench experiments only; never in a customer package.

## Pattern 8 — Command / write path

**How:** cloud or MIRA writes a tag/register to change plant behavior.
**Everything:** **forbidden.** ADR-0021 §"What we now forbid" #6, scope guard = DEFER tier. If ever built, it requires explicit per-tag admin approval **and** per-prompt cloud approval, RBAC, audit logging, and a safe command boundary (design sketch only, `docs/mira-ignition-secure-architecture.md §4.2`). **Out of scope.**

---

## Recommendation

- **Use now:** Pattern 5 (REST bridge, outbound-only) as the production spine + Pattern 3 (plain MQTT) on the bench/edge + Pattern 6 (DB) as the snapshot/trace store.
- **Defer:** Pattern 4 (Sparkplug B / `mira-connect`, #1627) until a customer UNS demands it.
- **Keep out of MIRA:** Pattern 1 write-back, Pattern 7 in customer packages, and Pattern 8 entirely.
- **Bi-directional, honestly:** MIRA's "bi-directional" is *data up (tags) + answers down (chat)* over HTTPS — **not** control down to the plant. That distinction is the product's safety promise.
