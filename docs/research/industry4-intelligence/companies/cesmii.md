# CESMII — Clean Energy Smart Manufacturing Innovation Institute

## Identity

- **Name:** CESMII (Clean Energy Smart Manufacturing Innovation Institute) — "the Smart Manufacturing Institute"
- **Website:** https://www.cesmii.org/
- **Category:** **Non-profit Manufacturing USA institute** — standards body + reference architecture + Smart Manufacturing Innovation Platform (SMIP)
- **ProveIt involvement:** UNCONFIRMED direct; CESMII publishes SM Profiles standards used by many ProveIt-ecosystem members.
- **Industry 4.0 relevance score (1-5):** 5 (as a standards / interoperability lever)
- **MIRA overlap (1-5):** 2 — non-overlapping (standards body, not a product) but **highly relevant** as a UNS / interoperability source
- **Last reviewed:** 2026-05-19
- **Reviewer:** claude-code

## What they do (public summary)

CESMII is a U.S. federal Manufacturing USA institute (originally launched 2016 as the Clean Energy Smart Manufacturing Innovation Institute). They publish **SM Profiles** — standardized data contracts for industrial assets that ensure semantic interoperability between machines, processes, and applications. They also run a **Smart Manufacturing Innovation Platform (SMIP)** with a GraphQL API for accessing those models programmatically. The April 2026 release notes update the GraphQL API documentation. CESMII is **not** a commercial vendor — they fund research and curate standards.

## Architecture (as publicly described)

- **Data model / hierarchy:** SM Profiles — standardized data contracts per asset type / process type. They build on top of OPC UA Companion Specifications and ISA-95, layered with semantic mappings.
- **UNS / namespace approach:** Semantic interoperability standards layer that **fits inside** a UNS — SM Profiles are what a "model layer" (HighByte's framing) would consume to produce consistent payloads.
- **Protocols supported:** OPC UA (deeply), GraphQL (the SMIP API), MQTT-adjacent via partner platforms.
- **AI / ML usage:** Funded research; not a productized AI surface.
- **Hosting / deploy model:** SMIP is hosted; reference implementations are mostly OSS. See [github.com/cesmii](https://github.com/cesmii) for repos.
- **Notable repos:** [github.com/cesmii](https://github.com/cesmii) — multiple OSS repos including SM Profile SDKs, the SMIP API, and integration samples. **This is one of the highest-value Tier 1 GitHub orgs to deep-dive next.**
- **Notable screens / UX:** Reference admin UIs for managing SM Profiles and the SMIP marketplace. Not consumer-facing.

## Maintenance / CMMS / PLC relevance

- **Maintenance:** Indirect. SM Profiles include asset-type definitions that maintenance applications would consume.
- **CMMS:** Standards-side only.
- **PLC:** SM Profiles are designed for assets that emit data via OPC UA — typically through a PLC or a gateway.

## Business model

- Government-funded non-profit (DOE / Manufacturing USA). Membership-based; private sector members pay dues.
- Output: standards + reference implementations + research grants.
- ICP for membership: large manufacturers, technology vendors, universities.

## Public sources

| Source | Type | URL | Date read | Notes |
|---|---|---|---|---|
| CESMII homepage | docs | https://www.cesmii.org/ | 2026-05-19 | Mission + program overview |
| Smart Manufacturing: The Path to the Future | whitepaper | https://www.cesmii.org/smart-manufacturing-the-path-to-the-future/ | 2026-05-19 | Their thesis doc |
| GitHub org | repos | https://github.com/cesmii | 2026-05-19 | **Deep-dive candidate** — SM Profile SDKs + SMIP API + samples |
| Manufacturing USA institute page | gov | https://www.manufacturingusa.com/institutes/cesmii | 2026-05-19 | Institutional background |
| DOE program page | gov | https://www.energy.gov/cmei/ammto/collaborative-ecosystems-smart-manufacturing-innovation-institute-cesmii | 2026-05-19 | Funding context |
| AIChE writeup | external | https://www.aiche.org/AMPs/cesmii | 2026-05-19 | Chemical engineering association framing — useful for process side |

## What MIRA should emulate

- **SM Profiles as data contracts.** This is the cleanest public articulation of "semantic interoperability above OPC UA." MIRA's component templates are conceptually the same shape — per-asset-type definitions with attributes, tags, and relationships. We should check whether SM Profiles can be a *consumer* schema for MIRA component templates (i.e., we export to SM Profile format).
- **OSS + open standard motion.** CESMII's openness is a credibility signal we can lean on by aligning our schemas with their standards, even though we're a commercial product.
- **GraphQL API for hierarchies.** The SMIP GraphQL approach is a useful reference if MIRA ever needs to expose UNS / KG queries to external consumers (cleaner than REST for hierarchy navigation).

## What MIRA should avoid

- **Don't reinvent SM Profile equivalents from scratch.** If a public profile exists for an asset type MIRA targets (motor, drive, conveyor, packaging machine), align — don't fork.
- **Don't try to *become* a standards body.** Different scale, different motion. Be a *good citizen* of CESMII's standards instead.

## Integration opportunity

- **Medium-High (as a credibility lever).** Concrete vector: an exporter from MIRA's component templates → SM Profile format. This positions MIRA as standards-compatible without building one ourselves. Worth a small prototype.
- Joining CESMII as a small-vendor member could open conferences + customer introductions. UNCONFIRMED current membership tier pricing.

## Threat level to MIRA (low / medium / high)

- **Score:** Low (they don't compete — they enable)
- **Why:** Non-profit standards body. The risk is missing them, not facing them.

## Usefulness score for MIRA learning (1-5)

- **Score:** 5
- **Why:** Most credible neutral standards source for "what should our asset schema look like." Useful both as a learning input and as a credibility output.

## Open questions

- [ ] Which SM Profiles are most-used in our ICP (food & bev, packaging, discrete)? Pull from the SMIP marketplace.
- [ ] Is the SMIP GraphQL API stable + production-ready, or experimental?
- [ ] Are there public CESMII case studies featuring a "maintenance copilot" use case? (Probably not yet — opening for MIRA.)
- [ ] What does CESMII membership cost for a startup-tier vendor?
- [ ] Can we co-publish a case study or technical writeup demonstrating "MIRA grounded in SM Profiles"?

## MIRA lessons (1-3 bullets)

- The CESMII GitHub org is the single highest-priority deep-dive next sprint. Read SM Profile SDKs + SMIP API repos and consider an SM-Profile-shaped export from MIRA's component templates.
- "Standards-aligned" is a cheap, durable credibility lever for the enterprise sale. Lean on it.
- The CESMII GraphQL approach is a candidate reference architecture for the Hub's UNS query surface (`mira-hub/`). Worth a small ADR if we move that direction.
