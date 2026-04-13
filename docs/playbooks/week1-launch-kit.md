# Week 1 Launch Kit — Copy-Paste Ready Content

**Prepared:** 2026-04-07 (dry run)
**Updated:** 2026-04-10
**Go-live:** 2026-04-08, 8:00 AM ET
**Status:** All content ready. Just copy, paste, post.

> **2026-04-10 rewrite** — every public CTA now points at `factorylm.com/cmms`
> (the beta funnel entry). `app.factorylm.com` is Open WebUI and bypasses the
> Loom nurture / Stripe / `/activated` flow; it is **not** a user landing page.
> Dead-tier language ("5 free queries / no credit card") is stripped — the
> free tier was killed in commit `6bbf5b3` (2026-04-09) and per the Fihn
> strategy pricing stays hidden until the Day 7 nurture email. Frame the beta
> as closed and email-gated. One exception: the Day 1 screenshot step still
> uses `app.factorylm.com` because that's Mike's internal Open WebUI admin
> instance used to generate content — it is **not** a public CTA.

---

## Pre-Launch Checklist (Do today, Apr 7)

### LinkedIn Profile Updates

**Headline** (copy this exactly):
```
Building AI maintenance tools for floor technicians | FactoryLM
```

**Featured Section:**
- Add link: `https://factorylm.com/cmms`
- Title: "Join the FactoryLM beta — AI fault diagnosis from your own manuals"
- Description: "Closed beta for floor techs. Welcome email has the walkthrough video."

**About Section** (add to top of existing):
```
I'm building FactoryLM — an AI-powered maintenance assistant that answers 
fault code questions from your actual equipment manuals. Allen-Bradley, 
PowerFlex, Automation Direct, hydraulic systems.

Ask Mira a fault code → get the diagnosis in 10 seconds, not 40 minutes.

Closed beta for floor techs: factorylm.com/cmms

I also run a 3,000-member LinkedIn group for hydraulics and industrial 
maintenance professionals. Join us: [GROUP URL]
```

### LinkedIn Group Settings

**Group Description** (copy this):
```
Hydraulics troubleshooting, VFD faults, PLC diagnostics, and industrial 
maintenance for floor technicians and managers. 3,000+ members sharing 
real-world fixes.

New: We're exploring how AI tools speed up fault diagnosis. Drop your 
toughest fault codes — the community (and some new AI tools) will help.

Rules: Be helpful. No spam. No recruiting posts.
```

**Group Rules:**
```
Rule 1: Stay on topic — hydraulics, VFDs, PLCs, industrial maintenance
Rule 2: No spam or recruiting — job posts go in the weekly thread
Rule 3: Share what you know — this group runs on experience, not theory
```

**Cover Image Specs (Canva):**
- Size: 1584 x 396 px
- Background: #0a0a08
- Text: "Hydraulics & Industrial Maintenance" in DM Sans Bold, #e4e0d8
- Accent: 3px left bar in #f0a030
- Subtext: "3,000+ maintenance professionals" in #7a766c

---

## Day 1 — Tuesday, Apr 8

### 8:00 AM: Reactivation Post (LinkedIn Group)

**Copy this and post to the group. Pin it after posting.**

```
This group has been quiet for a while. That changes today.

I started this group years ago because I kept running into the same 
hydraulic problems on the floor and wanted a place to share real fixes 
— not textbook theory.

3,000 of you joined. Let's put that knowledge to work again.

Here's what's coming:
→ Weekly fault code breakdowns (hydraulic, VFD, PLC)
→ "What would you check first?" polls  
→ AI diagnostic demos (I'm building a tool that answers fault 
  questions from actual OEM manuals — more on that soon)

First up — a tip you can use today:

Low pressure on your HPU? Before you tear into the pump, check the 
suction strainer. 80% of the time it's a restricted inlet, not a 
worn pump. Pull the strainer, clean it, check your pressure. 
Five-minute fix that saves you a $2,000 pump rebuild.

Drop a comment if you're still here. What equipment are you working 
on these days?
```

**After posting:**
- Click three dots → "Pin post"
- Watch for comments over the next 48 hours
- Reply to EVERY comment with a follow-up question

### 8:30 AM: Screenshot Mira Demo Scenarios

