# LinkedIn Hydraulics Group Reactivation — Step-by-Step Playbook

> **Updated 2026-04-10** — all CTAs now point at `factorylm.com/cmms` (the
> beta funnel entry) instead of `app.factorylm.com` (which is Open WebUI and
> is **not** connected to the Loom nurture / Stripe / `/activated` flow).
> Removed "5 free queries / no credit card" language: the free tier was
> killed in commit `6bbf5b3` (2026-04-09) and per the Fihn strategy
> (`project_beta_onboarding_strategy.md`) pricing stays hidden until Day 7
> of the nurture sequence. Frame everything below as a closed beta for
> floor techs.

## Context

Mike owns a 3,000-member LinkedIn hydraulics group that's been dormant for years. The GTM marketing plan (committed as `docs/superpowers/specs/2026-04-07-marketing-first-10-users-design.md`) calls for reactivating this group as the primary channel for acquiring the first 10 FactoryLM users. This plan provides the granular, click-by-click instructions to set up, reactivate, and manage the group daily.

**This is NOT a code plan — it's an operational playbook.** Output will be a markdown document saved to `docs/playbooks/linkedin-group-reactivation.md`.

---

## Phase 0: Group Audit & Setup (30 min — Day 0, today)

### Step 1: Audit Current Group State
1. Go to linkedin.com → "My Network" → "Groups" → find your hydraulics group
2. Note current state:
   - [ ] How many members show as active? (3,000 total — but how many have profile photos, recent activity?)
   - [ ] What was the last post? When?
   - [ ] Are there spam posts that need cleaning?
   - [ ] Is the group set to "Standard" or "Unlisted"?
   - [ ] Who are the other admins/moderators (if any)?

### Step 2: Update Group Settings
1. Click the gear icon (Admin settings) on the group page
2. **Group name:** Keep or update to include "AI" if relevant (e.g., "Hydraulics & Industrial Maintenance" or leave as-is if the name is already strong)
3. **Group description** — replace with:
   ```
   Hydraulics troubleshooting, VFD faults, PLC diagnostics, and industrial 
   maintenance for floor technicians and managers. 3,000+ members sharing 
   real-world fixes.

   New: We're now exploring how AI tools can speed up fault diagnosis. 
   Drop your toughest fault codes — the community (and some new AI tools) 
   will help.

   Rules: Be helpful. No spam. No recruiting posts.
   ```
4. **Group rules** — set 3 simple rules:
   - Rule 1: "Stay on topic — hydraulics, VFDs, PLCs, industrial maintenance"
   - Rule 2: "No spam or recruiting — job posts go in the weekly thread"
   - Rule 3: "Share what you know — this group runs on experience, not theory"
5. **Cover image** — upload a banner. Options:
   - Use Canva (free): 1584 x 396 px, dark background (#0a0a08), "Hydraulics & Industrial Maintenance" in DM Sans, amber (#f0a030) accent bar
   - Or: a real photo of a hydraulic power unit / PLC panel you've taken
6. **Posting permissions:** Set to "Members can post" (not "Admin only")
7. **Post approval:** Turn ON for the first 2 weeks (catches spam while you rebuild)
8. Save all settings

### Step 3: Clean Up Spam
1. Scroll through recent posts (last 6-12 months)
2. Delete any obvious spam (product pitches, unrelated links, job posts from recruiters)
3. This signals to returning members that the group is actively managed again

### Step 4: Prepare Your Profile
1. Your LinkedIn profile is the landing page for every DM you send
2. **Headline** should mention what you're building: "Building AI maintenance tools for floor technicians | FactoryLM"
3. **Featured section:** Pin a link to **factorylm.com/cmms** (the beta signup form — this is where the nurture + Stripe flow starts) or a Mira demo screenshot. Do NOT link to `app.factorylm.com` — that's Open WebUI and bypasses the funnel.
4. **About section:** 2-3 lines about FactoryLM + the group

---

## Phase 1: The Reactivation Post (20 min — Day 1, Apr 8)

### Step 5: Write and Post the "I'm Back" Announcement
1. Go to the group → "Start a post"
2. Post this (adapt to your voice):

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
  questions from actual OEM manuals)

First up: a troubleshooting tip you can use today.

[INSERT ONE REAL HYDRAULIC TROUBLESHOOTING TIP HERE]

Example: "Low pressure on your HPU? Before you tear into the pump, 
check the suction strainer. 80% of the time it's a restricted inlet, 
not a worn pump."

