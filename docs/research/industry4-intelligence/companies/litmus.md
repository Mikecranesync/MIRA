# Litmus

## Identity

- **Name:** Litmus Automation, Inc. (markets as "Litmus" / Litmus Edge)
- **Website:** https://litmus.io/
- **HQ:** San Jose, California, USA
- **Category:** Industrial Edge Data Platform — connectivity + DataOps + UNS + governance + AI
- **ProveIt involvement:** UNCONFIRMED, but Gartner Magic Quadrant Challenger for Global Industrial IoT Platforms — ecosystem-adjacent.
- **Industry 4.0 relevance score (1-5):** 5
- **MIRA overlap (1-5):** 3 — substrate overlap with our UNS, no maintenance copilot
- **Last reviewed:** 2026-05-19
- **Reviewer:** claude-code

## What they do (public summary)

Litmus ships **Litmus Edge**, an industrial edge data platform that connects OT to IT with 250+ out-of-the-box drivers, normalizes data, builds a UNS, and forwards into cloud platforms (Microsoft Azure IoT Operations + Microsoft Fabric is the headline integration as of April 2026). Self-described as "connectivity, DataOps, UNS, governance, and AI in one architecture." Recognized as a Gartner Magic Quadrant Challenger for Global Industrial IoT Platforms.

## Architecture (as publicly described)

- **Data model / hierarchy:** Asset-centric model on the edge, normalized into a UNS shape suitable for cloud consumption. ISA-95-aligned in their marketing.
- **UNS / namespace approach:** Litmus markets itself as a complete UNS solution at the edge. Their position is closer to HighByte's (model + plumbing) than HiveMQ's (broker = UNS), but they pitch it as a turnkey package — less explicit modeling layer, more "we make UNS easy."
- **Protocols supported:** 250+ connectors: Modbus, OPC-UA, Ethernet/IP, S7, MQTT (incl. Sparkplug B), REST, file. Edge Bridge to Microsoft Azure IoT Operations announced April 2026.
- **AI / ML usage:** Marketed as "AI-ready" data platform. Their blog ["Every Cloud Needs a Golden Edge"](https://litmus.io/blog/every-cloud-needs-a-golden-edge-finding-the-best-of-both-worlds) lays out the "edge + cloud AI" pattern. They publish AI pipelines that run on the edge for inference. Not a chatbot / agent product themselves.
- **Hosting / deploy model:** Edge-deployed software (Linux containers + virtual appliances), with cloud-side management.
- **Notable repos:** UNCONFIRMED meaningful public OSS presence. Worth a `gh repo` scan in a follow-up.
- **Notable screens / UX:** Litmus Edge Manager UI — connector list, data model editor, flow designer. Admin-facing.

## Maintenance / CMMS / PLC relevance

- **Maintenance:** None directly. Their analytics layer (forecasting, anomaly detection) can be aimed at maintenance use cases.
- **CMMS:** No native CMMS. Integrates via connectors.
- **PLC:** Strong driver coverage; read-only tag ingest is their wheelhouse.

## Business model

- Enterprise SaaS / per-deployment licensing. UNCONFIRMED specific tiers.
- Channel partners: Cloudera, Microsoft Azure (deep), AWS.
- ICP: enterprise manufacturers, energy, water, multi-plant operations needing OT/IT bridge.

## Public sources

| Source | Type | URL | Date read | Notes |
|---|---|---|---|---|
| Litmus homepage | docs | https://litmus.io/ | 2026-05-19 | "Connectivity, DataOps, UNS, governance, AI" framing |
| Litmus + Azure IoT Operations | blog | https://litmus.io/blog/azure-iot-operations-microsoft-litmus | 2026-05-19 | Edge Bridge architecture, schema-aware data assets |
| Litmus Launches Edge Bridge for Azure IoT Operations | press | https://www.bignewsnetwork.com/news/279001343/ | 2026-05-19 | April 2026 launch details |
| Litmus Edge Review 2026 (MachineCDN) | external review | https://www.machinecdn.com/blog/litmus-review-2026/ | 2026-05-19 | Independent (3rd-party) review — biased toward selling MachineCDN but useful counterweight |
| Cloudera + Litmus | partner page | https://www.cloudera.com/partners/solutions/litmus-edge.html | 2026-05-19 | Cloudera Data-Lake integration pattern |
| Golden Edge blog | blog | https://litmus.io/blog/every-cloud-needs-a-golden-edge-finding-the-best-of-both-worlds | 2026-05-19 | Edge-AI architecture thesis |
| ARC Advisory writeup | analyst | https://www.arcweb.com/blog/integration-between-azure-iot-operations-litmus-edge-automates-industrial-data-onboarding | 2026-05-19 | Analyst framing of the Azure integration |

## What MIRA should emulate

- **250+ connectors as table stakes** — Litmus's connector coverage is what enterprise customers expect. MIRA does not need to match this; we sit on top of whatever they (or HighByte, or Ignition) bring. But the message "we connect to anything" sells; ours needs to be "we ground in whatever you already have connected."
- **Azure IoT Operations bridge** — the "schema-aware data assets" framing is a useful pattern. If MIRA reads from Azure IoT Operations directly in some future enterprise deal, this is the integration shape to study.
- **"In-line data processing"** — filtering / enrichment / transformation before cloud. Validates `mira-bridge/` and `mira-relay/` edge-side enrichment patterns.

## What MIRA should avoid

- **Don't sell "we connect to your PLCs."** Litmus / HighByte / Ignition own that. MIRA's wedge is "we make sense of what's already connected," not "we connect."
- **Don't try to be a Gartner-MQ platform.** Their breadth is their value prop; ours is depth on one workflow (maintenance).

## Integration opportunity

- **Medium.** Concrete vector: read UNS / asset model out of Litmus Edge via their REST API into MIRA's KG for a shared customer. Litmus does the OT ingest; MIRA does the maintenance copilot on top.
- Lower-effort: Litmus → MQTT broker → MIRA relay (Sparkplug B subscriber) is a working architecture without any direct Litmus dependency.

## Threat level to MIRA (low / medium / high)

- **Score:** Low
- **Why:** Different ICP (large enterprise) + different surface (admin/DataOps team). No conversational maintenance product. Watch only if they ship a Litmus-branded copilot, which would be out-of-character.

## Usefulness score for MIRA learning (1-5)

- **Score:** 4
- **Why:** Best example of an "all-in-one" UNS + edge story. Useful to understand how customers compare MIRA's narrower wedge against an end-to-end edge platform.

## Open questions

- [ ] Litmus Edge data model — what's the schema for an asset / tag / hierarchy in their REST API?
- [ ] Is the Azure IoT Operations Edge Bridge production-ready, or preview-only as of April 2026?
- [ ] How many maintenance-specific case studies do they publish vs production-analytics ones?
- [ ] Any first-party LLM features on the roadmap?

## MIRA lessons (1-3 bullets)

- Litmus is the cleanest example of a competitor where MIRA's right answer is **"complement, don't replace."** When a customer evaluates both: they need Litmus (or HighByte, or Ignition) for the OT plumbing, and MIRA for the technician-facing copilot. The two roles do not conflict.
- The Azure IoT Operations Edge Bridge is a reminder that **major cloud vendors are productizing UNS at the platform layer**. If Azure IoT Operations becomes the dominant UNS substrate at enterprise, MIRA needs a first-class ingest path. Park as research question.
- "Connectors as moat" is not MIRA's lane. Stay on the grounded-answer-quality axis.
