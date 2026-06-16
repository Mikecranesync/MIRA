# FactoryLM × MIRA — Brand & Positioning Kit

**Generated:** 2026-04-26
**Owner:** Mike (FactoryLM)
**Companion to:** `docs/proposals/MIRA-Projects-Prototype.html`, `docs/launch-plan-2026-04-26.md`, `docs/recon/marketing-landing-pages-2026-04-26/recon-notes.md`

---

## TL;DR — the unified message

**FactoryLM is the workspace. MIRA is the agent.**

> *FactoryLM organizes everything your plant's maintenance team needs to know — manuals, sensors, photos, work orders, investigations. MIRA is the AI agent that lives inside FactoryLM and shows up at 2 AM when your tech scans a QR code on a broken machine.*

That's it. Every page, email, post, and pitch flows from those two sentences.

The mental model parallels:

| Workspace | Agent | Why this works |
|---|---|---|
| **FactoryLM** | **MIRA** | The pattern your buyer already understands |
| Notion | Notion AI | Workspace + AI inside |
| Atlassian | Rovo | Suite + AI agent |
| Anthropic | Claude | Parent + agent |
| Google | NotebookLM | Parent + project product |
| GitHub | Copilot | Tool + assistant |

You're not inventing a new category — you're naming an existing one for industrial maintenance, where it doesn't exist yet.

---

## 1. Brand architecture

```
FactoryLM ............................. (the company + the workspace platform)
├── FactoryLM Projects ................ (asset / crew / investigation organizer — the prototype)
├── MIRA .............................. (the AI agent — Telegram, Slack, Voice, QR, Floor)
├── Atlas CMMS ........................ (the work-order backbone — usually invisible to the buyer)
└── FactoryLM Connect ................. (factory-to-cloud streaming, post-MVP)
```

**The split that matters:**

- **The buyer** (plant manager, ops director, reliability lead) thinks about *FactoryLM*. They evaluate it as a workspace decision.
- **The user** (maintenance tech, reliability engineer) thinks about *MIRA*. They love their agent.
- The buyer pays for FactoryLM. The user uses MIRA. **Naming the agent separately protects bottom-up adoption** — techs love the tool they can name, and resist things their company forces on them.

This is exactly Atlassian's playbook: techs say "Rovo helped me," not "Atlassian Rovo helped me." Same with Notion AI, Claude, Copilot.

---

## 2. Names and how to use them

### "FactoryLM"
- **Always** when talking about pricing, the platform, the company, the buyer view, integrations
- Lowercase 'f' is wrong. It's `FactoryLM`. Always one word.
- Never "Factory LM" with a space.
- Domain: `factorylm.com`. Full-stop.

### "MIRA"
- **Always all caps** when used as the agent name. Like NASA, NATO, IBM.
- Use when talking about: chat answers, voice, QR scan, the tech experience, anything ending in "asks _____"
- Backronym you can use casually: *Maintenance Intelligence & Reliability Agent*. Don't lead with the backronym — most people will never need it.
- Refer to MIRA as "it," not "she." Avoids both gendered-AI cringe and the brittleness of "she" when audiences expect engineering-grade tools.

### "FactoryLM Projects"
- The product line modeled on the prototype HTML.
- Three sub-types: **Asset**, **Crew Workspace**, **Investigation** (matches Directions A/B/C in the prototype).
- "FactoryLM Projects" is correct. Not "FactoryLM Project" (singular, in nav). Not "MIRA Projects" — that demotes the workspace product.
- The prototype currently says "MIRA Projects" in the topbar; that needs to change to "FactoryLM Projects" before launch.

### "Atlas CMMS"
- This is the embedded work-order system. Most users don't need to know it exists. Mention it only when buyers ask "do you have a CMMS or do I need to keep mine?" Answer: "FactoryLM ships with Atlas, our built-in CMMS. It also works alongside MaintainX, Limble, and UpKeep — no migration."

### Other names to retire / clarify

- "MIRA Pilot" (deal name in HubSpot) → rename to "FactoryLM Pilot" going forward. The buyer's contract is with FactoryLM.
- "Mira AI chat" (in code comments) → fine internally, but customer-facing copy says "MIRA" or "MIRA chat."
- "FactoryLM Beta" → fine; eventually replaces with "FactoryLM Early Access" once you have a public price.

---

## 3. Color palette

Lifted from the prototype HTML, refined into a usable system.

### Primary palette

