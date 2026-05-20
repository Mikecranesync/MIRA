# Executive Summary — Industry 4.0 Intelligence

> Cross-cutting story across the library. Updated when a new finding materially changes the picture. Always read top-down — the lede is the most important paragraph.
>
> **Last updated:** 2026-05-20 (after Fuuz deep-dive sprint)

## TL;DR

The Industry 4.0 software landscape has bifurcated into:

1. **Platform plays** that try to own the whole stack — SCADA + UNS + analytics + apps (Ignition, Tulip, Litmus, Siemens Insights Hub). They are deep, expensive, and slow to deploy.
2. **DataOps plays** that own a layer — modeling + routing between OT and IT (HighByte, Cumulocity, partly CESMII). They thrive when the customer already has a vision and needs a wiring layer.
3. **Vertical SaaS plays** that own a workflow — CMMS (MaintainX), production analytics (MachineMetrics), predictive ops (TwinThread). They sell to a specific role, not a platform team.

**MIRA's wedge sits inside category 3**, but with a twist: instead of replacing the CMMS or the SCADA, MIRA **grounds a Slack-first maintenance copilot in the customer's real factory context** (UNS + KG + manuals + work-order history). The conversation is the front door; everything else is evidence.

The decisive bet — verified by every Tier 1 entry below — is that **grounding** is the moat, not the LLM. Anyone can wire ChatGPT to a CMMS. Almost nobody can answer "what's wrong with Line 2's case packer right now?" with citations to the UNS, the wiring diagram, and the last three work orders.

## What we learned this sprint (Tier 1 first-pass, 2026-05-19)

Four findings dominate the first sprint:

1. **The industry has converged on UNS + Knowledge Graph + MCP as the emerging substrate.** [LNS Research's ProveIt 2026 writeup](https://blog.lnsresearch.com/proveit-2026-all-about-uns-knowledge-graphs-and-claude-code) names exactly this stack and lists MIRA's Tier 1 vendors as the exhibitors. Notably: **graph-based data models gained substantial momentum** at the event, and **Model Context Protocol (MCP)** emerged as the interface for exposing industrial data to AI agents. [HighByte](../companies/highbyte.md) is explicitly building MCP-oriented services (IDC MarketScape coverage, April 2026). MIRA's `mira-mcp/` + `kg_entities`/`kg_relationships` + UNS gate stack is *the* current direction, not a contrarian bet.

2. **ThredCloud is MIRA's closest architectural twin in the Tier 1 cohort.** [ThredCloud](../companies/thredcloud.md) ships KG + AI + plain-language query, built on Ignition, targeting medium-sized factories — the same architectural shape and ICP band as MIRA. The differentiation reduces to **front door** (their dashboard / NL search vs MIRA's Slack-first chat) and **workflow** (their BI-flavored insights vs MIRA's maintenance-tech-conversation with confirmation gate + citations). Track quarterly.

3. **MaintainX is MIRA's highest threat-level competitor.** [MaintainX](../companies/maintainx.md) ships a grounded AI CoPilot in their CMMS app: work-order generation from manuals, voice-to-WO, photo-to-recommendation, predictive durations. They own the technician's mobile attention. MIRA's defenses are **UNS confirmation gate** (they don't have it), **cross-PLC OT grounding** (they don't have it), and **Slack-as-front-door** (they haven't committed to it). All three must remain non-negotiable.

4. **Generic "AI for manufacturing" framing is now commodity.** Tulip, MachineMetrics, TwinThread, MaintainX, ThredCloud, Fuuz — every Tier 1 player has an AI / agent surface. The market will not be won on "we have AI." It will be won on **what we ground in, and what we cite**. MIRA's groundedness score + citation compliance + UNS gate must remain visible — and demo-able — in every customer touchpoint.

A fifth quieter finding: **HighByte's "model is the UNS, not the broker" framing** matches MIRA's design choice exactly. Cite this framing externally; it's the cleanest public articulation of why MIRA's KG + UNS gate is the right shape.

## Implications for MIRA

The three things MIRA must keep doing, validated by what other players do or fail to do:

