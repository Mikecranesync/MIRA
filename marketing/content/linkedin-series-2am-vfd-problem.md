# LinkedIn Series: "The 2 AM VFD Problem"
**Status:** Draft — ready to schedule
**Cadence:** One post per week, starting W3 (week of 2026-05-10)
**Platform:** LinkedIn (personal profile — Mike Harper)
**CTA on every post:** Try MIRA free → factorylm.com OR "DM me and I'll extract your first PM schedule free"
**Audience:** Maintenance managers, plant managers, reliability engineers at SMB manufacturers

---

## Post 1 — The Hook (Week 1)
**Theme:** The 2 AM Call. Emotional entry. No product mention.

---

It's 2 AM.

Your phone rings. Line 3 is down.

Your best tech is standing in front of a VFD staring at fault code F0022.

He's been maintaining this line for 6 years. He knows every sound it makes. But this code? Never seen it.

He calls you.

You don't know either.

So you open a browser and start googling.

40 minutes later, you find the answer buried in page 847 of a 1,200-page Yaskawa PDF.

The fix took 4 minutes.

The downtime cost you $8,400.

This is a solvable problem.

Most plants just don't know it yet.

---

*I'm building a tool that fixes this. Following along for the next 6 weeks.*

---

**Engagement prompt:** What's the most expensive fault code you've ever chased? Drop it in the comments.

---

## Post 2 — The Real Cost (Week 2)
**Theme:** Pain amplification. Make the $8,400 number real. No product yet.

---

Most maintenance managers can tell you their equipment uptime.

Almost none can tell you how much a single unplanned fault costs them.

Here's the math nobody does:

**Avg. manufacturing plant: $22,000/hr downtime cost** (Siemens 2023)

**Avg. VFD fault-to-fix:** 47 minutes (from manual lookup + parts confirmation + tech travel)

**Per fault event:** $17,000+

And that's the *cheap* version — where you find the answer.

If you order the wrong part because the fault code pointed at the wrong root cause, add another 12 hours and $264,000.

I've talked to 30 maintenance managers in the last 6 weeks.

Every single one has a story like this. Some have dozens.

The problem isn't that your techs aren't good. They're excellent.

The problem is they're looking up fault codes the same way they did in 2002.

There's a better way. Showing it next week.

---

**Engagement prompt:** How long does it typically take your team to go from fault alarm to root cause? Be honest — I won't judge.

---

## Post 3 — The Reveal (Week 3)
**Theme:** What MIRA actually does. Demo > description. Show the workflow.

---

Here's what I've been building.

Your tech gets the 2 AM call.

Instead of opening a browser and hoping, he opens his phone, sends MIRA the fault code and a photo of the panel.

10 seconds later:

"F0022 on a Yaskawa GA500 = DC bus undervoltage. Most common cause: incoming voltage dropout during heavy load. Check L1-L2-L3 at the input terminals first. If voltage is normal there, check the DC bus capacitors — they fail on units over 5 years old."

Source cited. Page number included. Step-by-step fix attached.

He's back on the line in 12 minutes.

That's not magic. That's just what happens when you give an experienced tech instant access to the right knowledge.

We call it MIRA — Maintenance Intelligence, Rapid Action.

It knows your equipment because we've trained it on the actual OEM manuals, not generic internet data.

---

**Try it free:** DM me and I'll set you up today. No credit card.

factorylm.com

---

## Post 4 — The Manual Problem (Week 4)
**Theme:** Why OEM manuals are the wrong format for 2 AM. Technical credibility post.

---

Quick poll: How many OEM manuals does your plant have?

Most plants I talk to: 200-2,000.

Average pages per manual: 800.

How many are searchable PDFs stored somewhere accessible: fewer than 10%.

Here's the industrial knowledge problem nobody talks about:

Every piece of equipment in your plant came with an exact procedure for every fault it will ever throw.

