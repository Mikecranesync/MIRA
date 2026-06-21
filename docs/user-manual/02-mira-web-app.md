# PART 2 — THE MIRA WEB APP

---

# Chapter 3 — Navigating MIRA

## 3.1 The main navigation

MIRA's sidebar (or bottom nav on mobile) organises everything into sections. Here's what each one does in plain English:

| Section | What it's for |
|---|---|
| **Command Board** | Your maintenance dashboard — open work orders at a glance, fault trends, asset health summary. Start here each morning for a real-time view of your plant. |
| **Namespace** | Your plant's asset hierarchy — Site → Line → Cell → Machine → Component. The "org chart" for your equipment. |
| **Command Center** | Asset-specific intelligence — upload manuals, validate MIRA's answers, approve asset agents for deployment to your HMI or Ignition. |
| **Channels** | Connect Telegram and Slack to your plant's MIRA workspace. Run diagnostics from the chat app your team already uses. |
| **Knowledge** | Your uploaded manuals and the shared OEM knowledge base. Search fault codes, wiring diagrams, maintenance procedures. |
| **Assets** | Your equipment list. Every machine, drive, pump, and PLC in your plant lives here. Create and edit asset records. |
| **CMMS** | Work-order management — create, assign, track, and complete maintenance jobs. Integrated with your diagnostic conversations. |
| **Scan** | QR-based asset tagging — print QR stickers for your equipment, scan them to jump straight into diagnostics for that machine. |
| **Settings** | Workspace settings — plant name, team members, integrations, safety rules, timezone, audit log. |

---

## 3.2 Two roles: Technician and Admin

MIRA has two user roles. Here's the practical difference:

| Capability | Technician | Admin |
|---|---|---|
| Run diagnostic conversations | ✅ | ✅ |
| View and create work orders | ✅ | ✅ |
| Upload documents to an asset | ✅ | ✅ |
| View the PM schedule | ✅ | ✅ |
| View the asset list | ✅ | ✅ |
| Create and edit assets | ❌ | ✅ |
| Upload manuals to the knowledge base | ❌ | ✅ |
| Approve knowledge base suggestions | ❌ | ✅ |
| Print QR sticker sheets | ❌ | ✅ |
| Invite or deactivate team members | ❌ | ✅ |
| Change roles | ❌ | ✅ |
| Configure CMMS integrations | ❌ | ✅ |
| Connect Telegram and Slack | ❌ | ✅ |
| View billing and usage | ❌ | ✅ |

**Who should be an Admin:** The maintenance manager, reliability engineer, or whoever is responsible for setting up and maintaining the system. One or two people per plant is typical.

**Who should be a Technician:** Everyone else — the people on the floor running diagnostics and creating work orders.

> **Tip:** When in doubt, give new users the Technician role. You can always promote someone to Admin later. It's harder to clean up after an accidental change by a well-intentioned technician.

---

## 3.3 Mobile vs. desktop

MIRA works on both. Here's where each is better:

| Task | Mobile (phone) | Desktop (computer) |
|---|---|---|
| Running a diagnosis on the floor | ✅ Best | Works |
| Uploading a nameplate photo | ✅ Best | Requires separate photo transfer |
| Scanning a QR sticker | ✅ Only option | ❌ |
| Voice input | ✅ Best | Works with a mic |
| Uploading large PDFs (manuals) | Works | ✅ Best |
| Viewing reports | Works | ✅ Best (larger screen) |
| Managing users and settings | Works | ✅ Best |
| Approving KB suggestions | Works | ✅ Best |

For technicians, install MIRA as a PWA on your phone (see Chapter 2.4). For managers and admins doing setup and reporting, a desktop browser is more comfortable.

---

---

# Chapter 4 — Your Equipment (Assets)

The **Asset** is the heart of MIRA. Every diagnostic conversation, every work order, every manual reference, every PM task ties back to a specific piece of equipment — an asset.

## 4.1 What is an "asset"?

An asset is any piece of equipment you want to track. Examples:
- A variable frequency drive (VFD) on Line 3
- A 50 HP pump in the water treatment building
- An Allen-Bradley Micro820 PLC in Panel 7
- A packaging conveyor
- An air compressor
- A welding robot

