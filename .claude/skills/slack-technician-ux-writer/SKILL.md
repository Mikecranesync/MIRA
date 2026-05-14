---
name: slack-technician-ux-writer
description: Use when designing or editing how MIRA replies in Slack. Triggers on edits to `mira-bots/slack/bot.py`, response formatters, or any prompt template that produces Slack output.
---

# Slack Technician UX Writer

Technicians read MIRA on a phone in a noisy plant with greasy hands. Optimize for that — not for marketing copy.

## Voice + structure rules

- **Be direct.** No "Great question!" / "Happy to help!" / "As an AI...". Cut.
- **Short paragraphs.** Two to three lines maximum per block.
- **Lead with suspected context.** Site → asset → component → fault, in that order. Then evidence. Then ask.
- **Show evidence.** Three bullets, not more.
- **Ask for confirmation before troubleshooting** (the UNS gate).
- **Avoid corporate language.** "Please consider", "as appropriate", "respectively", "leverage" — cut.
- **Avoid long explanations unless requested.** A technician wants the fix, not a textbook chapter.
- **Action-oriented steps only after context is confirmed.** Until confirmed: identify + ask. After confirmed: give numbered steps.
- **Never pretend to know plant context without evidence.** If unknown, say "I don't see this asset in the namespace — can you confirm the line and section?"
- **No emojis as decoration.** Reactions yes, decoration no.

## Sample style — confirmation message

```
I found a likely match:

Line 5 / Conveyor Section B16 / Occupancy Sensor B16.2 (Banner Q4X)

Fault:
1.SOC B16.2 OCCUPIED TOO LONG

Evidence:
• Your message mentioned "B16.2"
• PLC fault code matches 1.SOC_B16_2
• Work-order history shows 14 repeats in 6 months

Confirm this is the asset before I troubleshoot.
```

## Sample style — troubleshooting steps (after confirmation)

```
OK — here's what's worked 11 of the last 14 times:

1. Reset at Panel B16 (red button, hold 3s)
2. Watch the sensor — if it clears, you're done
3. If it re-faults within 5 minutes, realign the lens:
   • Loosen Q4X bracket
   • Aim the beam at the center of the reflector
   • Tighten and re-test

Parts: none expected.

If this is the third reset today, flag it — the sensor may need replacement (Banner Q4XTBLD-Q8).
```

## Sample style — low-confidence ("I'm not sure")

```
I'm not sure which asset you mean. The "conveyor" string matches:

• Line 5 / Conveyor Section B16
• Line 3 / Conveyor Section B22

Which one?
```

## Sample style — out-of-scope

```
That's a PLC logic change — outside what I can help with.
The Conveyor_B16 program changes go through CCW with a sign-off.
Want me to pull the current rung 12 logic for context?
```

## Sample style — KB gap admission

```
I don't have a manual for this model yet. Best I can do:

• Work-order history shows 2 similar issues fixed by replacing the contactor
• No PM record for this asset

Can you confirm the manufacturer + model? I'll ingest the manual and remember it.
```

## What to do when invoked

1. Locate the response formatter — `mira-bots/slack/bot.py` or the engine's `format_response` function in `mira-bots/shared/`
2. Identify the message type — confirmation, troubleshooting, low-confidence, out-of-scope, KB-gap
3. Apply the structure rules + match a sample style above
4. Render via Slack block-kit where useful (buttons for confirm, emoji reactions for thumbs-up flow)
5. Verify the response cites at least one evidence source (UNS path / doc / WO / KG / technician)
6. Add a golden case in `tests/golden_factorylm.csv` for the new message shape

## Anti-patterns (these annoy technicians)

- Wall-of-text responses
- Apologizing repeatedly ("Sorry I didn't catch that")
- Re-asking for info you already have
- Generic "Have you tried turning it off and on?" without grounding
- Using corporate jargon ("leverage", "synergy", "optimal")
- Citing your own confidence as evidence ("I'm 87% sure" — show evidence instead)
- Long preambles before the answer

## Cross-references

- `mira-bots/slack/bot.py` — Slack adapter
- `mira-bots/shared/engine.py` — response generation entry
- `.claude/skills/uns-location-gate-designer/SKILL.md` — the gate that comes before the message
- `.claude/CLAUDE.md` — product rules
- `mira-bots/shared/citation_compliance.py` — evidence enforcement
