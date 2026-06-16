---
name: mira-saas-scope-guard
description: Use whenever a feature request, customer ask, or PR proposes expanding MIRA's surface area. Classifies requests as Core SaaS / Adjacent / Defer to prevent feature creep and keep the product sellable as a focused maintenance-intelligence wedge.
---

# MIRA SaaS Scope Guard

Prevent feature creep. Keep the product sellable as a focused industrial-maintenance-intelligence SaaS.

The product wedge is **a Slack-first maintenance copilot that grounds answers in real factory context**. Anything outside that needs strong justification.

## Three tiers

### Core SaaS (do this)

These are the wedge. New features in these areas are usually good:

- Slack technician copilot
- UNS location-confirmation gate
- Manual ingestion (PDFs, drawings, datasheets)
- Component profile generation
- Work-order history mining
- PLC tag mapping
- Knowledge graph proposals (proposed → verified flow)
- Maintenance troubleshooting assistance (grounded)
- Demo plant generation (for onboarding + evals)

### Adjacent but careful (think hard, scope tight)

These connect MIRA to the broader factory stack. They unlock value but expand surface area — do them with **explicit per-tenant scope**, read-first, and a clear off-ramp:

- MQTT live monitoring (read-side; no writes)
- Sparkplug B integration (read-side; protocol bridge)
- Ignition integration (tag exports + read; no control)
- CMMS integration (Atlas, MaintainX, Fiix — REST read first, draft writes only)
- Customer-specific onboarding (paid, time-boxed, generates reusable profiles)

### Defer (don't build these)

These break the wedge. Push back hard:

- Full SCADA replacement
- Full CMMS replacement (we integrate, we don't replace)
- Arbitrary PLC control (writes to live equipment)
- Generic executive dashboards (we're not Power BI)
- Custom consulting-only dashboards (one-off, not reusable)
- Uncontrolled write access to live equipment (safety-critical)
- Generic chatbot functionality (we're not ChatGPT for factories)
- Voice-only interfaces as primary surface (Slack first)
- Public-facing marketing-driven content generation (not the product)
- Compliance / audit reporting as primary product (adjacent at best)

## Classifier flow

When invoked on a request:

1. **State the request in one sentence.** "Customer wants MIRA to display real-time tank levels on a tablet."
2. **Identify what it touches.** UI surface, MQTT layer, MCP, KG, ingestion, etc.
3. **Classify** — Core / Adjacent / Defer.
4. **If Core** — approve, point at the right module + skill.
5. **If Adjacent** — approve with constraints (read-first, draft-only, scoped, time-boxed).
6. **If Defer** — push back with the reason + suggest a scoped subset that IS in scope (e.g., "Real-time tank levels = no, but level alerts grounded in PM history = yes").

## Sample classifications

| Request | Tier | Reason |
|---|---|---|
| "Auto-fill component profiles from a photo upload" | **Core** | Ingestion + profile building. Build it. |
| "Slack technician asks 'why won't Conveyor_B16_Run turn on?'" | **Core** | UNS gate + grounded answer. Build it. |
| "Read live VFD speed from Modbus and include in answer" | **Adjacent** | Read-side, tag-mapped. OK with safety review. |
| "Show real-time downtime dashboard on a wall TV" | **Defer** | Generic dashboard. Not the wedge. |
| "Have MIRA send commands to the conveyor (stop, reset)" | **Defer** | PLC writes. Safety-critical. Out. |
| "Replace the customer's CMMS with MIRA-native work orders" | **Defer** | We integrate, we don't replace. |
| "Add Teams + Telegram support" | **Core/Adjacent** | Telegram exists; Teams = adjacent. Same engine. |
| "Build a marketing chatbot for the factorylm.com homepage" | **Defer** | Not the product. |
| "Audit-report PDF generator" | **Defer / Adjacent** | Defer unless tied to component-profile evidence chain. |
| "Detect repeat failures and suggest PM additions" | **Core** | Work-order miner. Build it. |

## What to do when invoked

1. Read the request carefully — is it a feature, a customer ask, or a PR?
2. Run the classifier flow above
3. Output the classification + 1–3 sentence justification + suggested scoped version if not Core
4. Cross-reference the right module and skill so the work goes to the right place

## Cross-references

- `.claude/CLAUDE.md` — product rules
- `.claude/skills/mira-architecture-guardian/SKILL.md` — architecture-level pushback
- `.claude/skills/uns-location-gate-designer/SKILL.md` — gate that anchors the wedge
- Root `CLAUDE.md` — current modules + deferred ones (mira-hud, mira-prototype archived; mira-connect deferred)
