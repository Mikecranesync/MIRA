# Executive Summary — Industry 4.0 Intelligence

> Cross-cutting story across the library. Updated when a new finding materially changes the picture. Always read top-down — the lede is the most important paragraph.
>
> **Last updated:** 2026-05-19 (after initial Tier 1 sprint)

## TL;DR

The Industry 4.0 software landscape has bifurcated into:

1. **Platform plays** that try to own the whole stack — SCADA + UNS + analytics + apps (Ignition, Tulip, Litmus, Siemens Insights Hub). They are deep, expensive, and slow to deploy.
2. **DataOps plays** that own a layer — modeling + routing between OT and IT (HighByte, Cumulocity, partly CESMII). They thrive when the customer already has a vision and needs a wiring layer.
3. **Vertical SaaS plays** that own a workflow — CMMS (MaintainX), production analytics (MachineMetrics), predictive ops (TwinThread). They sell to a specific role, not a platform team.

**MIRA's wedge sits inside category 3**, but with a twist: instead of replacing the CMMS or the SCADA, MIRA **grounds a Slack-first maintenance copilot in the customer's real factory context** (UNS + KG + manuals + work-order history). The conversation is the front door; everything else is evidence.

The decisive bet — verified by every Tier 1 entry below — is that **grounding** is the moat, not the LLM. Anyone can wire ChatGPT to a CMMS. Almost nobody can answer "what's wrong with Line 2's case packer right now?" with citations to the UNS, the wiring diagram, and the last three work orders.

## What we learned this sprint

(Filled in after Phase 9. Until then, see `initial-research-library-report.md` for the live working notes.)

## Implications for MIRA

The three things MIRA must keep doing, validated by what other players do or fail to do:

1. **Hold the UNS gate.** No Tier 1 conversational product confirms site / area / line / asset / component before troubleshooting. That's the wedge.
2. **Stay Slack-first.** Tulip ships an app builder. MaintainX ships a mobile app. Nobody ships into the technician's existing chat surface with grounded evidence. Owning the front door = owning the relationship.
3. **Keep groundedness measurable.** `mira-bots/shared/citation_compliance.py` + the 1-5 groundedness score + `evidence_utilization` aren't just internal hygiene — they're the proof we'd put in a demo to outflank every "generic chatbot bolt-on" the incumbents will ship.

The three things to watch:

- **MaintainX adding more AI** — they own the CMMS surface; if they ship a grounded copilot inside their app, the "Slack-first" wedge needs sharper articulation. (See [companies/maintainx.md](../companies/maintainx.md).)
- **Ignition + LLM integration patterns** — Ignition has the SCADA install base; if a grounded copilot ships natively inside Ignition Perspective, the moat must be UNS-portable, not Ignition-bound. (See [companies/inductive-automation.md](../companies/inductive-automation.md).)
- **HighByte's Intelligence Hub adding agent surfaces** — HighByte's modeling layer is exactly the substrate MIRA grounds against; partnership > competition is the most likely path. (See [companies/highbyte.md](../companies/highbyte.md).)

## Cross-references

- [mira-lessons/mira-wedge-and-positioning.md](../mira-lessons/mira-wedge-and-positioning.md) — the positioning argument in detail
- [mira-lessons/mira-architecture-decisions.md](../mira-lessons/mira-architecture-decisions.md) — living decision log
- [summaries/initial-research-library-report.md](initial-research-library-report.md) — first-sprint working notes
