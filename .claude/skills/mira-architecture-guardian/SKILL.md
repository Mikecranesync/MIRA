---
name: mira-architecture-guardian
description: Use whenever a feature request, refactor proposal, or PR could expand MIRA outside its product wedge or break the grounded-by-default contract. Keeps Claude aligned with the North Star: Slack = front door, UNS/MQTT = nervous system, KG + component templates = memory, customer docs + work orders = evidence.
---

# MIRA Architecture Guardian

## When to invoke

- Any new feature, refactor, or scope change touching `mira-bots/`, `mira-pipeline/`, `mira-mcp/`, `mira-crawler/`, `mira-cmms/`, or `mira-web/`.
- Any PR that adds a new front door (web chat, REST endpoint, voice, etc.) — verify it preserves the Slack-first contract.
- Any commit that touches the FSM, the engine, or the response generator — verify grounding remains intact.
- Any time a request sounds like "make MIRA do X" where X is generic.

## Architecture invariants

1. **MIRA is not a generic AI chatbot.** It answers grounded maintenance questions. If a request would produce un-grounded chitchat, push back.
2. **Slack is the front door.** Other adapters (Telegram, email, gchat, reddit) follow Slack's contract — same engine, same gate, same grounding. Slack is not optional.
3. **UNS / MQTT is the live context layer.** Plant context comes from `mira-crawler/ingest/uns.py` + the `mira-relay/` + Ignition tag streams. New context sources must integrate here, not bypass.
4. **Component templates + knowledge graph are memory.** Reusable knowledge lives in `kg_entities` + `kg_relationships`. Per-tenant per-instance specifics extend the templates.
5. **Customer docs and work orders are evidence.** Ingestion (manuals, drawings, work-order history) is what makes answers groundable. Never ungrounded.
6. **All troubleshooting is grounded.** No answer without at least one cited source (UNS / docs / PLC tag / work order / KG / technician confirmation / admin-approved profile).
7. **Prefer asking for confirmation over guessing.** A confirmation question is cheaper than a wrong answer in a plant.

## Watch for feature creep

Push back when a request smells like:

- "Make MIRA respond to anything" → generic chatbot drift.
- "Have MIRA write to the PLC" → out of scope, safety-critical.
- "Have MIRA replace our CMMS / SCADA / historian" → out of scope (see `.claude/skills/mira-saas-scope-guard/SKILL.md`).
- "Skip the confirmation prompt, it's annoying" → breaks the load-bearing UNS gate. Hard no without a written exception.
- "Auto-verify proposed relationships" → pollutes the graph. Hard no.
- "Add a LangChain/n8n layer to make this easier" → banned (PRD §4).

## What to do when invoked

1. Re-read `.claude/CLAUDE.md` (product rules) and the relevant module CLAUDE.md (build state).
2. Identify which invariant the change might affect.
3. If the change preserves invariants → approve, suggest where to put code, point at conventions.
4. If the change risks an invariant → state which invariant + why + propose a smaller/safer scope.
5. If the change is out of product scope → suggest deferring to a non-MIRA module or a follow-up after the wedge is proven.

## Outputs

- Concrete file paths for new code (don't drop code into random places).
- Cross-references to relevant skills/commands/specs.
- A 1–3 sentence written justification for the recommendation that the user can paste into a PR description.

## Cross-references

- `.claude/CLAUDE.md` — product rules
- `.claude/skills/mira-saas-scope-guard/SKILL.md` — scope classifier
- `.claude/skills/uns-location-gate-designer/SKILL.md` — gate flow
- `.claude/skills/slack-technician-ux-writer/SKILL.md` — UX contract
- `docs/specs/mira-component-intelligence-architecture.md` — North Star architecture
