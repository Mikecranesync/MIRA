# MIRA Customer Usability Survey — 2026-04-26

**Purpose:** Establish baseline usability before opening MIRA to traffic. Identify the 1-3 things that will make a stranger bounce vs. stay.
**Target audience:** Two segments, run separately
- **Segment A — Friendlies (n=5):** Anyone in Mike's network with even loose plant exposure. Goal: catch dumb stuff (broken signup, bad copy, dead links). Run this first.
- **Segment B — ICP (n=3-5):** Plant maintenance managers / reliability engineers at small-to-mid manufacturers. Markus Dillman (GMF Steel), Thomas Hampton (Tampa Bay Steel), and 1-3 others Mike can reach. Run this *after* Segment A surfaces and you've fixed any P0 issues.

**Format:** 10 questions. ~10 minutes async, ~30 minutes if you can do screen-share for Q6. Use Tally, Google Forms, or just email a numbered list and ask for replies.

**Mike's workload:** ~30 min to send the surveys. Read replies as they come in (Slack/email digest is fine). Synthesize after you have ≥3 in each segment.

---

## The survey

Copy the section below into a Google Form / Tally / email body. Subject line for email:
> "5 minutes — what does MIRA look like to you?"

---

> **MIRA — early-access feedback**
>
> Hi {{first_name}} —
>
> I'm Mike, building MIRA at FactoryLM. It's an AI assistant for plant maintenance — your tech scans a QR code on a machine, asks a question, gets the answer from the OEM manual + your tribal knowledge.
>
> I'm in early access and trying to figure out what's confusing or broken before I scale it up. Your honest answer to these is more valuable to me than any pitch I could give you. Roast it.
>
> Site to look at first: **factorylm.com**

