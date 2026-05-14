---
name: uns-location-gate-designer
description: Use when designing, modifying, or reviewing the technician flow where MIRA must locate the asset/component/fault context before troubleshooting. Enforces the non-negotiable confirmation gate. Triggers on edits to `mira-bots/slack/bot.py`, `mira-bots/shared/engine.py`, the FSM, or any new front door.
---

# UNS Location-Gate Designer

## The non-negotiable rule

**MIRA must not begin troubleshooting until it has resolved the technician's work context inside the Unified Namespace or asset namespace AND the technician has confirmed.**

A code path that emits troubleshooting advice before the gate is a **bug**. The audit command `/mira-run-hallucination-audit` exists to find these.

## Required flow (8 steps)

1. **Receive technician message** at the Slack adapter (`mira-bots/slack/bot.py`).
2. **Extract candidates** — asset, line, area, machine, component, symptom, fault_code — from message text + thread context + user profile.
3. **Search the UNS / asset namespace** via `uns_resolver.resolve_uns_path()` per `docs/specs/uns-message-resolver-spec.md`. Backed by `kg_entities` (NeonDB) and `mira-crawler/ingest/uns.py` builders.
4. **Identify candidate contexts** — top K (default 3) ranked tuples of `(site, area, line, asset, component, fault, evidence)`.
5. **Gather evidence** — for the top candidate, attach: message hint, work-order history hit, PLC tag match, manual reference, prior session context, technician hint.
6. **Send the confirmation message** to Slack — see template below.
7. **Wait** for confirmation, correction, or "different asset". Implement a timeout + re-prompt cycle.
8. **Only after confirmation, enter troubleshooting mode.** FSM transition: `awaiting_context` → `troubleshooting`.

## Confirmation message template

```
I think you are working on:

Site:       Stardust Racers / Garage Factory
Area:       Conveyor Lab
Line:       Line 5
Asset:      Conveyor Section B16
Component:  Occupancy Sensor B16.2 (Banner Q4X)
Fault/Symptom: 1.SOC B16.2 OCCUPIED TOO LONG

Evidence:
• Your message mentioned "B16.2"
• PLC fault code matches 1.SOC_B16_2
• Work-order history shows 14 repeats in 6 months

Confidence: high

Confirm this is correct before I troubleshoot.
[ ✅ Yes ]   [ ✏️ Different asset ]   [ ❌ Wrong, let me clarify ]
```

Slack rendering uses block-kit; the engine returns a structured payload that the adapter renders.

## Confidence buckets

- **high** — UNS match + at least one other corroborating evidence (work-order, tag, prior session).
- **medium** — UNS match alone, or multiple weak hints.
- **low** — only message-text hint, no UNS match. In this case, **ask** rather than show a candidate.

## Edge cases to handle

- **No UNS match at all** → don't fabricate. Ask the technician for asset/line/component context.
- **Multiple equally-likely candidates** → present top 2 side-by-side and ask the technician to pick.
- **Technician corrects the candidate** → record the correction as evidence for future inference, transition to `troubleshooting` with the corrected context.
- **Technician changes asset mid-thread** → reset the gate, don't carry context across asset changes (`_clear_diagnostic_carryover` per memory).
- **Quick repeat fault on same asset** → use prior-session context as evidence, but **still confirm**. The gate is cheap.

## Anti-patterns (these are bugs)

- Returning troubleshooting advice on the first message without confirmation.
- Defaulting to "common asset" or "Line 1" or any other guess.
- Marking confidence high without a UNS match.
- Skipping the gate when the technician uses imperative language ("just tell me how to fix the conveyor").
- Auto-verifying the candidate after a thumbs-up emoji reaction (require text confirm or explicit button click).

## What to do when invoked

1. Locate the gate enforcement code (likely in `mira-bots/shared/engine.py` FSM `awaiting_context` state).
2. Verify each of the 8 steps is implemented.
3. Verify the confirmation message contains all required fields.
4. Verify the FSM cannot reach the troubleshooting state without passing through the gate.
5. If gaps exist, propose minimal patches with file:line.
6. Add or update golden cases in `tests/golden_factorylm.csv` covering each edge case above.

## Cross-references

- `mira-bots/slack/bot.py` — Slack entry point
- `mira-bots/shared/engine.py` — FSM + Supervisor
- `mira-bots/shared/guardrails.py` — safety keyword + escalation
- `docs/specs/uns-message-resolver-spec.md` — resolver authority
- `docs/specs/uns-kg-unification-spec.md` — UNS schema
- `.claude/mcp/mira-uns-mcp-spec.md` — proposed MCP server for UNS lookup
- `.claude/skills/slack-technician-ux-writer/SKILL.md` — message style
