# PART 3 — THE TELEGRAM BOT

---

# Chapter 11 — FactoryLM on Telegram

*A photo. Thirty seconds. A work order.*

---

## 11.1 What the Telegram bot does

The FactoryLM Telegram bot is the fastest path to getting equipment data into your CMMS.

**The flow:**
1. You see a piece of equipment that needs attention
2. You take a photo on Telegram and send it to the bot
3. The AI identifies the equipment, assesses its condition, and notes any visible issues
4. A work order is automatically created in your CMMS
5. You receive a reply with a direct link to the work order and the asset

Total time: under 30 seconds. No logging in. No forms. No typing asset names.

This is not a replacement for MIRA's full diagnostic chat — it's a capture tool. Great for:
- Field technicians logging issues as they find them, without stopping to write anything up
- Quick visual inspections across a facility
- Contractors who don't have full MIRA access but need to log equipment issues
- Getting unfamiliar equipment into your CMMS fast

---

## 11.2 Getting the bot

**Find the bot:**
Your plant admin will send you an invite link to your FactoryLM Telegram bot. Click the link on your phone and it opens directly in the Telegram app.

If you don't have Telegram: download it from the App Store (iOS) or Google Play (Android) — it's free.

Once you're in the bot chat: tap **Start** or type `/start`. The bot will greet you and show how many free scans you have remaining (3 for new users — see section 11.3).

---

## 11.3 Free trial — your first 3 scans

New users get **3 free photo analyses** before registration is required.

After each scan, the bot shows your remaining free photos:
> *"📊 Free scans remaining: 2 of 3. Type /register to unlock unlimited access."*

After 3 scans, the bot will prompt you to register:
> *"🔒 You've used your 3 free equipment scans! Create a free account to continue — unlimited photo analysis, work order management, and full CMMS access. Registration takes less than 2 minutes."*

Tap the **Register** button in the bot → you'll be taken to the FactoryLM registration page. Once registered, your scan history carries over and you have unlimited access.

---

## 11.4 Bot commands

| Command | What it does |
|---|---|
| `/start` | Welcome message and your current scan status |
| `/status` | Your account status (registered or trial), bot health, session statistics (how many photos processed, assets created, work orders created today) |
| `/assets` | List all assets in your CMMS — shows asset name and ID |
| `/recent` | Your 5 most recent work orders, with priority indicators (🔴 Critical, 🟠 High, 🟡 Medium, 🔵 Low) |
| `/register` | Get a registration link to unlock unlimited access |

---

## 11.5 Sending a photo: step by step

This is the main thing the bot does. Here's exactly what happens:

**Step 1:** Open Telegram → find the FactoryLM bot → tap the attachment icon (paperclip)

**Step 2:** Choose **Photo / Video** → select a photo from your library, or tap the camera to take one now

**Step 3:** Send. No caption needed — though you can add one if you want to give the bot extra context (e.g., "conveyor belt making grinding noise")

**Step 4:** Wait a few seconds. The bot sends status updates:
> *"📸 Photo received! Analyzing with AI vision..."*
> *"🤖 AI analyzing equipment..."*
> *"🏭 Checking CMMS for existing asset..."*
> *"📋 Creating work order..."*

**Step 5:** The bot replies with the full analysis:

---

**Example bot reply:**

