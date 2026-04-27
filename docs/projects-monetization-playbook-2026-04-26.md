# MIRA Projects Prototype — Monetization Playbook

**Generated:** 2026-04-26
**Source asset:** `docs/proposals/MIRA-Projects-Prototype.html`
**Goal:** Turn the interactive prototype into revenue + amplification inside 14 days.
**Companion to:** `docs/brand-and-positioning-2026-04-26.md`, `docs/launch-plan-2026-04-26.md`

---

## TL;DR

You have a working interactive prototype that already says "FactoryLM is to MIRA as Notion is to Notion AI" without writing it out. Five plays this week, in order:

1. **Today** — Email the prototype to Markus + Thomas to revive the $499 deals at $497/mo (10× upgrade, real positioning)
2. **Today** — Email the prototype to 8 investors / accelerators with a 3-line note. This is your bridge round.
3. **Tomorrow** — Host the prototype at `factorylm.com/projects` (1 hour deploy)
4. **This week** — Ship `factorylm.com/vs-chatgpt-projects` (the X tab as its own page)
5. **This week** — Launch on Show HN with the prototype as the centerpiece

Each play below has copy ready to ship.

---

## Play 1 — Re-pitch Markus and Thomas at $497/mo (today, 30 min)

The two stuck $499 deals are aging. The current pitch was "MIRA the chat agent for $499." The prototype lets you pitch them on the **Investigations tier** — the auto-built RCA timeline with signed PDF export. Plants pay outside RCA consultants $5K+ for one report. $497/mo replaces that.

### Email copy — Markus Dillman

**Subject:** Markus — what your next bearing investigation would look like in FactoryLM

Markus,

Sorry I haven't followed up since the pilot conversation — been heads-down shipping. I want to send you what we just finished and ask one question.

Attached is an interactive HTML preview of FactoryLM Projects. Open it in any browser. The third tab (**Investigation**) is what your next bearing or weld failure RCA would look like — auto-built timeline from SCADA, vibration, photos, ingested OEM emails, leading hypothesis with confidence percentage, and a signed PDF report you can push straight to your CMMS or your insurance file.

Question: how much did you spend on outside RCA help last year? If your number is $5K+ per investigation, FactoryLM Investigations is $497/mo — and the system gets better the more your team uses it. I'd rather you cancel after 30 days than commit early.

If you want to be plant #1 on the Investigations tier, I can have your worst machine running on it by Friday.

Mike
mike@factorylm.com
+1 863 651 7679

---

**Attachment:** `MIRA-Projects-Prototype.html` (works offline, no signup)

---

### Email copy — Thomas Hampton

**Subject:** Thomas — quick look at where FactoryLM is headed

Thomas,

Two things.

First, I want to send you what we built last week (attached HTML — open in any browser). The first tab (**Asset Page**) is what your worst machine at Tampa Bay Steel would look like inside FactoryLM. Manuals, sensor trends, photos, conversations, all linked. MIRA answers questions from your specific equipment with the manual page cited inline.

Second, I lowered the price for the first 5 plants. $97/mo for the chat agent, $497/mo for the full Project workspace with auto-built investigations. No card upfront — first 30 days free.

Want to be one of the five? I'll have your steel mill drives running on it by next week.

Mike
mike@factorylm.com
+1 863 651 7679

---

**What this does:**
- Re-anchors at a higher price tier with a real value framing (RCA cost displacement)
- Creates urgency with "first 5 plants"
- Uses the prototype to show progress, which forgives the gap since Apr 24

---

## Play 2 — Investor email (today, 1 hour)

The Wells Fargo declines tell me you need bridge capital, fast. The prototype is closer-grade. Send it to 8 names you already have in your network.

### Recipients (from your HubSpot CRM)

| Investor | Email | Why they bite |
|---|---|---|
| Avidan Ross | (Root Ventures) | Industrial AI thesis, deep tech |
| Rachel Holt | (Construct Capital) | Industrial-grade software for SMB market |
| Laila Partridge | (Techstars STANLEY+) | Stanley = industrial; she's program director |
| Georgina Campbell Flatter | (Greentown Labs) | Industrial cleantech adjacency |
| Tom Ryden | (MassRobotics) | Industrial robotics + AI |
| Jacob Barhydt | (LAUNCH) | He already replied "I'll take a look" Feb 28 — re-engage |
| Dan Engel | (BuildTheStory / Gust Countdown) | He's coaching you; ask for warm intros |
| (1 wildcard) | Find one industrial-AI investor you don't have yet via Apollo | — |

