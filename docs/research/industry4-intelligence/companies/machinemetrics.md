# MachineMetrics

## Identity

- **Name:** MachineMetrics, Inc.
- **Website:** https://www.machinemetrics.com/
- **HQ:** Northampton, Massachusetts, USA
- **Category:** Real-time production intelligence + AI-powered machine monitoring + lightweight MES for discrete manufacturing
- **ProveIt involvement:** UNCONFIRMED
- **Industry 4.0 relevance score (1-5):** 4
- **MIRA overlap (1-5):** 3 — adjacent surface (production analytics, not maintenance copilot), but very similar AI thesis
- **Last reviewed:** 2026-05-19
- **Reviewer:** claude-code

## What they do (public summary)

MachineMetrics is a cloud-native IIoT platform built specifically for **discrete manufacturers** (CNC, metalworking, fabrication). Their edge gateway (MMEdge) ingests directly from CNC PLCs and legacy controls; the cloud platform delivers real-time OEE, downtime causes, part counts, and — as of Nov 2025 — **Max AI**, an "agentic digital workforce" layered on top of their MES surface. April 2026 release notes touch scheduling, configuration, and operator experience.

## Architecture (as publicly described)

- **Data model / hierarchy:** Machine-centric (specifically CNC + discrete machine assets). Hierarchy: facility → machine → run → part → cycle.
- **UNS / namespace approach:** UNCONFIRMED whether they publish a UNS or ISA-95 model externally. Their architecture is more "machine-streaming-to-cloud" than UNS-modeled.
- **Protocols supported:** FANUC FOCAS, MTConnect, OPC-UA, Modbus, Ethernet/IP. Strong CNC focus. MMEdge gateway covers ethernet/WiFi/cellular.
- **AI / ML usage:** **Max AI** — agentic digital workforce, unifies machine + ERP + tribal knowledge data. November 2025 launch. Their separate ["Production Lab"](https://www.machinemetrics.com/blog/production-lab-2026-ai-manufacturing-applications) blog talks about customers building their own MES apps "in two days" with AI.
- **Hosting / deploy model:** Cloud-native SaaS + edge appliance (MMEdge).
- **Notable repos:** UNCONFIRMED public OSS presence.
- **Notable screens / UX:** Dashboards (OEE, downtime, part counts), production schedule, operator app on shop-floor tablets. Strong CNC-shop UX bar.

## Maintenance / CMMS / PLC relevance

- **Maintenance:** Indirect — downtime analytics surface maintenance triggers, but they're not a CMMS and don't own work-order lifecycle.
- **CMMS:** Integrate via API to ERP / CMMS. Not their wedge.
- **PLC:** Strong direct read of CNC controls (FANUC FOCAS, MTConnect). Read-only.

## Business model

- Enterprise / SMB SaaS, per-machine pricing typical (UNCONFIRMED specific tiers).
- Channel partners (e.g., WM Synergy resellers) plus direct sales.
- ICP: discrete CNC shops, metal fabricators, contract manufacturers (10-200 machines).

## Public sources

| Source | Type | URL | Date read | Notes |
|---|---|---|---|---|
| Reinventing the IoT Platform for Discrete Manufacturers | docs | https://www.machinemetrics.com/reinventing-the-iot-platform | 2026-05-19 | Architecture overview |
| Homepage | docs | https://www.machinemetrics.com/ | 2026-05-19 | "Intelligent MES and AI-Powered Machine Monitoring" positioning |
| Industrial IoT Platform page | docs | https://www.machinemetrics.com/industrial-iot-platform | 2026-05-19 | Edge + cloud pipeline |
| Production Lab 2026 AI manufacturing apps | blog | https://www.machinemetrics.com/blog/production-lab-2026-ai-manufacturing-applications | 2026-05-19 | "Build your own MES apps in 2 days" thesis |
| Impact of Industrial Data Platforms blog | blog | https://www.machinemetrics.com/blog/industrial-data-platform | 2026-05-19 | Their framing of "industrial data platform" |
| Capterra entry | review | https://www.capterra.com/p/159410/MachineMetrics/ | 2026-05-19 | Feature list + integrations |

## What MIRA should emulate

- **MMEdge directly speaks CNC protocols (FANUC FOCAS, MTConnect).** When MIRA targets discrete machining customers, having a CNC-fluent grounding (tool wear, spindle load, cycle time semantics) will be table stakes. Not today's priority but a real future requirement.
- **"Agentic" framing** — they market AI as "agentic digital workforce." Confirms market is ready for the agent narrative, but the term is being commoditized. MIRA should avoid generic agent-speak and lean on *grounded* + *gated* as the differentiators.
- **Operator UX bar.** Their shop-floor tablet UI sets expectations any maintenance copilot will be measured against. If MIRA ever has a non-Slack mobile / kiosk surface, study this UX.

## What MIRA should avoid

- **Don't try to be an MES.** Same lesson as Tulip. The "intelligent MES" positioning is well-defended in discrete.
- **Don't anchor on CNC.** MachineMetrics owns CNC-shop SaaS. MIRA's ICP is broader — multi-PLC plants where the wedge is **maintenance**, not production analytics.
- **Don't slip into machine-monitoring positioning.** "Downtime analytics" is their sale. MIRA's sale is "what to do when downtime happens" — adjacent but different.

## Integration opportunity

- **Medium.** Plausible vector: read downtime events from MachineMetrics → trigger MIRA in Slack with the affected machine's UNS context preloaded. Demo-able. Could be a Zapier/Make.com tier-1 integration.
- Channel angle: partner with one of their CNC-shop resellers (e.g., WM Synergy) to demo MIRA-on-top.

## Threat level to MIRA (low / medium / high)

- **Score:** Low-Medium
- **Why:** Different surface (production analytics) and different ICP (CNC discrete). But Max AI's "agentic" framing means they'll be in conversations where MIRA is, and a customer might conflate. Sharp positioning beats it.

## Usefulness score for MIRA learning (1-5)

- **Score:** 4
- **Why:** Best example of an adjacent SaaS that has already shipped an "agentic" AI layer for manufacturing. Read their Max AI announcement before drafting MIRA's agent messaging.

## Open questions

- [ ] What does Max AI actually do — chat, automate, recommend? UNCONFIRMED depth.
- [ ] Does it cite sources / show evidence?
- [ ] Does Max AI ground in a UNS or in MachineMetrics' proprietary machine schema?
- [ ] Integration shape with CMMS — push, pull, both?
- [ ] Public pricing for Max AI tier?

## MIRA lessons (1-3 bullets)

- "Agentic" is being said by everyone. Lean on grounded + gated + cited in MIRA messaging, not on agent-speak alone.
- A MachineMetrics-event → MIRA-Slack-with-UNS-context demo is a credible discrete-manufacturing flagship demo. Park as a feature idea.
- Watch their evolution from "monitoring" to "intelligence + recommendations." If they cross into telling techs *what to do* with citations, the threat ranking rises.
