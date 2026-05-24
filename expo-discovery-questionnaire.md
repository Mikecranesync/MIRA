# FactoryLM / MIRA — Expo Discovery Questionnaire
**Florida Automation Expo — May 21, 2026**

---

## FAST VERSION (8 questions for quick booth conversations)

1. What's your role and what kind of equipment do you work with?
2. When a machine goes down, how does your team figure out what's wrong? [MUST ASK]
3. How easy is it to find the right manual, drawing, or fault history when you need it? [MUST ASK]
4. On a scale of 1–5, how painful is the documentation problem at your plant? (1 = fine, 5 = constant struggle) [MUST ASK]
5. If you could text a question about a piece of equipment and get a grounded answer with citations from your own manuals — would your team use that? [MUST ASK]
6. What would make you NOT trust an AI system giving maintenance guidance?
7. Who at your company would need to approve trying something like this?
8. Would you be open to seeing a quick demo sometime — no pressure, just to see if it's relevant?

---

## DEEP VERSION (25 questions)

### A. Quick Role / Context Questions
*Goal: Understand who they are without making it feel like a form.*

**1.** What's your role, and what kind of plant or facility do you work in?

**2.** What kind of equipment does your team maintain? (PLCs, VFDs, conveyors, cranes, packaging, HVAC, etc.)

**3.** How big is your maintenance team?
> *Follow-up: Is it mostly in-house techs, or do you use contractors/integrators?*

---

### B. Current Maintenance Workflow
*Goal: Learn how they currently solve equipment problems.*

**4. [MUST ASK]** When a machine goes down or throws a fault, walk me through what happens. How does your team figure out what's wrong?
> *Follow-up: Where does the technician go first — a binder, a computer, a phone call, or their own memory?*

**5. [MUST ASK]** How much of your troubleshooting depends on one or two people who just "know" the equipment?
> *Follow-up: What happens when that person is on vacation or leaves?*

**6.** Do your techs have access to equipment info on a phone or tablet, or is it mostly desktop/paper?

---

### C. Documentation / Knowledge Pain
*Goal: Find out if manuals, prints, drawings, fault history, and procedures are hard to find.*

**7. [MUST ASK]** How easy is it to find the right manual, wiring diagram, or fault history when you need it?
> *Follow-up: Where does that stuff live — SharePoint, a file server, binders, someone's desk?*