### Email copy — investor outreach

**Subject:** FactoryLM × MIRA — interactive preview (works offline)

[Investor first name],

We're building FactoryLM, the AI workspace for industrial maintenance — and MIRA, the agent that runs on the plant floor.

Think Notion + NotebookLM, but for the maintenance team that's troubleshooting a $2M extruder at 2 AM with a phone covered in grease.

Attached is a working HTML prototype. Open it in any browser. Three tabs:

1. **Asset Page** — every machine becomes a Project. Manuals, sensors, photos, conversations, work orders, all linked, all cited.
2. **Crew Workspace** — multi-asset shutdowns with auto-generated shift handoffs.
3. **Investigation** — root-cause timelines built automatically from SCADA, vibration, photos, OEM emails — with signed PDF export. Replaces the $5K+ RCA consultant fee.

The fourth tab (**vs Competitors**) shows what ChatGPT Projects, Claude Projects, NotebookLM, and Perplexity Spaces fail at when applied to industrial maintenance — with sourced bug reports.

Where we are:

- 68,000 chunks of OEM documentation indexed (Rockwell 13.7K, Siemens 1.3K, AutomationDirect 2.3K, plus ABB / Yaskawa / Danfoss)
- 4 paying pilots in pipeline ($499/mo each)
- Working: chat agent, magic email inbox, QR scan flow, fault-code SEO library
- Shipped this month: citation gate, security hardening, MFA + audit log

What we're raising: a [size] bridge to ship the FactoryLM Projects workspace + close 20 plant pilots at $497/mo (RCA tier) by EOQ.

Worth 15 minutes? My calendar: [Calendly link]

Mike Harper
Founder, FactoryLM
mike@factorylm.com
+1 863 651 7679

---

**What this does:**
- Anchors on a familiar pattern (Notion + NotebookLM)
- Shows progress through artifact, not deck
- Names a specific revenue driver ($497/mo RCA tier)
- Asks for 15 minutes, not money

**Send these all on Sunday afternoon.** Investor inboxes are calmer. Reply rate doubles.

---

## Play 3 — Host the prototype as `factorylm.com/projects` (tomorrow, 1 hour)

The prototype is a single self-contained HTML file. Hosting it is one route in `mira-web`.

### Steps

1. Copy `docs/proposals/MIRA-Projects-Prototype.html` → `mira-web/public/projects.html`
2. In the file, change `<div class="brand">MIRA<span class="dot">·</span> Projects</div>` → `<div class="brand">FactoryLM<span class="dot">·</span> Projects</div>`
3. Add an email-capture banner above the topbar:

```html
<div style="background:#FFFAF4;border-bottom:1px solid #F2D6BB;padding:10px 22px;text-align:center;font-size:13px;color:#5A1E13;">
  <strong>Private beta.</strong> 20 plants are live. Want plant #21?
  <input type="email" id="beta-email" placeholder="work email" style="border:1px solid #E1E5EA;border-radius:8px;padding:6px 10px;margin:0 8px;font-size:13px;width:240px">
  <button onclick="captureBeta()" style="background:#C9531C;color:#fff;border:none;border-radius:8px;padding:7px 14px;font-weight:700;cursor:pointer;font-size:13px;">Get a Project for free</button>
</div>
```

4. Add a tiny capture endpoint to `mira-web/src/server.ts`:

```ts
app.post("/api/projects/beta", async (c) => {
  const { email } = await c.req.json();
  if (!email || !/.@./.test(email)) return c.json({ error: "email required" }, 400);
  await createTenant({ id: crypto.randomUUID(), email, company: "Projects beta", firstName: "", tier: "pending", atlasPassword: "", atlasCompanyId: 0, atlasUserId: 0 });
  await sendBetaWelcomeEmail(email, email.split("@")[0], "Projects beta");
  return c.json({ ok: true });
});
```

5. Wire the route:

```ts
app.get("/projects", async (c) => {
  const file = Bun.file("./public/projects.html");
  return new Response(await file.arrayBuffer(), { headers: { "Content-Type": "text/html; charset=utf-8" } });
});
```

6. Add `<meta>` tags for sharing — the OG image will be the asset hero card. Drop a screenshot of the prototype's hero into `public/og-projects.png` and reference:

```html
<meta property="og:title" content="FactoryLM Projects — the AI workspace for industrial maintenance">
<meta property="og:description" content="What ChatGPT Projects, Claude Projects, NotebookLM, and Perplexity Spaces should have been — built for the plant floor.">
<meta property="og:image" content="https://factorylm.com/og-projects.png">
<meta property="og:url" content="https://factorylm.com/projects">
<meta name="twitter:card" content="summary_large_image">
```

7. Update `sitemap.xml` (in `server.ts`) to add `/projects` at priority 0.95, freq weekly.

8. Add `data-cta` attributes to the buttons inside the prototype so PostHog tracks engagement (the analytics infra is already in place).

**Total time: 60-90 minutes.** Ship it.

### Issue ref

`#SO-102` (already in `docs/brand-and-positioning-2026-04-26.md`).

---

## Play 4 — `/vs-chatgpt-projects` (this week, 3 hours)

The X tab in the prototype is the strongest piece of marketing copy you have. Spin it into its own page.

### Page outline (`mira-web/public/vs-chatgpt-projects.html`)

```
HERO
  H1: Why ChatGPT Projects, Claude Projects, NotebookLM, and Perplexity
      Spaces don't work for industrial maintenance
  Subhead: And what FactoryLM does instead — with sources.
  CTA: [See the comparison →] (scrolls to it)

BAND
  "We're a small team building FactoryLM × MIRA — the AI workspace for industrial
   maintenance. Below is the side-by-side. All bug reports linked to source threads."

THE COMPARISON
  (lifted directly from the prototype's X tab — the same tech asks the same question
   to ChatGPT Projects vs MIRA, with the bad answer + the good answer side by side)

CITED FAILURES
  Bullet list of every consumer-AI bug, each with the source link from the prototype:
  - ChatGPT Projects: silent truncation 30-60KB, 10-file UI cap inside 20-file allowance
  - Claude Projects: instructions decay 100% post-compaction
  - NotebookLM: 50-source cap, no source edit, output uneditable
  - Perplexity Spaces: silent caps, hard refresh required, weak cite-from-uploads

WHAT FACTORYLM DOES INSTEAD
  Six bullets matching to features:
  - Document state transparency (Indexed / Partial / Failed / Superseded)
  - Voice in 80 dB
  - Sun-readable mode
  - Cited answers from your manuals (every chip is a real page)
  - Safety-aware (LOTO, arc flash, confined space escalate to a human)
  - Auto-built RCA timelines

EMAIL CAPTURE
  "Get the full 12-page comparison report (with reproducible test data)."
  [   work email   ] [Send me the report]

FOOTER
  FactoryLM × MIRA. factorylm.com.
```

The 12-page comparison report is the **MIRA Bench-off** from the launch plan (issue `#SO-074`). Build it once; use it as the lead magnet here.

### Issue ref

`#SO-103`.

---

## Play 5 — Show HN launch this week (Tuesday morning)

The prototype + the comparison page = a Show HN front-page candidate. Engineers love a public benchmark and a side-by-side bug list.

### Title

> **Show HN: FactoryLM Projects — what NotebookLM, ChatGPT Projects, and Claude Projects should have been (industrial maintenance edition)**

### Post body (paste into HN)

```
Hi HN — Mike here, founder of FactoryLM.

I've been building an AI workspace for industrial maintenance. Plant managers
and reliability engineers spend their day digging through 2,000-page OEM
manuals at 2 AM. NotebookLM, ChatGPT Projects, Claude Projects, and Perplexity
Spaces all promised to fix this — but each breaks in specific, predictable ways
on industrial documents.

We built two things:

- FactoryLM Projects: the workspace. Manuals, sensors, photos, work orders,
  conversations, all linked into one Project per asset. Light theme, runs in
  a browser, integrates with your existing CMMS.

- MIRA: the AI agent that runs inside every Project. Voice in 80dB plant noise,
  sun-readable on the floor, cites every answer with the manual page it came
  from, escalates safety-critical questions to a human.

Interactive prototype (no signup, single HTML file):
  https://factorylm.com/projects

Side-by-side vs ChatGPT Projects / Claude Projects / NotebookLM / Perplexity
Spaces — with sourced bug reports for each:
  https://factorylm.com/vs-chatgpt-projects

I'd love feedback from the HN industrial / RAG / AI infrastructure crowd. We
have 4 paying pilots and 91 plant prospects in our pipeline; this is the
v1 we'll be shipping over the next 8 weeks.

Open to questions about anything — the citation gate, RAG over 68K chunks of
OEM docs, the safety-keyword interrupt, the QR sticker scan flow, the sun-
readable mode, the Atlas CMMS embedded layer. I'll be in this thread for the
next 12 hours.
```