> **INTERNAL USE ONLY.** This step uses `app.factorylm.com` because that's
> Mike's Open WebUI admin instance — it's how you generate the screenshots
> you'll paste into LinkedIn posts. Do **not** share this URL with users;
> the public beta signup is `factorylm.com/cmms`.

Open `app.factorylm.com` (your Open WebUI admin) and run these 5 queries. Screenshot each conversation.

**Query 1 — Hydraulic:**
```
My hydraulic power unit has low pressure. Parker PVP pump, 
2000 PSI system, pressure gauge reads 1200 PSI. What should I check?
```

**Query 2 — Hydraulic:**
```
Hydraulic cylinder is drifting. It won't hold position under load. 
What are the most likely causes?
```

**Query 3 — VFD:**
```
GS20 VFD overcurrent fault on a 15HP motor. The motor isn't hot 
and the load hasn't changed. What should I check first?
```

**Query 4 — VFD:**
```
PowerFlex 525 fault code F004 undervoltage. Drive shuts down 
intermittently. What's causing this?
```

**Query 5 — PLC:**
```
Micro820 PLC not communicating over Ethernet. The network LED is 
flashing but I can't connect from CCW. What should I check?
```

**Save screenshots to:** `~/Desktop/mira-demos/` (use these all month)

---

## Day 2 — Wednesday, Apr 9

### 8:00 AM: Engagement Poll (LinkedIn Group)

**Create a LinkedIn poll in the group:**

**Poll question:**
```
Your VFD just threw an overcurrent fault on a 15HP hydraulic power unit.
Motor temp is normal. Load hasn't changed. What's your first move?
```

**Options:**
- Check input voltage at the drive
- Megger test the motor leads
- Review drive parameters (accel time)
- Disconnect motor, check for mechanical binding

**Text below the poll:**
```
Real scenario from last week. There's a right answer here — 
I'll share what I found (and what an AI diagnostic tool said) tomorrow.

Vote and comment your reasoning below 👇
```

### 8:20 AM: Reddit Setup

1. Go to reddit.com, create account (or log into existing)
2. Join these subreddits:
   - r/PLC (283K members)
   - r/maintenance
   - r/SCADA
   - r/manufacturing
   - r/IndustrialMaintenance
3. Sort r/PLC by "New"
4. Find 2-3 posts where someone needs help
5. Write detailed, helpful answers. Example:

```
[Reply to someone asking about a PLC communication issue]

A few things to check:

1. Make sure your CCW project IP matches the PLC's actual IP. 
   Default on the Micro820 is usually 192.168.1.1 but it 
   might have been changed.

2. Check if your laptop is on the same subnet. If the PLC is 
   192.168.1.x, your laptop needs to be 192.168.1.y.

3. Try pinging the PLC from command prompt: ping 192.168.1.1
   If you get replies, the issue is in CCW settings, not the network.

4. If no ping response, check the cable. Try a different port on 
   the switch. The Ethernet LED on the Micro820 should be solid 
   green for link and flashing for activity.

What's the exact error you're getting in CCW?
```

**NO product mentions. NO links. Just be helpful.**

---

## Day 3 — Thursday, Apr 10

### 8:00 AM: Build-in-Public #1 (Personal LinkedIn — NOT the group)

```
Week 1 building an AI maintenance copilot.

For the past few months I've been building a tool that answers 
equipment fault code questions from actual OEM manuals. 
Allen-Bradley, PowerFlex, Automation Direct, hydraulic systems.

You type the fault code. It finds the right page in the manual 
and gives you the diagnostic steps. In about 10 seconds.

Here's what it looks like 👇

[ATTACH SCREENSHOT FROM DAY 1 — Query 4, PowerFlex 525 F004]

It's not perfect — it missed one edge case on the undervoltage fault. 
But for a first pass standing at the machine, it beats flipping 
through a 400-page PDF.

Building this because I've been that guy on the floor at 2 AM 
trying to find the right page in a manual I can barely read 
in the dark.

If you work in maintenance, I'm opening a closed beta for a few
dozen floor techs. You'll get a walkthrough video series and I'll
load your equipment manuals for you.

Signup: factorylm.com/cmms
```

### 8:30 AM: Reply to group comments
- Go back to the Day 1 reactivation post
- Reply to every new comment
- Go to the Day 2 poll — reply to commenters with "good thinking" or "here's why I'd start somewhere else"

