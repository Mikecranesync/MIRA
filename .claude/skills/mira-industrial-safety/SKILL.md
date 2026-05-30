---
name: mira-industrial-safety
description: |
  L3 cross-cutting safety skill for MIRA. Auto-co-activates with any user-facing workflow whose output could surface advice on energized equipment, lockout/tagout (LOTO), arc flash, confined space, hot work, pressurized systems, chemical exposure, or fall hazards. Owns the SAFETY_KEYWORDS list in mira-bots/shared/guardrails.py and the STOP+escalate behavior. Triggers on any edit to guardrails.py, on any feature that could touch live equipment guidance, on any prompt mentioning a safety-keyword phrase, and on PRs that change how the engine handles SAFETY_ALERT messages. Supersedes generic troubleshooting flow when safety keywords match — even when mira-uns-architecture and mira-maintenance-workflow would otherwise own the response.
version: 0.1.0
status: draft
last-updated: 2026-05-19
owner-paths:
  - mira-bots/shared/guardrails.py
  - .claude/rules/security-boundaries.md
  - docs/THEORY_OF_OPERATIONS.md
related-skills:
  - mira-platform
  - mira-uns-architecture
  - mira-maintenance-workflow
  - slack-technician-ux-writer
---

# mira-industrial-safety

> **Status:** Draft (Phase 6 of the Fuuz-adaptation initiative). New skill. The mechanism it documents (the SAFETY_KEYWORDS list in `mira-bots/shared/guardrails.py`) already exists; this skill centralizes the behavior contract Claude must follow when reasoning about features that could touch live equipment guidance.

## 1. When to invoke

Invoke as a **co-skill** with any of:

- `mira-maintenance-workflow` — for any technician-facing response.
- `mira-uns-architecture` — when the gate identifies an asset whose work would involve energy isolation.
- `mira-platform` — when reviewing a feature that could surface live-equipment guidance.

Direct triggers (always activate this skill):

- Edits to `mira-bots/shared/guardrails.py` (especially `SAFETY_KEYWORDS`, `SAFETY_KEYWORDS_IMMEDIATE`, or the `classify_intent()` safety branch).
- Edits to the engine's SAFETY_ALERT handling path.
- Any inbound message containing one of the SAFETY_KEYWORDS phrases.
- Any new feature, ingestion source, or output channel that could surface PPE, LOTO, arc-flash, confined-space, or chemical-exposure guidance.
- PR review on any change that *removes* a safety keyword or *narrows* the safety branch.

### Do NOT trigger as the primary skill for

- Generic UNS path work that doesn't involve a safety-keyword surface → `mira-uns-architecture`.
- General Slack message styling outside the STOP+escalate template → `slack-technician-ux-writer`.
- Component-profile field design → `mira-component-profile`.

## 2. What this skill grounds in

| File | What it covers |
|---|---|
| `mira-bots/shared/guardrails.py` | `SAFETY_KEYWORDS` (full phrase list), `SAFETY_KEYWORDS_IMMEDIATE` (immediate-stop subset), `classify_intent()` safety branch, query-expansion rules around safety phrases. |
| `.claude/rules/security-boundaries.md` | "Safety Keywords" section (21 phrase-level triggers), match logic, immediate STOP escalation, false-positive handling for questions like "what is arc flash". |
| `docs/THEORY_OF_OPERATIONS.md` | Grounded troubleshooting contract — MIRA never advises on live work without verified isolation evidence. |

Primary regulatory references (citable independently, not from any third-party skill content):

- **OSHA 29 CFR 1910.147** — Control of Hazardous Energy (Lockout/Tagout).
- **NFPA 70E** — Standard for Electrical Safety in the Workplace (arc flash, PPE categories, approach boundaries).
- **OSHA 29 CFR 1910.146** — Permit-Required Confined Spaces.
- **OSHA 29 CFR 1910.252** — Welding, Cutting, and Brazing (hot work).
- **OSHA 29 CFR 1910.119** — Process Safety Management of Highly Hazardous Chemicals.

These regulations are public-domain US federal standards; MIRA references them by section, not by paraphrasing third-party explanations.

## 3. The non-negotiable rule

**MIRA never advises an action on energized, pressurized, or hazardous-state equipment without a verified isolation step. When a safety keyword fires, the response is STOP + escalate — not troubleshooting.**

