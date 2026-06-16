# Synthetic Conversation Stress Test — Design Spec

**Date:** 2026-04-13  
**Goal:** Run 50 scripted diagnostic conversations via Playwright against app.factorylm.com, find and fix 80% of edge cases so MIRA feels like a natural language agent when Mike uses it.

---

## Architecture

Single script `tools/audit/stress_test.py` that:
1. Runs 50 scenarios in waves of 10
2. After each wave, analyzes VPS pipeline logs for failures
3. Reports pass/fail per scenario with categorized failure reasons
4. Between waves: I fix root causes (aliases, regex, prompt), then re-run failed scenarios

## Scenario Categories (10 each = 50)

### Wave 1: VFD fault codes (10)
1. PowerFlex 525 F012 overcurrent
2. GS10 VFD OC fault on startup
3. Danfoss VFD earth fault alarm
4. Yaskawa A1000 SV fault
5. Siemens G120 F0003 overcurrent
6. AutomationDirect GS20 UL undervoltage
7. PowerFlex 40 F33 heatsink overtemp
8. ABB ACS580 fault 2310
9. VFD showing SC short circuit fault
10. Drive won't start, no fault code displayed

### Wave 2: Motor troubleshooting (10)
11. 3-phase motor hums but won't start
12. Motor runs but overheats after 30 min
13. Motor trips breaker immediately on start
14. Motor vibrates excessively at full speed
15. Single phase motor runs backwards
16. Motor shaft is locked, can't rotate by hand
17. Motor makes grinding noise at low speed
18. Motor current is 20% above nameplate FLA
19. Motor insulation resistance reads 0.5 megohm
20. Motor was submerged in flood water

### Wave 3: Photo + follow-up (10)
21. Upload GS10 VFD nameplate → ask about specs
22. Upload GS10 VFD nameplate → ask about fault codes
23. Upload FANUC nameplate → ask about maintenance schedule
24. Send wrong photo first → "never mind" → correct photo
25. Photo → "1" → "explain" (depth on demand)
26. Photo → ask "what model is this" → ask "what's the FLA"
27. Photo → "what do you know about these drives"
28. Photo → "2" → "2 again" (re-select same option)
29. Photo → then send text asking about completely different equipment
30. Two photos in one conversation

### Wave 4: Natural language patterns (10)
31. "option 2" selection
32. "the second one" selection
33. "explain more about that"
34. "why?" after a diagnostic question
35. "go deeper on the wiring"
36. "what does that mean?"
37. "can you break it down?"
38. "tell me more" after brief answer
39. "actually let me rephrase — the motor is tripping"
40. "thanks, that fixed it" (should resolve)

### Wave 5: Edge cases + recovery (10)
41. "never mind" after first response
42. "wrong chat" reset
43. Empty message then real question
44. Very long message (200+ words describing symptoms)
45. All caps "THE VFD IS ON FIRE" (safety keyword)
46. Message with abbreviations: "mtr trpd OC on strt"
47. Greeting → equipment question (should bypass greeting gate)
48. "reset" → new question in same chat
49. Rapid-fire 3 questions without waiting for options
50. Ask for a summary after 5 exchanges

## Data Collected Per Scenario

```python
{
    "scenario": "PowerFlex 525 F012 overcurrent",
    "category": "vfd_fault",
    "passed": True,
    "exchanges": 5,
    "failures": [],  # or ["fsm_stuck", "no_rag_hits", "vision_regurgitation"]
    "fsm_progression": ["IDLE", "ASSET_IDENTIFIED", "Q1", "Q2", "DIAGNOSIS"],
    "rag_hits": [3, 5, 0, 2],
    "avg_latency_s": 6.2,
    "memory_stored": 3,
    "grounding_warnings": 1,
    "response_word_counts": [28, 35, 42, 31, 50],
}
```

## Failure Categories

| Category | Detection | Auto-fixable? |
|----------|-----------|---------------|
| `fsm_stuck` | "Invalid FSM state" in logs | Yes — add to _STATE_ALIASES |
| `no_rag_hits` | NEON_RECALL hits=0 | Maybe — adjust threshold or add product regex |
| `vision_gibberish` | VISION_GIBBERISH in logs | Yes — already falls through to next provider |
| `vision_regurgitation` | Response starts with "The image shows" on non-photo turn | Yes — truncate asset_identified |
| `too_verbose` | Response > 80 words | Maybe — strengthen Rule 8 prompt |
| `no_context` | Later turn ignores earlier equipment/fault info | Investigate — check history length |
| `wrong_selection` | "You've selected option X" but X doesn't match | Investigate — check last_options |
| `safety_missed` | Safety keywords not triggering SAFETY_ALERT | Fix — add to SAFETY_KEYWORDS |
| `reset_failed` | "never mind" didn't clear state | Fix — add to reset phrases |

## Success Target

- **Wave pass rate:** 90%+ (45/50 scenarios pass)
- **FSM stuck:** 0 occurrences after fixes
- **RAG hits:** > 0 for 80%+ of queries
- **Avg response length:** < 50 words for non-depth exchanges

## Output

- `tools/audit/stress-findings.md` — summary + per-scenario details
- `tools/audit/stress-findings.json` — structured results
- Pipeline log analysis per wave