---

## Day 4 — Friday, Apr 11

### 8:00 AM: Reddit Value Post (r/PLC)

Find a NEW post on r/PLC where someone needs help. Write a thorough answer (like the Day 2 example). Build karma.

### 8:30 AM: Technical Value Post (LinkedIn Group)

```
GS20 VFD Overcurrent Fault — 5 things to check before you 
replace the drive:

1. Input voltage — measure all 3 phases at the drive terminals.
   If any phase is more than 10% off nameplate, fix the supply first. 
   A voltage imbalance will cause overcurrent every time.

2. Motor leads — megger test between each phase and ground.
   Anything under 1 MΩ = failing motor windings.
   Under 100 kΩ = replace the motor, don't even think about it.

3. Drive parameters — check accel time (P1.02 on the GS20).
   If someone set it to 1 second on a high-inertia load 
   (like a hydraulic pump), the drive can't ramp fast enough 
   and trips on overcurrent. Try 5-10 seconds.

4. Mechanical binding — disconnect the motor coupling.
   Run the motor uncoupled. If the fault clears, your problem 
   is mechanical (bad bearing, misalignment, seized pump).

5. Ambient temperature — GS20 derates above 40°C (104°F).
   If it's in a sealed cabinet with no fan, summer heat alone 
   can cause intermittent OC faults.

What am I missing? Drop your go-to checks below.
```

---

## Day 5 — Monday, Apr 14

### 8:00 AM: First Product Reveal (LinkedIn Group)

```
Remember the VFD overcurrent poll from last week?

I ran that exact scenario through an AI tool I'm building.

Fault: GS20 overcurrent on a 15HP hydraulic HPU
Question: "What should I check first?"

Here's what it returned:

[ATTACH SCREENSHOT FROM DAY 1 — Query 3, GS20 overcurrent]

It pulled the diagnostic steps from the actual Automation Direct 
GS20 manual. Referenced the right parameter (P1.02 accel time) 
and suggested checking input voltage first.

Took about 10 seconds.

What it got right: voltage check, motor megger, parameter review.
What it missed: the ambient temperature derate issue.

Not perfect. But for a first pass on the floor when you're 
standing in front of a faulted drive? Pretty solid.

I'm letting a handful of floor techs into a closed beta. You'll
get a video walkthrough and I'll load your specific equipment
manuals: factorylm.com/cmms

What fault code should I throw at it next? Drop it below 
and I'll post the result.
```

### 8:30 AM: Warm DMs

**Go to notifications on the reactivation post and poll. DM everyone who engaged.**

**DM Script #1 — For commenters:**
```
Hey [name] — saw your comment on the hydraulics group post. 
Glad you're still around!

Quick question — I built an AI tool that answers fault code 
questions from real equipment manuals (Allen-Bradley, PowerFlex, 
Automation Direct, hydraulic systems). 

Want in? I'm running a closed beta for a handful of floor techs
and I can load any manual you need.

Beta signup: factorylm.com/cmms

No pressure — just thought you might find it useful based on 
what you were saying about [reference their specific comment].
```

**DM Script #2 — For poll voters who didn't comment:**
```
Hey [name] — saw you voted on the VFD fault poll in the 
hydraulics group. Good choice on [their answer].

I actually built an AI tool that diagnosed that same fault 
from the OEM manual in 10 seconds. If you run into stuff 
like that on the floor, it might save you some time.

I'm running a closed beta — signup: factorylm.com/cmms

What equipment are you working on? I can make sure your 
manuals are loaded.
```

**Send 5-10 DMs max. Only to people who actively engaged.**

---

## Day 6 — Sunday, Apr 13

### 8:00 AM: Week 1 Review

Pull these numbers and write them down:

| Metric | Target | Actual |
|--------|--------|--------|
| Reactivation post views | 200+ | _____ |
| Total comments (all posts) | 10+ | _____ |
| Poll votes | 20+ | _____ |
| DMs sent | 5-10 | _____ |
| DM reply rate | 30%+ | _____ |
| factorylm.com/cmms signups | 1 | _____ |
| Reddit karma earned | 50+ | _____ |

