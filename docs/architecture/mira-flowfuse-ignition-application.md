# How FlowFuse / Node-RED / Ignition apply to MIRA's business

**Purpose:** state the product boundaries — what MIRA *is* in this stack, what it must not try to become, and how the layers serve MIRA's maintenance-intelligence use case.
**Grounded in:** `docs/THEORY_OF_OPERATIONS.md`, `docs/adr/0021-ignition-module-first-edge.md`, `docs/adr/0016-mira-bridge-flowfuse.md`, `.claude/skills/mira-saas-scope-guard/SKILL.md`, `docs/specs/maintenance-namespace-builder-spec.md`.

---

## The one-sentence positioning

**MIRA = Maintenance Intelligence Resource Agent: a maintenance-reasoning layer that consumes trusted, structured industrial context and turns it into cited, technician-facing troubleshooting — using chat as the interface, not as the product.**

## What MIRA must NOT become

These are scope walls, not preferences (`mira-saas-scope-guard`):

- **MIRA is not a Node-RED management platform.** It does not compete with FlowFuse. `mira-bridge` (Node-RED) is internal plumbing; if we ever need fleet flow management we adopt FlowFuse, we don't rebuild it (ADR-0016).
- **MIRA does not replace Ignition.** No SCADA, no HMI replacement, no historian replacement. The customer keeps Ignition; MIRA rides on top as an Ignition Module (ADR-0021).
- **MIRA does not host the customer's MQTT broker.** Making ourselves the broker competes with Mosquitto/HiveMQ/Cirrus Link and adds plant-side ops we don't want (ADR-0021, rejected alternatives).
- **MIRA does not write to the plant.** Read-only toward equipment; no PLC/VFD writes ship.
- **MIRA is not a generic chatbot.** Every answer is grounded and UNS-located, or it asks first.

## What each layer does *for* MIRA

| Layer | Role for MIRA | Why MIRA leans on it instead of building it |
|---|---|---|
| **Ignition** | Plant-trusted source of live tags, alarms, history; the distribution channel (Exchange/Module) | The customer already paid for it and already trusts it; it already speaks every fieldbus. Building a parallel SCADA would be slower, less trusted, and a fight with Inductive Automation. |
| **Node-RED** (optionally **FlowFuse**) | Edge protocol-conversion + light data movement where Ignition isn't present or isn't enough | Mature, low-code, ubiquitous. FlowFuse adds ops/multi-tenancy *if/when* we need it — deferred today (ADR-0016). |
| **MQTT / UNS** | The shared, business-addressable data structure that ties tags ↔ manuals ↔ work orders ↔ KG | A common namespace is what lets MIRA *know what the technician means*. We model the UNS (`uns.py`, `uns_resolver.py`); we don't need to own the transport. |
| **Sparkplug B** | The production-grade, stateful framing for that bus (birth/death, quality, timestamp) | Adopt when a customer's UNS requires it (#1627). Spec-only today — don't overbuild. |
| **MIRA** | Reasoning + troubleshooting + citations + UNS confirmation + traceability | This is the part nobody else builds. It is where our IP and margin live. |

## How a question becomes a grounded answer (the value chain)

This is the existing flow, with real components named:

```
technician chat (Slack / Ignition HMI / Telegram)
   → intent classification + safety keywords        (mira-bots/shared/guardrails.py, engine.py)
   → UNS asset/component resolution                 (mira-bots/shared/uns_resolver.py)
   → UNS CONFIRMATION GATE — confirm before troubleshooting   (engine.py; non-negotiable)
   → live tag snapshot (where available)            (ask_api/app.py today; see gap below)
   → document + KG retrieval (manuals, wiring, WOs)  (rag_worker.py, neon_recall.py)
   → cited answer                                    (citation_compliance.py)
   → trace log for auditability
```

**Where the layers plug in:** Ignition/Node-RED/MQTT feed the *live tag snapshot* step. Everything else (the reasoning, retrieval, citations) is MIRA's own and is the most mature part of the system. The honest gap (see the audit): the live-snapshot step is only wired for the single-machine `ask_api` kiosk today, and it injects tags as a text block *before* the gate rather than as a UNS-keyed snapshot attached *after* confirmation.

## The trust-boundary promise (the commercial moat)

The reason this architecture is sellable into brownfield plants is the boundary itself (ADR-0021):

- The customer opens **only outbound 443** to `*.factorylm.com`. No inbound, no VPN, no reverse tunnel, no MIRA agent polling their PLC.
- Tag reads are **allowlist-first, read-by-default**; an un-allowlisted tag is invisible to MIRA.
- **No write path ships.** "The cloud reasons; the gateway carries."

This is what lets a customer's IT say yes. It is also why MIRA must resist scope creep toward "just let us write one little setpoint" — that single feature would re-open the firewall conversation that the whole architecture exists to avoid.

## Business implications

- **Land via Ignition.** The Ignition Module + Exchange listing (`docs/specs/ignition-exchange-spec.md`, #1625) is the lowest-friction way into shops that already run Ignition.
- **Don't force a stack.** Customers without Ignition can be served by the `mira-connect` MQTT/Sparkplug edge (#1627) over the *same* HMAC contract — but that's a later tier, not the wedge.
- **FlowFuse stays optional.** Adopting it is an internal ops decision triggered by multi-tenant scale, never a customer dependency (ADR-0016).
- **The compounding asset is the reasoning + the UNS/KG**, not the plumbing. Invest there.

## Bottom line

MIRA should be the **smart, grounded, read-only maintenance brain** that sits on top of whatever industrial nervous system the customer already trusts — Ignition first, plain MQTT/UNS as the bus, Node-RED as an edge bridge when needed, Sparkplug and FlowFuse only when the customer or scale demands them. The product is the reasoning and the citations; everything below is interchangeable plumbing we consume, not own.
