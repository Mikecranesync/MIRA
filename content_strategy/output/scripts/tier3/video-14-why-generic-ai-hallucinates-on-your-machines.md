# Video 14: Why Generic AI Hallucinates on Your Machines

## Short Script (60s)

**Beat 1 — Hook (0:00–0:08)**
[Phone screen: ChatGPT prompt "What does fault code F0022 mean?" Answer: ChatGPT guessing wildly about Yaskawa drives.]
"You tried ChatGPT on a fault code. It made something up."

**Beat 2 — The Problem (0:08–0:15)**
[Split screen: generic answer vs. real answer from a manual.]
"Generic AI sees keywords and pattern-matches. It doesn't see your equipment."

**Beat 3 — Ungrounded vs. Grounded (0:15–0:25)**
[Left: ChatGPT answer (no source, wrong). Right: MIRA answer (source cited, confidence scored, evidence listed).]
"ChatGPT: 'likely the capacitors.' MIRA: 'DC bus undervoltage — Yaskawa GA500 manual, section 6.3, page 214.'"

**Beat 4 — What Grounding Means (0:25–0:35)**
[MIRA interface showing: fault name, evidence list, source document, page number, confidence band.]
"Every claim traces to your OEM manual or your live PLC tag. No guess work."

**Beat 5 — The Cost of Guessing (0:35–0:45)**
[Back to booth demo: tech orders wrong part based on ChatGPT answer. 12 hours lost.]
"One hallucination costs you $8k+. That's why grounding matters."

**Beat 6 — Why This Works (0:45–0:55)**
[Show the knowledge base: folders of OEM manuals, indexed + tagged by equipment.]
"We indexed your manuals, not the internet. Your fault codes, not patterns."

**Beat 7 — CTA (0:55–0:60)**
[MIRA interface. Factorylm.com.]
"Request a MIRA demo at factorylm.com. Grounded answers for your plant."

---

## Long-Form Outline (8–12 min)

### The Setup: ChatGPT on a Real Fault Code (0:00–1:00)
Show a real example. Tech at 2 AM opens ChatGPT, types "What does fault code F0022 mean on a Yaskawa drive?"

ChatGPT response: "F0022 typically indicates a motor failure or drive malfunction. Check the motor windings, inspect the encoder feedback, or reset the drive. If the problem persists, contact the manufacturer."

That's a hallucination. It's plausible-sounding, but it's wrong. F0022 on a Yaskawa GA500 is "DC bus undervoltage," not motor failure. The fix isn't checking motor windings — it's checking incoming voltage or capacitor health.

The tech orders an encoder, wastes 6 hours, and the problem is still there.

Cost: $8,400 in unplanned downtime.

### Why ChatGPT Hallucinates (1:00–2:30)
GenAI like ChatGPT is trained on the *internet*. It's a pattern matcher. It sees "Yaskawa," "fault code," "motor," and it synthesizes an answer that *sounds* like it could be right.

The problem: it doesn't see your Yaskawa manual. It doesn't see the specific fault code table. It doesn't differentiate between a GA500 and a GA700 — both are "Yaskawa drives," so it pattern-matches both.

And because it's not looking at a source, it can't say "I don't know." It fills the gap with something plausible.

That's a hallucination. And on a 2 AM fault, a hallucination costs real money.

[asset: STRATEGY.md, NORTH_STAR.md]

### What Grounding Is (2:30–4:00)
Grounding means every answer comes with a source.

Not "I think it's probably the capacitors."

"DC bus undervoltage. Source: Yaskawa GA500 Technical Manual, Section 6.3, page 214. Confidence: high, based on 3 lines of evidence."

The evidence:
1. Incoming voltage is below 180V (checked at the terminals).
2. The fault appeared during high-load operation (which draws more power, exposing voltage sag).
3. The capacitor bank is 8 years old (typical failure window for aluminum electrolytic caps).

Grounding is:
- Your manuals, not the internet
- Your PLC tags, not guesses
- Evidence you can measure, not intuition
- A source you can open and verify

### The Knowledge Engineering Problem (4:00–5:30)
Most plants have 200–2,000 OEM manuals.

99% are unsearchable PDFs on a shared drive nobody can find.

The fault code table is on page 847 of a 1,200-page manual.

