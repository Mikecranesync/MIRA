# Tulip

## Identity

- **Name:** Tulip Interfaces, Inc.
- **Website:** https://tulip.co/
- **HQ:** Somerville, Massachusetts, USA
- **Funding / ownership:** $120M Series D (2025), Mitsubishi Electric strategic investment + alliance (Jan 2026)
- **Category:** Frontline Operations Platform (FOP) / composable MES alternative
- **ProveIt involvement:** UNCONFIRMED
- **Industry 4.0 relevance score (1-5):** 5
- **MIRA overlap (1-5):** 3 — different surface (production line worker) but same plant + same AI thesis
- **Last reviewed:** 2026-05-19
- **Reviewer:** claude-code

## What they do (public summary)

Tulip ships a **no-code app builder for frontline operations** — production workers configure step-by-step apps that run on touch-screens, tablets, or kiosks at the line. The platform connects machines, sensors, vision systems, and ERP/MES backends, with AI features layered on top: AI Chat (LLM query over operations context), Computer Vision, Forecasting Analytics. Their 2026 positioning is "AI-native composable platform." Series D ($120M) closed 2025; Mitsubishi Electric alliance signed Jan 2026.

## Architecture (as publicly described)

- **Data model / hierarchy:** "Tables" + "Records" — a flexible, customer-defined data model (not a fixed ISA-95 hierarchy). Apps consume Tables.
- **UNS / namespace approach:** **No native UNS in the HighByte/HiveMQ sense.** Tulip has its own connectors layer; UNS-equivalent context is built per-customer in Tables. INFERENCE: Tulip is FOP-centric; UNS is adjacent but not the wedge.
- **Protocols supported:** REST, MQTT (UNCONFIRMED Sparkplug B compliance), OPC-UA, edge connectors, integrations to Salesforce, NetSuite, SAP, Snowflake.
- **AI / ML usage:** AI Chat over "the full context of operations in plain language, documents, videos, edge and connected-system data" (tulip.co/platform/tulip-ai). Computer vision for assembly verification. Forecasting in Analytics. Their AI is **embedded inside their app builder**, not exposed as a generic API.
- **Hosting / deploy model:** SaaS + Edge devices ("Edge IO," "Edge MC"). AWS Marketplace listing for managed deployments.
- **Notable repos:** Tulip publishes a small set of community apps and SDKs but **does not have a heavy public OSS GitHub footprint** — UNCONFIRMED. Plays community via [Tulip Library](https://tulip.co/library/).
- **Notable screens / UX:** Drag-and-drop App Builder; touch-friendly operator apps; analytics dashboards. Their UX bar is high — this is a benchmark for any "frontline" surface MIRA touches.

## Maintenance / CMMS / PLC relevance

- **Maintenance:** Indirect. Operators may log issues that flow to a CMMS, but Tulip is **production-line-worker-first**, not maintenance-tech-first.
- **CMMS:** Integrate via Tables / connectors. Tulip does not own the work-order record.
- **PLC:** Read PLC tags via Edge devices. Common pattern: an operator app shows a PLC value alongside a procedure step.

## Business model

- Enterprise SaaS subscription (per-app, per-station, or per-site — UNCONFIRMED specifics).
- AWS Marketplace + direct sales + partner ecosystem (Mitsubishi, Zebra Technologies partnership Oct 2025).
- ICP: large discrete manufacturers, electronics assembly, medical-device, automotive Tier-1.

## Public sources

| Source | Type | URL | Date read | Notes |
|---|---|---|---|---|
| Tulip homepage | docs | https://tulip.co/ | 2026-05-19 | "AI-native composable platform" positioning |
| Tulip $120M Series D press | press | https://tulip.co/press/tulip-secures-120m-series-d/ | 2026-05-19 | Funding + "AI superpowers" framing |
| What is Tulip? | docs | https://support.tulip.co/docs/what-is-tulip | 2026-05-19 | Platform architecture overview |
| Tulip AI | product page | https://tulip.co/platform/tulip-ai/ | 2026-05-19 | AI Chat + Vision + Forecasting features |
| AWS Marketplace listing | partner | https://aws.amazon.com/marketplace/pp/prodview-mmwjgxauyy2xy | 2026-05-19 | Deploy model + integration angle |

## What MIRA should emulate

- **AI Chat over operations context** is the closest public analog to MIRA's grounded chat — but they ground in their own Tables, not a UNS / KG. The UX expectation it sets in the market is real: customers will increasingly *expect* "ask the system in plain language." MIRA's groundedness story is the differentiator.
- **App composability**: even if MIRA doesn't ship an app builder, the Hub admin surface should feel composable (drag/drop UNS, click-to-attach component templates) — not engineer-only.
- **Partner-driven distribution.** Mitsubishi's alliance is the playbook for any future MIRA OEM deal (Rockwell, Siemens, Atlas Copco, etc.).

## What MIRA should avoid

- **Don't try to be an MES.** Tulip is well-funded and entrenched in the frontline-operations seat. Drifting toward production work instructions = scope creep (cross-reference `.claude/skills/mira-saas-scope-guard/SKILL.md`).
- **Don't replicate "Tables as universal data model."** It's powerful but loose. MIRA's wedge is the **opinionated** UNS+KG, not a generic schema. Stay opinionated.
- **Don't market as "AI for the frontline" generically** — that's the Tulip lane. MIRA's lane is narrower: "Grounded maintenance copilot."

## Integration opportunity

- **Medium.** Possible vector: a MIRA "ask MIRA about this asset" affordance inside a Tulip app — operator hits a button, MIRA opens a grounded thread in Slack. UNCONFIRMED whether Tulip has the embed primitives.
- Lower-effort: pull Tulip Tables → MIRA KG as a one-way enrichment for shared customers.

## Threat level to MIRA (low / medium / high)

- **Score:** Low-Medium
- **Why:** Adjacent surface (line operator, not maintenance tech) and adjacent buyer. But the AI Chat feature **does** demo against the same customer "I want to ask my plant questions" instinct. Differentiation is in the depth of grounding + the choice of surface (Slack vs touch-panel).

## Usefulness score for MIRA learning (1-5)

- **Score:** 4
- **Why:** Best example of a frontline-first AI product that's already in market. Their UX bar (kiosk → mobile → desktop continuity) is what customers will expect.

## Open questions

- [ ] Does Tulip AI Chat cite source documents / Table rows the way MIRA cites manuals + work orders + KG edges?
- [ ] What does the AI Chat refusal / fallback behavior look like when the answer isn't in their data?
- [ ] Pricing model — per-app / per-seat / per-site?
- [ ] Are there published customer case studies that include **maintenance** specifically (vs production)?

## MIRA lessons (1-3 bullets)

- "AI Chat over operations" is becoming table stakes. The differentiation is **what** the AI grounds in. MIRA's grounded-in-UNS+KG+manuals+WO is more defensible than grounded-in-flexible-Tables — but only if we keep enforcing the gate.
- Watch Tulip's Mitsubishi alliance as a template for OEM go-to-market. When MIRA's wedge stabilizes, an analogous alliance (e.g., with Rockwell, Atlas Copco, or a CMMS vendor) is a credible scaling path.
- The "frontline app" surface is well-defended. Don't drift toward it; keep MIRA's surface in Slack + Hub + (eventually) Teams.