Drop a comment if you're still here. What equipment are you working 
on these days?
```

3. **Pin this post** to the top of the group (click three dots → "Pin post")
4. This post serves three purposes:
   - Tells LinkedIn's algorithm the group is active (triggers notifications to members)
   - Gives members a reason to comment (the question at the end)
   - Sets expectations for what's coming

### Step 6: Engage With Every Response
- For the first 48 hours, reply to EVERY comment on this post
- Ask follow-up questions: "What brand HPU?" "How old is the system?"
- This signals to LinkedIn that the post is high-engagement → more members get notified

---

## Phase 2: Daily Posting Rhythm (Days 2-7)

### Step 7: Day 2 (Apr 9) — Engagement Poll
Post a poll (LinkedIn groups support native polls):

```
Your VFD just threw an overcurrent fault on a 15HP hydraulic power unit.
Motor temp is normal. Load hasn't changed.

What's your first move?
```
- Option A: Check input voltage
- Option B: Inspect motor leads  
- Option C: Look at drive parameters
- Option D: Check the pump coupling

Add text below the poll: "I'll share what an AI diagnostic tool returned for this exact scenario tomorrow."

**Why polls work:** They require zero effort to engage with (just click). LinkedIn's algorithm loves polls. This will get 5-10x more engagement than a text post.

### Step 8: Day 3 (Apr 10) — Build-in-Public #1 (Personal LinkedIn)
Post on your PERSONAL LinkedIn profile (not the group):

```
Week 1 building an AI maintenance copilot.

I've been a maintenance guy for [X] years. Last month I started 
building an AI tool that answers fault code questions from actual 
equipment manuals.

Here's what it looks like: [SCREENSHOT OF MIRA ANSWERING A FAULT CODE]

It found the right page in a PowerFlex manual in 11 seconds. 
Would have taken me 20 minutes to flip through the PDF.

Still rough. Getting better every day.

If you work in maintenance, I'm opening a closed beta for a few dozen
floor techs: factorylm.com/cmms
```

Then share this post TO the group with a short intro: "Shared this on my profile — curious what this group thinks."

### Step 9: Day 4 (Apr 11) — Technical Value Post (Group)
Post a pure-value technical post. No product mention. Examples:

```
GS20 VFD Overcurrent Fault — 5 things to check before you replace the drive:

1. Input voltage — measure all 3 phases at the drive terminals. 
   If you're more than 10% off nameplate, fix the supply first.
   
2. Motor leads — megger test. Anything under 1 MΩ, the motor 
   windings are going bad.
   
3. Drive parameters — check accel/decel time. If someone set 
   accel to 1 second on a high-inertia load, that's your problem.
   
4. Mechanical binding — disconnect the motor from the load. 
   Run it uncoupled. If the fault clears, it's mechanical.
   
5. Ambient temperature — these drives derate above 40°C. 
   Check the cabinet fan.

What am I missing? Drop your go-to checks below.
```

### Step 10: Day 5 (Apr 11) — Reddit Karma Building
Skip the group today. Spend 30 min on Reddit:
- Go to r/PLC, sort by "New"
- Find 2-3 posts where someone is asking for help
- Write genuinely detailed, helpful answers
- NO product mentions. Build karma only.

### Step 11: Day 6 (Apr 14, Monday) — First Product Reveal (Group)
This is the first time you show Mira in the group:

```
I ran last week's VFD fault scenario through an AI tool I'm building.

Fault: GS20 overcurrent on a 15HP hydraulic HPU
Question: "What should I check first?"

Here's what it returned: [SCREENSHOT]

It pulled the answer from the actual Automation Direct manual — 
page 47, section on overcurrent protection.

Took 10 seconds. Manual lookup would have been 20 minutes.

Not perfect — it missed the ambient temperature check. But for a 
first pass on the floor, it gets you 80% there.

I'm opening a closed beta for a handful of floor techs who want
early access. Walkthrough videos and a manual-upload workflow:
factorylm.com/cmms

What fault code should I throw at it next?
```

### Step 12: Day 6 (same session) — Warm DMs
After posting, go to the NOTIFICATIONS on the reactivation post and poll:
1. Click on every person who commented or reacted
2. Send a personal message:

```
Hey [name] — saw your comment on the hydraulics group. 
Glad you're still around!

I actually built the AI tool I mentioned in the post. 
It answers fault code questions from real equipment manuals. 
Want in? I'm opening a closed beta and I can load any manual you need.