| Role | Hex | Usage |
|---|---|---|
| Navy 900 | `#1B365D` | Primary brand — headlines, buttons, navy backgrounds |
| Navy 700 | `#23476F` | Hero gradients, secondary surfaces |
| Orange 600 | `#C9531C` | Primary CTA, accent on dark, key actions |
| Orange 500 | `#E67139` | Hover states, secondary accents |
| Sky 100 | `#E6F0FA` | Active chip backgrounds, subtle highlights |
| Ink 900 | `#1B2530` | Body text |
| Muted 600 | `#5C6770` | Secondary text, metadata |
| Bg 50 | `#F5F6F8` | App background |
| Card 0 | `#FFFFFF` | Card surfaces |
| Rule 200 | `#E1E5EA` | Borders, dividers |

### State palette (lifted from prototype's transparency model — keep these exact)

| State | Bg | Text | Use |
|---|---|---|---|
| Indexed (good) | `#DCEFE3` | `#16623F` | Document successfully ingested |
| Partial (warn) | `#FFF3D6` | `#856204` | OCR partially succeeded |
| Failed (bad) | `#FBDDD3` | `#862415` | OCR failed — *user is told immediately* |
| Superseded | `#E2E5E9` | `#455261` | Older doc replaced by newer rev |
| Safety alert | `#FCE9E5` border `#B5341E` | `#5A1E13` | LOTO / arc flash / safety interrupt |

These four states are part of the brand's *honesty* claim. Don't replace them with a green checkmark and a red X — the four-state spectrum is what differentiates from ChatGPT Projects' silent truncation.

### Sun-readable (high-contrast outdoor mode)

The prototype's `body.sun` toggle is a brand asset, not an afterthought.

- Background `#F0F0F0`, text `#000`, borders `#404040` 2px, font-weight 500
- Make the toggle persistent (cookie or localStorage)
- Photograph this mode on a phone in sunlight for marketing assets

### Two themes for two products

- **FactoryLM Projects (workspace, light theme)** — light backgrounds, navy + orange + sky. Like Notion, Linear, NotebookLM. This is what the buyer evaluates.
- **MIRA (agent, dark theme + sun mode)** — dark canvas with amber accent (matches current factorylm.com homepage feel). This is what the tech uses on the floor.

This is intentional: workspaces are office tools (light), agents are field tools (dark + sun mode for outdoor reading on OLED phones).

---

## 4. Typography

Use system stacks. No web fonts. Faster, more reliable, indistinguishable from a Linear/Notion-quality look.

```css
/* From the prototype — keep this stack */
font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, system-ui, sans-serif;
```

### Sizes (modular scale)

| Use | Size | Weight |
|---|---|---|
| H1 hero | 24-40px (clamp) | 700 |
| H2 section | 13px caps | 600, letter-spacing 0.8px, uppercase |
| H3 card | 14-18px | 600 |
| Body | 14px | 400 |
| Small | 12px | 400 |
| Mono / code / tag IDs | `ui-monospace, SFMono-Regular, Menlo, monospace` | 400 |

Asset tags (`EX-3-04`, `A1.MOTOR_AMP`) are always in monospace. That's a brand signal — these are systems, not vibes.

---

## 5. Voice & tone

### FactoryLM voice (the platform)

Confident, technical, calm. Aimed at the buyer.

| Don't say | Say |
|---|---|
| "Empower your team with AI-powered insights" | "FactoryLM organizes everything your plant already has." |
| "Revolutionize maintenance" | "Stop digging through 2,000-page manuals at 2 AM." |
| "Streamlined workflows" | "Fewer tools. One workspace. Cited answers." |
| "Cutting-edge technology" | "RAG over 68,000 chunks of OEM documentation." |

### MIRA voice (the agent)

Direct, helpful, short. Like a competent senior tech. No fluff. The prototype already shows this:

> "Yes — flag it. **A1.MOTOR_AMP** trended from 131 → 143 A over the last 24 hours."

Compare to ChatGPT Projects:

> "Based on standard industry practice, screw drive bolts are typically torqued to between 40 and 60 N·m..."

**MIRA's first word is the answer.** "Yes." "No." "45 N·m ± 2 N·m." Then the reasoning, then the citation. Always in that order.

### Tone rules across all surfaces

- **No "we're excited to announce."** Ever.
- **Cite sources inline,** not in a footer. The chip pattern from the prototype (`📄 Manual Rev D · §4.3 · p. 87`) is the brand signature.
- **Show, don't claim.** Instead of "MIRA is more accurate," show the side-by-side comparison.
- **Acknowledge limits.** "MIRA doesn't do safety advice — LOTO escalates to a human." This is a feature, not a bug.
- **Use the present tense and active voice.** "MIRA cites every answer," not "Citations will be provided."

