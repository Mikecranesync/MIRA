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