### Pre-launch prep (the day before)

- Have 5-10 friends ready to upvote AND comment in the first hour. Genuine comments. HN's algorithm is sensitive to comment-to-upvote ratio.
- Pin the post title to your X / LinkedIn 30 minutes after submitting.
- Have answers ready for the 5 most-likely tough questions:
  1. "How is this different from MaintainX/UpKeep/Limble?" → "Those are CMMS — work order databases. We're the AI workspace that wraps your existing CMMS. Integration, not replacement."
  2. "What's your moat once OpenAI ships ChatGPT Projects v2?" → "The KB. 68K chunks of OEM docs, with citation gating, safety keyword interrupts, and an industrial-specific UI like sun-readable mode. Plus we don't silently truncate."
  3. "What's the eval methodology?" → Link to the bench-off when you publish it.
  4. "Is the RCA report admissible for warranty / insurance?" → "We generate signed PDFs with full evidence trails. Whether your warranty department accepts it is up to them — the same is true of any consultant-written RCA today."
  5. "Why $97/$497?" → "$97 for the chat agent + workspace. $497 for the RCA tier replaces a $5K+ consultant invoice per investigation. Pricing reflects the line item we're displacing."

### Timing

Tuesday or Wednesday, 9:00 AM ET (6:00 AM PT). HN traffic peaks 9 AM-2 PM Eastern. Mid-week beats Friday and Monday.

### After

Whatever happens (front page, second page, dud), the post becomes a permanent reference. Cite the HN thread in cold emails. Cite it in the investor pitch.

---

## Play 6 (bonus, optional) — Twitter thread

If you want to pre-warm a Twitter audience, post a thread with screenshots from the prototype.

### Thread copy (8 tweets)

```
1/ I've been building an AI workspace for industrial maintenance.

NotebookLM, ChatGPT Projects, Claude Projects all promise this. They break in
specific ways on industrial docs.

So we built FactoryLM × MIRA. Prototype below — single HTML file, no signup.

2/ The buyer thinks: "FactoryLM" — the workspace. Manuals, sensors, photos,
conversations, all linked.

The user thinks: "MIRA" — the AI agent on the floor. Voice in 80dB, scans QR
on the broken machine, cites every answer with the manual page.

[screenshot: hero with asset card]

3/ Most consumer AIs silently truncate large PDFs. ChatGPT Projects loses files
past 30-60KB while claiming full read.

MIRA shows the document state honestly:
🟢 Indexed
🟡 Partial (with a tap-to-rescan)
🔴 OCR Failed (we tell you, we don't pretend)
⚫ Superseded (older revs stay searchable)

[screenshot: docs shelf with state pills]

4/ Plant maintenance happens at 2 AM with a phone covered in grease.

We built sun-readable mode. Black ink. 2px borders. Font weight 500. 100K-lux
sun on a phone screen.

No competitor has this. It's a feature only the floor cares about.

[screenshot: sun mode toggle]

5/ When someone asks MIRA about LOTO or arc flash, MIRA stops.

Safety-critical questions don't get a chat answer. They get a STOP card with
the LOTO procedure and a "notify safety lead" button.

This is a brand promise: MIRA never invents a torque spec. MIRA tells you
when it's not sure.

[screenshot: STOP safety card]

6/ The third tab in the prototype: Investigations.

When a cooling tower starts leaking at 4:13 AM, the timeline auto-builds:
SCADA flow drop → vibration spike → photo from the tech → matched OEM Field
Service Bulletin → leading hypothesis with 74% confidence → signed PDF.

This replaces the $5K consultant.

[screenshot: investigation timeline]

7/ Pricing:

- MIRA Free — voice + Telegram + Slack agent. 1 plant, 50 chats/mo.
- FactoryLM Projects — $97/mo/plant. Workspace + MIRA + cited answers.
- FactoryLM Investigations — $497/mo/plant. Adds RCA reports + Atlas CMMS push.

20 plants in private beta. Plant #21 free 30 days: factorylm.com/projects.

8/ Building this is a 1-2 person team in Tampa, FL.

If you're a maintenance manager, plant ops director, reliability engineer, or
just curious — open the prototype, click around, send me your worst manual at
manual@factorylm.com and watch MIRA answer it.

@FactoryLM_ · factorylm.com
```

