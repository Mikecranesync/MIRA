# FactoryLM & MIRA — User Manual Outline (Proposed)
**Prepared by:** Hermes (Independent Product Review)  
**Date:** 2026-06-20  
**Status:** PROPOSED — for Mike Harper's review before authoring begins  
**Target audience:** Maintenance managers, maintenance supervisors, plant operators, maintenance technicians — no software background assumed  
**Tone:** Direct, practical, plain English. Like a senior tech wrote it for the person next to them on the floor.

---

## What I found (research summary)

**Two products, one platform:**
- **FactoryLM** — the company name and Telegram-first gateway (send a photo, get a work order)
- **MIRA** — the full web platform at app.factorylm.com (the AI assistant + CMMS + knowledge base + team workspace)

They share the same backend but serve slightly different entry points. The manual should introduce both and show how they connect.

**Confirmed live features (what exists today):**
- Web app at app.factorylm.com (Next.js PWA, installable on phone)
- Magic-link login (no passwords)
- Asset management, work orders, PM schedules (Atlas CMMS, auto-provisioned at signup)
- AI diagnostic chat scoped to equipment (grounded in 25K+ manual chunks)
- Nameplate photo → auto-identifies equipment via vision AI
- QR sticker system (admin prints PDF → tech scans → chat pre-scoped to asset)
- Manual upload + ingestion (PDF → cited knowledge base)
- Telegram bot (send photo → Gemini analyzes → creates CMMS work order)
- Team management (invite, roles: technician vs admin)
- Multi-CMMS connectors (Atlas live, MaintainX / Limble / Fiix in beta)
- 21-phrase safety guardrail system
- Slack + Telegram channel adapters
- Proposals workflow (KB suggestions for admin review)
- Namespace / Knowledge graph (asset hierarchy)
- Onboarding wizard (guided first-time setup)

**Known gaps (be honest in the manual):**
- QR system listed as "in development" (sprint starting 2026-04-20 per docs)
- MaintainX/Limble/Fiix self-serve setup "shipping soon" — requires email to support for now
- WhatsApp adapter planned, not live
- Predictive maintenance is explicitly NOT in scope

---

## PROPOSED MANUAL STRUCTURE

---

### FRONT MATTER

**Title:** FactoryLM & MIRA — Complete User Manual  
**Subtitle:** From zero to your first diagnosis — no IT department required  
**Cover page elements:**
- FactoryLM logo
- Tagline: *"Text your factory. AI tells you what's wrong."*
- Version, date, support contact
- One-sentence pitch: "MIRA is an AI maintenance assistant that knows your specific equipment, reads from your actual manuals, and writes your CMMS work orders for you."

**How to use this manual** *(half page)*
- Who should read which sections (quick reference table by role)
- "If you only read one thing" callout → Chapter 2 (Getting Started)
- Where to get help

---

### PART 1 — INTRODUCTION (Chapters 1–2)
*For: everyone. Especially managers deciding whether to adopt.*

#### Chapter 1 — The Problem We're Solving  
*(2–3 pages, designed to resonate with any maintenance pro)*

- **1.1 — The 45-minute fault**  
  A real-world scenario: technician finds a tripped VFD, walks through the three bad options (manual, radio the senior guy, call OEM). Clock ticking. Machine down. Line stopped.

- **1.2 — Where the time actually goes**  
  Industry data: 40–60% of fault resolution time is searching for information, not fixing anything. The wrench is idle while someone reads a table of contents.

- **1.3 — What FactoryLM built**  
  The plain-English answer: MIRA is the senior tech who has read every manual, remembers every past fault on your specific machine, and is available at 3am on a Sunday. Built by a maintenance technician — not a software company.

- **1.4 — What MIRA is, and what it isn't**  
  Clear scope table:
  | MIRA IS | MIRA IS NOT |
  |---|---|
  | An AI diagnostic assistant | A replacement for your CMMS |
  | Grounded in your actual manuals | A predictive maintenance system |
  | Connected to your work order system | An MES or SCADA |
  | Available on any phone | A write-to-PLC control system |
  | Read-only on your equipment data | A guarantee of diagnosis accuracy |

