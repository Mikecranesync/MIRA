---
name: mira-industry4-research
description: Use whenever a question, PR, or design decision touches Industry 4.0, UNS / Unified Namespace, MQTT / Sparkplug B, OPC-UA, Ignition, SCADA, MES, CMMS, predictive maintenance, industrial AI agents, or competitive positioning. Surfaces the permanent research library at docs/research/industry4-intelligence/, points at the relevant company / pattern / lesson file, and enforces the routine: consult the library first; if the answer isn't there, run RESEARCH_ROUTINE.md before deciding.
---

# MIRA Industry 4.0 Research

## When to invoke

Trigger on prompts and PRs that involve any of:

- **Architecture questions**: UNS layout, KG schema, Sparkplug B vs raw MQTT, payload shape, ISA-95 / ISA-88 compliance, agent shape, broker choice, container topology for edge.
- **Competitor questions**: "How are we different from {Tulip / Ignition / MaintainX / HighByte / Litmus / Fuuz / MachineMetrics / TwinThread / CESMII / HiveMQ / ThredCloud}?" or any vendor in `docs/research/industry4-intelligence/INDEX.md`.
- **UNS / Ignition / MQTT** anything — protocol choice, topic naming, namespace authority, multi-site.
- **CMMS questions**: integration with Atlas / MaintainX / Limble / Fiix; work-order lifecycle; PM scheduling.
- **AI agent / copilot questions**: grounding, citation, FSM, confirmation gates, LLM choice.
- **Market positioning / GTM questions**: "Should we sell into X?" "Who's the competition for Y?"

## What to do

1. **Open the library**: `docs/research/industry4-intelligence/INDEX.md`.
2. **Read in this order**:
   - `summaries/executive-summary.md` for the cross-cutting story.
   - The relevant company files under `companies/` (Tier 1 first).
   - The relevant architecture pattern files under `architecture-patterns/`.
   - `mira-lessons/mira-wedge-and-positioning.md` to anchor the answer to MIRA's positioning.
   - `mira-lessons/mira-architecture-decisions.md` to see if a prior decision already covers the call.
3. **Cite the file path(s)** in your response — relative paths under `docs/research/industry4-intelligence/`. Don't paraphrase findings without a pointer.
4. **If the answer isn't in the library**: run `RESEARCH_ROUTINE.md` against the missing target, add a stub or full company file (use `_templates/COMPANY_TEMPLATE.md`), update `INDEX.md`, and **then** answer. Don't decide off vibes.
5. **If the decision is material**: append an entry to `mira-lessons/mira-architecture-decisions.md` using `_templates/DECISION_LOG_TEMPLATE.md`. If it's code-binding, escalate to a proper ADR in `docs/adr/`.

## What NOT to do

- ❌ Don't change production code based on a research entry alone — escalate to ADR + PR.
- ❌ Don't dump marketing copy into a company file — `EXTRACTION_RULES.md` requires facts + cited sources.
- ❌ Don't recommend "use HighByte / Sparkplug B / Ignition" without first reading the relevant company file and the wedge-and-positioning doc.
- ❌ Don't add a company / pattern unless you have at least one public source URL.
- ❌ Don't paste proprietary content into the library — summarize and cite.

## Quick reference

| Question shape | First file to open |
|---|---|
| "Should we adopt Sparkplug B?" | `companies/hivemq.md`, `companies/inductive-automation.md`, `architecture-patterns/` (UNS layout) |
| "How does {company} structure UNS?" | `companies/{slug}.md` → § Architecture |
| "How are we different from {company}?" | `companies/{slug}.md` → § Threat level + `mira-lessons/mira-wedge-and-positioning.md` |
| "What's the right CMMS integration shape?" | `companies/maintainx.md`, `companies/inductive-automation.md`, + Atlas docs |
| "Should the front door be Slack / Teams / mobile?" | `mira-lessons/mira-wedge-and-positioning.md` + `companies/maintainx.md` + `companies/tulip.md` |
| "Is there a partnership opportunity with {company}?" | `companies/{slug}.md` → § Integration opportunity |

## Cross-references

- Library root: `docs/research/industry4-intelligence/README.md`
- Navigation: `docs/research/industry4-intelligence/INDEX.md`
- Recurring process: `docs/research/industry4-intelligence/RESEARCH_ROUTINE.md`
- Extraction rules: `docs/research/industry4-intelligence/EXTRACTION_RULES.md`
- Templates: `docs/research/industry4-intelligence/_templates/`
- Sister skill: `.claude/skills/mira-saas-scope-guard/SKILL.md` (scope-creep prevention) — research informs scope but doesn't replace the scope guard.
- Sister skill: `.claude/skills/mira-architecture-guardian/SKILL.md` (architecture invariants) — research feeds, doesn't override, the invariants.