Each asset in MIRA has:
- A **name** and **asset tag** (your internal ID, like VFD-L3-07)
- **Manufacturer** and **model** (Yaskawa, GS20)
- **Location** (Line 3, Building B)
- **Type** (Electrical, Mechanical, HVAC, Fluid, etc.)
- **Criticality** (Low / Medium / High / Critical — affects fault priority)
- A **service history** (past work orders and fault events)
- **Attached documents** (manuals, wiring diagrams, inspection reports)
- A **QR sticker** (printable — links directly to this asset's MIRA chat)
- **Open work orders** and **PM schedule**

---

## 4.2 Adding your first asset

Go to **Assets** in the sidebar → click **"+ New Asset"** (blue button, top right).

A form opens with these fields:

**Required:**
- **Asset Name** — what you call it ("Line 3 Drive", "Pump Station B2")
- **Location** — where it lives ("Building A, Line 3")

**Highly recommended:**
- **Manufacturer** — choose from the dropdown (Allen-Bradley, Yaskawa, Siemens, ABB, Mitsubishi Electric, Schneider Electric, etc.) or type "Other"
- **Model** — the model number (e.g., GS20)
- **Asset Tag** — your internal ID if you have one (e.g., VFD-L3-07)
- **Criticality** — how bad it is if this asset fails: Low, Medium, High, or Critical
- **Type** — Mechanical, Electrical, HVAC, Fluid, CNC, Thermal, Hydraulic, Pneumatic

**Optional:**
- Serial number
- Department
- Description (free text — a good place for notes like "runs 24/7, never shut down without approval")

Click **"Create Asset"** when done.

> **Shortcut — nameplate photo:** Instead of typing the manufacturer and model, snap a photo of the equipment's nameplate. MIRA reads the nameplate via AI vision and fills in the fields automatically. Tap the camera icon inside the asset creation form.

---

## 4.3 The asset page: what you see

Click on any asset in your list to open its detail page. Here's what you'll find:

**Top section — current status**
- Status badge: **Operational** (green) / **Warning** (yellow) / **Critical** (red) / **Idle** (grey)
  - Status is derived automatically from open work orders and recent fault events
- Last maintenance date
- Last fault date

**Open work orders**
- All currently open WOs for this asset, with priority badges
- Click any WO to view or update it

**Service history**
- Chronological list of all past work orders and fault events
- Searchable by date or keyword

**Documents**
- Files attached to this asset: manuals, wiring diagrams, service reports
- "Upload document" button — drag a PDF or image to attach it

**QR sticker**
- A preview of this asset's QR code
- "Print" button → generates a ready-to-print sticker (see Chapter 8)

**"Ask MIRA about this asset" button**
- Opens a new diagnostic conversation pre-scoped to this exact asset — no typing required

---

## 4.4 The asset list: filtering and searching

The main **Assets** page shows all your equipment. You can:

**Filter by status:**
- All / Operational / Warning / Critical / Idle
  - Tabs across the top — useful first thing in the morning to spot anything in Warning or Critical

**Search:**
- By asset name, manufacturer, model, or tag
- The search box is at the top of the list

**Sort:**
- By name, last maintenance date, criticality, or fault frequency

> **Pro tip for maintenance managers:** Set criticality accurately when you create assets. MIRA uses criticality to prioritise work orders — a Critical asset fault gets a different response than a Low criticality one.

---

## 4.5 Building your asset list (practical guide)

Don't try to add every machine at once. Here's the order that gets you value fastest:

**Week 1 — Your top 10**
Start with the 10 machines that cause you the most downtime, have the most faults, or are hardest to diagnose. These are the ones where MIRA pays off immediately.

**Week 2 — Upload manuals for those 10**
Before uploading everything, make sure your top 10 assets each have their OEM manual uploaded (see Chapter 7). A well-documented asset gives far better diagnostic answers.

**Week 3 — Print QR stickers for those 10**
Once the top assets are in the system, print and stick their QR codes (see Chapter 8). From this point, your technicians can scan → diagnose in under a minute.

**Ongoing — Add as you go**
Add new assets when you encounter them. "I'm standing in front of a pump that's not in MIRA" → add it, snap the nameplate, and you're set.

---

## 4.6 The Namespace: your plant's equipment hierarchy

The **Namespace** is the organisational structure behind your asset list. Think of it as the org chart for your equipment:

```
Site (e.g., Main Plant — Detroit)
  └── Line (e.g., Line 3 — Packaging)
        └── Cell (e.g., Cell A — Labelling)
              └── Machine (e.g., Label Applicator)
                    └── Component (e.g., Drive Motor)
```

**Why it matters:** When a supervisor asks MIRA "what's the status of Line 3?", MIRA can answer by looking at all assets assigned to that Line in the Namespace. Without a Namespace, MIRA only knows individual assets, not how they relate.

**How to build it:**
1. Go to **Namespace** in the sidebar
2. Click **"+ Add Site"** — enter your plant name
3. Under the site, click **"+ Add Line"**
4. Continue building the hierarchy
5. As you add assets (Chapter 4.2), assign them to the correct Namespace location

> **Don't overthink it.** A flat list of machines is better than a perfect hierarchy that takes three weeks to build. Start with Site → Machine (skip Line and Cell if your plant is simple) and add levels later.

---

---

# Chapter 5 — Running a Diagnosis

*This is what you're here for. Read this chapter carefully — especially sections 5.2 and 5.5.*

---

## 5.1 Three ways to start a diagnostic conversation

### Option A — Type or speak your symptom (fastest for new users)

1. Tap **Conversations** in the sidebar
2. Tap **"New conversation"** (blue button)
3. Type your symptom — or tap the microphone icon and speak it:

   *"My Yaskawa GS20 VFD on Line 3 is showing fault F030. It trips about 3 seconds after startup."*

4. MIRA responds within a few seconds

**Tips for the best results:**
- Name the specific equipment and location
- Describe what you see, hear, or smell
- Mention when it started and what happened before the fault
- Tell MIRA what you've already tried

**Example of a good opening message:**
> *"Line 3 conveyor drive — Danfoss VLT 2800 — tripped on alarm 14 (earth fault). Happened twice this morning. First trip was after about 20 minutes of running. We checked the motor cables and they look fine. Motor is a 15kW SEW. No recent changes to the line."*

---

### Option B — Scan the QR sticker on the machine (recommended for daily use)

Once your assets have QR stickers (see Chapter 8), this is the fastest way to start a conversation:

1. Open your phone's camera app (no need to open MIRA first)
2. Point the camera at the QR sticker on the machine
3. Tap the link that appears at the top of the screen
4. MIRA opens — already knowing which machine you're at

When you start typing, MIRA already has the full context:
- Equipment: Yaskawa GS20
- Location: Line 3
- Last service: February 14th
- Last fault: Overload (F070), 3 weeks ago

You describe the symptom. MIRA handles the rest.

> **⚠️ Known issue:** On a device where you've never logged in before, the QR scan redirects to the login page, and after login you may land on an empty chat instead of the scoped asset view. Workaround: scan the QR code again after logging in. This is tracked as a bug (GitHub issue #2171) and will be fixed before the QR system's general release. See Chapter 14 for more workarounds.

---

### Option C — Upload a nameplate photo

If you're standing in front of equipment that isn't in MIRA yet:

1. Open Conversations → New conversation
2. Tap the **camera or attachment icon** in the chat input
3. Snap a photo of the machine's nameplate (the metal plate showing manufacturer, model, serial number, voltage, etc.)
4. MIRA reads the nameplate via AI vision and identifies the equipment
5. The conversation is now scoped to that equipment — and MIRA will offer to create an asset entry for it

**Best for:**
- Equipment you haven't added to your asset list yet
- On-site visits to other facilities
- Contractors diagnosing unfamiliar equipment

---

## 5.2 How MIRA diagnoses: what to expect

A typical MIRA conversation looks like this:

**You:** *"GS20 on Line 3 is throwing F030. Trips 3 seconds after startup."*

**MIRA:** *"F030 on the Yaskawa GS20 is Output Phase Loss — the drive has detected an open phase in the motor output circuit. A few questions to narrow this down:*
*1. Is this the first time you've seen F030 on this drive, or has it happened before?*
*2. Did anything change recently — motor replacement, cable work, panel work on Line 3?*
*3. Can you check if the motor runs (or attempts to run) before the trip, or does it trip immediately on start command?"*

**You:** *"First time. No recent changes. Motor hums briefly then trips."*

**MIRA:** *"The brief hum before trip tells us the motor is energising — this rules out a dead start contactor or wiring break between drive and motor. With no recent changes and a brief run before F030, the most likely causes in order of probability are:*

*1. Failing motor winding (most likely) — one phase of the motor's internal winding is developing high resistance. Check motor insulation resistance with a megohmmeter: each phase should read >1 MΩ against ground. A Yaskawa GS20 at 460V will report F030 when output current on any phase drops >50% from the other two phases.*

*2. Loose or corroded output terminal — less likely given no recent cable work, but worth checking. Terminals T1, T2, T3 on the drive's output side.*

*3. Drive output IGBT failure (less likely) — if the megger and terminal checks pass, the drive's output stage may be failing. Would require swap-out to confirm.*

*Source: Yaskawa GS20 Technical Manual, Section 6.3.2 — Output Fault Codes, page 89.*

*Recommended next step: megger test the motor before pulling the drive. Do you want me to walk you through the megger test procedure for this motor?"*

---

This is the pattern:
1. **You describe the symptom** with as much detail as you have
2. **MIRA asks clarifying questions** — just like a senior tech would
3. **MIRA narrows the diagnosis** to 2–3 most likely causes in order of probability
4. **MIRA cites the source** — manual name, section, page number
5. **MIRA offers next steps** — including walking you through procedures step by step

---

## 5.3 Understanding MIRA's response format

**Diagnosis section**
The probable cause(s), in order of likelihood. MIRA presents multiple possibilities rather than guessing — because an overconfident wrong answer is worse than an honest "here are the candidates."

**Cited source**
Every factual claim from a manual is cited: *"Source: Yaskawa GS20 Technical Manual, Section 6.3.2, page 89."* If MIRA is drawing on general knowledge rather than a specific document, it says so.

**Confidence**
MIRA uses language like "most likely," "less likely," "rules out" to communicate confidence. It does not give you a percentage — percentages are false precision. Pay attention to the language: "almost certainly" means something different from "possible but less likely."

**Recommended next step**
A specific, actionable next step. Not "check the motor" but "megger test T1, T2, T3 with a 500V megohmmeter, each phase against ground, expected reading >1 MΩ."

**Safety callouts**
Whenever a recommended action involves any risk — electrical exposure, stored energy, chemicals, confined spaces — MIRA calls it out explicitly. See section 5.5.

---

## 5.4 Giving MIRA good information

The quality of the diagnosis depends on the quality of your description. Here's what helps:

| ✅ Good information | ❌ Less helpful |
|---|---|
| "Yaskawa GS20 VFD on Line 3" | "the drive" |
| "F030 fault code on the display" | "it's faulting" |
| "Trips 3 seconds after startup" | "keeps stopping" |
| "Brief hum before trip" | "makes noise" |
| "No recent changes to the line" | "don't know" |
| "We already checked the output terminals" | (not mentioned) |
| "Motor is a 15kW SEW, 3-phase 460V" | (not mentioned) |

**The single most useful thing you can do:** tell MIRA what you've already tried. This prevents MIRA from walking you through steps you've already done.

**Voice input tip:** If you're hands-on with the equipment, tap the microphone and describe what you're seeing in real time. *"Okay I've got the panel open — F030 on the display, motor just hums, trips at 3 seconds, output terminals look clean, no burning smell, no visible damage on the drive..."* MIRA can work with stream-of-consciousness.

---

## 5.5 Safety: what MIRA always does

MIRA has 21 built-in safety guardrails. These are not optional and cannot be disabled. Here's what they do:

**Lockout/Tagout (LOTO)**
Before any advice that requires accessing live electrical components, MIRA will include a LOTO reminder:
> *"⚠️ Safety: Before opening this panel, ensure the drive is de-energised and locked out per your plant's LOTO procedure. Verify zero energy with a properly calibrated tester. Do not proceed until lockout is confirmed."*

**Arc Flash**
Before any work near electrical panels or switchgear, MIRA will note arc flash hazards:
> *"⚠️ Arc flash risk: This panel is rated at [X] incident energy. Ensure you are wearing appropriate PPE per your site's arc flash study before opening."*

**Confined Space**
When discussing equipment inside confined spaces (tanks, vessels, pits), MIRA will flag entry procedures.

**Chemical Hazards**
When fluids, lubricants, or cleaning agents are involved, MIRA will note SDS requirements.

**Escalation**
When a situation is beyond what MIRA can safely advise on — complex electrical failures, structural issues, anything requiring a licensed engineer — MIRA will say so clearly and recommend the appropriate professional.

> **Important:** MIRA's safety guardrails are a supplement to your plant's safety program, not a replacement. Always follow your plant's actual LOTO procedures, arc flash study, and EHS policies. If MIRA's safety advice conflicts with your plant's procedures, follow your plant's procedures and report the discrepancy to support@factorylm.com.

---

## 5.6 When MIRA doesn't know

MIRA will tell you when it doesn't have a good answer. This is a feature, not a bug.

Signs MIRA is uncertain:
- *"I don't have enough information about this specific fault code to give you a confident diagnosis."*
- *"This is outside the scope of equipment I have detailed knowledge about."*
- *"I'd recommend consulting the OEM directly for this one."*

**What to do when MIRA doesn't know:**

1. **Upload the manual.** Go to Knowledge → Manuals → Upload PDF. Once the manual is processed (2–10 minutes), return to your conversation and MIRA will cite it.

2. **Add more context.** Rephrase your question with more specific detail about the symptom, the equipment, and what you've already checked.

3. **Try a different framing.** Instead of "why did it trip?", try "what are the common causes of F030 on a Yaskawa GS20?"

4. **Escalate appropriately.** MIRA is not a substitute for the OEM's technical support team on novel or complex failures. If MIRA is uncertain and you're under pressure, call the OEM.

> **Never ignore safety uncertainty.** If MIRA can't answer a safety-related question confidently, stop the job. Don't interpret "I'm not sure" as permission to proceed.

---

## 5.7 Providing feedback on MIRA's answers

If MIRA gives you an answer that's wrong, outdated, or unhelpful:

**For safety concerns:** Tap **"Report → Safety concern"** on the message, or email safety@factorylm.com immediately with screenshots. Safety reports are reviewed within 2 hours.

**For incorrect technical information:** Tap **"Report → Incorrect answer"** on the message. Include what the correct answer is if you know it — your feedback trains the system.

**For great answers:** Positive feedback (👍) also helps. When MIRA nails a diagnosis, let it know — those patterns get reinforced.

> **Your reports matter more than any other signal.** A maintenance technician correcting a wrong answer is worth 1,000 benchmark tests. Please report errors.

---

## 5.8 Your conversation history

All conversations are saved automatically. To find a past conversation:

1. Go to **Conversations** in the sidebar
2. Use the search bar to search by asset name, technician name, keyword, or date
3. Conversations show who ran them, which asset they were about, and which channel (web, Telegram, Slack)

**Sharing a conversation:**
Conversations can be shared with teammates by copying the conversation URL. Useful when handing off a fault to another shift.

**Conversations and compliance:**
Every conversation is logged with timestamp, user, and asset. This creates an automatic record of every diagnostic event — useful for audits, insurance, and compliance reviews.

---

---

# Chapter 6 — Work Orders

## 6.1 From diagnosis to work order: the one-tap flow

When a MIRA diagnostic conversation reaches a conclusion — either a fix is identified, or work needs to be scheduled — MIRA will offer to create a work order:

> *"Based on this diagnosis, I'd recommend scheduling an inspection and potential replacement of the motor windings on VFD-L3-07's motor (Air Handler Unit #3). Want me to draft a work order?"*

Tap **"Create Work Order"** and MIRA pre-fills:
- **Title:** "Inspect and replace motor windings — Line 3 VFD motor"
- **Description:** A clear summary of the fault, diagnosis, and recommended actions
- **Asset:** Line 3 VFD (already linked from the conversation)
- **Priority:** MIRA assigns High, Medium, or Low based on the diagnosis severity and asset criticality
- **Estimated labour** (if known from the manual)
- **Parts to check** (if MIRA identified specific parts)

Review the draft. Tap any field to edit. When it looks right, tap **"Confirm"** — the WO posts to your CMMS.

That's it. No forms. No end-of-shift documentation. The fault, diagnosis, and work order are all captured in one flow.

---

## 6.2 Creating a work order manually

Sometimes you need to log a WO without a diagnostic conversation — a visual inspection finding, a PM task, a safety observation.

**From the Assets page:**
1. Open the asset → tap **"New Work Order"**
2. Fill in the title and description
3. Set priority and assignee
4. Tap **"Create"**

**From the Work Orders page:**
1. Go to **CMMS** or **Command Center** in the sidebar
2. Tap **"+ New Work Order"**
3. Search for and select the asset
4. Fill in the details

---

## 6.3 Managing your work order queue

The **CMMS** section (or **Command Center** dashboard) shows all open work orders across your plant.

**Filter by:**
- Priority: Critical / High / Medium / Low
- Status: Open / In Progress / Pending Parts / Closed
- Asset or location
- Assigned technician
- Date created or due date

**Updating a work order:**
Tap any WO to open it → update the status, add notes, attach photos, log time, or change the assignee.

**Closing a work order:**
When the fault is resolved, update the status to **Closed** and add a brief close-out note (what was done, what parts were used). This close-out note feeds MIRA's memory — the next time there's a fault on this asset, MIRA knows what fixed it last time.

---

## 6.4 How work order history improves future diagnoses

Every closed work order is MIRA's memory. When you ask MIRA about an asset that's had 4 overload faults in 90 days, MIRA knows:
- The fault history
- What was done to fix it each time
- Whether the fixes held

This pattern recognition is what makes MIRA genuinely useful over time — it gets better at diagnosing your specific equipment as more data accumulates. A plant that's been on MIRA for 6 months gets much better answers than a plant that signed up yesterday.

---

---

# Chapter 7 — Your Knowledge Base

## 7.1 Why the knowledge base matters

MIRA comes pre-loaded with a **shared knowledge base**: over 25,000 chunks of content from 100+ OEM manuals, fault code references, and industrial maintenance guides. This covers the most common vendors (Yaskawa, Allen-Bradley, Siemens, ABB, Danfoss, SEW-Eurodrive, and many more) and gives you useful answers from day one.

But the shared knowledge base is general. Your plant has specific equipment, specific configurations, and specific procedures.

**When you upload your own manuals:**
- MIRA cites your exact manual — not a generic one
- Your plant-specific procedures appear in answers
- Non-standard configurations are handled correctly
- MIRA's answers are weighted toward your uploads over the shared KB

Upload your manuals. It takes 5 minutes to upload. It pays off in every conversation afterwards.

---

## 7.2 Uploading a manual

1. Go to **Knowledge** in the sidebar
2. Click **"Manuals"** tab
3. Click **"Upload"** or drag and drop a PDF into the upload area
4. MIRA will prompt you to confirm:
   - Document type (OEM manual, SOP, wiring diagram, etc.)
   - Manufacturer (if not auto-detected)
   - Model (if not auto-detected)
5. Click **"Upload"** — processing begins in the background

**Processing time:** 2–10 minutes for a typical 300-page PDF. You'll see a progress indicator, and MIRA will notify you when the document is indexed and searchable.

**File requirements:**
- Format: PDF (text-based PDFs work best; scanned image PDFs take longer and may have lower accuracy)
- Size: up to the plan limit (standard: 50MB per file)
- Language: English primary; contact support for other languages

> **Tip:** If your manual is a scanned image PDF (you can tell because you can't select or copy the text), the OCR processing takes longer but still works. For best results, use the manufacturer's official digital PDF if you can get it — most OEMs offer these free on their websites or via their distributor.

---

## 7.3 What to upload first (prioritisation guide)

**Highest value uploads:**
1. OEM manuals for your top 10 most-faulting machines
2. Any equipment with proprietary or obscure fault codes not covered by the shared KB
3. Your plant's LOTO and safety procedures (MIRA will cite these in safety-related responses)
4. OEM PM guides with specific intervals and specifications

**Good uploads:**
5. Wiring diagrams (searchable as reference documents)
6. Previous vendor service reports (MIRA can reference prior findings)
7. Installation manuals (for newer equipment)

**Lower priority:**
8. General training materials
9. Vendor catalogs (useful but lower diagnostic value)
10. Older superseded manuals — see note below

> **⚠️ Document version management (known gap, GitHub issue #2170):** MIRA does not currently have a built-in way to mark a document as "superseded" when the OEM releases a newer version. If you upload an updated manual, both versions will be searchable. Until this is resolved, delete the old version (Knowledge → Manuals → select document → Delete) before uploading the replacement. This ensures MIRA cites the current version.

---

## 7.4 The shared knowledge base

The pre-loaded shared knowledge base covers:
- **VFDs and motor drives:** Yaskawa, ABB, Danfoss, SEW-Eurodrive, Allen-Bradley PowerFlex, Siemens, AutomationDirect
- **PLCs:** Allen-Bradley (Micro820, MicroLogix, CompactLogix), Siemens S7, Mitsubishi iQ-R
- **Industrial motors:** Generic fault diagnosis, insulation testing, bearing replacement
- **Conveyors:** Belt, chain, and roller — generic procedures
- **Pumps:** Centrifugal, positive displacement — generic fault patterns
- **And 90+ more vendor categories**

To see exactly what's in the shared KB: Knowledge → Manuals → toggle "Shared library" to see the full list by manufacturer.

---

## 7.5 Knowledge suggestions: capturing tribal knowledge

This is one of MIRA's most valuable long-term features.

When a technician resolves a fault and knows the fix isn't in any manual — or adds a useful note to a work order close-out — MIRA can extract that knowledge and propose it as a KB entry.

**How it works:**
1. Technician closes a work order with detailed notes ("Turned out the issue was the capacitor bank on the input side — not covered in the F030 troubleshooting section")
2. MIRA identifies this as a useful KB addition and creates a **Suggestion**
3. An Admin sees it in **Knowledge → Suggestions**
4. Admin reviews, edits if needed, and approves
5. The knowledge is added to your plant's knowledge base — searchable by all technicians

**Why this matters:** Every time a senior tech solves a problem and explains how, that knowledge is captured. When they retire, it stays. The new hire gets the benefit of 20 years of experience — from the first day.

> **Admin task:** Review the Suggestions queue once a week. It takes 5–10 minutes. The backlog can build up quickly on active plants, and stale suggestions lose context over time.

---

---

# Chapter 8 — QR Asset Tagging

> **⚠️ Status note:** The QR system is in active development. Core functionality (URL routing, chat scoping) is built and tested. The admin print page (PDF sticker sheet generation) and the fresh-device login flow fix (GitHub issue #2171) are shipping in the next release. Check [status.factorylm.com](https://status.factorylm.com) for the current release status, or contact support@factorylm.com to get early access.

---

## 8.1 What QR asset tags do

A QR sticker on a machine turns a 30-second "which machine are we talking about?" exchange into a 1-second scan.

Without QR: technician opens MIRA → goes to Conversations → types the machine name → types the symptom → MIRA asks "which VFD on Line 3?" →

With QR: technician opens phone camera → points at sticker → taps the link → MIRA opens showing "What's wrong with VFD-L3-07? I have it as a Yaskawa GS20, last serviced Feb 14, last fault F070 3 weeks ago." → technician describes symptom.

One second vs. 30–60 seconds. For a 10-technician plant doing 50 diagnostic conversations per week, that's 4–8 hours of technician time saved per week — before MIRA even starts answering questions.

---

## 8.2 Printing your stickers (admin)

1. Go to **Assets** in the sidebar
2. Open any asset → click **"Print QR"** button, or
3. For batch printing: Assets → select multiple assets (checkboxes) → "Print QR Stickers"
4. A PDF is generated — standard Avery 5520 layout, 30 stickers per sheet
5. Print the PDF on:
   - **Avery 5520 weatherproof vinyl** (any office supply store, ~$22/pack) — suitable for most indoor environments
   - **Laminated vinyl sheets** — for heavy industrial environments
   - **Anodized aluminum** — for outdoor or extremely harsh environments (see the table in section 8.3)
6. Peel and stick near each machine's nameplate

> **FactoryLM ships 50 free laminated vinyl stickers with every beta account.** Contact support@factorylm.com to request yours. These are ready to print and rated for 2–3 years in heavy industrial environments.

---

## 8.3 Choosing the right sticker material

| Environment | Material | Where to buy | Cost per label | Expected life |
|---|---|---|---|---|
| Indoor clean (food, pharma, electronics) | Avery 5520 weatherproof vinyl | Any office supply store | ~$0.20 | 1–2 years |
| Indoor heavy industrial (machining, welding, foundry) | Laminated vinyl (e.g., Brother TZe-S241) | Industrial supply or online | ~$0.35 | 2–3 years |
| Outdoor or harsh (pump stations, wastewater, outdoor conveyors) | Anodized aluminum labels | Metalcraft, Camcode, or similar | ~$2.00 | 5+ years |

**Placement tips:**
- Near the nameplate (technicians naturally look there first)
- At approximately eye level — scanning is easier without crouching
- Away from direct heat sources (above 60°C will degrade adhesive on standard vinyl)
- Away from heavy oil or chemical spray zones (use laminated or anodized material in these areas)

---

## 8.4 Verifying your stickers

After sticking, always verify each sticker scans correctly before marking it as done:

1. Open your phone camera
2. Point at the new sticker
3. Tap the link that appears
4. Confirm MIRA opens and shows the correct asset name

If the wrong asset appears: the sticker was mis-printed or mis-stuck. Remove it, reprint via the Assets page, and replace.

---

## 8.5 Everyday scanning — the technician's workflow

**Step 1:** Walk up to the faulting machine  
**Step 2:** Open phone camera, point at the QR sticker  
**Step 3:** Tap the link (appears at the top of the camera screen)  
**Step 4:** MIRA opens, pre-loaded with the asset's details  
**Step 5:** Describe your symptom — voice or text  
**Step 6:** MIRA diagnoses

No app to open. No account to find. No asset to search for. The sticker does all of that in one tap.

---

## 8.6 When a sticker is damaged or falls off

1. Log in to MIRA → go to **Assets**
2. Find the asset → open it → tap **"Print QR"**
3. Print and replace the sticker

The URL encoded in the QR sticker is permanent and tied to the asset's unique ID — not to the physical sticker. The replacement sticker points to exactly the same asset as the original.

---

---

# Chapter 9 — PM Schedules

## 9.1 Why PM scheduling is in MIRA

A CMMS without PM scheduling is a work-order system. A CMMS with PM scheduling is a maintenance management system. MIRA includes both.

PM schedule data also feeds into your diagnostic conversations — if an asset has a PM due in 3 days, MIRA will tell you:
> *"Note: VFD-L3-07 has a quarterly inspection due in 3 days. While I have you here, want me to include the inspection checklist in today's work?"*

---

## 9.2 Creating a PM task

1. Go to **Schedule** in the sidebar
2. Tap **"+ New PM Task"**
3. Fill in:
   - **Asset** (search or select from list)
   - **Task name** ("Quarterly belt inspection", "Annual motor alignment check")
   - **Frequency** (daily, weekly, monthly, quarterly, bi-annual, annual, or custom interval)
   - **Estimated duration** (in hours)
   - **Assigned technician** (optional — assign to a specific person or leave open)
   - **Checklist** (optional but recommended — list the specific steps)
   - **Parts typically needed** (optional — list consumables like filters, belts, grease)
4. Tap **"Create"**

MIRA schedules the first occurrence immediately and auto-generates future occurrences on the defined frequency.

---

## 9.3 Viewing your PM calendar

**Schedule view** shows a calendar (week or month) with all upcoming PMs. Filter by:
- Asset or location
- Technician
- Overdue / Due this week / Due this month

**Overdue PMs** appear in red. Any PM that's overdue and involves a Critical-rated asset will also appear in the **Alerts** section.

---

## 9.4 Completing a PM

When a technician completes a PM:
1. Open the PM task from the Schedule
2. Work through the checklist (tick each item)
3. Add any notes ("found loose terminal T2 — tightened to spec")
4. Tap **"Mark Complete"**

The completion is logged with date, technician, time taken, and notes. This feeds MIRA's service history for that asset.

If the technician finds a fault during a PM: tap **"Create Work Order"** directly from the PM completion screen — the asset and PM context carry over automatically.

---

---

# Chapter 10 — Team Management

## 10.1 Inviting your team

During beta, we're managing team members manually to ensure smooth onboarding.

**To add a technician to your workspace:**
Email [support@factorylm.com](mailto:support@factorylm.com) with:
- The team member's name and email address
- Their role: **Technician** (diagnose, create/view work orders) or **Admin** (manage namespace, uploads, team, settings) — see section 3.2 for the full capability matrix

We'll add them to your workspace within one business day. They'll receive a login email and can start using MIRA immediately.

> **Coming soon:** In-app team management (invite members directly from Settings → Team).

---

## 10.2 Changing a user's role

1. Go to **Team**
2. Find the user in the list
3. Tap their name → tap **"Edit role"**
4. Select the new role → tap **"Save"**

Role changes take effect immediately.

---

## 10.3 Deactivating a user (offboarding)

When someone leaves your team:
1. Go to **Team**
2. Find the user → tap their name → tap **"Deactivate"**

The deactivated user can no longer log in. Their conversation history, work orders, and KB contributions are preserved — these are plant records, not personal records.

> **Do this promptly.** A former employee with an active account is a security risk. Magic links don't expire unless clicked, but deactivating the account immediately prevents any new login links from working.

---

## 10.4 Conversation visibility and sharing

- **Technicians** can see their own conversations
- **Admins** can see all conversations across the plant (for oversight, compliance, and coaching)
- **Any user** can share a specific conversation by copying its URL and sending it to a teammate

This means a technician can start a diagnosis on the floor, share the link in a text message to their supervisor, and the supervisor can see the full context — all without re-explaining anything.