**Decision tree for Week 2:**
- If reactivation post got <50 views → group may be dead. Shift primary effort to Reddit + personal LinkedIn.
- If poll got 20+ votes but <5 comments → people are lurking. Push more interactive formats (fault code threads).
- If DM reply rate is <20% → adjust the script. Make it shorter. Lead with their specific comment.
- If 0 signups → the offer isn't landing. Try "I'll load YOUR manual for free" instead of linking to the site.

**Prep for Week 2:**
- Film first YouTube troubleshooting scenario on Saturday (if not done already)
- Pick the highest-engagement post format from this week — do more of that
- Identify the 3 most engaged group members — they're your early champions

---

## Content Bank — Reusable Posts for Weeks 2-4

### Poll Templates (use one per week)

**Poll 2:**
```
Hydraulic cylinder drifting under load. What do you check first?

A) Cylinder seals
B) Directional control valve
C) Relief valve setting
D) Pump flow rate
```

**Poll 3:**
```
PLC won't go to RUN mode. What's your first move?

A) Check for faults in the error log
B) Verify I/O wiring
C) Re-download the program
D) Check the mode switch
```

**Poll 4:**
```
Motor is running hot but not tripping. Amps are normal. 
What's causing the heat?

A) Ventilation / cooling blocked
B) Bearing failure
C) Voltage imbalance
D) Wrong motor for the load
```

### Technical Value Posts (use one per week)

**Post: Hydraulic Troubleshooting Sequence**
```
Hydraulic system not building pressure? Here's the sequence 
I follow every time:

1. Check oil level — sounds obvious, but I've seen $5K 
   pump rebuilds that were just low oil.

2. Check the suction strainer — pull it, hold it up to light.
   If you can't see through it, that's your problem.

3. Listen to the pump — cavitation sounds like marbles 
   in a blender. That's air in the suction line.

4. Check the relief valve — put a gauge right at the relief 
   port. Crack the adjustment. If pressure doesn't change, 
   the relief is stuck open or the cartridge is blown.

5. Flow test the pump — if you've eliminated everything above 
   and pressure still won't build, rent or borrow a flow meter.
   Compare actual GPM to the pump nameplate.

6. Check for internal bypass — a worn cylinder or badly 
   seated valve can dump flow internally. Disconnect the 
   work ports one at a time and retest.

Save this for next time you're standing in front of an HPU 
wondering where to start.
```

**Post: PowerFlex 525 Common Faults**
```
PowerFlex 525 — the 4 faults I see the most and what 
actually fixes them:

F004 (Undervoltage)
→ Check incoming power. Loose connection on the DC bus 
  is the #1 cause. Tighten terminals, measure all phases.

F005 (Overvoltage)  
→ Usually on decel. The motor is regenerating back into 
  the drive. Slow down your decel time or add a braking 
  resistor.

F002 (Overcurrent)
→ See my earlier post on this. TL;DR: check accel time, 
  megger the motor, disconnect the load.

F033 (Heatsink overtemp)
→ Clean the heatsink fins. Check the internal fan. If the 
  drive is in a sealed enclosure, add ventilation or an 
  AC unit. These things derate hard above 40°C.

What's the weirdest PowerFlex fault you've seen?
```

### "Drop Your Fault Code" Thread (use every Wednesday)

```
Fault code thread — drop yours below.

Give me:
→ Equipment make and model
→ Fault code or symptom
→ What you've already tried

I'll run it through an AI diagnostic tool and post what it 
finds from the OEM manual. Screenshots included.

Last week's thread got [X] submissions — let's beat it.
```

---

## Mira-Copy Commands (for generating additional content)

When you need fresh ad copy, emails, or lead magnets:

```bash
# Ads for different platforms
doppler run -- python -m mira_copy ad-copy -a maintenance_tech -v google_search
doppler run -- python -m mira_copy ad-copy -a maintenance_manager -v linkedin

# All 5 drip emails for techs
doppler run -- python -m mira_copy drip-email -a maintenance_tech --all

# Lead magnet: VFD fault code checklist
doppler run -- python -m mira_copy lead-magnet -a maintenance_tech -v checklist

# Landing page hero section
doppler run -- python -m mira_copy landing-page -a maintenance_tech -v hero

# Everything for a new audience
doppler run -- python -m mira_copy batch -a reliability_engineer
```

Outputs land in `mira_copy/outputs/` — review before using.