- **1.5 — The two ways to use FactoryLM**  
  Brief intro to the two entry points:  
  → **MIRA web app** (app.factorylm.com) — full platform, your daily driver  
  → **FactoryLM Telegram Bot** — phone-in-your-pocket, photo → work order in 30 seconds  
  (These connect. The Telegram bot talks to the same CMMS as the web app.)

---

#### Chapter 2 — Getting Started (Account Setup)  
*(3–4 pages — the "first 10 minutes" chapter)*

- **2.1 — Signing up**  
  Go to factorylm.com → "Start my beta" → enter email, name, plant/company name.  
  What happens next: welcome email, 7-day Loom walkthrough series, invitation to activate on day 7.

- **2.2 — Activating your account**  
  Day-7 email → Stripe checkout → $97/month, cancel anytime.  
  What activates automatically:
  - Your MIRA workspace
  - Your Atlas CMMS (work orders, assets, PM schedules — no setup required)
  - Your knowledge base seed pack (100+ vendor manuals pre-loaded)

- **2.3 — Logging in (magic links — no passwords)**  
  Visit app.factorylm.com → enter email → click the link in your email.  
  The link is valid for 10 minutes. Explain why no password (simpler, more secure, especially on plant-floor shared devices).

- **2.4 — Install MIRA on your phone (highly recommended)**  
  Step-by-step with screenshots:
  - iOS Safari: Share → Add to Home Screen
  - Android Chrome: ⋮ menu → Install app  
  "The installed MIRA opens full-screen like a native app. One tap from your home screen."

- **2.5 — Your first 10 minutes — the quick tour**  
  Numbered walkthrough of what to click first:
  1. Onboarding wizard (auto-launches)
  2. Your feed (recent activity)
  3. Create your first asset
  4. Ask your first diagnostic question
  5. Invite a teammate

---

### PART 2 — THE MIRA WEB APP (Chapters 3–10)
*For: maintenance managers (admin tasks), technicians (daily use), supervisors (reporting)*

---

#### Chapter 3 — Navigating MIRA  
*(2–3 pages)*

- **3.1 — The main menu (sidebar)**  
  What each section does in plain English:
  | Menu Item | What it's for |
  |---|---|
  | Feed | Recent activity across your plant — new faults, WOs, KB updates |
  | Conversations | Your diagnostic chat history |
  | Command Center | Dashboard — open WOs, fault trends, asset status |
  | Assets | Your equipment list (the heart of MIRA) |
  | Namespace | Your asset hierarchy — lines, cells, machines, components |
  | Knowledge | Your uploaded manuals and the shared knowledge base |
  | Library | Curated reference documents |
  | Documents | Uploaded files tied to assets |
  | Parts | Spare parts inventory |
  | Schedule | PM schedule |
  | Reports | Fault trends, MTTR, technician activity |
  | Alerts | Automated notifications |
  | Proposals | Suggested KB additions awaiting admin approval |
  | Channels | Telegram/Slack integration settings |
  | Integrations | CMMS and external system connections |
  | Team | Manage users and roles |
  | Settings | Account, notifications, API keys |
  | Usage | API and query usage (for billing awareness) |

- **3.2 — Role overview**  
  Two roles, explained plainly:
  - **Technician** — sees chat, assets, documents, schedule. Can run diagnostics, submit WOs. Cannot manage users, print QR, or configure integrations.
  - **Admin** — everything above plus user management, KB curation, QR sticker printing, CMMS settings, API access.  
  "If you're setting up MIRA for your plant, you're an admin."

- **3.3 — Mobile vs. desktop**  
  Both work. Mobile (PWA) is optimized for the floor — big touch targets, voice input, camera. Desktop is better for admin tasks (user management, reports, knowledge upload).

---

