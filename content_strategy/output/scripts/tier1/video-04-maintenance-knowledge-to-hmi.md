# Video 4: I used AI to turn maintenance knowledge into HMI screens

## Short Script (60s)

**Beat 1 — Hook (0:00–0:08)**
Your senior tech's brain is the most valuable thing in the plant. Here's how I turned some of it into a screen.

**Beat 2 — The knowledge (0:08–0:16)**
One tech, six years on this line. He knows what every sound means. Fault codes. Part numbers. Fixes. All in his head.

**Beat 3 — The capture (0:16–0:26)**
I asked him: "What's the top 3 failures on this conveyor?" He told me. I fed that to MIRA. It named the fault, cited the manual, highlighted the part.

**Beat 4 — The screen (0:26–0:36)**
Now when Line 3 goes down, any tech—not just him—gets his knowledge on their phone. With evidence.

**Beat 5 — The confirmation gate (0:36–0:48)**
Before it suggests a fix, it asks: "Is this your machine? This part?" You confirm. Then it moves. Respects the tech.

**Beat 6 — CTA (0:48–1:00)**
MIRA does this at scale. Free demo in the bio.

---

## Long-Form Outline (8–12 min)

### Intro (0:00–1:00)
I'm going to show you how AI captures the most valuable—and most fragile—asset in a plant: what a senior technician knows. And how it turns that knowledge into screens that the next person can use.
[asset: Fault Detective diagnosis screen, `.claude/rules/uns-confirmation-gate.md`]

### The Asset at Risk (1:00–2:15)
Set the problem.
- When a tech retires, so does their troubleshooting experience. Not written down. Not recorded. Just gone.
- Most plants have 1-2 people who know the critical lines. If they leave, you hire a new person and lose 6 months to ramp.
- What if you could capture that knowledge *while they're still here* and make it repeatable?
- Explain: this isn't about replacing the tech. It's about *multiplying* them.
[asset: photo of a maintenance tech at a control panel, or a work-order log showing fault-code history]