**8. [MUST ASK]** On a scale of 1–5, how painful is the documentation problem at your plant?
*(1 = everything's organized and current, 5 = constant struggle, stuff is missing or outdated)*

**9.** When a new piece of equipment gets installed, how does the documentation make it into your system — if it does at all?

**10.** Have you ever had a situation where a tech couldn't find a manual or drawing and it cost real downtime?
> *Follow-up: How often does that happen — once a month, once a week?*

---

### D. PLC / Controls / Equipment Data
*Goal: Understand whether PLC tags, VFD parameters, fault codes, and equipment data are accessible.*

**11. [MUST ASK]** If a tech needs to check a PLC tag value, a VFD parameter, or look up a fault code — how do they do that today?
> *Follow-up: Do they have to find a laptop with the programming software, or is there a faster way?*

**12.** Do you have any kind of system that connects PLC/SCADA data to maintenance workflows — or are those completely separate worlds?

**13.** Have you looked at or heard of Unified Namespace, MQTT, or Sparkplug B for organizing plant data?
> *Follow-up: Is that something your team is exploring, or is it not on the radar yet?*

---

### E. AI / MIRA Concept Validation
*Goal: Test whether they would actually want an AI maintenance assistant.*

**14. [MUST ASK]** Imagine your tech could send a message — like a text — describing a fault or a question about a piece of equipment, and get back a grounded answer that cites the actual manual, drawing, or work order history. Would your team use that?
> *Follow-up: Would they trust it? What would make it useful versus annoying?*

**15.** On a scale of 1–5, how likely would you be to try a system like that?
*(1 = no interest, 5 = I'd try it this week)*

**16. [MUST ASK]** What would make you NOT trust an AI system giving maintenance guidance?
> *Follow-up: Is it about accuracy, safety, liability, or just not believing it works?*

**17.** If this kind of tool existed, would your techs use it in Slack, Teams, text message, or something else?

---

### F. QR Code / Asset Access Validation
*Goal: Test whether scanning equipment to pull up asset context would be useful.*

**18.** If you could scan a QR code on a machine and immediately pull up its manuals, fault history, wiring diagram, and last 5 work orders — would that be useful?
> *Follow-up: Do you already have asset tags or QR codes on equipment, or would that be new?*

**19.** What information would be most valuable to see when you walk up to a machine — maintenance history, documentation, live status, or something else?

---

### G. Buying / Implementation Reality
*Goal: Learn who would care, who would approve, and what would block adoption.*

**20.** Who else at your company would care about a tool like this? Maintenance manager? Plant engineer? Reliability? IT?

**21.** If you found something useful, what does the process look like to actually try it? Is there a budget, an approval chain, a pilot process?

**22.** If a tool like this worked well and saved real troubleshooting time, what would a reasonable investment look like? Per month, per technician, per site — however you think about it.
> *Note: Don't push if they're uncomfortable. Just listen for signals about budget authority and price sensitivity.*

**23.** What would make you walk away from a tool like this — even if it worked?
> *Follow-up: Is it integration complexity, cost, trust, IT approval, or something else?*

---

### H. Closing Questions
*Goal: Get the strongest quote, pain point, and next step.*

**24.** If you could fix one thing about how your team finds and uses equipment knowledge, what would it be?
> *This is the money question. Let them talk. Write down exactly what they say.*

**25. [MUST ASK]** Would you be open to seeing a short demo sometime — not a sales call, just a 10-minute walkthrough to see if this is relevant to your world?
> *If yes: Can I grab your email so I can send you a link?*
> *If no: Totally fair. Can I send you a one-pager so you have it if it comes up later?*

---

## HOW MIKE SHOULD USE THIS AT THE EXPO

### Best Opening Line
"Hey, I'm Mike — I'm in maintenance, been doing it about 30 years. I'm building a tool to help techs find equipment information faster. I'm not here to sell anything, just trying to learn how other shops handle it. Mind if I ask you a couple quick questions?"

### Best 15-Second MIRA Explanation
"We're building MIRA — it's a maintenance assistant that reads your actual manuals, wiring diagrams, and work order history, and lets a tech ask it questions in plain language. Like texting someone who actually read all your documentation. It cites where it found the answer so you can verify it."

### How to Ask Questions Without Being Awkward
- Lead with your own experience: "At my last plant, we had this problem where..."
- Ask about THEIR world first. Don't pitch until they've told you their pain.
- Use "walk me through" instead of "tell me about" — it gets stories, not summaries.
- If they light up on a topic, stay there. Skip your script.
- If they're rushed, use the Fast Version (8 questions). Get the email and follow up.

### What Answers Indicate Strong Product-Market Fit
- "Our senior guy is retiring and nobody knows what he knows"
- "We waste 30 minutes per call just finding the right manual"
- "Our documentation is a disaster"
- "We'd absolutely use that if it actually worked"
- Pain score 4 or 5
- Likelihood score 4 or 5
- They ask YOU questions about how it works
- They volunteer their email without being asked

### What Answers Indicate Weak Product-Market Fit
- "We've got everything pretty well organized"
- "Our CMMS handles all of that"
- "We don't really have a documentation problem"
- Pain score 1 or 2
- "AI isn't something we'd trust for safety-related work" (valid concern, but not your ICP yet)
- They seem polite but uninterested — don't push

### What Answers Indicate a Possible Pilot Customer
- They describe a SPECIFIC pain (not generic "things could be better")
- They name a SPECIFIC machine, line, or situation where this would help
- They ask about pricing or timeline unprompted
- They say "I wish we had something like this"
- They offer to introduce you to someone else at their company
- They have 5+ maintenance techs (enough scale to feel the pain)

### What Answers Indicate You Should Follow Up After the Event
- Any pain score of 3+
- Any likelihood score of 3+
- They gave you their email or business card
- They mentioned a specific problem MIRA could solve
- They asked about a demo
- They said "talk to our [maintenance manager / plant engineer / IT]"

### Post-Conversation Checklist
After each conversation, quickly note in your lead capture form:
- Their name and company
- Their role
- The one thing they said that matters most (exact words if possible)
- Pain score and likelihood score
- Whether they want a demo or follow-up
- Any specific equipment or situation they mentioned
