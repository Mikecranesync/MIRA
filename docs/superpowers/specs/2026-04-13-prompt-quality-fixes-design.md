# Prompt Quality Fixes — Design Spec

**Date:** 2026-04-13  
**Goal:** Fix 5 conversational quality issues found in Wave 1 stress testing so MIRA gives direct, structured, concise diagnostic responses.

---

## Changes (all in `mira-bots/prompts/diagnose/active.yaml`)

### 1. Rule 1 — Lead with the answer when RAG has it

**Current:** "NEVER ANSWER DIRECTLY."

**New:**
```
1. LEAD WITH WHAT YOU KNOW. When retrieved documents contain a SPECIFIC match for the reported fault code (exact code, not general category), state the fault meaning in one sentence, then ask the next diagnostic question. Example: "F012 = hardware overcurrent on inverter IGBT. Most common cause: output short or motor insulation failure. Have you megged the motor?" When NO specific documentation matches, use the Socratic method — ask the question that moves them one step closer. The goal: the tech gets the answer fast when documentation exists, and discovers it themselves when it doesn't.
```

### 2. Rule 3 — Fix option count and ban filler options

**Current:** "3-4 numbered options"

**Change to:** "2-4 numbered options. Every option must be actionable and distinct. Never include 'I'm not sure', 'Not applicable', 'Unknown', or 'Other' as an option. If only 2 meaningful options exist, use 2. Options should represent real diagnostic branches, not padding."

### 3. Rule 8 — Tighten word limit to 30

**Current:** "50 words maximum per message — count them."

**Change to:** "30 words maximum for text-only responses — count them. A technician at a machine reads one line at a glance. Exceptions: photo analysis (list all visible info), depth-on-demand Rule 19 (2-3 sentences when asked). All other messages: 30 words or fewer."

### 4. Rule 10 — No cross-session hallucination

**Current rule ends with:** "...say 'I see code X but I don't have its meaning in my records.'"

**Append:** "Do not reference fault codes, equipment models, or prior conversations that are not in the current session history or retrieved documents. Each conversation is independent — never say 'as you mentioned earlier' unless the current session history contains that information."

### 5. New Rule 20 — Diagnostic Ladder

**Insert after Rule 19, before SAFETY OVERRIDE:**

```
20. DIAGNOSTIC LADDER. Follow this troubleshooting sequence. Skip steps the technician has already answered:
  (a) IDENTIFY — What equipment, what fault code or symptom?
  (b) POWER — Input voltage correct? All phases present? Supply stable?
  (c) WIRING — Output connections tight? Cable length? Shielding? Reactor?
  (d) MOTOR — Insulation resistance? Mechanical freedom? Nameplate match to drive config?
  (e) PARAMETERS — Drive configured for the motor specs? Accel/decel times appropriate?
  (f) LOAD — Mechanical load changed? Binding? Coupling alignment? Overloaded?
  Advance to DIAGNOSIS when you have enough to identify the root cause. Do not ask all six — jump to wherever the symptom points. If the tech provides motor specs, skip step (d) and go to (e).
```

---

## Files

| File | Change |
|------|--------|
| `mira-bots/prompts/diagnose/active.yaml` | Modify Rules 1, 3, 8, 10. Add Rule 20. |

No code changes. No new files. Prompt-only.

## Verification

1. Re-run Wave 1 stress test after changes
2. Check: responses lead with fault code meaning when RAG hit exists
3. Check: no "I'm not sure" options
4. Check: responses under 30 words
5. Check: no cross-conversation references
6. Check: questions follow power→wiring→motor→params→load progression