### The Interview: Knowledge Capture (2:15–3:45)
Show me interviewing a tech or walking through a captured example.
- "What are the top 3 things that go wrong on this line?" (Answer: motor bearing, sensor alignment, belt tension.)
- "Walk me through the motor bearing fault. What does it sound like? What do you check first?" (Answer: temperature climb, vibration, listen for grinding.)
- "What's the manual procedure?" (Answer: they don't have one memorized, but they know which section of the drive manual covers it.)
- The interview captures: symptom → diagnosis path → source document → fix steps.
[asset: audio/video snippet of an actual interview, or a cleaned-up FAQ document]

### The MIRA Translation (3:45–5:30)
Show how MIRA turns that into a screen.
- I feed the tech's knowledge into MIRA's training context: "Motor bearing fault on a GS10 at Line 3 usually means temperature climb. The manual says check DC bus capacitors first, then motor winding resistance. The tech typically turns up the ramp rate slowly and watches temps."
- MIRA learns the specific logic for that line.
- Now when a technician reports "motor's getting hot, won't spin up," MIRA says: "Sounds like motor bearing or DC bus issue. Check the DC bus capacitor first—usually fails on units over 5 years old. If that's OK, measure motor winding resistance. Manual is Section 6.3, page 214. Procedure takes 15 minutes."
- Source is cited. Evidence is listed. The tech can verify before acting.
[asset: Fault Detective demo screenshot showing MIRA response with citations]

### The Confirmation Gate: Why the Tech Stays in the Loop (5:30–7:15)
This is the core principle that makes this credible.
- MIRA doesn't just answer. It asks: "Are you sure this is the right machine? Is it a GS10 or a GS1? Where are you right now—Line 3 or Line 2?"
- The tech confirms context. MIRA confirms it heard correctly.
- **Only then** does MIRA give step-by-step guidance.
- This matters for two reasons:
  1. **Liability:** if the tech acts on MIRA's advice at 2 AM, they can say "I confirmed the machine first." It's not a guess.
  2. **Safety:** a VFD fault at Line 3 is different from the same fault at Line 2 (different load, different environment, different risk profile). MIRA respects that.
- Show the confirmation flow on screen: question → tech responds → MIRA pivots.
[asset: Fault Detective UX showing confirmation dialog + context resolution]

### Why This Isn't a Replacement (7:15–8:45)
Credibility moment.
- MIRA is not replacing the senior tech. It's making them 5x more useful.
- The senior tech still owns: safety judgment, equipment familiarity, knowing when the manual is outdated, deciding what to risk.
- MIRA owns: instant reference, cross-plant knowledge, documentation, not forgetting.
- Together: a new person on the floor gets the senior tech's intuition + the manual's authority + MIRA's memory.
- Alone, either one is dangerous. Together, it works.
- Show an example where MIRA says "I don't know" because the situation is outside its training. The tech makes the call.
[asset: MIRA response saying "I haven't seen this fault on your configuration. Check with your senior tech." Or similar.]

### The Capture Flywheel (8:45–10:15)
Explain how knowledge compounds.
- First capture: one tech, one line, top 3 faults.
- Second capture: another tech, another line, overlapping fault (bearing) + new faults (hydraulic pump).
- MIRA now knows bearing faults across two lines. Patterns emerge.
- Third capture: a third tech adds GS10-specific knowledge the first tech never mentioned because they run a GS1.
- Knowledge compounds. Downtime shrinks. The ramp time for new hires drops from 6 months to 4.
- This is the flywheel that makes MIRA valuable: it captures what lives in people's heads and turns it into a plant asset.
[asset: diagram or timeline showing how 3 knowledge captures create a network of connections]

### One More Thing: What Gets Captured (10:15–11:15)
Be explicit about what doesn't leak out.
- Trade secrets are safe. Proprietary methods stay in the plant.
- What gets captured: standard troubleshooting (from manuals), common faults, known fixes, safety workflows.
- MIRA citations point to the OEM manual or the work-order database—sources your plant already owns.
- This isn't competitive intelligence. It's organized evidence.
- Contrast: a generic ChatGPT might hallucinate a fix. MIRA cites where it came from. "Yaskawa manual, Section 6.3, because your tech told me that section covers bearing faults and your plant has 8 Yaskawa drives."
[asset: example of a MIRA citation chain: tech interview → manual reference → diagnosis]

### Closing & CTA (11:15–12:00)
This is what MIRA does—at scale. It captures maintenance knowledge from your team, grounds it in your equipment, and makes it available on a phone at 2 AM.
If you want to try it on your plant's top 3 faults, book a free assessment. I'll walk through the process and show you what knowledge looks like when it's organized right.
[asset: MIRA logo or sign-up screen]

---

## Thumbnail Brief
**Layout:** Left: a senior technician (or "brain" icon). Right: a bright HMI screen showing a diagnosis. Arrow between labeled "KNOWLEDGE → SCREEN."
**Text overlay:** "TRIBAL KNOWLEDGE → SCREEN" (top), "6 Years of Experience" (bottom).
**Key visual:** The idea that one person's expertise becomes a repeatable tool. Not a chatbot, not a replacement—a multiplier.

---

## CTA
Book a free MIRA assessment in the bio. I'll show you how to capture your plant's knowledge and turn it into answers.

**Funnel:** MIRA (this is a bottom-funnel video—the person watching is ready to hear about MIRA as a solution, not just a trick).

---

## Production Notes
- **Voice tone:** respect for the senior tech. "This person is irreplaceable. So let's make sure their knowledge isn't."
- **The confirmation gate is the entire credibility story:** emphasize it. "Before it gives a diagnosis, it asks where you are. That respects you and protects you."
- **Banned phrases:** "Replaces technicians," "automates maintenance," "removes the human." Say instead: "multiplies their usefulness," "makes them available 24/7," "captures what lives in their head."
- **First 3 seconds wins:** open on a senior tech working at the PLC or talking. Capture presence + authority. Then cut to the screen showing MIRA diagnosis. The contrast is: "this person's knowledge is now here."
- **Asset to source:** Fault Detective demo for the MIRA response. A real interview transcript (sanitized) or a cleaned-up Q&A. Work-order database showing common faults. The senior tech themselves (if they're willing to appear on camera—huge credibility boost).
- **Call-to-action logic:** this video lands on MIRA (not the PDF). The viewer is already convinced HMIs work (from videos 1-3). Now they need to understand the *reason* to buy MIRA: it's the grounding layer that makes the difference between "neat trick" and "actual business system."