## 4. Constraints

### 4.1 Detection

- **SAFE-001** `[FATAL]` Keep `SAFETY_KEYWORDS` as phrase-level triggers, not single words. Adding a single word risks false-positives that desensitize the safety branch (PR review must verify each new keyword is a phrase or an unambiguous noun like `loto`).
- **SAFE-002** `[FATAL]` `SAFETY_KEYWORDS_IMMEDIATE` is the subset that produces a hard STOP regardless of educational framing. Phrases here suppress the false-positive carve-out used for questions like "what is arc flash".
- **SAFE-003** `[BLOCKING]` Match runs against the full normalized message — lowercased, mention-stripped (via `guardrails.strip_mentions()`), whitespace-collapsed. PR review verifies the normalization order has not changed.
- **SAFE-004** `[BLOCKING]` Removing a safety keyword is a `[FATAL]` PR change and requires a documented justification + signoff from a human reviewer with industrial-maintenance domain context.

### 4.2 Response

- **SAFE-010** `[FATAL]` When a SAFETY_KEYWORDS_IMMEDIATE phrase matches, the response is STOP + escalate, regardless of the technician's framing or imperative language.
- **SAFE-011** `[FATAL]` Never suggest skipping LOTO, deferring arc-flash PPE, ignoring entry-permit requirements, or bypassing a confined-space attendant.
- **SAFE-012** `[FATAL]` Never write to a PLC tag during a safety-keyword-bearing conversation. PLC interactions are read-only in MIRA generally (PLT-004) and absolutely so when safety surface is detected.
- **SAFE-013** `[FATAL]` Never advise an action whose preconditions include "while equipment is running" / "live circuit" / "energized panel" / "pressurized system" — even when the technician explicitly asks for it.
- **SAFE-014** `[WARNING]` The STOP message identifies the hazard category, names the relevant standard (OSHA 1910.147 / NFPA 70E / etc.), and asks the technician to confirm isolation OR escalate to a qualified person.
- **SAFE-015** `[WARNING]` Log the safety episode to the benchmark DB (`mira-bots/shared/benchmark_db.py`) for later review — these episodes are evidence the safety surface is working.

### 4.3 Educational carve-out

- **SAFE-020** `[WARNING]` Questions that match SAFETY_KEYWORDS but not SAFETY_KEYWORDS_IMMEDIATE may route to grounded education ("what is arc flash", "how does LOTO work in this plant") — this routes through the RAG path with explicit citation, not the troubleshooting path.
- **SAFE-021** `[FATAL]` The carve-out NEVER applies to imperative phrases ("how do I work on the live panel", "skip LOTO for me", "I'll just pull the breaker while it's running") — these always escalate.

### 4.4 Cross-skill precedence

- **SAFE-030** `[FATAL]` This skill's `[FATAL]` rules supersede any contrary suggestion from `mira-uns-architecture`, `mira-maintenance-workflow`, or `mira-component-profile`. A feature that resolved a UNS context still STOPs if safety keywords matched after gate-pass.
- **SAFE-031** `[BLOCKING]` After a STOP, the FSM does not transition to `troubleshooting` even if the technician later confirms the gate. A new message that does NOT trigger safety keywords is required to resume.

## 5. Workflow — handling a safety-keyword message

```
inbound message
      │
      ▼
guardrails.strip_mentions() → lowercased message
      │
      ▼
   ┌──────────────────────────────┐
   │ Does message match           │
   │ SAFETY_KEYWORDS_IMMEDIATE?   │
   └────┬─────────────────────────┘
        │ yes ─────────────────────┐
        │                          │
        ▼                          ▼
  STOP + escalate           Log SAFETY_ALERT
        │                   to benchmark_db
        ▼
  Slack response (template in §6)
  FSM lock: troubleshooting blocked
  Require fresh message to resume
```

Educational-question branch:

```
   message matches SAFETY_KEYWORDS but NOT SAFETY_KEYWORDS_IMMEDIATE
   AND message is interrogative (what is / how does / explain)
   AND message contains no imperative ("just", "skip", "while running")
        │
        ▼
   Route to RAG with citation
   Reply must cite a manual page or a public standard
```

## 6. STOP message template