---

## 6. Logo & iconography (direction, not finished)

You don't need a $5K logo to ship. You need a wordmark and a glyph.

### FactoryLM wordmark

Set the word `FactoryLM` in the chosen sans (system stack), navy `#1B365D`, weight 700, slight letter-tightening. Pair with a 1-2 character glyph. Three options:

1. **Lattice mark** — a 3×3 grid of dots, navy with one orange. Reads as "structured industrial workspace."
2. **Stacked-block mark** — three blocks like the project shelves.
3. **Stylized factory roof line** — three angled peaks like a saw-tooth factory roof, navy with orange tip.

Pick option 3. It's the most Vista-Print-friendly, scales to a sticker, and it's industrial-recognizable.

### MIRA mark

A separate mark. The prototype has the perfect candidate already: the **microphone-button glyph** (🎙️ in the composer) — turn that into a clean line-art mic icon inside an orange circle. That becomes MIRA's mark on Telegram, Slack, the QR sticker, the floor app.

### Sticker mark

For the QR code packs, use the FactoryLM lattice + the URL `factorylm.com/m/[asset-tag]` and a small "powered by MIRA" line. The asset-tag in monospace makes it look like it's part of the equipment.

### Free placeholders for now

If commissioning a designer is out of budget this week, set the wordmark on Vistaprint with a saw-tooth glyph and ship. Iterate later. Real customers don't care about your logo; they care about MIRA's first answer being right.

---

## 7. Messaging hierarchy

Every page or asset should pick one level. Don't try to deliver all four at once.

### L1 — Category statement (homepage, sales deck cover, investor email)
**"FactoryLM is the AI workspace for industrial maintenance. MIRA is the agent that runs on the floor."**

### L2 — Product split (about page, pricing, /projects landing)
**"FactoryLM Projects organizes manuals, sensors, photos, work orders, and conversations into one workspace per asset, crew, or investigation. MIRA is the AI agent that lives inside every Project — it answers from cited sources, escalates safety, and speaks plant-floor English in 80 dB."**

### L3 — Differentiator (vs-pages, comparison content, sales objections)
**"What ChatGPT Projects, Claude Projects, NotebookLM, and Perplexity Spaces promised — built for industrial maintenance, where their bugs cost real downtime."**

### L4 — Feature claims (feature pages, ad copy, social posts)
- Voice in 80 dB
- Sun-readable on the floor
- Cited answers from your manuals
- Safety-aware (LOTO, arc flash, confined space)
- Document state transparency (Indexed / Partial / Failed / Superseded — not silent truncation)
- Auto-built RCA timelines with signed PDF export

---

## 8. Before / after — fixing every surface

The recon doc (`docs/recon/marketing-landing-pages-2026-04-26/recon-notes.md`) already nailed the conversion gaps. Here's the brand-aligned content to ship into them.

### Homepage (`factorylm.com`)

**Today:** "The AI troubleshooter that knows your equipment." + sparse hero + chat mockup + Beta CTA
**Verdict:** Strong thesis. Wrong framing. Buries the workspace story.

**New hero (top of page):**

> # FactoryLM
> ## The AI workspace for industrial maintenance.
> ## Meet **MIRA** — your agent on the floor.
>
> Manuals, sensors, photos, work orders, investigations — organized into Projects. MIRA answers from cited sources at 2 AM, when you scan the QR sticker on a broken machine.
>
> [Start Free — magic link]   [See the prototype →]

**Underneath the hero:**

