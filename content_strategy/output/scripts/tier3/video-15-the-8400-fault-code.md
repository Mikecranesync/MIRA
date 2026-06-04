# Video 15: The $8,400 Fault Code

## Short Script (60s)

**Beat 1 — Hook (0:00–0:08)**
[Dark plant floor. 2 AM timestamp on screen. Phone light on a tech's face.]
"2 AM. Line 3 down. Fault code F0022. Your best tech has never seen it."

**Beat 2 — The Problem (0:08–0:18)**
[Browser opening. Google search. Page after page of manual PDFs.]
"He starts googling. Manual lookup. 40 minutes. Still doesn't match."

**Beat 3 — The Cost (0:18–0:28)**
[Calculator: $22,000/hr × 4 hours = $88,000 lost. Cross out. Re-calc: $8,400 downtime on that fault event.]
"That fault cost $8,400 in unplanned downtime. The fix was 4 minutes."

**Beat 4 — The Better Way (0:28–0:38)**
[Phone opens. "F0022?" Text to MIRA. 10-second wait. Answer: "DC bus undervoltage. Yaskawa manual section 6.3."]
"MIRA answers in 10 seconds. Check incoming voltage. It's low. Swap the breaker."

**Beat 5 — Back Online (0:38–0:48)**
[Conveyor starts again. Lights green. Real time: 12 minutes total from fault to running.]
"Tech is back on the line in 12 minutes. 4 hours saved. $8,400 recovered."

**Beat 6 — The Rhythm (0:48–0:55)**
[Fade back to dark plant. Phone glowing.]
"That's the 2 AM rhythm. Fault happens. MIRA answers. Problem solved."

**Beat 7 — CTA (0:55–0:60)**
[MIRA logo. Factorylm.com.]
"Request a MIRA demo at factorylm.com. Turn your next 2 AM call into a 12-minute fix."

---

## Long-Form Outline (8–12 min)

### The 2 AM Call (0:00–1:30)
[Reuse the voice and narrative from marketing/content/linkedin-series-2am-vfd-problem.md]

It's 2 AM.

Your phone rings. Line 3 is down.

Your best tech is standing in front of a VFD staring at fault code F0022. He's been maintaining this line for 6 years. He knows every sound it makes. But this code? Never seen it.

He calls you.

You don't know either.

So you open a browser and start googling.

You find the Yaskawa manual. 1,200 pages. The fault code table is on page 847.

F0022: "DC bus undervoltage."

Most common cause: incoming voltage dropout during heavy load.

First check: L1-L2-L3 at the input terminals. If voltage is below 180V under load, the problem is upstream (utility, transformer, or line size).

You call your tech back. He measures. Voltage is 165V — the utility is sagging during peak hours (6–11 AM and 2–4 PM).

Next steps: call the utility, or upgrade the line capacity.

But that's a 2–4 week lead time.

Meanwhile, your line is down for 4 hours. Shift stops.

40 minutes of work. $8,400 in unplanned downtime.

The fix took 4 minutes once you knew what to check.

[asset: marketing/content/linkedin-series-2am-vfd-problem.md]

### The Cost of Guessing (1:30–3:00)
Most maintenance managers can tell you their equipment uptime percentage.

Almost none can tell you the cost of a single unplanned fault event.

Here's the math:

**Avg. manufacturing plant downtime cost:** $22,000/hour (Siemens 2023)

**Avg. fault-to-fix time (with manual lookup):** 47 minutes

**Per unplanned fault event:** $17,000

But that's the *best case* — where you find the answer.

If you order the wrong part based on a wrong diagnosis:
- Add 12 hours (parts delivery + install + re-test)
- **Total cost: $17,000 + $264,000 = $281,000**

I've talked to 30 maintenance managers in the last 6 weeks.

Every single one has a story. Some have dozens.

The problem isn't that your techs aren't good. They're excellent.

The problem is they're looking up fault codes the way they did in 2002.

[Show real fault-cost math on screen]

### The MIRA Answer (3:00–5:00)
Tech gets the 2 AM call. Line 3 down. Fault F0022.

Instead of opening a browser, he opens his phone and sends MIRA the fault code and a photo of the panel.

10 seconds later:

```
Fault: F0022 — DC Bus Undervoltage
Confidence: HIGH

Equipment: Yaskawa GA500 VFD
Source: Yaskawa Technical Manual, Section 6.3, Page 214

Evidence:
1. Fault code F0022 is defined as "DC bus voltage below 180V."
2. This fault often co-occurs with incoming voltage sag during 
   peak load hours.
3. Typical causes: undersized utility connection, transformer 
   saturation, or utility brownout.

Recommended first check:
Measure L1-L2-L3 voltage at the VFD input terminals.
Expected: 208V ± 5% (198–218V).
At fault time, it's likely <180V.

If voltage is low, the problem is upstream (call the utility).
If voltage is normal, check the DC bus capacitors.

Safety: VFD capacitors hold charge. Discharge fully before testing.

Next measurement: After stability is confirmed, check for 
recurring faults during peak load windows (6–11 AM, 2–4 PM).
If recurring, work with the utility on line reinforcement.
```

Tech grabs a multimeter. Measures L1-L2-L3 at the VFD input. Voltage is 165V.

He calls his supervisor. "The utility is sagging during peak load. We're going to drop out until they fix it."

They can't fix it in 4 hours. So they throttle production, reduce load, and ride it out at 30% capacity for the next shift.

**Total downtime on that fault: 2 hours (not 4).**

**Cost: $44,000 (not $88,000).**

That one answer — and the knowledge that the problem is *outside the plant* — saves $44,000.

[asset: docs/promo-screenshots/2026-05-27_fault-detective-chat-diagnosis_desktop.png]

### How MIRA Knows (5:00–6:30)
You're not betting on ChatGPT's training data.

You indexed the Yaskawa manual. You extracted every fault code. You linked it to your PLC tags.

When F0022 hits on *your* VFD, you're not guessing what it means on *some* VFD.

You're reading the exact page of *your* manual.

And because you know the asset (Yaskawa GA500, location Line 3, installed 6 years ago), MIRA can add context that a generic search can't.

"This fault often co-occurs with utility sag during peak load." That pattern came from your historical data — other occurrences of F0022 on this exact line.

Grounding + history + your manual = a 10-second answer that's right.

[Show the knowledge base: manual index, fault code tables, asset linking, NeonDB tables, inference]

### The 12-Minute Rhythm (6:30–8:00)
2 AM fault: 0:00
Tech gets the call: 0:30
MIRA answer: 0:40
Tech measures voltage: 3:00
Diagnosis confirmed: 4:00
Production supervisor notified: 5:00
Decision made (throttle vs. shut down): 6:00
Shift starts with a plan: 12:00

Compare to:
2 AM fault: 0:00
Tech gets the call: 0:30
Manual lookup: 40:00
Diagnosis: 42:00
Tech measures: 47:00
Fix implemented: 50:00 (order part? wait for delivery?)

One rhythm takes 12 minutes and saves $44k. The other takes 40+ hours and costs $8.4–280k.

The difference is grounding. Knowing the asset. Having the right knowledge at hand.

[asset: marketing/content/linkedin-series-2am-vfd-problem.md — the narrative voice section]

### Why This Matters to You (8:00–9:30)
You're not building a "cool AI" feature. You're cutting unplanned downtime cost.

Every fault code your tech doesn't have to google is an hour saved.

Every asset your team can confirm before troubleshooting is a wrong diagnosis avoided.

The $8,400 fault isn't rare. It's every unplanned fault on your line.

If you average 2 unplanned faults per week per 20-person shift at a mid-market plant, you're looking at:

2 faults/week × $8,400/fault × 52 weeks = **$873,600 in preventable downtime cost per year per 20-tech plant.**

MIRA costs a fraction of that.

### The Offer (9:30–10:30)
Start with one troubleshooting session. One 2 AM scenario.

MIRA will walk your team through a fault diagnosis, show them the evidence, and cite the source.

You'll see where the hours are being spent, where the guesses are happening, and where having the right knowledge at hand makes the difference.

[Soft CTA: "Request a MIRA demo at factorylm.com. No pitch. Just one real fault and one 10-second answer."]

### CTA (10:30–12:00)
"Request a MIRA demo at factorylm.com. Your next 2 AM fault shouldn't cost $8,400. Let's cut that to 12 minutes."

---

## Thumbnail Brief

**Layout:** Dark plant floor, 2 AM timestamp, tech standing in front of a VFD. Phone glowing in his hand. Dollar sign animated over it ($8,400 → $0).

**Text overlay:** "THE $8,400 FAULT CODE"

**Key visual:** The contrast between a dark, urgent plant floor and the quick resolution on the phone screen.

---

## CTA

Request a MIRA demo at factorylm.com. Turn your next 2 AM call into a 12-minute fix.

**Funnel:** MIRA