Signup for the beta: factorylm.com/cmms
(You'll get a welcome email with a walkthrough video.)
```

**Volume:** Send 5-10 DMs. Don't spam — only message people who actively engaged.

### Step 13: Day 7 (Apr 13, Sunday) — Week 1 Review
Spend 30 min reviewing:
- [ ] How many post views did the reactivation post get? (Target: 200+)
- [ ] How many comments across all posts? (Target: 10+)
- [ ] How many DM conversations started? (Target: 2-3)
- [ ] Any factorylm.com/cmms signups? (Target: 1 — check NeonDB `plg_tenants`)
- [ ] Which post format got the most engagement? (Double down on that next week)

---

## Phase 3: Weeks 2-4 Content Calendar

### Weekly Posting Schedule (Repeating Pattern)

| Day | Post Type | Template |
|-----|-----------|----------|
| Monday | YouTube clip + engagement question | Share clip from Saturday filming, ask "What would you check?" |
| Tuesday | (YouTube publishes — share link to group) | "Full walkthrough on my YouTube: [link]" |
| Wednesday | "Drop your fault code" interactive thread | Template 4 from GTM plan — run submissions through Mira, reply with screenshots |
| Thursday | (Post on personal LinkedIn, share to group) | Build-in-Public update |
| Friday | Poll OR case study scorecard | Template 1 or Template 5 from GTM plan |

### Step 14: Week 2 — "Drop Your Fault Code" Thread
This is your highest-engagement format. Post every Wednesday:

```
Drop your fault code below — I'll run it through the AI and post 
the result.

Include:
- Equipment make/model
- Fault code or symptom
- What you've already tried

I'll reply with what the AI pulls from the OEM manual.
```

Then spend 30 min running each submission through Mira and replying with screenshots. This is the most powerful conversion mechanism — people see THEIR problem being solved.

### Step 15: Week 3 — Manual Loading Offer
Start offering to load people's specific manuals:

```
I'm loading equipment manuals into the AI diagnostic tool. 
Which of these should I add next?

- Parker hydraulic valves
- Eaton Vickers pumps
- Bosch Rexroth drives
- Danfoss proportional valves
- Other (comment below)
```

DM anyone who votes or comments: "I can load your specific manual — just send me the PDF and I'll set it up for you. Free."

### Step 16: Week 4 — Testimonial + Close
Ask your best early user for a quote. Post it:

```
[Name] has been using the AI diagnostic tool for 2 weeks. 
Here's what they said:

"[Quote — even something simple like 'saved me 20 minutes 
on a PowerFlex fault yesterday' works]"

Closed beta is still open for a few more floor techs:
factorylm.com/cmms
```

---

## Phase 4: Ongoing Group Management

### Step 17: Moderation Routine (5 min/day)
1. Check the group once daily for:
   - Spam posts → delete immediately
   - Pending posts (if approval is on) → approve legitimate ones
   - Unanswered questions → reply or tag someone who can help
2. After 2 weeks, turn off post approval if spam is under control

### Step 18: Engagement Rules
- **Reply to every comment** for the first 30 days. Every. Single. One.
- **Like every post** from other members (even if you don't comment)
- **Tag active members** in relevant posts: "@[name] you'd know about this"
- **Never post more than once per day** in the group (LinkedIn penalizes flooding)
- **Best posting time:** Tuesday-Thursday, 7-9 AM EST (maintenance shift change)

### Step 19: Conversion Tracking
Track in a simple spreadsheet or in HubSpot:

| Date | Post Type | Views | Comments | DMs Sent | DM Replies | Signups |
|------|-----------|-------|----------|----------|------------|---------|
| Apr 8 | Reactivation | ? | ? | 0 | 0 | 0 |
| Apr 9 | Poll | ? | ? | 0 | 0 | 0 |
| ... | ... | ... | ... | ... | ... | ... |

### Step 20: Growth Tactics (After Week 2)
1. **Invite connections:** Go to the group → "Invite" → select relevant connections from your network. LinkedIn lets you invite up to 15/day.
2. **Cross-promote:** Every YouTube video description includes "Join 3,000 maintenance pros in my LinkedIn group: [group URL]"
3. **Pin the best post each week** — always have a high-value pinned post visible to new visitors
4. **Weekly "question of the week"** — creates a ritual that members expect and return for

---

## Files to Create

| File | Purpose |
|------|---------|
| `docs/playbooks/linkedin-group-reactivation.md` | This playbook, saved for reference |

## Verification

- [ ] Group settings updated (description, rules, cover image)
- [ ] Spam cleaned from recent posts
- [ ] LinkedIn profile updated (headline, featured section)
- [ ] Reactivation post published and pinned
- [ ] First poll posted on Day 2
- [ ] 5+ DMs sent by end of Week 1
- [ ] 1+ signup at factorylm.com/cmms by end of Week 1 (verify via NeonDB `plg_tenants` row with matching email)