1. **Hold the UNS gate.** No Tier 1 conversational product confirms site / area / line / asset / component before troubleshooting. That's the wedge.
2. **Stay Slack-first.** Tulip ships an app builder. MaintainX ships a mobile app. Nobody ships into the technician's existing chat surface with grounded evidence. Owning the front door = owning the relationship.
3. **Keep groundedness measurable.** `mira-bots/shared/citation_compliance.py` + the 1-5 groundedness score + `evidence_utilization` aren't just internal hygiene — they're the proof we'd put in a demo to outflank every "generic chatbot bolt-on" the incumbents will ship.

The three things to watch:

- **MaintainX adding more AI** — they own the CMMS surface; if they ship a grounded copilot inside their app, the "Slack-first" wedge needs sharper articulation. (See [companies/maintainx.md](../companies/maintainx.md).)
- **Ignition + LLM integration patterns** — Ignition has the SCADA install base; if a grounded copilot ships natively inside Ignition Perspective, the moat must be UNS-portable, not Ignition-bound. (See [companies/inductive-automation.md](../companies/inductive-automation.md).)
- **HighByte's Intelligence Hub adding agent surfaces** — HighByte's modeling layer is exactly the substrate MIRA grounds against; partnership > competition is the most likely path. (See [companies/highbyte.md](../companies/highbyte.md).)

## Update — 2026-05-20: Fuuz deep-dive findings

The deep-dive on Fuuz (Episode 6 video + `fuuz-skills` + `proveit2026` repos) **reinforces three findings** from the Tier 1 sprint and **adds three new ones**:

**Reinforced:**
- UNS = nervous system, KG = queryable memory is now publicly articulated by Fuuz, not just MIRA's interpretation.
- "Generic AI is commodity, grounding is the moat" — Fuuz's whole thesis ("you have to be really, really good at evaluating the output. Learn your domain") rhymes with MIRA's UNS gate.
- Skills-as-captured-corrections is the right shape — Fuuz's `fuuz-packages` skill has 71 numbered golden rules; MIRA's `.claude/rules/` does the same informally.

**New findings:**
- **MIRA is behind on skill rigor and versioning.** Fuuz has semver per skill, status enum, deploy log. MIRA's skills are unversioned. Cheap to fix (see [mira-lessons-from-fuuz.md](../mira-lessons/mira-lessons-from-fuuz.md) action items 1 + 2).
- **MIRA is ahead on Slack-first + UNS gate + grounded-by-default.** No vendor in the cohort enforces "don't answer without context." Protect the lead.
- **A new skill, `mira-platform-utilities`, is high-leverage.** Routes Claude to existing MIRA helpers (uns_resolver, citation_compliance, dedup, inference router) so it stops reinventing them. Inspired by Fuuz's `fuuz-platform`. ~4 hours to build.

Full action plan: [mira-lessons-from-fuuz.md](../mira-lessons/mira-lessons-from-fuuz.md) (top 10 lessons, 10-item action plan).
Skill adaptation roster: [mira-fuuz-skill-adaptation-plan.md](../mira-lessons/mira-fuuz-skill-adaptation-plan.md).
Detailed report: [fuuz-first-action-final-report.md](fuuz-first-action-final-report.md).

## Cross-references

- [mira-lessons/mira-wedge-and-positioning.md](../mira-lessons/mira-wedge-and-positioning.md) — the positioning argument in detail
- [mira-lessons/mira-architecture-decisions.md](../mira-lessons/mira-architecture-decisions.md) — living decision log
- [mira-lessons/mira-lessons-from-fuuz.md](../mira-lessons/mira-lessons-from-fuuz.md) — Fuuz-specific lessons + action plan
- [mira-lessons/mira-fuuz-skill-adaptation-plan.md](../mira-lessons/mira-fuuz-skill-adaptation-plan.md) — proposed 10-skill MIRA roster
- [architecture-patterns/](../architecture-patterns/) — 5 pattern files (Fuuz / agents / screens / data-modeling / UNS-MQTT)
- [summaries/initial-research-library-report.md](initial-research-library-report.md) — first-sprint working notes
- [summaries/fuuz-first-action-final-report.md](fuuz-first-action-final-report.md) — Fuuz-sprint final report
- [summaries/fuuz-initial-research-summary.md](fuuz-initial-research-summary.md) — plain-English summary for Mike
