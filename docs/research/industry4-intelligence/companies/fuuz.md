# Fuuz

## Identity

- **Name:** Fuuz
- **Website:** https://www.fuuz.com/
- **Category:** Manufacturing iPaaS + PaaS — "Unified Manufacturing Platform" (UMP) layering MES, WMS, APS, Quality, CMMS, monitoring on top of a UNS
- **ProveIt involvement:** **Exhibited at ProveIt! 2026 in Dallas** — categorized as "DataOps as part of larger platform" alongside MachineMetrics + AVEVA. ([Source: LNS Research](https://blog.lnsresearch.com/proveit-2026-all-about-uns-knowledge-graphs-and-claude-code).)
- **Industry 4.0 relevance score (1-5):** 4
- **MIRA overlap (1-5):** 4 — they bundle a CMMS module under their UMP umbrella; the maintenance-app surface overlaps
- **Last reviewed:** 2026-05-19
- **Reviewer:** claude-code

## What they do (public summary)

Fuuz pitches a **Unified Manufacturing Platform (UMP)** — an iPaaS + PaaS built for manufacturers, anchored on a UNS data layer. The platform's modules cover MES, WMS, APS, Quality, **CMMS**, and production/process monitoring. Their thesis is "one platform, one UNS, many manufacturing applications." Distributed via partners (e.g., Strategic Information Group).

## Architecture (as publicly described)

- **Data model / hierarchy:** UNS at the core, with "universal language of common names for data points across all systems," feeding ERP, IIoT, MES, CMMS, etc. into a unified data model.
- **UNS / namespace approach:** Explicit UNS — Fuuz's UMP = UNS + ontology / governance + modular applications. Closer to HighByte's framing (model + apps) than HiveMQ's (broker = UNS).
- **Protocols supported:** OPC-UA, MQTT, REST, integrations to ERP (NetSuite first-class — Fuuz is closely tied to the NetSuite ecosystem), CRM, IIoT devices.
- **AI / ML usage:** UNCONFIRMED — analyst commentary suggests AI features are in their roadmap but **no specific shipping AI / LLM surface** is described as of 2026-05-19 in the sources I read. Worth a deeper dive.
- **Hosting / deploy model:** Cloud SaaS + edge connectors.
- **Notable repos:** UNCONFIRMED public OSS footprint.
- **Notable screens / UX:** Module-by-module dashboards; ontology / data-mapping admin UI. Built for the manufacturing IT team, not the line operator.

## Maintenance / CMMS / PLC relevance

- **Maintenance:** **Direct.** Fuuz ships a CMMS module as part of UMP. Worth understanding the depth — is it a real CMMS or a checkbox?
- **CMMS:** **In-platform.** This is the closest Tier 1 product to "everything in one place," and the angle where Fuuz could collide with MIRA + Atlas.
- **PLC:** Reads via OPC UA / MQTT. Not a PLC programming tool.

## Business model

- Enterprise / mid-market SaaS via the platform + module licensing model.
- Strong NetSuite-ecosystem channel; resellers like Strategic Information Group, RF-SMART affiliations.
- ICP: discrete + process manufacturers running NetSuite ERP that want a UNS + manufacturing apps without stitching 6 vendors.

## Public sources

| Source | Type | URL | Date read | Notes |
|---|---|---|---|---|
| Fuuz homepage | docs | https://www.fuuz.com/ | 2026-05-19 | UMP + UNS positioning |
| Embracing the Future: UNS + UMP blog | blog | https://www.fuuz.com/fuuz-blog/embracing-the-future-unified-namespaces-and-unified-manufacturing-platforms-in-modern-manufacturing | 2026-05-19 | Their UMP thesis |
| Architecture page | docs | https://www.fuuz.com/infrastructure/platform-architecture/ | 2026-05-19 | Architecture overview |
| MES module | product page | https://www.fuuz.com/fuuz-modules/manufacturing-execution-system-mes | 2026-05-19 | MES module surface |
| Tech-Clarity coverage (iPaaS modules) | analyst | https://tech-clarity.com/ipaas-and-modules-fuuz/20213 | 2026-05-19 | Independent analyst writeup |
| Tech-Clarity coverage (industrial intelligence platform) | analyst | https://tech-clarity.com/industrial-intelligence-platform/23104 | 2026-05-19 | Fuuz enterprise positioning |
| LNS Research — ProveIt 2026 coverage | analyst | https://blog.lnsresearch.com/proveit-2026-all-about-uns-knowledge-graphs-and-claude-code | 2026-05-19 | Names Fuuz as DataOps-embedded-in-platform exhibitor |

## What MIRA should emulate

- **Module catalog under a UNS.** Fuuz's framing — *one UNS, many apps* — is the most explicit public proof of MIRA's working model: KG + UNS + Slack copilot + Atlas CMMS as a coordinated set, not a single monolithic product.
- **NetSuite-ecosystem channel.** Targeting a single ERP/business-system ecosystem (NetSuite for them; Slack/Atlas for us) is a focused GTM lever.
- **"Universal language of common names" pitch.** This is the customer-facing language for what MIRA's UNS gate enforces. Steal the phrasing.

## What MIRA should avoid

- **Don't try to ship MES + WMS + APS modules.** That's the Fuuz lane, well-defended. MIRA stays maintenance-only.
- **Don't drift into NetSuite-tied positioning.** Our channel is Slack + technician workflow, not ERP-ecosystem-bound.

## Integration opportunity

- **Medium.** Fuuz's CMMS module is a candidate for a "MIRA grounds in your Fuuz UNS" integration. UNCONFIRMED public API depth — needs research.
- The strongest opening: Fuuz customers who picked the platform for the UNS but find the CMMS module thin. MIRA + Atlas can plug that gap.

## Threat level to MIRA (low / medium / high)

- **Score:** Medium
- **Why:** They already have a UNS + CMMS module under one roof and an active analyst story. If they layer a credible LLM copilot on top, the wedge tightens. But their motion is platform-sale + module-catalog, which is slower to ship and slower to demo than MIRA's grounded-Slack-answer.

## Usefulness score for MIRA learning (1-5)

- **Score:** 5
- **Why:** Cleanest public articulation of "UMP = UNS + many apps." Useful both for messaging (validate our shape) and for competitive positioning (Slack-first vs platform-suite).

## Open questions

- [ ] What's the depth of the Fuuz CMMS module — is it MaintainX-level, or just a checkbox?
- [ ] Public API for reading the UNS / models?
- [ ] Any shipping LLM features as of 2026-05-19?
- [ ] How customers reconcile Fuuz CMMS module with an existing MaintainX / Limble / Fiix install?
- [ ] Pricing model — per-module or bundle?

## MIRA lessons (1-3 bullets)

- Fuuz proves the **bundled** market exists — customers will buy "one platform with a UNS and many apps." MIRA's correct counter-positioning is **specialist** — we're the best at grounded maintenance chat, and we plug into whichever UMP/UNS the customer chose.
- Watch for Fuuz to ship an LLM copilot. If they do, MIRA's response is the same as for MaintainX: lean on Slack-first + cross-PLC UNS + measurable groundedness.
- "Universal language of common names" is good marketing copy. Borrow the phrase (or a derivative) for MIRA's UNS-gate messaging.
