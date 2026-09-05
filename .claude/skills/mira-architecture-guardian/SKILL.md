---
name: mira-architecture-guardian
description: Use when a feature request, refactor, or PR could break the unified mobile/web product, shared server intelligence, safety, tenant, or evidence contracts. Product direction comes from docs/PRODUCT_CONSTITUTION.md and engineering constraints from docs/ENGINEERING_GUARDRAILS.md.
---

# MIRA Architecture Guardian

> **Authority:** This legacy skill is subordinate to
> [`docs/PRODUCT_CONSTITUTION.md`](../../../docs/PRODUCT_CONSTITUTION.md) and
> [`docs/ENGINEERING_GUARDRAILS.md`](../../../docs/ENGINEERING_GUARDRAILS.md). Its former Slack-first,
> all-answers-grounded, and confirm-before-any-troubleshooting rules are superseded where they
> conflict with Universal Technician L0 or the unified mobile/web product.

## When to invoke

- Any new feature, refactor, or scope change touching `mira-bots/`, `mira-pipeline/`, `mira-mcp/`, `mira-crawler/`, `mira-cmms/`, or `mira-web/`.
- Any PR that changes a customer surface — verify mobile and web retain one server-governed MIRA contract.
- Any commit that touches the FSM, the engine, or the response generator — verify grounding remains intact.
- Any time a request sounds like "make MIRA do X" where X is generic.

## Architecture invariants

1. **MIRA is a maintenance intelligence, not an unrestricted chatbot.** Universal Technician L0 may provide clearly labelled general maintenance reasoning without an asset or manual.
2. **FactoryLM mobile and web are the primary customer surfaces.** They share the same server-owned intelligence, history, tools, evidence, tenant, and safety contracts. Slack/Foreman is internal orchestration; retained adapters do not define the customer contract.
3. **UNS / MQTT is the live context layer.** Plant context comes from `mira-crawler/ingest/uns.py` + the `mira-relay/` + Ignition tag streams. New context sources must integrate here, not bypass.
4. **Component templates + knowledge graph are memory.** Reusable knowledge lives in `kg_entities` + `kg_relationships`. Per-tenant per-instance specifics extend the templates.
5. **Customer docs and work orders are evidence.** Asset-specific, historical, and live claims require admitted, tenant-authorized evidence.
6. **Evidence state is explicit.** L0 general reasoning is labelled general; grounded claims carry inspectable citations or provenance.
7. **Confirm identity rather than guessing.** Confirm tenant-scoped asset identity before asset-specific, historical, or live claims—not before a general maintenance question.

## Watch for feature creep

Push back when a request smells like:

- "Make MIRA respond to anything" → generic chatbot drift.
- "Have MIRA write to the PLC" → out of scope, safety-critical.
- "Have MIRA replace our CMMS / SCADA / historian" → out of scope (see `.claude/skills/mira-saas-scope-guard/SKILL.md`).
- "Skip the confirmation prompt, it's annoying" → breaks the load-bearing UNS gate. Hard no without a written exception.
- "Auto-verify proposed relationships" → pollutes the graph. Hard no.
- "Add a LangChain/n8n layer to make this easier" → banned (PRD §4).

## What to do when invoked

1. Read `AGENTS.md`, `docs/PRODUCT_CONSTITUTION.md`, `docs/ENGINEERING_GUARDRAILS.md`, and the relevant module instructions.
2. Identify which invariant the change might affect.
3. If the change preserves invariants → approve, suggest where to put code, point at conventions.
4. If the change risks an invariant → state which invariant + why + propose a smaller/safer scope.
5. If the change is out of product scope → suggest deferring to a non-MIRA module or a follow-up after the wedge is proven.

## Outputs

- Concrete file paths for new code (don't drop code into random places).
- Cross-references to relevant skills/commands/specs.
- A 1–3 sentence written justification for the recommendation that the user can paste into a PR description.

## Cross-references

- `docs/PRODUCT_CONSTITUTION.md` — canonical product direction
- `docs/ENGINEERING_GUARDRAILS.md` — canonical engineering constraints
- `.claude/CLAUDE.md` — compatibility entrypoint
- `.claude/skills/mira-saas-scope-guard/SKILL.md` — scope classifier
- `.claude/skills/uns-location-gate-designer/SKILL.md` — gate flow
- `.claude/skills/slack-technician-ux-writer/SKILL.md` — UX contract
- `docs/specs/mira-component-intelligence-architecture.md` — North Star architecture