> **Equipment Identified:**
> Variable Frequency Drive (VFD)
> Manufacturer: Yaskawa
> Model: GA500
> Condition: **FAIR**
>
> **Visible issues noted:**
> • Cooling fins show moderate dust/debris accumulation
> • Small oil stain on lower casing (possible nearby leak, not from drive itself)
>
> **Recommended action:** Schedule cleaning of cooling fins and investigate source of oil contamination. Monitor operating temperature.
>
> **Work Order Created:** #WO-2847 — Yaskawa GA500 — Inspect cooling and investigate oil contamination
> Priority: 🟡 Medium
>
> [📋 View Work Order](https://app.factorylm.com/cmms/work-orders/WO-2847)
> [🏭 View Asset](https://app.factorylm.com/assets/ga500-line3)

---

Tap **View Work Order** to open the full WO in MIRA. Tap **View Asset** to see the equipment's full history.

---

## 11.6 What makes a good photo

The AI does its best with any photo, but here's how to get the most accurate results:

**✅ Good photos:**
- Fill the frame with the equipment — not the whole machine room
- Include the nameplate (the metal plate showing manufacturer, model, serial number) if possible — this is how MIRA identifies the specific model
- Clean, dry lens (industrial environments collect grime fast — wipe before shooting)
- Even lighting — daylight or work light
- Photo taken from 1–2 metres away (not so close that details blur, not so far that labels are unreadable)

**❌ Less helpful photos:**
- The entire machine room from 10 metres away
- Extreme close-up of one connector (no nameplate visible)
- Blurry or motion-blurred
- Shot into bright backlight
- Phone screen shot of another photo

**Sending multiple photos:** Each photo is processed separately. Send them one at a time.

**Adding context in the caption:** You can type a caption with your photo to give the AI more context:
> *"Yaskawa GA500 on Line 3 — amber fault light, showing E-Stop alarm"*

This helps the bot with identification and condition assessment.

---

## 11.7 Condition ratings — what they mean

The AI assesses the equipment's visible condition in every photo:

| Rating | What it means | Typical response |
|---|---|---|
| **GOOD** | No visible issues | Logged as asset entry; no urgent WO created (informational) |
| **FAIR** | Minor issues visible (dust, surface corrosion, minor wear) | WO created at Medium priority |
| **POOR** | Significant issues visible (heavy contamination, visible damage, worn components) | WO created at High priority |
| **CRITICAL** | Immediate safety or operational risk visible | WO created at Critical priority; bot adds a safety note |

> **Note:** Condition ratings are based on visual appearance in the photo only. The AI cannot assess things it can't see (electrical faults, bearing wear, internal damage). Use the bot to capture what you see visually — use MIRA's diagnostic chat to go deeper.

---

## 11.8 How the bot handles equipment it hasn't seen before

When you send a photo of a piece of equipment that isn't in your CMMS yet, the bot:
1. Identifies the equipment type, manufacturer, and model from the photo
2. Checks your CMMS for a matching asset (by name — case-insensitive)
3. If no match: **creates a new asset** in your CMMS, then creates the work order linked to the new asset
4. Tells you: *"New asset created: Yaskawa GA500 VFD (Line 3)"*

This means your asset list can grow automatically just from technicians sending photos. Every piece of equipment they photograph becomes an asset in your system.

---

## 11.9 Checking your work from Telegram

After sending photos, you can check what was created without opening the web app:

**`/recent`** — shows your last 5 work orders:
```
📋 Recent Work Orders:
🔴 WO-2849 | CRITICAL | Pump Station B2 — Seal failure visible
🟠 WO-2848 | HIGH | Air Compressor #1 — Belt wear
🟡 WO-2847 | MEDIUM | Yaskawa GA500 — Cooling fins
🔵 WO-2846 | LOW | VFD Cabinet — General inspection
🔵 WO-2845 | LOW | Conveyor Belt #3 — Routine
```

**`/assets`** — shows all assets in your CMMS:
```
🏭 Your Assets (8):
• Air Compressor #1 (ID: AC-001)
• Conveyor Belt #3 (ID: CB-003)
• Yaskawa GA500 Line 3 (ID: VFD-L3-07)
...
```

For anything more detailed — updating WO status, adding notes, viewing service history — tap the links in any bot reply or open app.factorylm.com.

---

## 11.10 Rate limits

To prevent accidental spam, the bot limits how many photos can be sent per hour (configurable by your admin, default is 10/hour per user).

If you hit the limit:
> *"⏳ Rate limit reached. Try again in X minutes."*

This resets automatically. If you're doing a large inspection walk and need to send many photos quickly, contact your admin — the limit can be raised.

---

## 11.11 When the bot can't identify equipment

Sometimes the AI can't identify what's in the photo. This usually happens when:
- The nameplate isn't visible or readable
- The photo is of a small component rather than the whole unit
- The equipment is very old and model markings are worn off
- The photo is too blurry or dark

In this case, the bot will say:
> *"⚠️ I couldn't identify the specific equipment from this photo. Try sending a clearer photo that includes the nameplate, or use the MIRA web app to add this asset manually."*

**Fix options:**
1. Send a second photo focusing on the nameplate specifically
2. Open app.factorylm.com → Assets → "+ New Asset" and enter the details manually
3. Add a caption to the photo with the equipment details: *"SEW Eurodrive MDX60B VFD, Panel 7B"*

---

---

# PART 4 — INTEGRATIONS & CONNECTIONS

---

# Chapter 12 — Connecting Your Systems

---

## 12.1 Your included CMMS (Atlas) — nothing to do

Every FactoryLM subscription includes **Atlas CMMS** — a full-featured maintenance management system. It's provisioned automatically when your account activates.

When you log into MIRA, Atlas is already there:
- Work orders you create in MIRA appear in Atlas
- Assets you add in MIRA appear in Atlas
- PM schedules you build in MIRA run in Atlas

If you've never used a CMMS before, Atlas is where you start. It handles work orders, asset tracking, PM scheduling, and parts inventory — everything a maintenance department needs.

You do not need to configure Atlas. It's ready.

---

## 12.2 Connecting MaintainX

> **Current status:** Available on request. Self-serve connector setup is in development (GitHub issue #2165). Email support@factorylm.com to request connection — turnaround time is typically 1 business day.

**What you'll need:**
- A MaintainX account with admin access
- A MaintainX API key with read/write permissions on Work Orders, Assets, and Locations

**What syncs once connected:**
- Work orders created in MIRA appear in MaintainX
- Assets in MaintainX are visible in MIRA's asset picker
- Recent fault history from MaintainX feeds into MIRA's diagnostics

---

## 12.3 Connecting Limble CMMS

> **Current status:** Available on request — same process as MaintainX above.

Contact support@factorylm.com with your Limble account details and we'll configure the connection.

---

## 12.4 Connecting Fiix

> **Current status:** Available on request — same process above.

---

## 12.5 Connecting Telegram to your plant

The Telegram bot is configured once during account setup by the FactoryLM team. Your bot handle is unique to your plant.

**Inviting your team to the bot:**
1. Go to **Channels** in the MIRA sidebar
2. Under Telegram, tap **"Copy invite link"**
3. Send the link to your technicians via text, email, or however your team communicates
4. When they tap the link, it opens the bot directly in Telegram

**What the invite link does:** It opens the specific bot configured for your plant. All work orders and assets created by technicians via this bot are scoped to your plant's MIRA workspace.

---

## 12.6 Connecting Slack

1. Go to **Channels** in the MIRA sidebar
2. Under Slack, click **"Connect Slack"**
3. You'll be taken through Slack's OAuth flow — choose your workspace and the channel where you want MIRA alerts and summaries to appear
4. Click **"Allow"** → Slack is connected

**What MIRA posts to Slack:**
- New Critical and High priority work orders (with a link to the WO)
- Diagnostic conversation summaries (optional — can be configured in Channels settings)
- Daily or weekly plant status summaries (optional)

---

## 12.7 Data security and privacy

This is what your IT and OT security team will ask about. Here are the answers:

**MIRA is read-only on your equipment.**
MIRA never writes to a PLC, DCS, SCADA system, or any OT (operational technology) device. It reads tag data (via Ignition or similar, if connected), but reading is all it does. This is an architectural commitment, not a configuration option.

**CMMS writes require explicit approval.**
MIRA creates draft work orders. A human must tap "Confirm" before anything is written to your CMMS. The AI never autonomously modifies your maintenance records.

**Your data is isolated to your tenant.**
Your assets, work orders, uploaded manuals, and conversation history are never shared with other FactoryLM customers. Each plant is a completely separate tenant with isolated data storage.

**Every CMMS write is audit-logged.**
Who approved it, what they approved, when. This log is accessible to admins under Settings → Audit Log.

**Data in transit:** TLS (HTTPS) on all connections. Your CMMS API keys are never stored in plain text.

**Data at rest:** Encrypted at rest on our cloud provider (NeonDB for structured data).

**Where is data hosted?** Managed cloud infrastructure. Contact support@factorylm.com for the specific region and cloud provider if your security policy requires it.

**Compliance status:** Certification work is in progress. Contact support@factorylm.com for the current status of SOC 2, ISO 27001, or any other compliance frameworks relevant to your industry.

**Network requirements for your IT team:**
- MIRA requires outbound HTTPS (port 443) from user devices to `app.factorylm.com` and `api.factorylm.com`
- No inbound connections required from the internet to your plant network for basic MIRA usage
- If you use the Ignition connector, one outbound HTTPS connection from your Ignition gateway server to `api.factorylm.com`
- No VPN, no agents installed on plant-floor machines, no access inside the OT network required for web/Telegram usage

> **For a full network and security specification:** see GitHub issue #2166 (being tracked) or contact support@factorylm.com for the current IT requirements document.

---

---

# PART 5 — FOR MAINTENANCE MANAGERS

---

# Chapter 13 — Running Your Maintenance Program with MIRA

---

## 13.1 The 30-day rollout plan

You don't need to be fully set up before MIRA starts paying off. Here's the sequence that works:

### Week 1 — Get your top 10 in

**Day 1–2: Add your top 10 assets**
Start with the 10 machines that cause the most downtime or are the hardest to diagnose. Go to Assets → + New Asset. Snap nameplates to fill in details fast.

**Day 3–5: Upload manuals for those 10**
Go to Knowledge → Manuals → Upload. One PDF per machine. If you can't find a digital version, check the OEM's website or email their technical support — most will send a PDF free.

**Day 5–7: Run your first real diagnostic**
Pick a real fault that came in this week. Walk through the diagnosis with MIRA. Note where it helped, where it didn't. This is your baseline.

### Week 2 — QR and team

**Print stickers for your top 10**
Assets → select your top 10 → Print QR Stickers → print on weatherproof vinyl → stick near each nameplate.

**Add your technicians to your workspace**
Email support@factorylm.com with the names and emails of your technicians and their roles (Technician or Admin). We'll add them within one business day. They'll receive a login email and be ready to use MIRA.

**Run a 15-minute team walkthrough** (see section 13.2 for the script)

### Week 3 — Go live

All faults this week go through MIRA. Every diagnostic conversation, every work order draft, every close-out note. This is where the data starts building.

**Watch your Conversations feed** — check once or twice a day to see what your team is diagnosing. If MIRA gave a wrong answer, flag it. If a technician solved something creatively, check if it's worth adding to the KB.

### Week 4 — Review and adjust

**Run your first report** (Reports → Fault Trends)
- Which assets faulted most this week?
- How fast were WOs being closed?
- Is MIRA being used consistently, or just by a few people?

**Review the Suggestions queue**
Knowledge → Suggestions — anything your technicians submitted for KB addition.

**Adjust PM schedules** if the week surfaced any patterns (e.g., that compressor faulted twice — maybe the PM interval needs to be shorter).

---

## 13.2 Training your technicians (15-minute floor session)

You don't need a classroom. This is a 15-minute walkthrough with your team before a shift.

**What to cover:**

**Step 1 — Install MIRA on your phone (3 minutes)**
Have everyone open their phone and install the PWA (see Chapter 2.4). Android is a few taps. iPhone needs Safari specifically.

**Step 2 — Show a QR scan (2 minutes)**
Walk to the nearest machine that has a sticker. Scan it in front of the group. Show them how the chat opens pre-scoped to that machine.

**Step 3 — Demo a diagnostic conversation (5 minutes)**
Using a real fault you fixed recently, show what a conversation with MIRA looks like. Emphasise:
- Be specific about the machine and symptom
- MIRA will ask follow-up questions — answer them honestly
- Read the cited source — it's there for a reason
- The work order draft is for them to review, not auto-submit

**Step 4 — One rule: MIRA is the first call, not the last (2 minutes)**
The expectation is: any time they're about to radio you or call the OEM, try MIRA first. If MIRA doesn't know, call you. Not instead of — first.

**Step 5 — Questions (3 minutes)**
Common first questions:
- *"What if MIRA is wrong?"* → Your judgment overrides MIRA's suggestion always. Report the error so we can fix it.
- *"Do I still have to fill out paper WOs?"* → No. MIRA's WO is the record. Talk to your admin if your plant requires paper backup.
- *"What if there's no signal?"* → Take note of the fault, scan the QR code when you're back in signal range, log it then.

---

## 13.3 Reports: what to look at and when

**Weekly (Monday morning, 10 minutes):**
- **Open WO count:** How many open? How old is the oldest? Anything sitting Open for more than 7 days needs attention.
- **Top faulting assets:** What broke most often this week? One asset appearing repeatedly is a pattern worth investigating.
- **PM compliance:** What percentage of PMs due this week were completed? Below 80% — find out why.

**Monthly (first Monday, 30 minutes):**
- **MTTR by asset:** Mean time to resolve, per machine. Is it going down? Up? MIRA should be reducing this.
- **Fault pattern trends:** Are any assets faulting more frequently month-over-month? That's a leading indicator for failure.
- **Knowledge base health:** How many uploads this month? How many Suggestions approved? How many conversations included a cited source?

**Quarterly:**
- **Technician activity:** Who's using MIRA? Who isn't? Non-users often indicate training gaps or a specific barrier (phone issues, connectivity, resistance to change).
- **Total diagnostic conversations:** Has MIRA become a habit or a novelty? You want to see this number growing and stabilising.
- **ROI calculation** (see section 13.6)

---

## 13.4 Managing the knowledge base over time

**Every week:**
- Check **Knowledge → Suggestions** — review and approve anything your team submitted
- Budget 10 minutes. Don't let the queue build up — stale suggestions lose context

**When new equipment arrives:**
- Create the asset, upload the manual, print a QR sticker — before the first fault hits, not after
- "New machine went in Friday, fault Monday" — this is why you prep before it breaks

**When an OEM releases a manual update:**
- Delete the old version (Knowledge → Manuals → select → Delete)
- Upload the new version
- See GitHub issue #2170 for the tracked improvement to make this cleaner

**When a technician solves something novel:**
- Encourage them to add a close-out note in detail
- Check Suggestions after the WO is closed — MIRA may have extracted it automatically
- If not, you can manually add it: Knowledge → + Add Entry

---

## 13.5 Using MIRA for compliance and audits

Every action in MIRA creates an automatic record:
- Who opened a conversation, when, about which asset
- What diagnosis was given and what source was cited
- Who approved a work order draft, when
- What the close-out notes said

For ISO 55000, OSHA inspection, or insurance audit: everything is searchable and exportable from the CMMS section. You don't need to build a paper trail — it builds itself as your team uses MIRA.

If you need to demonstrate that LOTO was considered before any hands-on repair: MIRA's conversation logs show the safety guardrail prompts and technician acknowledgments.

---

## 13.6 Calculating your return

Here's a simple calculation you can run on your own data:

| Input | Your number |
|---|---|
| Average fault resolution time today (minutes) | ___ |
| Number of faults per week | ___ |
| Technician hourly rate (fully loaded, inc. benefits) | $___ |
| Estimated reduction in search/diagnostic time with MIRA | 40% (industry benchmark) |

**Calculation:**
```
Weekly time saved = Faults/week × Avg resolution time × 40% reduction
Weekly labour saved = Weekly time saved (hours) × Hourly rate
Monthly labour saved = Weekly labour saved × 4.33
```

**Example:**
```
50 faults/week × 45 minutes × 40% = 900 minutes = 15 hours saved/week
15 hours × $35/hr = $525/week
$525 × 4.33 = $2,273/month saved in diagnostic labour alone
```

FactoryLM pricing scales with your rollout:
- **Assessment** ($500 one-time): 2-week evaluation of MIRA for your plant
- **Pilot** ($2–5K/month, 3-month minimum): Validate on a production line before plant-wide deployment
- **Operating Layer** ($499/month per plant): Run MIRA as your digital maintenance backbone

Even at the Operating Layer ($499/month), your ROI is 4.5x in the first month from labour savings alone.

This doesn't count:
- Reduced downtime cost (typically $1,000–$50,000+ per hour depending on the line)
- Faster new-hire ramp-up (access to tribal knowledge from day one)
- Reduced OEM support call costs
- Improved PM compliance reducing catastrophic failures

---

---

# PART 6 — REFERENCE

---

# Chapter 14 — Troubleshooting

*Organised by symptom. If yours isn't here: support@factorylm.com — response within 24 hours during beta.*

---

## Login and signup

### I signed up but never got the welcome email
- Check your spam folder (search for "factorylm.com")
- Add hello@factorylm.com to your contacts/allowlist
- If it's been more than 10 minutes: email support@factorylm.com — we'll resend

### The magic-link login email never arrived
- Check your spam folder first
- The email comes from hello@factorylm.com — search for it
- **The link expires in 10 minutes.** If you found the email but waited too long, go back to the login page and request a new one
- If your inbox is slow (corporate mail servers can be): wait 2–3 minutes and check again

### I clicked the login link and it says "This link has expired"
The link is only valid for 10 minutes. Go to app.factorylm.com and request a new one. The new link arrives in 1–2 minutes.

### I'm on a shared device and someone else is logged in
Log out: tap your name in the bottom left of the sidebar → "Log out." Then log in with your own email.

### Activation checkout link expired
Stripe checkout sessions expire after 24 hours. Reply to any email from FactoryLM and ask for a new checkout link. We'll generate one within a few hours.

---

## Chat and diagnostics

### MIRA is giving generic answers that don't match my equipment

**Most likely cause:** No asset context in the conversation.

Three fixes, try in this order:
1. Start the conversation by naming the specific machine: *"On my Yaskawa GS20 VFD on Line 3..."*
2. Upload a nameplate photo (tap the camera icon in the chat input)
3. Set up QR asset tagging (Chapter 8) — then every scan automatically scopes the conversation

### MIRA cited a manual I never uploaded
MIRA ships with a shared knowledge base covering 100+ vendors. If the answer is accurate, this is working correctly. If you want MIRA to prefer your specific manual, upload it via Knowledge → Manuals → Upload. Your uploads are weighted higher than the shared KB.

### MIRA said something that seems wrong
**For technical errors (non-safety):** Tap the flag icon on the message → "Incorrect answer." Describe what's wrong and what the correct answer is if you know it. This is how the system improves.

**For safety errors:** Tap "Report → Safety concern" immediately, or email safety@factorylm.com with screenshots. Safety reports are reviewed within 2 hours.

### MIRA responses are very slow
- First message in a new conversation is slower (3–8 seconds while context loads)
- Subsequent messages should stream within ~1–2 seconds
- If consistently slow: check status.factorylm.com
- If status shows all green and it's still slow: email support@factorylm.com

### MIRA keeps asking me to clarify the same thing
This usually means your initial message didn't include enough context. Before answering the clarifying question, add context: *"Sorry — it's a Yaskawa GS20, 460V, 5HP, on Line 3's main conveyor belt drive."*

---

## QR scanning

### The QR sticker won't scan
- Wipe the sticker clean (dust, oil, and water all confuse the camera)
- Try different lighting — direct sunlight or very dim light are both problematic
- Hold the phone 6–12 inches from the sticker (not too close, not too far)
- Try a different phone camera app (built-in camera vs. third-party)
- If the sticker is physically damaged: reprint via Assets → [asset name] → Print QR

### The scan opens MIRA but shows the wrong asset
The sticker was either mis-printed or mis-stuck (two stickers close together and you scanned the wrong one). Confirm by reading the text on the sticker — it should show the asset name. If it's wrong: reprint the correct sticker via the Assets page and replace the wrong one.

### The scan redirects me to a login page and then to an empty chat
This is a known bug on first-time devices (GitHub issue #2171).
**Workaround:** After you log in, scan the QR sticker again. The second scan will correctly scope the chat to the asset.

This bug is being fixed before the QR system's general release.

---

## CMMS / Work orders

### MIRA can't see my work orders
1. Check Settings → Integrations → [your CMMS] → Status. Should show green "Connected."
2. If red or showing an error: your API key may have expired or been revoked. Generate a new key in your CMMS and re-enter it in MIRA.
3. If you use Atlas (the default): it's always connected. If you can't see WOs, contact support.

### MIRA created a duplicate work order
- Open the duplicate in your CMMS and delete it
- To prevent recurrence: when MIRA proposes a WO, look at the "Similar existing WOs" panel before confirming. If a matching WO already exists, tap "Link to existing" instead of "Create new."

### A work order I approved in MIRA isn't showing in my external CMMS
- Check Settings → Integrations for any sync errors
- Most CMMS connections sync within 30 seconds. Wait 1–2 minutes and refresh
- If still missing after 2 minutes: email support@factorylm.com with the WO number

---

## Knowledge base / Manual upload

### My PDF is taking more than 10 minutes to process
- Large PDFs (500+ pages) can take up to 20 minutes
- Scanned image PDFs (where you can't select the text) take longer — the OCR step adds time
- If it's been more than 30 minutes and the status still shows "Processing": email support@factorylm.com

### The uploaded manual isn't being cited in answers
- Wait until the upload status shows "Indexed" (not just "Uploaded")
- Try asking specifically: *"According to the GS20 manual I uploaded, what is the cause of F030?"*
- If MIRA still doesn't reference it after indexing is complete, email support

### I uploaded the wrong version of a manual
Delete the incorrect version: Knowledge → Manuals → click the document → "Delete." Then upload the correct version.

---

## Telegram bot

### The bot isn't responding to my photos
- Type `/status` to check if the bot is running
- If the bot responds to commands but not to photos: the rate limit may have been hit. Wait an hour and try again, or ask your admin to increase the limit.
- If the bot doesn't respond at all: the bot service may be down. Email support@factorylm.com.

### The bot says "I couldn't identify this equipment"
The photo didn't give the AI enough to work with. Try:
- A clearer shot that includes the nameplate
- Adding a caption with equipment details
- Multiple photos from different angles
- If still failing: add the asset manually in the MIRA web app

### I've used my 3 free scans and can't afford to register yet
Contact support@factorylm.com — we have options for teams in evaluation mode.

---

## Connectivity

### MIRA won't load on the plant floor (no WiFi in this area)
MIRA requires an internet connection for AI features. Options for low-connectivity environments:
- Use mobile data (4G/5G) if available in that area
- If your plant has guest WiFi: connect to that
- If there's no connectivity at all: note the fault details, return to a connected area, and log it there
- See GitHub issue #2167 for the tracked offline capability improvements

---

# Chapter 15 — Frequently Asked Questions

## For technicians on the floor

**Q: Do I need to be connected to WiFi to use MIRA?**
A: Yes, for AI diagnostic features. Mobile data (4G/5G) works fine. The PWA app caches the interface itself, but AI responses require a connection. See Chapter 14 (Connectivity section) for workarounds in dead zones.

**Q: Can I use MIRA on my personal phone?**
A: Yes. MIRA runs in your phone's browser. If your plant has a bring-your-own-device policy, you're set. If not, check with your supervisor.

**Q: Does MIRA keep my conversation history private?**
A: Your conversations are visible to you and to your plant's admins. They're not visible to other technicians unless you share the conversation link. They're never visible to other FactoryLM customers.

**Q: What if I disagree with what MIRA says?**
A: Your judgment wins. Always. MIRA is a tool — if it suggests something that doesn't match what you're seeing, trust your experience. Flag the answer so we can improve it.

**Q: Can I use voice instead of typing?**
A: Yes. Tap the microphone icon in the chat input. MIRA handles voice-to-text — describe what you're seeing while you're looking at it.

---

## For maintenance supervisors

**Q: How do I know if my team is actually using MIRA?**
A: Go to Reports → Activity. You'll see conversation count per technician, per week. You can also see all conversations in the Conversations view, filterable by technician.

**Q: Can I see what MIRA told my technicians?**
A: Yes. Admins can view any conversation. Go to Conversations, filter by technician or asset.

**Q: What if a technician says MIRA gave them bad advice?**
A: Take the report seriously. Review the conversation, identify what was wrong, and use the flag feature to report it. Then check if the bad advice was acted on — and correct any resulting mistakes. Email safety@factorylm.com if there's any safety concern.

**Q: Can I set MIRA to always notify me when a Critical WO is created?**
A: Yes. Settings → Notifications → Work Orders → "Notify me for Critical and High priority WOs." You can receive these by email and/or Slack.

---

## For maintenance managers and decision-makers

**Q: How long does it take to get value from MIRA?**
A: The first useful diagnosis can happen on day one, with the shared knowledge base and no manual uploads. Full value — grounded in your specific manuals and fault history — builds over the first 30–60 days.

**Q: Do my technicians need training?**
A: 15 minutes on the floor is enough to get them started (see Chapter 13.2). MIRA is designed to be intuitive — if they can text someone, they can use MIRA.

**Q: How do I get started with MIRA?**
A: Go to [factorylm.com](https://factorylm.com) and click **"Start my beta."** Fill in your email, name, and plant name. The sales team will reach out within 24 hours to discuss which tier fits your plant (Assessment, Pilot, or Operating Layer) and get you set up.

**Q: What's the difference between Assessment, Pilot, and Operating Layer?**
A: **Assessment** ($500, 2 weeks) is for evaluating MIRA on a trial basis. **Pilot** ($2–5K/month, 3-month minimum) is for validating MIRA on one production line before rolling out plant-wide. **Operating Layer** ($499/month per plant) is the full platform for ongoing production use with unlimited assets and technicians. Contact sales@factorylm.com to discuss which is right for your plant.

**Q: We have 3 plants. How does that work?**
A: Currently, each plant is a separate account (separate tenant). Contact support@factorylm.com to discuss multi-site arrangements — this is on the roadmap. See GitHub issue #2168.

**Q: What happens to our data if we cancel?**
A: Contact support@factorylm.com for the full data retention and export policy. See GitHub issue #2160 for the tracked documentation task. In summary: we will give you a data export window and do not delete records immediately on cancellation.

**Q: Is MIRA compliant with [specific regulation]?**
A: Compliance certification is in progress. Contact support@factorylm.com with your specific compliance requirements (SOC 2, ISO 27001, HIPAA, ITAR, etc.) and we'll tell you where we stand and what's on the roadmap.

---

## For IT and security teams

**Q: What outbound network connections does MIRA require?**
A: User devices need outbound HTTPS (port 443) to `app.factorylm.com` and `api.factorylm.com`. If using the Ignition connector, one outbound HTTPS connection from the Ignition gateway server to `api.factorylm.com`. No inbound connections to your network are required.

**Q: Does MIRA access our OT network?**
A: No, for basic MIRA usage (web + Telegram). For the Ignition connector, the connection is outbound-only from your Ignition server — MIRA never initiates inbound connections into your OT network.

**Q: Does MIRA write to our PLCs or SCADA?**
A: Never. MIRA is architecturally read-only on OT systems. This is a foundational design constraint, not a configuration option.

**Q: Where is customer data stored?**
A: NeonDB (managed PostgreSQL) for structured data. Contact support@factorylm.com for specific cloud region and provider details.

**Q: Can we do a security review before deployment?**
A: Yes. Contact support@factorylm.com to request a security questionnaire response, architecture diagram, and any penetration test reports available.

**Q: Is the connection between user devices and MIRA encrypted?**
A: All connections use TLS (HTTPS). Data at rest is encrypted on our cloud provider.

---

# Chapter 16 — Quick Reference Cards

*Print these. Laminate them. Post them near the equipment or in the maintenance office.*

---

## Quick Reference Card A — Technician Daily Use

```
╔══════════════════════════════════════════════╗
║        MIRA — Technician Quick Reference     ║
╠══════════════════════════════════════════════╣
║  HOW TO START A DIAGNOSIS                    ║
║  1. Scan QR sticker on the machine           ║
║     → MIRA opens knowing which machine       ║
║  2. OR: Open app.factorylm.com in browser    ║
║     → Conversations → New conversation       ║
║  3. Describe: MACHINE, SYMPTOM, WHAT YOU SAW ║
╠══════════════════════════════════════════════╣
║  TELEGRAM BOT COMMANDS                       ║
║  /status  → Check your account status       ║
║  /recent  → Last 5 work orders              ║
║  /assets  → List all equipment              ║
║  /register → Register for unlimited access  ║
╠══════════════════════════════════════════════╣
║  GOOD SYMPTOM DESCRIPTION:                   ║
║  "My [MACHINE] at [LOCATION] is              ║
║   showing [FAULT CODE/SYMPTOM].              ║
║   It [when/how it trips].                    ║
║   I've already [what you tried]."            ║
╠══════════════════════════════════════════════╣
║  SAFETY: MIRA will always flag LOTO,         ║
║  arc flash, and confined space.              ║
║  Follow YOUR plant's safety procedures.      ║
║  MIRA doesn't replace your judgment.         ║
╠══════════════════════════════════════════════╣
║  SUPPORT: support@factorylm.com              ║
║  SAFETY: safety@factorylm.com                ║
╚══════════════════════════════════════════════╝
```

---

## Quick Reference Card B — Admin Setup Checklist

```
╔══════════════════════════════════════════════╗
║        MIRA — Admin Setup Checklist          ║
╠══════════════════════════════════════════════╣
║  WEEK 1                                      ║
║  □ Add top 10 assets (Assets → + New)        ║
║  □ Upload OEM manuals for those 10           ║
║    (Knowledge → Manuals → Upload)            ║
║  □ Run first diagnostic to test setup        ║
╠══════════════════════════════════════════════╣
║  WEEK 2                                      ║
║  □ Print QR stickers for top 10 assets       ║
║    (Assets → select → Print QR Stickers)     ║
║  □ Invite your technicians (Team → Invite)   ║
║  □ Run 15-min team walkthrough               ║
╠══════════════════════════════════════════════╣
║  ONGOING — WEEKLY                            ║
║  □ Review Suggestions queue                  ║
║    (Knowledge → Suggestions)                 ║
║  □ Check open WO queue for stale items       ║
║  □ Review Alerts for overdue PMs             ║
╠══════════════════════════════════════════════╣
║  SUPPORT: support@factorylm.com              ║
║  BILLING: support@factorylm.com              ║
╚══════════════════════════════════════════════╝
```

---

## Quick Reference Card C — Good vs. Bad Symptom Descriptions

```
╔══════════════════════════════════════════════╗
║     GETTING THE BEST ANSWERS FROM MIRA       ║
╠══════════════════════════════════════════════╣
║  ✅ GOOD:                                    ║
║  "Yaskawa GS20 VFD on Line 3 showing F030.  ║
║   Trips 3 sec after startup. Motor hums     ║
║   briefly before trip. No recent changes.   ║
║   Already checked output terminals."        ║
╠══════════════════════════════════════════════╣
║  ❌ LESS HELPFUL:                            ║
║  "The drive keeps stopping."                 ║
╠══════════════════════════════════════════════╣
║  ALWAYS INCLUDE:                             ║
║  □ Machine name and model                   ║
║  □ Location                                 ║
║  □ Fault code (if there is one)             ║
║  □ When/how it fails                        ║
║  □ What you already tried                   ║
╚══════════════════════════════════════════════╝
```

---

---

# Appendix A — Glossary

**Asset:** Any piece of equipment tracked in MIRA — a VFD, a pump, a PLC, a conveyor. Each asset has its own history, documents, and QR sticker.

**Atlas CMMS:** The work-order management system included with every FactoryLM subscription. Provisioned automatically at activation.

**Chunk:** A section of a manual or document that MIRA indexes and searches. A typical 300-page PDF is split into ~1,000 chunks. When MIRA cites "page 89," it found the relevant chunk and gives you the source.

**CMMS:** Computerised Maintenance Management System. Software that manages work orders, assets, PM schedules, and maintenance history.

**GSDEngine:** MIRA's internal diagnostic engine — the component that routes your question through the knowledge base, retrieves relevant document chunks, and generates a grounded answer.

**Knowledge base:** The collection of indexed documents MIRA searches to answer diagnostic questions. Includes both the shared knowledge base (pre-loaded OEM content) and your plant's uploaded manuals.

**LOTO:** Lockout/Tagout. The safety procedure for isolating energy sources before maintenance work. MIRA always prompts for LOTO compliance before hands-on advice involving electrical or stored-energy risks.

**Magic link:** MIRA's login method. Enter your email → a one-time login link arrives → click it to log in. No password required. Link expires in 10 minutes.

**MIRA:** Maintenance Intelligence & Response Assistant. The FactoryLM AI diagnostic product.

**MTTR:** Mean Time To Repair. The average time from fault detection to fault resolution. Reducing MTTR is MIRA's primary goal.

**Namespace:** The organisational hierarchy of your equipment (Site → Line → Cell → Machine → Component).

**OEM:** Original Equipment Manufacturer — the company that built the equipment (Yaskawa, Allen-Bradley, Siemens, etc.).

**PM:** Preventive Maintenance. Scheduled maintenance work performed before a failure occurs, based on time intervals or usage.

**PWA:** Progressive Web App. A website that can be installed on your phone's home screen and runs like a native app. MIRA's web app is a PWA.

**QR sticker:** A printed label with a QR code that links to a specific asset in MIRA. Scan the sticker → MIRA opens pre-scoped to that machine.

**RAG:** Retrieval-Augmented Generation. The technique MIRA uses to answer questions: retrieve relevant document chunks, then generate an answer grounded in those chunks. This is why MIRA can cite the exact page and section of your manual.

**Tenant:** Your plant's isolated data workspace in MIRA. Each FactoryLM customer is a separate tenant with completely isolated data.

**UNS:** Unified Namespace. The structured naming convention MIRA uses to organise equipment (Site/Line/Cell/Machine/Component). ISA-95 compliant.

**Work order (WO):** A formal task record documenting a maintenance job — what needs to be done, who does it, when it's completed, and what was found.

---

# Appendix B — CMMS Platform Support

| Platform | Status | Notes |
|---|---|---|
| **Atlas CMMS** | ✅ Live — included | Provisioned automatically at activation |
| **MaintainX** | 🟡 Beta — on request | Email support@factorylm.com |
| **Limble CMMS** | 🟡 Beta — on request | Email support@factorylm.com |
| **Fiix** | 🟡 Beta — on request | Email support@factorylm.com |
| **UpKeep** | 🔲 Roadmap | Contact us if needed |
| **eMaint** | 🔲 Roadmap | Contact us if needed |
| **IBM Maximo** | 🔲 Roadmap | Contact us for enterprise timeline |
| **SAP PM** | 🔲 Roadmap | Contact us for enterprise timeline |

---

# Appendix C — Telegram Bot Command Reference

| Command | Full description |
|---|---|
| `/start` | Welcome message. Shows your account status (free trial with X scans remaining, or registered). Lists available commands. |
| `/status` | Detailed status: account type (trial/registered), bot service health, Gemini AI status, CMMS connection status, session statistics (photos processed today, assets created today, work orders created today, bot uptime). |
| `/assets` | Lists all assets in your CMMS — name and internal ID for each. Paginated if you have more than 20. |
| `/recent` | Lists your 5 most recent work orders in reverse chronological order. Shows WO number, priority emoji (🔴🟠🟡🔵), and title. Includes a link to view each WO. |
| `/register` | If you're on the free trial: provides a registration link and button. If you're already registered: confirms your status and provides a link to your MIRA dashboard. |

---

# Appendix D — Safety Guardrail Reference

MIRA has 21 built-in safety triggers. When a message or recommendation touches one of these areas, MIRA includes a mandatory safety callout before proceeding.

| Category | Examples of trigger phrases | MIRA response |
|---|---|---|
| LOTO / Electrical isolation | "open the panel," "check the terminals," "measure the phases" | Lockout/tagout reminder + energy verification step |
| Arc flash | "switchgear," "MCC," "bus bar," "panel energised" | Arc flash PPE reminder + reference to plant arc flash study |
| Confined space | "inside the tank," "vessel entry," "pit," "sump" | Confined space permit reminder + atmospheric testing |
| Chemical hazard | "cleaning solvent," "hydraulic fluid," "battery acid" | SDS reminder + PPE requirements |
| Working at height | "on top of the machine," "elevated conveyor" | Fall protection reminder |
| Stored energy | "capacitor," "spring-loaded," "hydraulic accumulator," "pneumatic reservoir" | Stored energy isolation and bleed-down steps |
| Hot surfaces | "kiln," "furnace," "heat exchanger" | Burn risk and cooling-down time |
| Rotating equipment (energised) | "spinning," "while running," "with power on" | Hard stop — do not approach rotating equipment without isolation |
| Unknown voltage | "transformer," "unknown circuit" | Voltage verification before contact |
| Radiological / X-ray (rare) | "X-ray," "radiation source," "nuclear gauge" | Radiation safety officer referral |

When MIRA hits a safety trigger, it does not stop the diagnostic conversation — but it will not provide hands-on procedural advice until the safety context is acknowledged.

---

# Appendix E — Known Issues and Tracked Gaps

Issues filed during the writing of this manual. Track progress in the MIRA GitHub repo.

| Issue | GitHub # | Status |
|---|---|---|
| QR system: in development, manual notes coming-soon status | #2158 | Open |
| Branding: FactoryLM vs. MIRA naming consistency | #2159 | Open |
| Data retention and cancellation policy — no documented answer | #2160 | Open |
| Ignition integration needs product docs and manual chapter | #2161 | Open |
| Magic-link expiry (10 min) not prominent in login UX or docs | #2164 | Open |
| MaintainX/Limble/Fiix described as self-serve but requires email | #2165 | Open |
| IT/security network requirements document missing | #2166 | Open |
| No offline/low-connectivity guidance | #2167 | Open |
| No multi-site/multi-tenant guidance | #2168 | Open |
| No guidance when MIRA gives wrong/unsafe answer | #2169 | Open |
| No document version management (superseded manuals) | #2170 | Open |
| QR scan on fresh device loses asset context after login | #2171 | Open |
| Parts inventory — live or stub? No documentation | #2173 | Open |
| Alerts section — undocumented, unclear capabilities | #2174 | Open |
| Telegram bot registration URL uses bare IP (factorylm repo) | #164 | Open |

---

*End of Manual — Version 1.0 Draft*

*FactoryLM & MIRA User Manual*
*© 2026 Cranesync. All rights reserved.*
*support@factorylm.com | safety@factorylm.com | status.factorylm.com*
