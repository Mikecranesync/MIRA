# MaintainX

## Identity

- **Name:** MaintainX
- **Website:** https://www.getmaintainx.com/
- **HQ:** Montreal, Canada
- **Funding / ownership:** Unicorn (Series D from 2024 onward); public funding history confirms B2B SaaS scale.
- **Category:** CMMS / mobile-first maintenance + AI copilot
- **ProveIt involvement:** UNCONFIRMED (not natively a ProveIt ecosystem company — CMMS-adjacent)
- **Industry 4.0 relevance score (1-5):** 4
- **MIRA overlap (1-5):** 5 — closest direct competitor on the AI-for-maintenance axis (single highest threat level in Tier 1)
- **Last reviewed:** 2026-05-19
- **Reviewer:** claude-code

## What they do (public summary)

MaintainX is the **mobile-first CMMS leader** for non-desk maintenance teams. Their AI surface, **MaintainX CoPilot**, generates work orders from OEM manuals + history, summarizes voice notes into work orders, analyzes photos of assets, predicts work-order durations, and answers maintenance questions from uploaded asset manuals. The April 2026 release added sub-work orders, nested maintenance plans, and part-availability awareness — i.e., they continue to deepen the work-order surface alongside the AI features.

## Architecture (as publicly described)

- **Data model / hierarchy:** Asset hierarchy (location → asset → sub-asset) + work orders + procedures + parts + meters. Not ISA-95-shaped; CMMS-domain-shaped.
- **UNS / namespace approach:** None. MaintainX is not a UNS product; it integrates with CMMS-adjacent ERP/asset systems but does not model the plant in OT terms.
- **Protocols supported:** REST API, integrations to Slack, Microsoft Teams, SSO providers, ERP (NetSuite, SAP), IoT integrations via partners (UNCONFIRMED first-party Sparkplug B support).
- **AI / ML usage:** CoPilot — work order generation from manuals, voice → work order summary, photo → recommended actions (visual analysis), predictive durations from historical data, conversational Q&A grounded in uploaded asset manuals.
- **Hosting / deploy model:** SaaS only. Cloud-hosted. Mobile apps (iOS + Android) are the primary surface.
- **Notable repos:** No significant public OSS footprint. Closed-source SaaS.
- **Notable screens / UX:** Mobile-first work-order list, asset detail with PM schedule, conversational interface inside the app for CoPilot. The mobile UX is the gold standard for maintenance-tech mobile UI — even if we don't pursue mobile-first, study it.

## Maintenance / CMMS / PLC relevance

- **Maintenance:** Core product. They define the SaaS bar for CMMS / mobile maintenance.
- **CMMS:** They **are** the CMMS for many SMB and mid-market plants. Atlas (our CMMS) is positioned differently — internal-to-MIRA, more deeply integrated with the diagnostic engine.
- **PLC:** Not directly. They consume IoT-style sensor data via integrations, not native PLC drivers.

## Business model

- Per-user SaaS subscription (Free / Essential / Premium / Enterprise tiers publicly priced).
- Self-serve PLG funnel + outbound sales for mid-market.
- ICP: facilities, manufacturing SMB and mid-market, food & bev, hospitality, fleet maintenance.

## Public sources

| Source | Type | URL | Date read | Notes |
|---|---|---|---|---|
| Meet MaintainX CoPilot | blog | https://www.getmaintainx.com/blog/maintainx-copilot-ai-assistant-for-maintenance | 2026-05-19 | Core CoPilot feature set |
| AI for Maintenance Teams | product page | https://www.getmaintainx.com/use-cases/ai-powered-maintenance-operations | 2026-05-19 | "Smarter CMMS with MaintainX AI" pitch |
| About Work Orders | docs | https://help.getmaintainx.com/about-work-orders | 2026-05-19 | Work-order data model |
| April 2026 release notes | docs | https://help.getmaintainx.com/help-center-updates/april-2026 | 2026-05-19 | Sub-WO, nested plans, part availability |
| Capterra 2026 entry | review | https://www.capterra.com/p/179296/GetMaintainx/ | 2026-05-19 | Feature list + integrations |
| AI-Powered CMMS comparison | review | https://limble.com/learn/cmms-ai-powered-solutions | 2026-05-19 | Competitive landscape (Limble's framing — biased but useful) |
| Google Play app | app | https://play.google.com/store/apps/details?id=com.commas.client | 2026-05-19 | Production mobile app, public install base |