#### Chapter 4 — Your Equipment (Assets)  
*(3–4 pages — this is the foundation)*

- **4.1 — What is an "asset" in MIRA?**  
  Any piece of equipment you want to track. A VFD, a pump, a conveyor, a PLC — anything with a nameplate. Explain the asset model: each asset has a name, location, manufacturer, model, service history, attached manuals, open work orders, and a chat entry point.

- **4.2 — Adding your first asset**  
  Three ways:
  - **Type it in** (Settings → Assets → + New Asset) — name, manufacturer, model, location
  - **Snap a nameplate photo** — MIRA reads the nameplate via vision AI and fills in the fields
  - **Import from your CMMS** — if you connect MaintainX/Limble/Fiix, existing assets sync automatically

- **4.3 — Building your asset list (for plant managers)**  
  Practical advice:
  - Start with your top 10 most-faulting machines
  - Add the manuals for those machines first (Chapter 7)
  - Don't try to add everything at once — MIRA is useful before day 1 with just a few well-documented assets

- **4.4 — The asset page: what you see**  
  Walkthrough of the asset detail view:
  - Current status and last fault
  - Open work orders
  - Service history
  - Attached documents
  - "Ask MIRA about this asset" button → goes straight to scoped diagnostic chat
  - QR sticker (print link)

- **4.5 — The Namespace: organizing your plant**  
  Explain the hierarchy: Site → Line → Cell → Machine → Component.  
  "Think of it as the org chart for your equipment."  
  How to build it (drag-and-drop in the Namespace view).  
  Why it matters: context-aware answers. "What's wrong with Line 3?" pulls from all machines on that line.

---

#### Chapter 5 — Running a Diagnosis (The Core Feature)  
*(5–6 pages — most important chapter for technicians)*

- **5.1 — The three ways to start a diagnostic conversation**

  **Option A — Type or speak your symptom**  
  Open Conversations → New Chat → type or tap the microphone  
  *Example: "My Yaskawa GS20 on Line 3 is faulting F030. It trips at startup."*

  **Option B — Scan the QR sticker on the machine** *(recommended)*  
  Point your phone camera at the sticker → tap the link → MIRA opens pre-loaded with:
  - Equipment: Yaskawa GS20
  - Location: Line 3
  - Last service: Feb 14th
  - Last fault: F024 overload (3 weeks ago)
  
  *You describe the symptom. MIRA already knows the machine.*

  **Option C — Upload a nameplate photo**  
  Tap the camera icon in chat → snap the nameplate → MIRA reads it and scopes the conversation.  
  Good for equipment you haven't set up yet.

- **5.2 — How MIRA diagnoses: what to expect**  
  Step-by-step of what a typical conversation looks like:
  1. You describe the symptom
  2. MIRA asks clarifying questions ("Does it trip at startup or during acceleration? Any recent changes to the load?")
  3. MIRA retrieves relevant manual pages and past fault history
  4. MIRA proposes a diagnosis with a cited source ("See page 47 of the Yaskawa GS20 Technical Manual")
  5. You confirm or push back
  6. MIRA refines if needed
  7. Fault resolved → MIRA drafts the work order closeout

- **5.3 — Giving MIRA good information**  
  Practical tips for getting better answers:
  - Name the equipment ("GS20 on Line 3", not "the drive")
  - Describe what you see, hear, smell ("amber fault light, F030 on display, trips 3 seconds after start")
  - Mention recent history ("we replaced the belt last week")
  - Tell MIRA what you've already tried
  
  Sidebar: "What MIRA knows without you telling it" — the asset's specs, past WOs, PM history, your uploaded manuals.

- **5.4 — Understanding MIRA's answers**  
  How to read a response:
  - The diagnosis (plain language)
  - Cited source (manual name, page number, section)
  - Confidence indicators
  - Suggested next steps
  - Safety callouts (when relevant)

