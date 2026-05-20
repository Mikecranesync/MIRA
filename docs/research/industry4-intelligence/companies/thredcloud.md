# ThredCloud (Thred)

## Identity

- **Name:** Thred (product: ThredCloud)
- **Websites:** https://www.thredcloud.com/ (product), https://www.thred.cloud/ (parent / company)
- **Category:** Industrial DataOps platform — **knowledge-graph + AI on top of Ignition**
- **ProveIt involvement:** **Exhibited at ProveIt! 2026 in Dallas** — listed as a "pureplay Industrial DataOps provider" alongside Flow Software, FlowFuse, HighByte, HiveMQ, Litmus, MaestroHub. ([Source: LNS Research](https://blog.lnsresearch.com/proveit-2026-all-about-uns-knowledge-graphs-and-claude-code).)
- **Industry 4.0 relevance score (1-5):** 5 (highest learning-relevance to MIRA in this cohort)
- **MIRA overlap (1-5):** **5** — **closest architectural twin in this Tier 1 cohort**: explicit knowledge-graph + AI + natural-language query, Ignition-based
- **Last reviewed:** 2026-05-19
- **Reviewer:** claude-code

## What they do (public summary)

ThredCloud (built on Inductive Automation's **Ignition** platform) turns raw OT data into a **knowledge-graph-backed digital representation of the factory**. Factory teams query production in **plain language**; engineers build on a "unified model." Explicitly aims at **medium-sized factories** that lack production-metrics visibility and need **rapid SCADA modernization** + **root-cause analysis**. As of 2026-05-19 their public site shows the KG visual + factory-team UX as the headline.

The parent company **Thred** is a data engineering / purpose-built software development consultancy focused on industrial data (Co-founder: **Keiran Stokes** — confirmed via Cedalo case study). They moved off AWS IoT Core as the primary broker to **Cedalo (Pro Mosquitto)** to avoid vendor lock-in.

## Architecture (as publicly described)

- **Data model / hierarchy:** **Knowledge graph** — explicit nodes / edges representing factory relationships and machine contexts. Tag-derived + P&ID-derived + PLC-code-derived.
- **UNS / namespace approach:** Built **on Ignition's UNS** (Cirrus Link MQTT stack). They sit *above* the UNS as a contextualization layer. MQTT broker per Cedalo case study.
- **Protocols supported:** Inherits Ignition's protocol matrix (OPC-UA, Modbus, Allen-Bradley, Siemens, MQTT/Sparkplug B). Imports: PLC tags, P&ID diagrams, PLC code.
- **AI / ML usage:** **Yes — explicit.** Plain-language production-environment querying. The site doesn't name a specific LLM provider; INFERENCE: standard cloud LLM with KG-augmented retrieval. Not a chat copilot UX in the maintenance-tech sense — closer to a BI-via-natural-language surface.
- **Hosting / deploy model:** SaaS (cloud). UNCONFIRMED on-prem option.
- **Notable repos:** UNCONFIRMED public OSS footprint — likely closed-source.
- **Notable screens / UX:** Knowledge-graph visualizer; insights dashboard; factory-team imagery. Less "chat" than "graph-with-search."

## Maintenance / CMMS / PLC relevance

- **Maintenance:** **Indirect but adjacent.** Their root-cause-analysis hook touches maintenance, but they don't ship a CMMS or own work-order lifecycle.
- **CMMS:** No CMMS module in current public materials.
- **PLC:** Ingests PLC tags + PLC code + P&ID. Read-only.

## Business model

- "Affordable and flexible" — UNCONFIRMED specific pricing tiers.
- ICP: **medium-sized factories** (explicitly stated) — same band as MIRA's PLG funnel customers.
- Distribution: Ignition ecosystem + ProveIt ecosystem.

## Public sources

| Source | Type | URL | Date read | Notes |
|---|---|---|---|---|
| ThredCloud homepage | docs | https://www.thredcloud.com/ | 2026-05-19 | KG-on-Ignition + NL-query positioning |
| Thred company site | docs | https://www.thred.cloud/ | 2026-05-19 | Parent consultancy framing |
| Cedalo Pro Mosquitto case study | partner | https://cedalo.com/mqtt-broker-pro-mosquitto/mqtt-case-studies/thred/ | 2026-05-19 | Confirms MQTT broker choice + Keiran Stokes co-founder + AWS IoT Core → Mosquitto switch |
| LNS Research ProveIt 2026 | analyst | https://blog.lnsresearch.com/proveit-2026-all-about-uns-knowledge-graphs-and-claude-code | 2026-05-19 | Names Thred as pureplay DataOps; KG momentum + Claude Code mention |

## What MIRA should emulate

- **Knowledge graph as the contextualization layer above UNS.** This is exactly MIRA's pattern. ThredCloud is **the** public proof that KG-above-UNS-above-Ignition is a credible architecture and is being recognized at industry events.
- **Plain-language query as the BI surface.** Validates the AI-chat surface for non-technical factory teams — but their UX is dashboard-flavored, not chat-flavored. MIRA's Slack-first chat is the differentiator.
- **Medium-size-factory ICP positioning.** Same band as MIRA's PLG funnel. Our motion (Slack-first, self-serve trial via `factorylm.com/cmms`) is the right shape for this band.
- **Move-off-vendor-lock-in posture (Cedalo case study).** Validates MIRA's multi-broker, multi-PLC, multi-CMMS positioning.

## What MIRA should avoid

- **Don't position as "AI for BI."** ThredCloud's chat is closer to a BI-via-NL surface. MIRA is **maintenance-conversation-first** — the gate, the citations, the diagnostic state machine. Different lane.
- **Don't tie tightly to Ignition.** They built on Ignition; we work *with* Ignition + Rockwell FactoryTalk + Siemens WinCC + Mitsubishi GX Works etc. Stay vendor-neutral on the SCADA layer.

## Integration opportunity

- **High.** Cleanest potential partner in the Tier 1 cohort:
  - They model the factory as a KG; MIRA grounds maintenance conversations in a KG.
  - They built on Ignition; MIRA grounds in whatever the customer runs.
  - Shared customer flow: ThredCloud KG → MIRA Slack maintenance copilot grounded in that KG.
- **Concrete next step:** open a conversation with Thred about a reference integration. Their consulting business (parent Thred) means partnerships are part of their motion.

## Threat level to MIRA (low / medium / high)

- **Score:** **Medium-High** (closest architecturally; not yet in the same go-to-market lane)
- **Why:** They overlap on **KG-as-context** thesis, on **AI-over-factory-data**, on **medium-sized-factory ICP**, and they've already been recognized at ProveIt 2026. The differentiation is **maintenance-tech-conversation vs BI-via-NL**, and **Slack-first vs dashboard-first**. If they pivot to maintenance + Slack, the wedge narrows fast.

## Usefulness score for MIRA learning (1-5)

- **Score:** **5** (highest in cohort)
- **Why:** Closest architectural mirror. Read their site deeply; track changes quarterly.

## Open questions

- [ ] What's the LLM provider stack? Single-provider or cascade? Locally hosted?
- [ ] Does ThredCloud cite source data when answering NL queries? (Critical comparison to MIRA's groundedness scoring.)
- [ ] Is there a public API for the KG / query surface?
- [ ] Does Thred (parent) take on consulting work that competes with MIRA's onboarding, or do they always pull customers to ThredCloud?
- [ ] What's the relationship to Inductive Automation — partner, OEM, sublicensed?
- [ ] Has the Cedalo/Mosquitto broker switch made it into a published reference architecture?

## MIRA lessons (1-3 bullets)

- **ThredCloud is the single most important file in this library to re-read before any MIRA architecture decision.** They are the closest architectural twin and the cleanest validation that KG + AI + UNS-on-Ignition is a recognized category.
- The **dashboard-vs-chat front-door split** is MIRA's differentiation in this segment. Stay Slack-first. Stay maintenance-tech-conversation-first. Don't drift toward BI dashboards.
- **Partnership before competition.** Open a partnership conversation with Thred before competing for the same customer. (Decision-log candidate.)
