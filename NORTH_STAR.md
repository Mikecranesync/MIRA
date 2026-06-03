# FactoryLM North Star

**FactoryLM is a maintenance digital transformation firm. We turn messy maintenance reality into AI-ready infrastructure. MIRA is the execution layer that runs on top.**

The product is **the transformation**. The flywheel is what makes each transformation cheaper and faster than the last.

## The Three Offers (commercial layer)

1. **Assessment** ($500) — walk the floor, score Maintenance AI Readiness, deliver gap report + namespace blueprint.
2. **Pilot** ($2–5K/mo) — structure one line: nameplates, manuals, PLC tags, PMs, fault history. MIRA goes live on that scope.
3. **Operating Layer** ($499/mo) — MIRA in production. Continuous structuring as the plant evolves.

See `STRATEGY.md` for the full commercial logic.

## The Flywheel (technical layer)

1. We structure a plant → its **Maintenance Intelligence Namespace** is captured (assets, docs, tags, history)
2. Every structuring increases our reusable inventory: parsed manuals, OEM PM templates, fault pattern libraries, PLC tag-mapping heuristics
3. Each next plant is faster + cheaper to structure because we already have the OEM patterns
4. MIRA on top of the namespace gives the plant grounded answers, captures more knowledge, and feeds back into the inventory
5. The cost-to-structure curve drops; the moat compounds

## This Is The Product

Infrastructure first. AI second. Every customer engagement starts with **"what does your maintenance world actually look like?"** — not with a chatbot demo.

Everything in the repo — `mira-pipeline`, `mira-mcp`, `mira-bots`, `mira-web`, `mira-cmms`, `mira-crawler` — is supporting infrastructure for delivering and operating that namespace.

## The Canonical Asset Graph (the next evolution)

> Added 2026-06-02. This sharpens — does not replace — the doctrine above. The "Maintenance
> Intelligence Namespace" and the "canonical asset graph" are the same artifact at two altitudes:
> the namespace is what we *sell*; the asset graph is what it *is* under the hood.

"AI-ready infrastructure" has a concrete shape: a **canonical industrial asset graph** that is the
**translation layer between plant-floor OT and enterprise maintenance systems.**

- **In:** semi-structured customer reality from every direction — IBM Maximo, SAP, MaintainX,
  Fiix, Limble; Ignition, MQTT/Sparkplug B, OPC UA, historians; manuals, wiring diagrams, PLC
  tags, nameplates, and technician knowledge.
- **Through:** one canonical graph (`kg_entities` + `kg_relationships`, ISA-95 `uns_path`
  addressing, `proposed → verified` approval state, confidence on every edge) — with the
  **original source record preserved**, never normalized-and-discarded.
- **Out:** the reasoning layer AI agents ground in, *and* a bidirectional bridge — OT signal
  meaning flows up to enterprise CMMS/ERP; enterprise asset structure flows down to the plant
  floor — without MIRA replacing either system or ever writing to a PLC.

**The graph IS the product.** The copilot, the connectors, the Hub, the bots are how the graph
gets built and used. Two architectural commitments make this defensible:

1. **Build the canonical graph first, connectors around it.** No connector owns a shape; each maps
   *into* the canonical model and keeps its raw record. We never hardcode around one system.
2. **Read-only for OT by default.** MIRA observes the plant floor; it never controls it.

This reframes the Knowledge Cooperative moat: every plant we structure deepens a *shared canonical
graph* of OEM components, fault patterns, and tag-mapping heuristics — so each new plant maps onto
existing canonical nodes instead of starting blank. The asset graph is what compounds.

**Architecture docs:** `docs/mira/canonical-asset-graph.md` (the model),
`docs/mira/source-record-preservation.md` (raw-record layer),
`docs/mira/current-repo-inventory.md` (what's built), governed by
`docs/plans/2026-06-01-mira-master-architecture-plan.md`.

## The Decision Filter

Before building any feature, ask: **"Does this make the flywheel spin faster?"**

- Reusable OEM manual parsing? YES — directly drops structuring cost.
- New chat adapter (WhatsApp)? MAYBE — only if a paying plant needs it.
- Pretty dashboard chart? ONLY if it proves namespace quality to a buyer.
- Self-serve onboarding wizard? DEFER — we structure FOR them in the pilot, not via a wizard.

## The Maintenance Intelligence Namespace (core deliverable)

Status: PARTIALLY BUILT. This is what every pilot produces.

| Layer | Status | What |
|------|--------|------|
| Asset hierarchy (machine → sub-component) | 🔲 Schema only | Component model, parent/child links |
| Nameplate → asset binding | ✅ Built | Vision + OCR (mira-pipeline) |
| Manual ingest → cited RAG | ✅ Built | mira-ingest, 68K chunks indexed |
| PM schedule extraction | 🔲 NOT BUILT | LLM structured output from chunks |
| PLC tag ↔ asset reconciliation | 🔲 NOT BUILT | Ignition tag stream + asset matcher |
| Fault history capture (Telegram → structured RCA) | ✅ Partial | Adapter exists; RCA schema TBD |
| Tribal knowledge → structured notes | 🔲 NOT BUILT | Voice memo → structured RCA |
| CMMS write-back | ✅ Partial | Atlas integration; MaintainX via Nango next |

## The Knowledge Cooperative (long-term moat)

Operating-Layer plants who opt in share anonymized PM patterns and fault-resolution traces. A plant that pilots a Yaskawa GA500 — every subsequent plant with a GA500 starts ~80% structured for free. The more plants on the operating layer, the lower the structuring cost per new plant. **This is the network effect that makes the firm defensible.**