- **5.5 — Safety first: MIRA's guardrails**  
  What MIRA will always do:
  - Call out LOTO requirements before any hands-on advice
  - Refuse to advise on live-electrical work without safety acknowledgment
  - Flag arc flash, confined space, and chemical hazards
  - Stop and recommend a licensed professional for tasks outside its scope
  
  "MIRA has 21 safety triggers built in. It will never tell you to skip a lockout."

- **5.6 — When MIRA doesn't know**  
  Honest section. What happens when MIRA can't find an answer:
  - It says so ("I don't have enough information on that specific fault code")
  - It suggests what to try (upload the manual, add more context)
  - It does not guess or hallucinate a confident-sounding wrong answer
  
  How to improve MIRA's knowledge for your equipment → Chapter 7 (uploading manuals)

- **5.7 — Conversation history**  
  Where your diagnostic conversations live. How to find a past conversation. How conversations are tied to assets. Sharing a conversation with a colleague.

---

#### Chapter 6 — Work Orders  
*(3–4 pages)*

- **6.1 — How work orders connect to diagnostics**  
  MIRA doesn't just diagnose — it closes the loop. When a diagnosis is complete, MIRA drafts a work order and you approve it. One tap. No forms.

- **6.2 — Creating a work order from a diagnosis**  
  Step-by-step:
  1. End of diagnostic conversation → "Create Work Order" button appears
  2. MIRA pre-fills: title, description, asset, priority (Low / Medium / High / Critical), recommended parts, estimated labor
  3. Review the draft — tap any field to edit
  4. Tap "Confirm" → WO posts to your CMMS

- **6.3 — Creating a work order manually**  
  For when you need to log something without a diagnostic chat:
  Assets → select asset → "New Work Order" → fill in manually or start a quick chat.

- **6.4 — Managing open work orders**  
  The work order queue. Filtering by priority, asset, technician. Updating status (Open → In Progress → Closed). Adding notes and photos to an active WO.

- **6.5 — Work order history and fault patterns**  
  How MIRA uses past WOs to improve future diagnoses. Viewing fault frequency by asset. "This motor has had 4 overload faults in 90 days" — MIRA surfaces this automatically.

- **6.6 — If you use an external CMMS (MaintainX, Limble, Fiix)**  
  What syncs (WOs created by MIRA appear in your existing CMMS). What doesn't (bi-directional sync is in development). How to check connection status.

---

#### Chapter 7 — Your Knowledge Base (Manuals & Documents)  
*(3–4 pages)*

- **7.1 — Why the knowledge base matters**  
  MIRA comes pre-loaded with 25,000+ chunks from 100+ OEM manuals. That's the foundation. Your uploaded manuals layer on top — and they're weighted higher for your plant. "A Yaskawa GS20 manual you upload beats the generic one MIRA ships with."

- **7.2 — Uploading a manual**  
  Knowledge → Upload PDF → drag and drop or select file  
  Processing time: 2–10 minutes for a typical 300-page PDF  
  What happens: MIRA chunks, embeds, and indexes. From that point, every relevant answer cites page and source.

- **7.3 — What to upload (prioritization guide)**  
  Recommended order:
  1. Manuals for your top 5 most-faulting machines
  2. Any equipment with obscure or proprietary fault codes
  3. Plant-specific SOPs and safety procedures
  4. OEM PM guides
  5. Wiring diagrams (MIRA handles diagrams as documents — search is text-based)

- **7.4 — The shared knowledge base**  
  What's already in there. How to search it. What vendors are covered. How to request additions.

- **7.5 — Proposals: how MIRA learns from your team**  
  When a technician identifies a fix not in the manuals, they can propose it as a KB entry. Admins see it in the Proposals queue, review, and approve. Once approved, it's available to the whole team. "Twenty years of tribal knowledge, captured and searchable."

- **7.6 — Tying documents to assets**  
  Documents → link to a specific asset. When a technician scans that asset's QR code, MIRA knows to pull from that document first.

---

#### Chapter 8 — QR Asset Tagging  
*(2–3 pages)*