```
⚠️ I'm pausing before we go further.

Your message mentions: <keyword phrase>
That's a hazard category covered by <OSHA 1910.147 / NFPA 70E / OSHA 1910.146>.

Before I help with this, please confirm one of:

✅ The equipment is fully de-energized and locked out (or otherwise isolated)
✅ A qualified person has cleared the work
❌ I'd rather escalate this to a supervisor / EHS — please do.

I can't recommend steps that would touch live / pressurized / confined-space conditions.
```

The exact phrasing lives in `references/escalation-templates.md`; Slack rendering is block-kit, see `mira-maintenance-workflow/references/slack-message-templates.md`.

## 7. Anti-patterns (these are bugs)

- A reply that begins with troubleshooting steps while the message contained `"arc flash"`, `"loto"`, `"de-energize"`, `"live panel"`, `"pressurized"`, `"confined space"`, `"gas leak"`, etc. (SAFE-010).
- A code path that strips a safety keyword from a normalized message to "improve recall" (SAFE-003).
- A test case that asserts "what is arc flash" returns troubleshooting steps (SAFE-020 — that's the carve-out, but it returns RAG-cited education, not steps).
- Removing a SAFETY_KEYWORDS phrase to fix a false positive without finding an alternative way to disambiguate (SAFE-004).
- The FSM resuming `troubleshooting` after a STOP without a fresh non-safety message (SAFE-031).

## 8. Common errors (error → cause → fix)

| Error / symptom | Likely cause | Fix |
|---|---|---|
| Replies include troubleshooting steps for "arc flash on conveyor B16" | Safety branch not consulted before troubleshooting branch | Move SAFETY_KEYWORDS_IMMEDIATE check to the front of `classify_intent()` (SAFE-010) |
| "What is LOTO?" returns a STOP message instead of education | Carve-out not implemented or too narrow | Verify the interrogative-question path (SAFE-020); add a golden case |
| "How do I pull the breaker while running" returns RAG education | Imperative not detected; carve-out leaked | Tighten imperative detection — "while running" is always SAFE-021 |
| Safety episode not logged | `benchmark_db.evidence_packet` not invoked on SAFETY_ALERT | Wire the log call into the safety branch (SAFE-015) |
| FSM resumes troubleshooting after a STOP without fresh message | `troubleshooting_unlock` triggered on next reply regardless of safety state | Require a non-safety message after STOP (SAFE-031) |

## 9. Output checklist

Before declaring a safety-surface-touching change complete:

- [ ] `SAFETY_KEYWORDS` and `SAFETY_KEYWORDS_IMMEDIATE` lists reviewed; no single-word triggers added.
- [ ] Normalization order (mention-strip → lowercase) preserved.
- [ ] Match check runs BEFORE intent classification (front of `classify_intent()`).
- [ ] Imperative phrases ("just", "skip", "while running", "live", "energized") always escalate.
- [ ] STOP message contains hazard category + standard reference + confirmation options.
- [ ] Safety episode logged to benchmark DB.
- [ ] FSM does not transition to `troubleshooting` after STOP without a fresh non-safety message.
- [ ] PLC writes blocked on safety-surface conversations.
- [ ] Golden cases added/updated covering: imperative-live-work refusal, educational-question carve-out, mixed-message handling, post-STOP resume blocking.
- [ ] `/mira-run-hallucination-audit` run; safety-branch findings reviewed.

## 10. References

See `references/` for depth:

- `references/safety-keywords.md` — the canonical phrase list with rationale per phrase, including SAFETY_KEYWORDS_IMMEDIATE subset and the v2.4.1 electrical-isolation additions.
- `references/escalation-templates.md` — STOP message variants (electrical, mechanical, confined space, chemical, hot work) and block-kit JSON.
- `references/regulatory-frame.md` — OSHA / NFPA standard citations (section + scope) for STOP messages and PR justifications. Independently citable from primary sources.

## 11. Cross-references

- `mira-platform/SKILL.md` — PLT-004 (no arbitrary PLC writes), PLT-070 (no LLM-call abstractions).
- `mira-uns-architecture/SKILL.md` — the gate runs first, but this skill's `[FATAL]` rules supersede any post-gate troubleshooting (SAFE-030).
- `mira-maintenance-workflow/SKILL.md` — workflow consults this skill in every stage; STOP at any stage is final.
- `slack-technician-ux-writer/SKILL.md` — STOP message styling.
