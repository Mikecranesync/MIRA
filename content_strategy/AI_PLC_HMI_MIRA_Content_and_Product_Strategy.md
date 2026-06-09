# AI + PLC/HMI + MIRA — Content & Product Strategy

**Owner:** Mike Harper — FactoryLM / MIRA
**Built from:** a real audit of the MIRA repo (PLC code, Ignition Perspective views, Modbus maps, demo HMIs, commissioning logs, existing marketing). Claims here are backed by actual artifacts — see Deliverable 6 for the file-level inventory.
**Date:** 2026-05-30

---

## The one-paragraph thesis

You did something most "AI in manufacturing" talkers can't: you used AI coding agents to **program a real PLC, talk Modbus to a real VFD, and turn ordinary machine photos into live, tag-bound HMIs** — and you have the files to prove it. That "photo → working HMI" moment is your wedge. It's visually undeniable, it's repeatable, and it leads straight into MIRA's real business (structuring a plant's maintenance namespace). The plan below turns that proof into **attention (YouTube), a lead magnet, a fast paid offer, and qualified MIRA pipeline** — in that order, because attention is free and pipeline is the goal.

**The single sharpest hook you own:** *"I turned a bad webcam photo of a machine into a working HMI — here's how."* Lead with it everywhere.

---

# DELIVERABLE 2 — YouTube Content Strategy

## Channel strategy in 6 lines
- **Channel promise:** "Maintenance guy uses AI to do real controls work. No hype. Real hardware. Real screens."
- **Format mix:** every idea ships as a **60-sec Short** (hook + payoff, vertical) AND an **8–12 min long-form** (the full build, screen-recorded). Shorts farm reach; long-form converts.
- **Visual rule:** the thumbnail and first 3 seconds must show a *machine or a screen changing*, never a talking head or an "AI" logo.
- **Proof rule:** show the actual file, the actual tag updating, the actual fault lighting up red. You have these — use them.
- **Cadence:** 2 Shorts/week + 1 long-form/week is the target. If that's too much, 3 Shorts/week and 1 long-form every 2 weeks.
- **CTA rule:** every video ends with ONE ask — the free PDF (top of funnel) or "turn your machine photo into an HMI" (bottom of funnel). Never both.

## Funnel map (where each video sends people)
- **PDF** = the free lead magnet (Deliverable 4). Most Shorts point here.
- **MIRA** = book a call / join the MIRA waitlist / request a demo. Bottom-funnel videos point here.
- **Workshop** = the paid live "photo-to-HMI" session (Deliverable 3).
- **Consulting** = "done-for-you" image-to-HMI / documentation gig.

---

## TIER 1 — Record these first (highest hook, lowest production cost, all proof already exists)

### 1. "I turned a bad webcam photo into a working HMI"
- **Hook (first 3s):** "This is a garbage webcam photo of a control panel. Watch what the AI does with it."
- **Thumbnail:** split screen — grainy webcam photo on the left, clean live HMI on the right, big yellow arrow between them. Text: "PHOTO → HMI".
- **60-sec Short:** show the photo → show the AI building the Perspective View → show the live tags moving + the handwritten "PMC Station" label it transcribed. End: "Free guide in bio."
- **8–12 min:** full walkthrough — the photo, the prompt, the generated Perspective View JSON, binding it to tags, the gotchas. Show it's a *functional* screen, not a picture.
- **Asset:** original operator-station webcam photo (**must locate/recapture**) + `ignition/project/.../` Perspective views + ConveyorStatus screenshot.
- **CTA:** PDF.
- **Funnel:** PDF → MIRA.

### 2. "Claude Code built an Ignition Perspective screen from a conveyor image"
- **Hook:** "I Googled 'conveyor 3D image,' snipped it, and asked AI to make it a real HMI."
- **Thumbnail:** the snipped conveyor stock image → the rendered conveyor HMI with green/red sensors. Text: "GOOGLE IMAGE → LIVE HMI".
- **60-sec Short:** snip → generate → bind → a sensor goes red. "Did this twice. Works every time."
- **8–12 min:** the repeatable pipeline — reference image → SVG/Perspective → component IDs that match the diagnostic engine → live highlight. Show the one-line highlight trick.
- **Asset:** Fault Detective conveyor HMI (`2026-05-27_fault-detective-chat-diagnosis_desktop.png`), `docs/conveyor-fault-detective-demo/README.md`.
- **CTA:** PDF.
- **Funnel:** PDF → Workshop.

### 3. "Can AI build a PLC dashboard from a machine photo?" (the test-it-live format)
- **Hook:** "Everyone says AI can't do real industrial work. Let's test it. One photo. One PLC."
- **Thumbnail:** your face mid-skeptical-look + a machine photo + "REAL TEST". 
- **60-sec Short:** the challenge → the result → "it worked, and here's the catch."
- **8–12 min:** honest build including the failure (the GS1-vs-GS10 register mix-up, the CCW sync blocker). Skeptic-friendly. This builds the "no hype" trust your LinkedIn voice already has.
- **Asset:** `plc/GS10_Integration_Guide.md` §8, `RESUME_VFD_COMMISSIONING.md`, ConveyorStatus view.
- **CTA:** PDF.
- **Funnel:** PDF → MIRA.

### 4. "I used AI to turn maintenance knowledge into HMI screens"
- **Hook:** "Your senior tech's brain is the most valuable thing in the plant. I turned some of it into a screen."
- **Thumbnail:** sticky-notes/manual photo → structured HMI. Text: "TRIBAL KNOWLEDGE → SCREEN".
- **60-sec Short:** fault knowledge → MIRA names the fault, cites evidence, highlights the part.
- **8–12 min:** the grounding story — why this isn't ChatGPT guessing; the confirmation gate; citations; "I don't know."
- **Asset:** Fault Detective diagnosis screen, `.claude/rules/uns-confirmation-gate.md` concept.
- **CTA:** MIRA.
- **Funnel:** MIRA.

### 5. "This is how small factories can start building AI-ready machine interfaces"
- **Hook:** "You don't need a $200k SCADA project. You need a phone photo and an afternoon."
- **Thumbnail:** small shop machine + phone + "$0 START". 
- **60-sec Short:** photo → HMI → "that's the whole on-ramp."
- **8–12 min:** the cheap garage-rig stack (Micro820 + GS10 + Ignition + AI), and the path from one screen to a structured plant.
- **Asset:** rig photo (capture), `STRATEGY.md` ICP framing.
- **CTA:** PDF → MIRA.
- **Funnel:** MIRA.

---

## TIER 2 — The build/teach series (credibility + SEO; controls people search these)

### 6. "I let AI program my Allen-Bradley Micro820"
- **Hook:** "I version-controlled my PLC program like software. Here's why that changed everything."
- **Thumbnail:** CCW screen + `Micro820_v4.1.9_Program.st` + "v3 → v4.1.9".
- **Short:** show the versioned ST files; "every AI change is reviewable and reversible."
- **Long:** ST state machine walkthrough, how AI helped, what you still owned (I/O map, safety).
- **Asset:** `plc/Micro820_v*.st`. **CTA:** PDF. **Funnel:** PDF.

### 7. "Modbus RTU to a VFD, explained by someone who just learned it"
- **Hook:** "Modbus sounds scary. It's just: read these numbers, write those numbers."
- **Thumbnail:** GS10 drive + RS-485 wires + "READ / WRITE".
- **Short:** the 3-wire RS-485 hookup + one register read going live.
- **Long:** full GS10 + Micro820 integration — wiring, 8N2/9600, FC03 read, FC06 write, command words.
- **Asset:** `plc/GS10_Integration_Guide.md`. **CTA:** PDF (the cheat-sheet appendix). **Funnel:** PDF.

### 8. "The register map that cost me 3 days (GS1 vs GS10)"
- **Hook:** "The AI wrote perfect code. From the wrong manual. The motor never moved."
- **Thumbnail:** two register tables, one with a red X. Text: "WRONG MANUAL".
- **Short:** the reveal — same drive family, different registers, `0x2100` vs `0x2000`.
- **Long:** the debugging saga + the lesson: grounding beats fluency. Bridge to why MIRA exists.
- **Asset:** `GS10_Integration_Guide.md` §8. **CTA:** MIRA. **Funnel:** MIRA.

### 9. "How I let an AI agent near a live PLC without breaking the plant"
- **Hook:** "Rule #1: the AI never touches energized hardware. Here's the workflow."
- **Thumbnail:** the phase checklist + "YOU CHECK / I CHECK".
- **Short:** the "you see what I can't, I check what you can't" split.
- **Long:** the full 9-phase bringup prompt as a teachable pattern.
- **Asset:** `plc/PLC_BRINGUP_PROMPT.md`. **CTA:** PDF. **Funnel:** PDF → Workshop.

### 10. "Read-only can still stop your motor (the RS-485 trap)"
- **Hook:** "I wrote a 'safe, read-only' scanner. It can fault-stop a running conveyor. Here's why."
- **Thumbnail:** two masters on a bus + "⚠ DANGER".
- **Short:** two-master contention → comm timeout → motor stop, in 30s.
- **Long:** fieldbus safety, why discovery must be read-only AND bus-aware.
- **Asset:** `.claude/rules/fieldbus-readonly.md`, `plc/discover.py`. **CTA:** PDF. **Funnel:** PDF.

### 11. "Connected Components Workbench is where AI hits a wall"
- **Hook:** "The logic was perfect. It just never made it onto the PLC. ErrorID 255."
- **Thumbnail:** CCW + red error + "DEPLOY ≠ DONE".
- **Short:** "correct code, broken deploy" — the two fail independently.
- **Long:** the CCW serial-sync blocker, how you diagnosed it, why you DON'T rewrite working logic.
- **Asset:** `RESUME_VFD_COMMISSIONING.md`. **CTA:** PDF. **Funnel:** PDF.

### 12. "I asked AI to read a schematic photo and diagnose the fault"
- **Hook:** "Photo of a wiring schematic + a question. The AI read it like a tech."
- **Thumbnail:** schematic photo + magnifier + "VISION".
- **Short:** snap schematic → ask → grounded answer.
- **Long:** vision-LLM schematic Q&A, the limits, when it's wrong.
- **Asset:** schematic-photo vision feature (git: "analyze schematic photos with vision LLM", May 25), `mira-core/data/photos/`. **CTA:** MIRA. **Funnel:** MIRA.

---

## TIER 3 — MIRA / business-led (lower reach, higher intent — these close deals)

### 13. "Ask the conveyor what happened" (the booth demo)
- **Hook:** "I built a conveyor that diagnoses its own faults. Watch me blow a fuse."
- **Thumbnail:** conveyor HMI with "BRANCH FUSE LOSS 95%" in red.
- **Short:** inject fault → MIRA names it → highlights the part → confirms before steps.
- **Long:** the full Fault Detective demo + the 7 diagnostic rules + the confirmation gate.
- **Asset:** `docs/conveyor-fault-detective-demo/`, fault-detective screenshots. **CTA:** MIRA. **Funnel:** MIRA.

### 14. "Why generic AI hallucinates on your machines (and how to fix it)"
- **Hook:** "You tried ChatGPT on a fault code. It made something up. Of course it did."
- **Thumbnail:** "HALLUCINATION" crossed out + "GROUNDED".
- **Short:** ungrounded vs grounded answer, side by side.
- **Long:** the grounding thesis — your manuals, your tags, citations, confirmation.
- **Asset:** `STRATEGY.md`, `NORTH_STAR.md`, MIRA chat screenshots. **CTA:** MIRA. **Funnel:** MIRA.

### 15. "The $8,400 fault code (the 2 AM problem)"
- **Hook:** "2 AM. Line 3 down. Fault F0022. Your best tech has never seen it."
- **Thumbnail:** dark plant + phone + "$8,400".
- **Short:** the story beat → the MIRA answer in 10 seconds.
- **Long:** reuse your existing LinkedIn "2 AM VFD Problem" narrative as a video.
- **Asset:** `marketing/content/linkedin-series-2am-vfd-problem.md`. **CTA:** PDF or MIRA. **Funnel:** MIRA.

### 16. "From one machine photo to a structured plant" (the namespace story)
- **Hook:** "One photo becomes a screen becomes an asset becomes a maintenance brain."
- **Thumbnail:** photo → HMI → UNS tree. Text: "1 PHOTO → WHOLE PLANT".
- **Short:** the Command Center UNS tree expanding.
- **Long:** the flywheel — why image-to-HMI is the on-ramp to the namespace MIRA sells.
- **Asset:** Command Center screenshot, `NORTH_STAR.md`. **CTA:** MIRA. **Funnel:** MIRA.

### 17. "I scanned a QR code on a machine and the AI knew what it was"
- **Hook:** "Stick a QR on any machine. Scan it. The AI knows which one you're standing at."
- **Thumbnail:** QR on a panel + phone + "NO APP".
- **Short:** scan → asset context → diagnostic.
- **Long:** the QR/asset workflow, no-app floor access.
- **Asset:** `2026-05-10_qr-asset-sheet_desktop.png`, QR scan screenshots. **CTA:** MIRA. **Funnel:** MIRA.

---

## TIER 4 — Reach/curiosity Shorts (cheap to make, pure top-of-funnel)

### 18. "AI transcribed handwritten marker text off a control panel"
- **Hook:** "Someone wrote 'PMC Station' in marker. The AI put it in the HMI." Thumbnail: zoom on handwriting → UI label. **Short only.** **Asset:** operator-station photo (locate). **CTA:** PDF.

### 19. "Bad photo, good HMI — quality doesn't matter as much as you think"
- **Hook:** "Blurry, dark, off-angle. Still worked." Thumbnail: blurry photo + "STILL WORKED". **Short.** **CTA:** PDF.

### 20. "3 things the AI got WRONG building my PLC project"
- **Hook:** "It's not magic. Here are the 3 ways it burned me." Thumbnail: "3 FAILS". **Short + optional Long.** **Asset:** GS1/GS10, CCW sync, rewrite-reflex. **CTA:** PDF.

### 21. "The cheapest way to learn PLCs + AI in 2026"
- **Hook:** "One PLC, one VFD, one motor, one AI agent. Under [$X]." Thumbnail: the rig + price. **Short + Long.** **Asset:** rig photo, BOM. **CTA:** PDF.

### 22. "I'm a maintenance guy, not a programmer — and I shipped this"
- **Hook:** "No CS degree. No software job. Here's 30 days of output." Thumbnail: montage of screens. **Short.** Channel-trailer energy. **CTA:** subscribe + PDF.

---

## Production notes (so this is doable, not aspirational)
- **Batch the Shorts.** Films 6–8 Shorts in one sitting from the same screen recordings.
- **Reuse the existing pipeline.** You already have `marketing/demo-videos/story-scripts.yaml` (Ken-Burns screenshot videos), `marketing/hyperframes/` (a 60-sec setup MP4), and a comic pipeline. The image-to-HMI content is *new and better* than these — but the rendering tooling is already built.
- **The voice is already defined:** practitioner-peer, short sentences, no "AI-powered" without saying what it does (`linkedin-series-2am-vfd-problem.md` production notes). Keep it.
- **First 3 seconds win or lose.** Always open on a machine or a screen changing.
- **Capture the missing money shots first** (see Deliverable 6 + 7): the operator-station before/after is the highest-leverage asset you don't yet have cleanly captured.

---

# DELIVERABLE 3 — Paid Product Ideas (ranked by speed-to-cash)

Each idea scored on: **Launch speed**, **Revenue potential**, **Build difficulty**, **Who buys**, **Proof you already have**, **Best format**. Sorted so the top of the list is what to test first.

## Scorecard (at a glance)

| # | Product | Launch | Revenue | Difficulty | Best format |
|---|---------|--------|---------|------------|-------------|
| 1 | "Machine Photo → HMI Mockup" done-for-you | ⚡ Days | $$ per job | Low (you've done it) | Consulting / fixed-fee gig |
| 2 | Free→Paid PDF: AI PLC/HMI guide | ⚡ Days | $ | Low | Gumroad PDF ($0 then $19–39) |
| 3 | Live "Photo-to-HMI" workshop | 🕐 1–2 wks | $$ | Medium | Cohort / live Zoom ($99–299) |
| 4 | "PLC/VFD Troubleshooting with AI" mini-course | 🕐 2–4 wks | $$ | Medium | Gumroad/Teachable ($79–199) |
| 5 | "Ignition Perspective with AI" starter kit | 🕐 1–2 wks | $$ | Medium | Template pack + guide ($49–149) |
| 6 | MIRA pilot (the real business) | 🕐 Weeks | $$$$ | High (delivery) | Service: $500 assess → $2–5k pilot |
| 7 | "AI-ready machine" workshop for schools/teams | 🗓 Month+ | $$$ | Medium-High | On-site / trade-school workshop |
| 8 | HMI design template pack | 🕐 1–2 wks | $ | Low-Med | Gumroad digital download |

## The ideas, evaluated

### 1. "Machine Photo → HMI Mockup" — done-for-you service (START HERE for cash)
- **Speed:** days. You've literally done it 3+ times.
- **Revenue:** $150–$750 per mockup; $1.5–5k for "mockup + live-tag binding." Recurring if they want more screens.
- **Difficulty:** low — it's your existing workflow productized.
- **Who buys:** small manufacturers, system integrators short on UI time, OEMs who want a quick HMI concept for a quote.
- **Proof you have:** the Perspective views in `ignition/project/`, the conveyor HMI, the operator-station reproduction.
- **Best format:** fixed-fee consulting gig with a 48-hour turnaround. "Send me a photo of your machine, get an HMI mockup back."
- **Why it's #1:** fastest path from your unique skill to a paid invoice, and every job becomes YouTube/case-study content + MIRA pipeline.

### 2. The PDF guide (free lead magnet → paid expanded edition)
- **Speed:** days (the outline is already written — see the companion file).
- **Revenue:** modest direct ($19–39), but its real job is list-building and authority. Sell an "expanded edition + GS10/Micro820 cheat sheet + the bringup prompt."
- **Difficulty:** low. You have all the content.
- **Who buys:** controls learners, maintenance techs leveling up, AI-curious industrial folks.
- **Best format:** free PDF on a landing page (lead magnet), $29 "pro" version on Gumroad.
- **Proof:** `GS10_Integration_Guide.md`, `PLC_BRINGUP_PROMPT.md`, the demo READMEs.

### 3. Live "Photo-to-HMI" workshop
- **Speed:** 1–2 weeks to first cohort.
- **Revenue:** $99–299/seat × 10–30 seats = $1–9k/cohort; repeatable monthly.
- **Difficulty:** medium — you teach live, attendees bring a photo, build an HMI together.
- **Who buys:** integrators, maintenance teams, controls students.
- **Best format:** 2-hour live Zoom, recorded and resold.
- **Proof:** the repeatable pipeline; do it live on a stranger's photo to prove it's not staged.

### 4. "PLC/VFD Troubleshooting with AI" mini-course
- **Speed:** 2–4 weeks.
- **Revenue:** $79–199; evergreen.
- **Difficulty:** medium (record + edit modules).
- **Who buys:** techs, apprentices, reliability folks.
- **Best format:** Gumroad or Teachable, 6–10 short modules.
- **Proof:** GS10 guide, fault-code tables, the real debugging stories.

### 5. "Ignition Perspective with AI" starter guide + template kit
- **Speed:** 1–2 weeks.
- **Revenue:** $49–149.
- **Difficulty:** medium.
- **Who buys:** Ignition users, integrators, SCADA learners (Ignition has a hungry community).
- **Best format:** PDF + downloadable Perspective view JSON templates.
- **Proof:** your actual `ConveyorStatus`, `SpeedControl`, `FaultLog`, `MiraPanel` views + the `mira-ignition-exchange` listing — you can also publish to the **Ignition Exchange** for free distribution + inbound.

### 6. MIRA pilot — the real company (don't let the products distract from this)
- **Speed:** weeks (sales cycle).
- **Revenue:** $500 assessment → $2–5k/mo pilot → $499/mo operating layer. **This is where the millions are**, per `STRATEGY.md`.
- **Difficulty:** high — it's delivery, not a download.
- **Who buys:** SMB/mid-market plants (50–500 employees, 2–20 techs), OEM service orgs.
- **Best format:** service-led. Everything above (1–5) is **top-of-funnel for this.**
- **Proof:** the whole repo — grounded diagnosis, UNS namespace, CMMS, QR floor access.

### 7. "Turn Your Machine Into an AI-Ready Training Asset" — workshop for teams / trade schools
- **Speed:** month+ (partnerships).
- **Revenue:** $1.5–5k per on-site/virtual session; trade schools buy curriculum.
- **Difficulty:** medium-high.
- **Who buys:** maintenance departments, community colleges, apprenticeship programs.
- **Best format:** half-day workshop; license the materials.
- **Proof:** the garage rig + the photo-to-HMI pipeline = a perfect teaching artifact.

### 8. AI-generated HMI design template pack
- **Speed:** 1–2 weeks.
- **Revenue:** $$ low but passive.
- **Difficulty:** low-medium.
- **Who buys:** integrators wanting a fast visual starting point.
- **Best format:** Gumroad digital download (Perspective/SVG templates + prompts).
- **Proof:** your existing views.

## Recommended sequence
**Test #1 (service) + #2 (free PDF) in the same week.** The PDF generates leads; the service converts the hottest ones to cash immediately. Use the revenue and case studies to fund #3 (workshop) and feed #6 (MIRA). Don't build #4/#5/#8 until #1–#3 prove demand — they're polish, not validation.

---

# DELIVERABLE 4 — The Lead Magnet

## Title (pick one — A/B test)
- **A:** "Turn a Machine Photo into an HMI Mockup with AI — the 5-step field guide" ✅ recommended
- **B:** "From Phone Photo to Live HMI: How a Maintenance Guy Did It With AI"
- **C:** "The Machine-Photo-to-HMI Playbook (free)"

## Target audience
Maintenance techs, controls hobbyists, small-plant engineers, and integrators who can wire a panel but have never built a screen — the same ICP as MIRA (`STRATEGY.md`), reached one layer earlier in their journey.

## Problem it solves
"I have machines with no usable interface, no documentation, and no budget for a SCADA project. I keep hearing 'AI' but I don't know how to use it on real hardware." The PDF gives them a concrete, safe, repeatable first win — a screen from a photo — that costs them nothing but an afternoon.

## What the PDF includes (8–12 pages, skimmable)
1. **The promise + a before/after image** (grainy photo → live HMI) on page 1.
2. **Why this works** — the AI reproduces a *functional, tag-bound* interface, not a drawing.
3. **The 5 steps** (below).
4. **The safety rule** — never let the AI touch energized hardware; pair it with your eyes (the bringup pattern, condensed).
5. **One worked example** — the conveyor photo → conveyor HMI.
6. **The gotchas** — bad-but-usable photos, confirm the exact model, deploy ≠ done.
7. **CTA page** — book a call / join the waitlist / "send me your machine photo."

## Step-by-step sections
- **Step 1 — Take the photo.** Any phone/webcam. Off-angle and dim is fine. Capture labels and nameplates.
- **Step 2 — Prompt the agent.** "Reproduce this operator panel as an Ignition Perspective View; list the controls and indicators you see." (Give the exact prompt template.)
- **Step 3 — Review the generated screen.** Check the layout, the labels, the controls. The AI will transcribe handwritten text — verify it.
- **Step 4 — Bind to tags (or mock them).** Map each indicator to a PLC tag (or a simulator) so the screen is *live*, not static. Show the tag table.
- **Step 5 — Make it diagnose.** Add the one rule: "if this tag faults, turn this component red." Now it's an interface that tells you something.

## Screenshots needed (for the PDF)
- 🔴 Operator-station **before/after** (locate original webcam photo + capture rendered view).
- 🟢 Conveyor reference image → conveyor HMI (have the HMI; get the source snip).
- 🟢 A live tag updating / a component turning red (Fault Detective screenshot exists).
- 🟡 The prompt template as a clean graphic.

## CTA copy (end of PDF)
> **You just turned a photo into a screen. Imagine your whole plant structured like this.**
> That's what we build at FactoryLM. If you want me to turn *your* machine photo into a working HMI mockup — free, no pitch — reply to the email or [book 15 minutes]. If you're ready to make your plant AI-ready, [request a MIRA demo].

## Email capture copy (landing page form)
- **Headline:** "Turn a machine photo into a working HMI. Free guide."
- **Sub:** "The exact 5-step process I used to build live HMIs from phone photos — with AI, on real PLC hardware. No SCADA budget required."
- **Field:** Email + (optional) "What machine are you trying to interface?"
- **Button:** "Send me the guide"
- **Trust line:** "From a maintenance guy, not a software vendor. No spam. Unsubscribe anytime."

## Landing page copy (short, conversion-focused)
> **Headline:** You don't need a SCADA project to give your machines a screen.
> **Sub:** I'm a maintenance guy. Using AI coding agents, I turned ordinary phone photos of machines into live, working HMIs — bound to real PLC tags. This free guide shows you exactly how, in 5 steps, safely.
> **3 bullets:**
> - Works with bad webcam photos — the AI even reads handwritten panel labels.
> - Real hardware (Micro820 + GS10 VFD), real Ignition screens — not a concept demo.
> - Includes the safety workflow for using AI near a live PLC.
> **CTA:** [Send me the free guide] → then a soft nudge to book a "photo-to-HMI" call.

**Where to promote it:** every Tier-1/Tier-4 YouTube Short, the LinkedIn "2 AM" series, and the expo lead-capture flow you already built (`expo-lead-capture.html`, `expo-discovery-questionnaire.pdf`).

---

# DELIVERABLE 5 — Business Positioning

You asked which of five paths to bet on. Here's the honest comparison, then a recommendation that doesn't make you choose just one.

| Path | Cash speed | Ceiling | Defensibility | Supports MIRA? | Risk |
|---|---|---|---|---|---|
| 1. Sell education (courses/PDF) | Fast | Low–Med | Low (commoditizes) | Indirectly (audience) | Becomes a content treadmill |
| 2. Sell AI/HMI consulting | **Fast** | Med | Med (your skill) | **Yes (direct pipeline)** | Trades time for money |
| 3. Sell MIRA software | Slow | **Very high** | **High (namespace moat)** | **It IS MIRA** | Long delivery cycle |
| 4. Done-for-you docs/HMI PDFs | Fast | Med | Med | Yes (lands accounts) | Service scaling limits |
| 5. Workshops (teams/trade schools) | Med | Med–High | Med | Yes (brand + leads) | Partnership-dependent |

## The read
- **Education alone (Path 1)** is the weakest standalone bet — it's a treadmill and it commoditizes. But as a *lead magnet and authority engine*, it's essential. Use it; don't depend on it.
- **MIRA software (Path 3)** is where the real money and the durable moat are — `NORTH_STAR.md` and `STRATEGY.md` are right that the **Maintenance Intelligence Namespace** is the defensible asset. But it's a slow, delivery-heavy sale. You can't eat while you wait for it.
- **Consulting + done-for-you (Paths 2 & 4)** are the bridge: fast cash, and every engagement is a foot in the door for a MIRA pilot. The "photo-to-HMI" gig is the perfect tip-of-the-spear because it's a *small, visual, low-risk yes* that gets you inside a plant.
- **Workshops (Path 5)** are a force multiplier for brand and pipeline once you have case studies — not the thing to lead with.

## Recommendation: a "ladder," not a single bet
Run a **services-funded software company**:

1. **Tip of the spear (now):** the "Machine Photo → HMI Mockup" service + the free PDF. Fast cash, undeniable proof, content flywheel.
2. **The wedge (per `STRATEGY.md`):** convert HMI/consulting clients into the **$500 Assessment** → it's the same buyer, one step deeper.
3. **The engine (the real business):** Assessment → **$2–5k/mo Pilot** → **$499/mo Operating Layer** (MIRA in production). This is the millions.
4. **Education + workshops:** run continuously as **top-of-funnel and authority**, not as the main revenue line.

**One-line positioning to use publicly:** *"FactoryLM makes your plant AI-ready. We start by turning a machine photo into a working interface — and end with a maintenance brain that knows your whole plant."* It leads with the visual hook and lands on the MIRA thesis.

**Keep the `STRATEGY.md` guardrail:** infrastructure first, AI second. The photo-to-HMI trick is the attention-grabber, but never sell "AI CMMS" — sell the transformation. And apply the existing filter to every piece of content: *"Would an industrial buyer who hates AI hype still find this credible?"*

---

# DELIVERABLE 6 — Repo Artifact Inventory

What you actually have, what it's for, and whether it's safe to publish. Paths are relative to the MIRA repo root.

## A. The headline assets (image-to-HMI proof)

| Artifact | Path | What it is | Supports | In PDF? | Publish safety |
|---|---|---|---|---|---|
| Ignition Perspective views | `ignition/project/com.inductiveautomation.perspective/views/` (ConveyorStatus, SpeedControl, FaultLog, NavBar, Mira/MiraPanel, MiraAlertHistory, ConnectSetup, MiraSettings) | Real, live-tag-bound HMI screens (JSON) | Videos 1,2,6,11; Products 1,5,8 | ✅ Yes | ✅ Safe — generic demo tags |
| Conveyor Fault Detective HMI | `docs/conveyor-fault-detective-demo/`, screenshots `2026-05-27_fault-detective-*` | 2D conveyor HMI + grounded chat + confirmation gate | Videos 2,13,14; Products 1,3 | ✅ Yes | ✅ Safe — booth demo by design |
| Command Center (UNS tree) | `mira-hub/src/app/(hub)/command-center/`, screenshot `2026-05-30_command-center-LIVE-watching-nodered_desktop.png` | Live web app showing namespace + live conveyor | Videos 16; Product 6 | ✅ Yes | ✅ Safe — demo data ("Home Garage") |
| Ignition Exchange package | `mira-ignition-exchange/` (ChatDock, ScanWidget, EXCHANGE_LISTING.md) | Publishable Ignition module | Product 5 | Optional | ✅ Safe — built to distribute |
| Source machine photos | `mira-core/data/photos/{Analyze,Tell,Which}/*.jpg` | Real machine HMI/nameplate photos (e.g., MultiSmart pump controller) | Videos 1,12,19; Product 1 | Selectively | ⚠️ **Verify provenance** — confirm these are yours, not a customer's, before publishing |

## B. PLC / Modbus / VFD (the teaching substance)

| Artifact | Path | What it is | Supports | In PDF? | Publish safety |
|---|---|---|---|---|---|
| Micro820 ST programs (versioned) | `plc/Micro820_v3_Program.st` → `v4.1.9_Program.st` | The PLC logic, version-by-version | Videos 6,9; Product 4 | ✅ excerpts | ✅ Safe (generic logic) |
| GS10 integration guide | `plc/GS10_Integration_Guide.md` | Full Modbus/VFD bible — params, registers, wiring, faults | Videos 7,8; Products 2,4; **PDF Appendix A** | ✅ Yes | ✅ Safe — pure reference |
| VFD commissioning blocker log | `plc/RESUME_VFD_COMMISSIONING.md` | The CCW sync failure saga (ErrorID 255) | Videos 11,20; PDF Ch.5/16 | ✅ Yes | ⚠️ **Redact** `C:\Users\hharp\...` path + LAN IPs |
| PLC bringup prompt | `plc/PLC_BRINGUP_PROMPT.md` | The 9-phase human-in-the-loop pattern | Video 9; Products 2,3; **PDF Appendix B** | ✅ Yes | ⚠️ **Redact** Windows paths + IPs first |
| Modbus map + scripts | `plc/MbSrvConf_v4.xml`, `live_monitor.py`, `vfd_diag.py`, `deploy_modbus_map.py`, `discover.py` | Live monitoring + diagnostics + (deliberate) write tool | Videos 7,10,13 | excerpts | ✅ Safe (LAN-only addresses) |
| Fieldbus read-only rule | `.claude/rules/fieldbus-readonly.md` | The RS-485 two-master safety lesson | Video 10; PDF Ch.9 | ✅ Yes | ✅ Safe |
| CCW assets | `plc/CCW_*.txt`, `plc/ccw/` | Variables + deploy notes | Video 6 | excerpts | ✅ Safe |

## C. Instruction PDFs (already-built teaching collateral)

| Artifact | Path | What it is | Supports | Publish safety |
|---|---|---|---|---|
| Conveyor teaching PDFs | `docs/instructions/Conv_Simple_{LadderFirst,Prog3_Modbus_Polling,Complete,UDFB_Intro}.pdf` | Step-by-step CCW/ladder lessons | Product 4 (mini-course spine) | ✅ Review then safe |
| 3-tag demo PDF | `tools/demo-3tag-plc-vfd-conveyor.pdf` | PLC+VFD+conveyor demo handout | Products 1,3 | ✅ Safe |
| Modbus map PDF | `docs/conveyor-fault-detective-demo/Micro820_v4.1.9_Modbus_Map.pdf` | Generated register map | Video 7; Product 2 | ✅ Safe |

## D. Marketing / business assets (already exist — reuse, don't rebuild)

| Artifact | Path | What it is | Supports | Publish safety |
|---|---|---|---|---|
| Demo video story scripts | `marketing/demo-videos/story-scripts.yaml` | 5 narrated screenshot-video scripts + pipeline | YouTube long-form | ✅ Safe (internal scripts) |
| 60-sec setup video | `marketing/hyperframes/output/60-second-setup.mp4` | Rendered promo | Channel trailer | ✅ Safe |
| LinkedIn "2 AM VFD" series | `marketing/content/linkedin-series-2am-vfd-problem.md` | 6-post narrative + voice guide | Video 15; all CTAs | ✅ Safe |
| Comic / cartoon pipeline | `marketing/cartoons/`, `marketing/comic-pipeline/` | Generated explainer panels | Shorts B-roll | ✅ Safe |
| Expo lead capture | `expo-lead-capture.html`, `expo-discovery-questionnaire.pdf` | Working lead-capture flow | Lead magnet delivery | ✅ Safe (it's a form) |
| Positioning docs | `NORTH_STAR.md`, `STRATEGY.md`, `Mira-BizDev/` | The business thesis, ICP, offers | Videos 14,16; Positioning | ❌ **Internal — do not publish** (strategy, pricing logic) |

## E. ⚠️ Do NOT publish (internal/infra/secrets)
- `CLAUDE.md`, `.claude/` rules beyond the two teaching ones — contain VPS IP (`165.245.138.91`), Tailscale IPs, node hostnames, Doppler/secret references, deploy internals.
- Any `docker-compose*.yml`, `nginx-*.conf`, `deployment/`, `infra/` — infra topology.
- The node map / network table in `CLAUDE.md`.
- Customer/prospect data: `marketing/prospects/*.csv` — **PII, never publish.**

## Cleanup checklist before any public release
1. Redact `C:\Users\hharp\...`, VPS/Tailscale IPs, hostnames, Doppler refs from `RESUME_VFD_COMMISSIONING.md` + `PLC_BRINGUP_PROMPT.md` (make sanitized "public" copies).
2. Confirm `mira-core/data/photos/` images are yours to publish (or get permission / blur identifying detail).
3. Strip any real customer names from screenshots (demo data like "Home Garage" is fine).
4. Keep prospect CSVs and infra configs out of any repo or video you publish.

---

# DELIVERABLE 7 — 30-Day Execution Plan

**Goal of the 30 days:** convert existing proof into (a) a published lead magnet, (b) 5–10 leads, (c) 1 paid "photo-to-HMI" gig, and (d) 4–6 YouTube videos live — all feeding MIRA pipeline. Do the cheap, high-leverage things; skip the polish.

## Week 1 — Capture proof + ship the free PDF
- **Gather the money shots (highest priority):**
  - Locate the original operator-station webcam photo ("PMC Station"). If gone, **recreate it**: take a fresh bad photo of a panel, regenerate the HMI on camera (better — it's now a repeatable demo, not a relic).
  - Capture the rendered Perspective views from Ignition (ConveyorStatus + the operator station).
  - Re-snip a conveyor reference image and re-run the photo→HMI live (record your screen this time).
- **Produce the lead magnet:** turn the companion outline into the 8–12 page PDF (use the `pdf` skill). Redact the two prompt files for the appendices.
- **Stand up capture:** point the existing `expo-lead-capture.html` flow (or a simple Gumroad/landing page) at the PDF.
- **Publish first:** the free PDF + a LinkedIn post announcing it (reuse the "2 AM" voice).

## Week 2 — Launch the first paid offer + first videos
- **Record Tier-1 videos 1, 2, 3** (you have the assets). Cut each into a Short + a long-form. Publish 2 Shorts + 1 long-form.
- **Open the "Machine Photo → HMI Mockup" service:** one page, fixed fee, 48-hr turnaround, "send me a photo." Announce it to your LinkedIn audience and in the video CTAs.
- **Soft offer (your proven move):** "First 5 people to send a machine photo get a free HMI mockup" — same mechanics as your "free PM extraction" post that already works. Free mockups → testimonials → paid pipeline.

## Week 3 — Convert + the troubleshooting/credibility content
- **Record videos 8, 9, 13** (the GS1/GS10 failure, the bringup pattern, the conveyor booth demo). Publish 2 Shorts + 1 long-form.
- **Convert the warmest lead** from the free mockups into a paid gig OR a **$500 MIRA Assessment** (same buyer, deeper). 
- **Turn the first mockup into a case study** (before/after + a 2-line quote). This is the artifact that closes the next 10.

## Week 4 — Test the workshop + decide what scales
- **Announce a live "Photo-to-HMI" workshop** (Week 5 date) — low price, cap seats, do it live on an attendee's photo.
- **Publish videos 15, 16** (the 2 AM story, the namespace story) to bridge audience → MIRA.
- **Review the numbers:** which CTA converted (PDF vs mockup vs MIRA)? Double down on the winner. Schedule a recurring weekly briefing to keep this moving.

## First-things-first (if you only do five things)
1. **Recreate the photo→HMI on camera** (turns a lost artifact into a repeatable, recordable demo).
2. **Ship the free PDF** + capture page.
3. **Record video #1** ("bad webcam photo → working HMI").
4. **Open the mockup service** with a free-for-first-5 hook.
5. **Convert one warm lead** to a $500 Assessment.

## What NOT to waste time on yet
- ❌ A polished multi-module course (#4) — validate the workshop first.
- ❌ Template/design packs (#8) — no audience to sell to yet.
- ❌ New software features in MIRA — you have *more than enough* proof to sell; the gap is attention and offers, not product.
- ❌ Perfect production value — your edge is authenticity and real hardware, not cinematography.
- ❌ Publishing anything from the "do not publish" list (infra, pricing strategy, prospect data).
- ❌ Chasing platforms beyond YouTube + LinkedIn — that's where your buyer is.

## The proof to show (your unfair advantages, in order)
1. **Bad photo → working HMI** (with the handwritten label transcription) — nobody else shows this.
2. **The honest failures** (GS1/GS10, CCW ErrorID 255) — earns trust with skeptical controls people.
3. **The grounded conveyor that diagnoses itself** — the bridge from "neat trick" to "real product."
4. **One machine photo → a structured plant** (the UNS tree) — the MIRA close.

---

## Companion file
The PDF learning-guide blueprint is in **`AI_Assisted_PLC_HMI_Learning_Guide_Outline.md`** (same folder). Build the lead magnet from it in Week 1.