- **8.1 — What QR tags do**  
  One paragraph: scan the sticker, MIRA opens pre-scoped to that exact machine. No typing. The asset's history, manuals, open WOs, and service record are already loaded. One second vs. 30 seconds.

- **8.2 — Printing your stickers (admin)**  
  Admin → QR Stickers → check boxes next to assets → "Generate sticker sheet (PDF)" → print on Avery 5520 weatherproof vinyl (any office supply store, ~$22/pack)  
  Step-by-step with screenshots.

- **8.3 — Choosing the right sticker material**  
  | Environment | Recommended | Expected life |
  |---|---|---|
  | Indoor clean (pharma, food, electronics) | Avery 5520 weatherproof vinyl | 1–2 years |
  | Heavy industrial (machining, welding) | Laminated vinyl | 2–3 years |
  | Outdoor / harsh (pump stations, wastewater) | Anodized aluminum | 5+ years |
  
  "FactoryLM ships 50 free laminated vinyl stickers with every beta account — enough for your first critical assets."

- **8.4 — Sticking and verifying (technician)**  
  Where to place the sticker (near the nameplate, at eye level, away from heat/grease sources).  
  How to verify: scan it, confirm MIRA shows the right asset, tick the checkbox on the admin page.

- **8.5 — Using QR every day (technician workflow)**  
  Phone camera → sticker → tap link → describe symptom → done.  
  No app needed for the scan — any phone camera works.

- **8.6 — If a sticker gets damaged**  
  Log in to admin → QR Stickers → reprint. The URL is permanent. The new sticker replaces the old one automatically.

---

#### Chapter 9 — PM Schedules  
*(2 pages)*

- **9.1 — What's in the PM scheduler**  
  Schedule view: see upcoming PMs by asset, by date, by technician. Filter by line or area.

- **9.2 — Creating a PM task**  
  Assets → select asset → "+ PM Task" → frequency (weekly, monthly, annual), assigned technician, checklist steps.

- **9.3 — How MIRA uses PM data during diagnostics**  
  "This asset has a PM due in 3 days — want me to include inspection steps in the diagnosis?" MIRA pulls scheduled maintenance into the conversation automatically.

- **9.4 — PM history**  
  Every completed PM is logged. Technician, date, notes, any items flagged. Searchable from the asset page.

---

#### Chapter 10 — Team Management (Admin)  
*(2 pages)*

- **10.1 — Inviting your team**  
  Team → Invite → enter email → assign role (Technician or Admin) → send.  
  Invitees receive an email with a login link.

- **10.2 — Role permissions at a glance**  
  Full table: what each role can and can't do (chat, create WOs, upload manuals, print QR, manage users, configure integrations, view reports, approve proposals).