Your tech doesn't have 40 minutes to find it at 2 AM.

So they guess. Or they call the OEM. Or they order the wrong part.

Grounding means **we've indexed your manuals for you.** Every fault code, every maintenance procedure, every wiring diagram is tagged, searchable, and cited in real-time.

When you ask MIRA "What does F0022 mean?", it's not guessing. It's reading the exact page of your manual.

[Show the knowledge base ingestion: manual → OCR → fault code extraction → NeonDB + Open WebUI, indexed + searchable]

### Grounded vs. Ungrounded: Side-by-Side (5:30–7:00)
**Ungrounded (ChatGPT):**
```
Q: What does F0022 mean on a Yaskawa drive?
A: F0022 typically indicates a motor failure or drive malfunction. 
   Check the motor windings, inspect the encoder feedback, or reset 
   the drive. If the problem persists, contact the manufacturer.
```
- No source cited
- No specific model
- No evidence collected
- Confidence: unknown (sounds plausible but is wrong)
- Action: tech orders encoder, wastes time

**Grounded (MIRA):**
```
Fault: F0022 — DC Bus Undervoltage
Confidence: HIGH

Evidence:
1. Yaskawa GA500 Technical Manual (Section 6.3, p.214) defines 
   F0022 as "DC bus voltage below 180V threshold."
2. Incoming L1-L2-L3 voltage measured at 195V (nominal 208V).
   Voltage sag during motor acceleration is normal on undersized lines.
3. Historical patterns: 8 occurrences in the past 90 days, 
   all during peak load windows (6–11 AM, 2–4 PM).

Recommended first check:
Measure L1-L2-L3 incoming voltage. If <180V under load, 
the problem is upstream (utility, transformer, or line size).

If voltage is normal, check DC bus capacitor health — these 
typically fail at 7–10 years (this unit is 8 years old).

Safety: Verify no fault current before testing capacitors.
```
- Source explicitly cited (manual, page, section)
- Specific model (GA500, not generic "Yaskawa")
- Evidence collected from 3 independent checks
- Confidence stated with reasoning
- Action: tech measures voltage, saves 5 hours

### The Confirmation Gate (7:00–8:00)
MIRA doesn't guess without confirmation.

Before giving the diagnosis, it asks: "Are you working on a GA500, or a different drive model? Is the symptom an F0022 fault light, or something else?"

This forces a checkpoint. If the tech says "no, mine says F0021," the diagnosis changes. MIRA doesn't hallucinate a one-size-fits-all answer.

This is the **UNS confirmation gate** in action. Know the asset → ground the knowledge → cite the source → confirm before acting.

[asset: .claude/rules/uns-confirmation-gate.md]

### Why This Matters for Your ICP (8:00–9:00)
Small and mid-market plants don't have a SCADA team. They have 2–5 maintenance techs who know the machines but not the manuals.

Generic AI makes them less confident, not more. A tech who thinks they might have the wrong diagnosis loses credibility.

Grounded AI makes them *more* confident. A tech who can cite the OEM manual gains authority with their manager. "I followed the procedure from the GA500 manual" is accountability.

That's the difference between a tool that feels like it's helping, and a tool that actually does.

### The MIRA Difference (9:00–10:30)
We're not betting on ChatGPT's training data.

We indexed your OEM manuals. We extracted the fault codes. We linked them to your PLC tags. We built a confirmation gate so wrong assumptions get caught before they cost money.

And when you ask "Why F0022?" — you get the answer from the manual, not from the internet. From your plant, not from a pattern.

[asset: NORTH_STAR.md — the grounding thesis section]

### CTA (10:30–12:00)
"Request a MIRA demo at factorylm.com. See how grounded answers change your plant's troubleshooting speed."

---

## Thumbnail Brief

**Layout:** Split screen — left shows ChatGPT with a generic, wrong answer (red X). Right shows MIRA with a grounded, sourced answer (green checkmark). Bold red text overlay.

**Text overlay:** "HALLUCINATION vs GROUNDED"

**Key visual:** The contrast between the generic answer and the sourced answer. The citation visible on the MIRA side.

---

## CTA

Request a MIRA demo at factorylm.com. Answers grounded in your equipment, not the internet.

**Funnel:** MIRA