> **Section 1 — About you (30 seconds)**
>
> 1. **What's your role and your plant in 2 sentences?** *(I want to know whether you'd actually use MIRA, or whether you're answering as a friend.)*
>
> **Section 2 — First impression of the website (2 minutes)**
> *Open factorylm.com in another tab. Don't sign up yet — just look.*
>
> 2. **In your own words, what does MIRA do?** *(If you had to explain it to a tech in your plant, in one sentence.)*
>
> 3. **On a scale of 1-10, how clearly does the homepage explain what MIRA is for someone in your role?** *(1 = "I have no idea", 10 = "obvious")*
>
> 4. **On a scale of 1-5, how trustworthy does the page feel? What did or didn't help you trust it?** *(1 = "this is a scam", 5 = "I'd give them my email")*
>
> **Section 3 — Try it (5 minutes)**
> *Now actually try it. Sign up at factorylm.com, upload a manual (any PDF — equipment manual you have lying around), ask MIRA one question about it.*
>
> 5. **Where did you get stuck, if anywhere?** *(Open answer. Even small friction counts. "I didn't see the upload button for 30 seconds" is gold.)*
>
> 6. **What did MIRA's first answer look like? Was it useful?** *(Paste the answer if you can. If it was wrong, say what you expected instead.)*
>
> **Section 4 — The deciding question (2 minutes)**
>
> 7. **Imagine you have a machine that throws a fault code right now. You scan a QR sticker on it. What would you expect MIRA to tell you first?** *(This is asking what your model of the product is — there's no wrong answer.)*
>
> 8. **What's missing for you to use this with a real machine in your plant?** *(Be specific. "It needs to integrate with my Maximo" or "I'd need approval from corporate" or "I need to trust it for safety-critical answers" are all useful.)*
>
> **Section 5 — Wrap (1 minute)**
>
> 9. **0-10: would you tell a maintenance friend at another plant about MIRA?** *(0 = "don't bother", 10 = "calling them today")*
>
> 10. **If MIRA didn't work right on the first try, what would make you give it a second chance — vs. just walking away?** *(This tells me how much grace early users will give.)*
>
> Hit reply with your answers. If you'd rather show me on Loom or jump on a 15-min call, my Calendly is [link]. I'll personally read every word.
>
> Thanks for the help —
> Mike
> mike@factorylm.com

---

## Decision rules — when answers come in

Read each survey ≤24 hours after it lands. After ≥3 in a segment, run this checklist:

| If... | Then... |
|---|---|
| **Q2 (free-text "what does MIRA do") matches your intended pitch in <50% of replies** | Block Phase 1 (Sticker Drop). The homepage copy is buried lede and cold prospects will bounce. Fix `public/index.html` headline + subhead first. |
| **Q3 (clarity score) averages <6** | Same as above. Marketing-led traffic onto an unclear page is wasted spend. |
| **Q4 (trust score) averages <3** | Block opening `manual@` to public traffic (Phase 2). Add testimonials, case study, real plant logos, security/trust page. |
| **Q5 (signup/upload/chat) reports a hard blocker for ≥1 tester** | P0 bug. Fix before any new traffic. Likely candidates: Stripe webhook race, Atlas provisioning timeout, magic-inbox token expiry. |
| **Q6 (first answer quality) is "wrong" or "I don't know" for >40% of testers** | Pause Phase 2 (manual-by-email) until you can characterize when MIRA fails. Add a "MIRA isn't sure" disposition path. |
| **Q7 (mental model) diverges wildly from what MIRA actually says first** | Update `mira-pipeline` system prompt to match user expectations OR update marketing to set the right expectation. Your call which side moves. |
| **Q8 (what's missing) gets the SAME answer from 3+ testers** | That's a Phase 0 blocker. Don't ship Phase 1 until it's addressed. (Examples I'd expect: "needs SOC 2", "needs Maximo integration", "needs to handle safety-critical Qs differently".) |
| **Q9 (NPS) average <5** | Stop. Do another round of customer-development calls to figure out what kind of product they actually want. Adding outbound won't help. |
| **Q10 reveals a consistent "second-chance" pattern** | That's your retention play. Build it into the activation drip (e.g. "if MIRA gets it wrong, here's what to do"). |

---

## How to send the survey

### Option 1 — Tally (recommended, free for your volume)

1. Sign up at tally.so with mike@factorylm.com.
2. New form → paste each question, set Q3/Q4/Q9 to scale, Q1/Q2/Q5/Q6/Q7/Q8/Q10 to long text.
3. Send link via personal email — not a marketing tool. Subject above.

### Option 2 — Email (no form, fastest)

Just paste the text above. Numbered list. Ask for numbered replies.

### Option 3 — Loom for the trial task (Q6)

For Markus and Thomas specifically: ask them to record a Loom while doing Q5/Q6 ("loom.com/screen-recorder, hit record, share your screen, sign up at factorylm.com, talk through what you're doing"). Watching a 5-min Loom of a real plant manager onboarding teaches you more than any analytics tool.

---

## Whom to send first

### Segment A — Friendlies (send Apr 27-28)

Pick 5 from your network. Examples from your inbox / CRM:
- Karen Krymski (FFSBDC) — has plant network and will be candid
- Dan @ BuildTheStory (Gust Countdown coach) — already coaching you
- Anyone from Greentown Labs / MassRobotics / Techstars cohort
- Yuhao Zhong, Klaus Blache, or any one of the predictive-maintenance professors — will give technical critique
- Founders in your batch of accelerators

If you don't have 5, run with 3.

### Segment B — ICP (send May 04, only after Segment A pass)

- Markus Dillman (Lead Plant Engineer, GMF Steel Group) — also part of his sticker pack offer (#SO-001)
- Thomas Hampton (Operations Manager, Tampa Bay Steel) — same (#SO-002)
- 1-3 plant managers Mike already knows from outside HubSpot — call old colleagues if needed

For Segment B, frame as: "I'd love your eyes on this for 10 minutes — I'll send you a free 10-pack of MIRA stickers either way as a thank-you." (The stickers are the gift, not the pitch. The survey is the pitch.)

---

## Synthesis template

After you have ≥3 in each segment, fill this in (`docs/usability-survey-results-2026-05.md`):

```
SURVEY RESULTS — 2026-05-XX
n_friendlies = X
n_icp        = Y

Q3 clarity (avg, range):       _ / 10  (_ to _)
Q4 trust (avg, range):         _ / 5   (_ to _)
Q9 NPS (avg, range):           _ / 10  (_ to _)

Top 3 themes from open answers:
  1. [theme] — [n people, pull quote]
  2. ...
  3. ...

P0 blockers found:
  - [blocker] — assigned to issue #SO-XXX

Decisions:
  - Phase 1 ship: [GO / DELAY / RECONSIDER]
  - Phase 2 ship: [GO / DELAY / RECONSIDER]
  - Marketing copy: [REWRITE / KEEP / TWEAK]
```

Pin this file into `wiki/hot.md` so future Cowork sessions pick it up.