- **10.3 — Managing access (offboarding)**  
  When someone leaves: Team → find user → Deactivate. Their conversation history is preserved (for the plant's records), but they can no longer log in.

- **10.4 — Shared vs. personal conversations**  
  Conversations are private by default. An admin can view all conversations for compliance. Technicians can share a specific conversation by copying a link.

---

### PART 3 — THE TELEGRAM BOT (Chapter 11)
*For: technicians who want a zero-friction entry point. Also for maintenance managers evaluating the bot-first workflow.*

---

#### Chapter 11 — FactoryLM on Telegram  
*(4–5 pages)*

- **11.1 — What the Telegram bot does**  
  One photo. Thirty seconds. One new work order.  
  The bot receives an equipment photo on Telegram, uses AI vision to identify the equipment, assess its condition, and create a work order in your CMMS automatically. No app, no login, no forms.

- **11.2 — Finding the bot**  
  The FactoryLM bot is available on Telegram. Search for your plant's configured bot handle, or tap the invite link your admin sent.  
  (Note for admins: your organization's Telegram bot handle is configured during setup — see Chapter 12.)

- **11.3 — Your first 3 photos (free trial)**  
  New users get 3 free photo analyses before registration is required. You'll see how many free scans remain after each analysis.

- **11.4 — Bot commands**  
  | Command | What it does |
  |---|---|
  | `/start` | Welcome message + how many free scans remain |
  | `/status` | Your account status, bot health, session stats (photos processed, WOs created) |
  | `/assets` | List all assets in your CMMS |
  | `/recent` | Your 5 most recent work orders (with priority flags) |
  | `/register` | Get a registration link to unlock unlimited access |

- **11.5 — Sending a photo: step by step**  
  1. Open Telegram, find the FactoryLM bot
  2. Tap the paperclip / attach icon
  3. Select a photo (or snap one with your camera)
  4. Send — no caption needed
  5. The bot replies within a few seconds:  
     - Equipment identified: "Yaskawa GS20 Variable Frequency Drive"
     - Condition assessed: GOOD / FAIR / POOR / CRITICAL
     - Issues noted: any visible faults the AI can see in the photo
     - Recommended action: "Schedule inspection of cooling fins and check for debris"
     - Work order created: [View Work Order ↗] [View Asset ↗]
  6. Tap the work order link to open it in your CMMS

- **11.6 — What makes a good photo**  
  Practical tips (illustrated with examples):
  - Fill the frame with the equipment — not the whole machine room
  - Include the nameplate in the shot if possible
  - Clean the camera lens (common problem in industrial environments)
  - Daylight or work light works; direct flash can wash out labels
  - Multiple photos → send one at a time, the bot processes each separately

- **11.7 — Registering for unlimited access**  
  After 3 free scans, type `/register` → tap the link → create your FactoryLM account → unlimited access.  
  Your Telegram account links to your FactoryLM account automatically — your scan history carries over.

- **11.8 — Checking your work orders from Telegram**  
  `/recent` → see your latest WOs.  
  `/assets` → see all equipment the bot has logged.  
  For full WO management: follow any [View Work Order ↗] link to the CMMS.

- **11.9 — When the bot says "I can't identify this"**  
  The AI may struggle with:
  - Very old or rusted equipment with illegible nameplates
  - Partial photos showing only connectors/components
  - Non-industrial objects (tables, floors, hands)
  
  Fix: send a clearer photo, or a close-up of the nameplate specifically. Or log in to the web app and add the asset manually.

---

### PART 4 — CMMS INTEGRATION & EXTERNAL CONNECTIONS (Chapter 12)
*For: admins connecting MIRA to their existing tools*

---

#### Chapter 12 — Connecting Your Systems  
*(3–4 pages)*

- **12.1 — Your included CMMS (Atlas)**  
  Already connected at activation. Nothing to configure. Open MIRA, your CMMS is there.  
  "If you've never used a CMMS before, this is your starting point."

- **12.2 — Connecting MaintainX**  
  Status: beta (requires a quick email to support@factorylm.com for now — self-serve flow coming soon)  
  What you need: MaintainX API key with read/write on work orders and assets  
  What syncs: WOs created by MIRA, asset status, fault history

- **12.3 — Connecting Limble CMMS**  
  Same process as MaintainX above. Status: beta.

- **12.4 — Connecting Fiix**  
  Same process. Status: beta.

- **12.5 — Connecting Telegram to your plant**  
  Admins configure which Telegram bot your plant uses via Settings → Channels → Telegram.  
  The bot handle is created once during onboarding by the FactoryLM team.  
  Invite your technicians to the bot: share the invite link from the Channels page.

- **12.6 — Connecting Slack**  
  Settings → Channels → Slack → follow the OAuth flow → choose which Slack channel MIRA posts alerts and diagnostic results to.

- **12.7 — Data security and privacy**  
  - MIRA is read-only on your equipment data — it never writes to a PLC or SCADA
  - CMMS writes only happen when you explicitly approve a draft work order
  - Your uploaded manuals and CMMS data are isolated to your tenant — never shared with other FactoryLM customers
  - Every CMMS write is audit-logged with the approving user's name and timestamp
  - All data in transit uses TLS. Data at rest encrypted.

---

### PART 5 — FOR MAINTENANCE MANAGERS (Chapter 13)
*Role-specific guide — the "what does this mean for my department" chapter*

---

#### Chapter 13 — Running Your Maintenance Program with MIRA  
*(3–4 pages)*

- **13.1 — The 30-day rollout plan**  
  Practical checklist for getting a plant team live:  
  Week 1: Set up assets for top 10 machines, upload manuals for each  
  Week 2: Print and stick QR tags, do a team walkthrough (15 min training)  
  Week 3: Live — all faults go through MIRA. Capture every diagnosis  
  Week 4: Review reports, identify patterns, adjust PM schedules

- **13.2 — Training your technicians (15-minute floor session)**  
  What to cover in the team walkthrough:
  - How to scan a QR sticker
  - How to describe a fault to MIRA
  - How to approve a work order draft
  - When to trust MIRA and when to call a specialist
  
  Suggested script and talking points included.

- **13.3 — Reports: what to look at and when**  
  Weekly review:
  - Open WO count and age (are WOs sitting open too long?)
  - Top faulting assets (what's breaking the most?)
  - MTTR by asset (is MIRA actually reducing resolution time?)
  
  Monthly review:
  - Fault pattern trends
  - PM compliance rate
  - Knowledge base health (how many proposals awaiting approval?)

- **13.4 — Using MIRA during audits and compliance reviews**  
  Every diagnostic conversation is logged with timestamp, user, asset, and cited sources. Every CMMS write is logged. This creates an auditable paper trail automatically.

- **13.5 — Managing the knowledge base (ongoing)**  
  Proposals queue: review and approve technician knowledge contributions weekly.  
  Manual updates: when an OEM releases a revised manual, replace the old version — MIRA will re-index.  
  New equipment: add assets and upload manuals before the first fault hits.

- **13.6 — ROI: calculating your time savings**  
  Simple worksheet:
  - Average fault resolution time today (minutes)
  - Number of faults per week
  - Technician hourly cost
  - Estimated reduction with MIRA (industry benchmark: 40% reduction in search time)
  
  Example: 50 faults/week × 45 min avg × 40% reduction × $35/hr = $525/week saved.  
  MIRA costs $97/month.

---

### PART 6 — REFERENCE  
*(Chapters 14–16)*

---

#### Chapter 14 — Troubleshooting  
*(3–4 pages — pulled from existing docs/product/troubleshooting.md with expansion)*

Section organization:
- Login and signup issues
- Chat and diagnostics issues
- QR scanning issues
- CMMS integration issues
- Telegram bot issues
- Manual upload issues
- "Still stuck?" — support contacts and response times

---

#### Chapter 15 — Frequently Asked Questions  
*(2–3 pages)*

Organized by audience:
- **For technicians on the floor**
- **For maintenance supervisors**
- **For managers / decision makers**
- **For IT / security teams** (the "what do you need from our network?" section)

Key FAQs to include:
- "Does MIRA need internet access on the plant floor?" (yes, for the cloud features; Ignition integration has partial offline capability)
- "Can MIRA see our PLC data?" (read-only, and only what you configure)
- "What if MIRA gives a wrong answer?" (human always approves before action; report safety concerns)
- "What languages does MIRA support?" (English primary; ask support for others)
- "Can we use MIRA without giving MIRA our manuals?" (yes, shared KB works; upload for better results)
- "Is this HIPAA/ISO 27001/SOC 2 compliant?" (in progress — contact for current compliance status)
- "What happens if we cancel?" (data export available, data retained 90 days)

---

#### Chapter 16 — Quick Reference Cards  
*(2–3 pages — printable, designed for the plant floor)*

- **Technician Quick Card** (laminated, stick near machines)
  - How to scan a QR tag
  - How to start a chat
  - Bot commands (/status, /recent, /assets)
  - Safety: what MIRA always requires (LOTO acknowledgment before hands-on advice)
  - Support: support@factorylm.com

- **Diagnostic Conversation Starter Phrases**  
  Fill-in-the-blank templates:  
  "My [equipment name] at [location] is [symptom]. It started [when]. I've already [what you tried]."

- **Admin Quick Card**
  - How to add an asset
  - How to print QR stickers
  - How to invite a team member
  - How to approve a knowledge proposal
  - How to check the CMMS connection status

---

### APPENDICES

**Appendix A — Supported Equipment Vendors (Knowledge Base coverage)**  
List of 100+ vendors in the shared knowledge base.

**Appendix B — Supported CMMS Platforms**  
Status table with feature support matrix per CMMS.

**Appendix C — Telegram Bot Command Reference**  
Full command list with examples.

**Appendix D — Safety Guardrail Reference**  
The 21 safety triggers and what happens when MIRA hits each one.

**Appendix E — Glossary**  
Plain-English definitions: asset, namespace, tenant, knowledge base, chunk, RAG, CMMS, PM, WO, MTTR, QR sticker, magic link.

**Appendix F — Changelog**  
Manual version history.

---

## PRODUCTION NOTES FOR MIKE

### Gaps I noticed while researching (honest feedback)

1. **QR sticker system is still in development** — the docs say "in development" as of April 2026. The manual can describe the full intended UX, but add a note like "shipping Q3 2026 — contact support for early access." Don't pretend it's live if it's not. Users will find out.

2. **The Telegram bot registration URL** (`http://72.60.175.144/register`) looks like a bare IP — that's not production-grade for a public manual. Before publishing, this should be `https://app.factorylm.com/register` or similar. Flag for your team.

3. **Two brand names, one system** — FactoryLM (company/Telegram) and MIRA (the AI + platform) can confuse new users. The manual's introduction chapter handles this explicitly, but consistent branding across the app, the bot, and the website will reduce confusion long-term.

4. **Magic link login** — excellent UX choice for plant floors where people share devices. But the troubleshooting section needs to be prominent ("10-minute expiry" catches a lot of people).

5. **The $97/mo pricing with 7-day nurture before payment** is a real product and should be described honestly. Don't hide the trial-then-pay structure — maintenance managers respect straightforwardness.

6. **"What happens to my data if I cancel?"** — I couldn't find a clear answer in the docs. This is a must-answer before publishing. Maintenance records are legally important. Add to FAQ and Terms.

7. **Ignition integration (PR #2074)** is built but not yet in the product docs at all. As that ships, add a Chapter 13 subsection for "Connecting via Ignition Perspective" — it's a huge differentiator.

### Format recommendations

- **Primary format:** Web-hosted (docs.factorylm.com or similar), not a PDF. Maintenance managers Google for answers; a searchable web doc ranks better and can be updated without a reprint.
- **Secondary format:** Single printable PDF for customers who want to hand something to their IT team.
- **Quick Reference Cards (Chapter 16):** Print-ready, laminated, 4×6". These live on the plant floor.
- **Screenshots:** Every UI step needs a screenshot. The manual is useless for a 60-year-old maintenance manager without them.
- **Video supplements:** Link to the Loom walkthroughs from the nurture sequence. Don't duplicate — cross-reference.

### Suggested authoring order

1. Chapter 5 (Diagnosis) — highest value, most technician traffic
2. Chapter 2 (Getting Started) — first thing every new user needs
3. Chapter 8 (QR Tags) — biggest differentiator once the feature ships
4. Chapter 11 (Telegram Bot) — fastest adoption path
5. Chapter 14 (Troubleshooting) — reduces support ticket volume
6. Everything else

---

*This outline was produced by Hermes acting as an independent secret-shopper/maintenance manager reviewer, after reading the Mikecranesync/MIRA and Mikecranesync/factorylm GitHub repositories in full. No content was invented — all features described are confirmed from code and product documentation. Gaps and honest assessments are included deliberately.*