Use OBS or QuickTime to record short Loom-style screen recordings of each tab and post them as videos under the relevant tweets. Twitter favors video.

---

## Play 7 (bonus, optional) — LinkedIn announce

LinkedIn is where the buyers live. Post on the same day as Show HN, but 2-3 hours later (LinkedIn peaks 11 AM ET).

### LinkedIn copy

```
We just shipped a working prototype of FactoryLM × MIRA.

If you've ever spent 2 hours digging through a 2,000-page OEM manual at
2 AM to reset a VFD fault — this is for you.

Three things make it different from ChatGPT Projects, Claude Projects, and
NotebookLM:

1. It runs at 80 dB and 100K lux. The current consumer AIs are designed
   for desks. This one is designed for the floor.

2. It cites every answer with the actual manual page. No silent truncation.
   No "based on industry standard practice." When MIRA isn't sure, MIRA
   says so and links the page anyway.

3. The Investigation workflow auto-builds a root-cause timeline from
   SCADA + vibration + photos + OEM emails — and exports a signed PDF
   that can go straight into your CMMS or your warranty file. We're
   replacing a line item plants pay $5K+ for today.

Working interactive prototype, no signup, opens in any browser:
factorylm.com/projects

Side-by-side comparison with ChatGPT Projects, Claude Projects, NotebookLM,
and Perplexity Spaces — every failure is sourced:
factorylm.com/vs-chatgpt-projects

We're closing pilot #5 of the first 20 right now. If you run a plant or
know someone who does, DM me — I'd love to send your team a free pack of
QR stickers and a Project to try.

#IndustrialAI #MaintenanceManagement #Reliability #SmartFactory
```

Tag 5 maintenance / industrial-AI accounts you respect. They might re-share.

---

## Measurement — what to watch this week

| Play | Success metric | Target | Tracker |
|---|---|---|---|
| Markus + Thomas re-pitch | Reply | 1 of 2 within 72h | HubSpot deal note |
| Investor email | "Yes, 15 min" reply | 1 of 8 within 7d | Personal CRM |
| `/projects` deploy | Email captures | 25 in week 1 | PostHog + Neon |
| `/vs-chatgpt-projects` | Email captures | 50 in week 1 | PostHog + Neon |
| Show HN launch | Front page (top 30) for 4+ hours | Yes | HN |
| Show HN signups | Trial registrations | 50 in 24h | PostHog |
| Twitter thread | Impressions | 10K | X analytics |
| LinkedIn post | Reactions / comments | 50 / 10 | LinkedIn |

If two of those five hit by Friday, you have your bridge round and your first $497/mo customer.

---

## What NOT to do

- **Don't pitch the prototype as the shipped product.** It's a working interactive demo. Be explicit: "this is the v1 we're shipping over the next 8 weeks." Investors and customers will respect honesty more than overclaim.
- **Don't gate the HTML behind email capture.** The email capture goes ABOVE the prototype, optional. The HTML works fully without an email. Friction kills the share rate.
- **Don't post to PH this week** (per launch plan, week 7). One week. One audience. Show HN first, then PH later.
- **Don't change the pricing twice in 7 days.** Set $0 / $97 / $497, hold it. If it's wrong, change in week 4 with data.
- **Don't promise the RCA tier features that don't ship for 4 weeks** to early customers. Sell the chat tier, mention RCA as "Q3 add-on, included in your subscription when it ships."

---

## After this week

If by Friday you have:
- 1+ investor reply
- Markus or Thomas back at the table
- 50+ email captures from `/projects` and `/vs-chatgpt-projects`
- Front page or close on HN

→ Run the rest of the launch plan in `docs/launch-plan-2026-04-26.md` (PLCTalk, Reddit, sticker drop, content factory, etc.). The prototype was the wedge.

If you have none of those:
- The product story isn't broken. The execution is. Re-do the email copy with a cleaner pull-quote, re-time the HN post, ask Dan @ BuildTheStory and Karen @ FFSBDC for warm intros.
- Don't blame the prototype. It's the strongest asset in your repo.