## What MIRA should emulate

- **Asset-document → AI answer pipeline** — they upload manuals to assets and ground answers in them. This is exactly what MIRA does with `mira-crawler/ingest/` + KG + manual chunks; the public proof is that the pattern works at scale.
- **Voice → structured work-order summary** — well-validated mobile UX pattern. Worth a feature idea for the MIRA Slack flow (record voice note in Slack thread → MIRA summarizes to a structured proposed-work-order in Atlas).
- **Predictive duration from history** — a low-risk, high-perceived-value ML feature. MIRA has the WO history substrate to do something similar.
- **Photo → recommended actions** — already in MIRA's product surface (photo ingest pipeline). MaintainX shipping it validates the demand.
- **Public pricing tiers** — they publish prices. Builds trust. Worth mirroring for MIRA's CMMS landing.

## What MIRA should avoid

- **Don't try to replace MaintainX as the work-order system of record.** That's a different sale, different buyer (maintenance manager vs maintenance tech), different switching cost. MIRA should integrate with MaintainX-the-CMMS the way it integrates with Atlas, not compete.
- **Don't be mobile-first.** MaintainX owns mobile. MIRA's Slack-first wedge is the differentiator. Trying to out-mobile MaintainX is a losing fight.
- **Don't market on "AI for CMMS"** — they're spending heavily on that phrase. MIRA's marketing should anchor on the **UNS confirmation gate** and **grounded evidence**, not on the AI side.

## Integration opportunity

- **High.** Concrete vector: a MaintainX → MIRA integration that pulls WO history into the KG and pushes MIRA's proposed work orders back. This is **the** integration to ship if we get a MaintainX customer asking. Track in roadmap as a partner-readiness item.
- Lower-effort: a Slack reply from MIRA that includes a "Create MaintainX work order from this" button (linkable, no auth refresh needed for ad-hoc demos).

## Threat level to MIRA (low / medium / high)

- **Score:** **High** — single highest in Tier 1.
- **Why:** They own the technician's mobile attention, they ship grounded AI, they have the work-order data MIRA needs to be useful, and they're well-funded. **If** MaintainX adds a Slack adapter that grounds in their data + manuals + work orders, the wedge narrows fast. MIRA's defense is (a) UNS gate they don't have, (b) cross-PLC OT grounding they don't have, (c) Slack-as-front-door commitment they haven't made.

## Usefulness score for MIRA learning (1-5)

- **Score:** 5
- **Why:** Closest direct comparison product in the market. Every CoPilot feature page is a hint at what enterprise CMMS buyers want and what MIRA will be measured against.

## Open questions

- [ ] Does CoPilot enforce a location / asset confirmation gate before answering, or does it answer freely once an asset is selected?
- [ ] Does CoPilot show citations (manual page numbers, WO IDs) on the answer surface?
- [ ] What's the model + provider stack? UNCONFIRMED — Anthropic? OpenAI? In-house?
- [ ] How do they handle multi-PLC plants where assets span OT systems?
- [ ] Pricing of the AI tier — is CoPilot bundled or a paid add-on?
- [ ] Have they shipped a Slack-first surface yet? (If yes — re-evaluate threat ranking.)

## MIRA lessons (1-3 bullets)

- MaintainX is the single most important Tier 1 file to keep current. Re-review at least quarterly. (Schedule via Routine.)
- The Slack-first wedge needs **sharper articulation** in marketing — assume a competent CMMS-side AI competitor will be raised in every sales call. The differentiator is (a) UNS gate, (b) cross-PLC OT grounding, (c) Slack as the technician's existing surface.
- "Voice → work order" is a credible, demo-able feature inside MIRA's Slack adapter. Park as a feature idea.