The manufacturer wrote it. Their engineers tested it. It's the most authoritative document that exists for that machine.

But it's in a filing cabinet. Or a shared drive nobody remembers the password for. Or it left with the tech who retired in 2019.

So when fault F0022 hits at 2 AM, your $85/hr tech spends 40 minutes doing the worst possible thing: guessing.

What we built: ingest your OEM manuals, make every fault code, maintenance procedure, and wiring diagram instantly searchable from a phone.

Not "AI that summarizes the internet." AI that answers from *your* manuals, cites the source, and says "I don't know" when it doesn't.

That last part matters more than people think.

---

**How many unindexed PDFs are in your plant right now?** Drop a number — I'm collecting data.

---

## Post 5 — Build in Public (Week 5)
**Theme:** What shipped this week. Proof that this is real and moving.

---

Build in public, week 5.

What we shipped:

**Source citations on every answer.**

Every MIRA response now shows the exact source: manufacturer, model, manual section, page number.

"F0022 — DC bus undervoltage. [Source: Yaskawa GA500 Technical Manual, Section 6.3, p.214]"

Why this matters for industrial maintenance:

When a tech acts on a diagnosis at 2 AM and something goes wrong, they need to be able to say "I followed the procedure from the OEM manual."

That's not a legal CYA. That's real accountability. Real traceability. Real protection for your team.

No more "we googled it." No more "the tech thought it was the capacitors."

The knowledge lives in the manual. The manual lives in MIRA. The answer comes with a citation.

We also shipped this week:
- Hybrid fault-code search (BM25 + vector) — 15% better recall on exact part numbers and fault codes
- Magic inbox: email a PDF to `kb+[your-plant]@inbox.factorylm.com`, it auto-indexes in under 2 minutes

Current count: 43 equipment models indexed, 6,200 fault codes, 22 OEM manufacturers.

Growing every day.

---

**What equipment are you still waiting for someone to index?** Drop it below — I'll tell you if we have it.

---

## Post 6 — The Offer (Week 6)
**Theme:** Free PM extraction. Convert engaged followers to trials.

---

Six weeks ago I started sharing "The 2 AM VFD Problem."

You've been generous with your comments, your fault-code war stories, and your questions.

Here's what I want to do:

**For the next 10 plants that DM me this week:**

I'll personally extract the top 3 PM schedules from your most critical OEM manuals.

No pitch. No demo. You get a PDF with your PM intervals, inspection procedures, and lubrication points — pulled directly from your OEM manual and formatted for your team.

Takes me about 10 minutes with MIRA.

Takes your team 6-8 hours manually.

If you hate it, you keep it anyway. It's yours.

If you love it, we talk about what MIRA can do for the rest of your plant.

The only ask: tell me what equipment you're running and where the manual is.

First 10 to DM me get it done by end of week.

---

**DM "PM" to get started.**

---

## Production Notes

**Voice:** First-person, practitioner-peer register. Mike's voice — not a copywriter's. Short sentences. No buzzwords. Never say "AI-powered" alone without explaining what specifically the AI does.

**Format:**
- No headers in posts
- Short paragraphs (1-3 sentences)
- Bold sparingly (2-3 uses max per post)
- End with question OR CTA — never both on the same line
- Hashtags: #IndustrialMaintenance #PredictiveMaintenance #ManufacturingOps (3 max, appended after)

**Timing:** Post Tue-Thu, 7-9 AM Eastern (industrial audience commute/shift-change window)

**Engagement rule:** Reply to every comment within 4 hours for first 48h. This is the algorithm trigger.

**Funnel:**
- Posts 1-2: awareness / engagement farming
- Posts 3-4: product education / credibility
- Post 5: proof / trust
- Post 6: conversion offer

**Success metrics:**
- Post 1-2: ≥200 impressions, ≥15 comments
- Post 3-4: ≥500 impressions, ≥5 DM inquiries
- Post 5-6: ≥3 free PM requests → 1 paid conversion