- Trust band: *"68,000+ chunks of OEM documentation indexed: Rockwell · Siemens · AutomationDirect · ABB · Yaskawa · Danfoss · SEW-Eurodrive · Mitsubishi"*
- Three-card row showing the three Project types (Asset, Crew, Investigation) with one screenshot each
- A live chat snippet (animated) showing MIRA answering with a `📄 Manual Rev D · §4.3 · p. 87` citation chip
- "vs ChatGPT Projects" comparison section (lift directly from the prototype's X tab)
- Customer outcome strip placeholder until you have a real one
- Pricing teaser ("Site license. Not per-seat.")
- Footer with `/limitations` link (the codex recon nailed this — don't hide what's not there yet)

### `/cmms` (the trial page)

**Today:** Beta application form (work email, company, first name, terms checkbox) — codex correctly flagged this as a beta-application feel.

**New `/cmms` (top):**

> # Start with FactoryLM in 60 seconds
> ## Just your work email — we'll send a magic link.
>
> You'll land in a sample workspace with a real OEM manual already loaded and 3 example questions ready. No card. No call. No demo. If you like it, your plant becomes a Project.
>
> [   work email   ] [Send magic link]

Below that: a 3-step "What happens next" strip:

1. Click the link in your inbox. Land in a Project.
2. Ask MIRA a question on the sample VFD manual. Watch the citation chip.
3. Upload your own manual or scan a QR on your worst machine.

Move company name, first name, integration questions to **after** the user is in the workspace, per codex's recommendation.

### New page: `/projects` (HOST THE PROTOTYPE)

Take `docs/proposals/MIRA-Projects-Prototype.html`, change `MIRA · Projects` in the topbar to `FactoryLM · Projects`, add an email-capture banner at the top:

> *"FactoryLM Projects is in private beta with 20 plants. Want plant #21? Drop your email and we'll set up a Project for your worst machine — free for 30 days."*

Host at `factorylm.com/projects`. This is the single highest-leverage page on your site this week.

### New page: `/vs-chatgpt-projects`

The most viral piece of marketing in your repo right now is the comparison tab in the prototype. Spin it into its own URL.

Headline: **"Why ChatGPT Projects, Claude Projects, NotebookLM, and Perplexity Spaces don't work for industrial maintenance."**

Sub: *"And what FactoryLM does instead — with sources."*

The body is exactly the X tab content. Add an email-capture: *"Get the full 12-page comparison report (with reproducible test data)."*

### Pricing (`/pricing`)

Restructure into three tiers tied to the workspace + agent split:

| Tier | What | Price | Audience |
|---|---|---|---|
| **MIRA Free** | Voice + Telegram + Slack + QR scan agent. Free forever, capped at 1 plant + 50 chats/mo. | $0 | Practitioners on the floor |
| **FactoryLM Projects** | The workspace. Unlimited Projects (assets, crews, investigations). MIRA included. Cited answers, sensor traces, photo archive. | $97 / month / plant | Plant managers, mid-size manufacturers |
| **FactoryLM Investigations** | Everything in Projects + signed RCA report export, Atlas CMMS push, Outlook/email ingest, OEM warranty file format. | $497 / month / plant | Reliability engineers, RCA-heavy plants |
| Site license | Talk to us. | Custom | Multi-plant orgs |

The $497 tier is the RCA/insurance tier. Plants pay outside consultants $5K+ for a single RCA today. $497/mo replaces that line item.

The free MIRA tier is a wedge — it gets the agent into plants at zero cost, then the buyer upgrades for the workspace + RCA features.

### Blog / fault-code library

Keep the existing blog at `/blog`. Reframe the fault-code library as a **MIRA**-branded asset (since it's the agent answering questions). Each fault-code page should have a "Ask MIRA the rest" CTA in the FactoryLM trust band.

### Email templates (`emails/*.html`)

Replace the `Mike at FactoryLM` sender with the right one based on email type:

| Email | Sender | Why |
|---|---|---|
| Beta welcome | "Mike at FactoryLM" | Workspace decision |
| Drip email Day 1-6 (Loom education) | "Mike at FactoryLM" | Education |
| Drip Day 7 (payment) | "FactoryLM Billing" | Transactional |
| MIRA answers / receipt emails (`manual@`) | "MIRA" | Agent voice |
| Sticker pack notification | "Mike at FactoryLM" | Personal |
| Activation email | "MIRA" | Agent intro |

That last one is important: the activation email is the first time the user meets MIRA. It should be from MIRA: *"Hey {{first_name}} — I'm MIRA. Your FactoryLM workspace is ready. Upload your worst manual and ask me anything."*

### Sticker pack

Per the existing implementation plan, but with brand alignment:
- Sticker glyph: FactoryLM saw-tooth roof + URL `factorylm.com/m/{tag}` + small "ask MIRA"
- Setup card: navy/orange palette per the prototype, "Stick it on your worst machine. Scan it. Ask MIRA."
- Mike's business card from FactoryLM (not CraneSync)

### Social media handles

Take `@factorylm` on every platform. `@mira` is too generic to claim — use `@askmira` or `@factorylm_mira` for an agent-voice account if you want a separate one. Recommendation: ONE handle per platform (`@factorylm`), use the MIRA voice on Telegram and product, FactoryLM voice on Twitter/LinkedIn/HN.

### Sales deck

Rebuild around the L1 category statement on slide 1, the prototype's three Directions on slides 2-4, the comparison on slide 5, pricing on slide 6, customer roadmap on slide 7. Total: 7 slides. Anything more is a tell.

### Sender domains

- `noreply@factorylm.com` — transactional
- `mike@factorylm.com` — Mike's personal sender (FIX THE MX — this is still issue #SO-003, P0)
- `mira@factorylm.com` — agent emails (the activation email, MIRA's `manual@` auto-replies)
- `manual@factorylm.com` — public Manual-by-Email inbox
- `team@factorylm.com` — distribution list for support

CraneSync.com goes into your personal/separate-business mailbox. Stop sending FactoryLM mail from cranesync.com — every recon doc and outbound auditor will flag it.

---

## 9. The Atlas CMMS question

Your codebase has Atlas CMMS as a module. Do you call it out, or hide it?

**Hide it from buyers.** Atlas is plumbing. The buyer doesn't want to know about your work-order schema. Mention only when:

1. They ask "do you have a CMMS?" → "Yes, FactoryLM ships with Atlas built in. Or it works alongside MaintainX, Limble, UpKeep — no migration."
2. They ask "what about my existing data?" → "Atlas accepts CSV imports. We'll migrate your last 12 months of work orders for free during pilot."
3. They ask about integrations → list Atlas as the native option, then the alternatives.

Atlas should never appear in marketing copy or pricing tiers as a separate product. It's like Postgres for Notion — important, invisible.

---

## 10. What to actually do this week

### Two-day brand-fix sprint (split with C if you want me to ship code)

| Hour | Task |
|---|---|
| 1-2 | Update `mira-web/public/index.html` hero with the new L1 message and trust band |
| 3-4 | Replace `/cmms` form with email-only field + "send magic link" button (uses existing auth — copy from `lib/auth.ts` magic-link generator, you have one) |
| 5-6 | Host the prototype HTML at `/projects` with topbar text changed to FactoryLM |
| 7-8 | Spin up `/vs-chatgpt-projects` from the prototype's X tab |
| 9-10 | Update pricing with three tiers ($0 / $97 / $497) |
| 11-12 | Update email templates with the MIRA / FactoryLM sender split |
| 13-14 | Update sender domains: stop sending from cranesync.com, fix MX on factorylm.com |
| 15-16 | Update HubSpot deal names from "MIRA Pilot" → "FactoryLM Pilot" |

That's two days of work. The next 80% of the brand kit (logo polish, sales deck, ad creative) can come over the next 4 weeks as you launch.

### Issues to add

| # | Title | Files |
|---|---|---|
| #SO-100 | Update homepage hero copy: L1 + trust band + three-Project row | `mira-web/public/index.html` |
| #SO-101 | Refactor `/cmms` to email-only magic-link entry | `mira-web/src/server.ts`, `mira-web/public/cmms.html` |
| #SO-102 | Host prototype at `/projects` (topbar = FactoryLM) | `mira-web/public/projects.html` (new), `mira-web/src/server.ts` |
| #SO-103 | Spin up `/vs-chatgpt-projects` page | `mira-web/public/vs-chatgpt-projects.html` (new) |
| #SO-104 | Three-tier pricing page ($0 / $97 / $497) | `mira-web/public/pricing.html` |
| #SO-105 | Email-template sender split (MIRA vs FactoryLM) | `mira-web/emails/*.html`, `mira-web/src/lib/mailer.ts` |
| #SO-106 | Rename "MIRA Pilot" deals to "FactoryLM Pilot" in HubSpot | (script + HubSpot UI) |
| #SO-107 | Visual asset: FactoryLM saw-tooth wordmark + MIRA mic mark | Vistaprint or Fiverr |
| #SO-108 | 7-slide sales deck rebuilt around L1/L2/L3 | `marketing/sales-deck-v2.pptx` |

---

## 11. The brand promise — one sentence to hold yourself to

> **"FactoryLM never silently truncates your manual. MIRA never invents a torque spec. Both will tell you when they're not sure."**

That's the promise. It's anti-positioned to ChatGPT Projects' silent truncation, Claude Projects' instruction-decay, NotebookLM's source caps, and Perplexity Spaces' weak cite-from-uploads bias — every one of which is documented in the prototype.

If a customer ever catches MIRA inventing an answer, that's a P0 bug. Not a feature gap. The whole brand depends on it.
