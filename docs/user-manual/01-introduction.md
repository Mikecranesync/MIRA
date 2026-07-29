# FactoryLM & MIRA — Complete User Manual

**Version:** 1.0 (Draft)
**Product version:** MIRA v3.21 / FactoryLM
**Support:** support@factorylm.com
**Emergency (safety):** safety@factorylm.com — response within 2 hours
**Status page:** status.factorylm.com

---

> *"Factory technicians spend 40% of their time diagnosing problems. What if they could just ask their factory what's wrong?"*
> — Mike Harper, Founder. Maintenance technician, 20+ years.

---

## How to use this manual

| If you are… | Start here |
|---|---|
| A maintenance technician (daily user on the floor) | Chapter 2 (Getting Started) → Chapter 5 (Running a Diagnosis) → Chapter 11 (Telegram Bot) |
| A maintenance manager or supervisor | Chapter 1 (Introduction) → Chapter 2 → Chapter 13 (Running Your Program) |
| An admin setting up MIRA for your plant | Chapter 2 → Chapter 4 (Assets) → Chapter 7 (Knowledge Base) → Chapter 8 (QR Tags) → Chapter 10 (Team) |
| Someone evaluating FactoryLM | Chapter 1 (the whole thing) → Chapter 5 demo walkthrough → Chapter 13 ROI section |
| An IT or security team member | Chapter 12.7 (Data Security) → Chapter 15 (IT/Security FAQ) |

**Quick start (5 minutes):** Go to [factorylm.com](https://factorylm.com), click **Start my beta**, enter your email and plant name. That's it. You're in the system.

---

# PART 1 — INTRODUCTION

---

# Chapter 1 — The Problem We're Solving

## 1.1 The 45-minute fault

It's 2 AM. A conveyor on Line 3 trips. The production supervisor calls you.

You walk out to the machine. There's an amber fault light and a code on the VFD display: **F030**. You know this drive — it's a Yaskawa GS20, been running two years, solid unit. But F030? You're not sure.

You have three options.

**Option 1: Find the manual.**
The cabinet has a binder. You flip to the fault code section — if it's even indexed. "F030: Output Phase Loss." Okay. But what does that mean here? Is it the wiring? The motor? The drive itself? The manual gives you the definition, not the diagnosis.

**Option 2: Call someone.**
Your senior tech retired eight months ago. The guy who replaced him hasn't seen this fault before. Your OEM's support line opens at 7 AM.

**Option 3: Start checking things yourself.**
You check the output terminals. Measure the phases. Everything looks fine. You reset the drive. It runs for 30 seconds and trips again. You've been here 45 minutes.

---

This is not an unusual story. It is the *normal* story.

The average industrial fault takes **45 to 90 minutes to resolve**. Studies from maintenance consultancies consistently find that 40–60% of that time is not spent fixing anything — it's spent *searching for information*: the right page in the right manual, the prior fault log, the last person who dealt with this machine.

The wrench is idle. The line is down. The clock is running.

---

## 1.2 Why the old solutions don't work

**Manuals** give you definitions. They don't give you context — your machine's history, the specific fault pattern, what worked last time.

**Tribal knowledge** walks out the door with every retirement. The average maintenance department loses decades of diagnostic expertise every few years, with no systematic way to capture it.

**OEM support lines** are useful for warranty issues. They're not built for 2 AM troubleshooting at $300/hour downtime cost.

**Generic AI (ChatGPT, Claude, Gemini)** doesn't know your equipment. It can't look up your specific machine's last 10 fault codes. It has no idea what your plant's procedures say. It will give you a confident-sounding answer that may or may not apply to your Yaskawa GS20 on Line 3 at your facility.

---

## 1.3 What FactoryLM built

FactoryLM is a company founded by a maintenance technician — not a software company. Mike Harper spent 20 years on the floor fixing industrial equipment before building the tool he wished had existed.

**MIRA** (Maintenance Intelligence & Response Assistant) is that tool.

MIRA is the senior technician who:
- Has read every manual for every machine in your plant
- Remembers every fault that's ever been logged on your equipment
- Knows that the GS20 on Line 3 had two overload faults in the last 60 days
- Can pull up the exact page from your OEM manual that addresses F030
- Will ask the right clarifying questions ("Does it trip immediately or after running for a few seconds?")
- Will draft your work order when you're done

MIRA is available at 2 AM on a Sunday. It runs on your phone. It takes about 30 seconds to get an answer.

---

## 1.4 What MIRA is — and what it isn't

This is important. MIRA is a powerful tool. It is not magic, and it doesn't replace your judgment.

| **MIRA IS** | **MIRA IS NOT** |
|---|---|
| An AI diagnostic assistant grounded in your specific equipment | A replacement for your CMMS |
| Trained on your actual manuals and your plant's fault history | A predictive maintenance system |
| Integrated with your work order system | An MES, SCADA, or PLC control system |
| Available on any phone, via browser or Telegram | A substitute for professional engineering judgment |
| Read-only on your equipment data — it never writes to a PLC | A guarantee that every answer is correct |
| Multi-channel: web, Telegram, Slack | A fully offline system (cloud connection required for AI features) |

**The most important thing:** MIRA gives you better information, faster. The decision to act on that information — and how — is always yours. MIRA will never tell you to skip a lockout. It will never advise working on live equipment without safety acknowledgment. It is built with 21 safety guardrails that force a stop-and-reassess response before any hands-on advice involving arc flash, LOTO, confined space, or chemical hazards.

> **MIRA provides diagnostic assistance. Always apply your professional judgment and follow your plant's safety procedures.**

---

## 1.5 The two ways to use FactoryLM

**FactoryLM** is the company. **MIRA** is the product. They're connected — same data, same work orders, same knowledge base. Two entry points:

### Entry Point 1: The MIRA web app (app.factorylm.com)
The full platform. Your daily driver as a maintenance manager or technician. Assets, work orders, PM schedules, knowledge base, team management, reports. Runs in your phone's browser; install it as an app in one tap.

Best for:
- Daily diagnostic conversations
- Managing work orders
- Uploading and searching manuals
- Running PM schedules
- Team coordination and reporting

### Entry Point 2: The FactoryLM Telegram bot
The zero-friction entry point. Takes 30 seconds. Send a photo of a piece of equipment to a Telegram chat. The AI identifies the equipment, assesses its condition, and creates a work order in your CMMS automatically.

Best for:
- Quick fault logging when you don't have time to open a browser
- Field technicians who are already on Telegram
- First-time users who want to see MIRA work before setting up the full platform

**These two entry points talk to the same system.** A work order created via the Telegram bot shows up in the MIRA web app. A technician using Telegram and a supervisor using the web app are looking at the same data.

---

---

# Chapter 2 — Getting Started

*From zero to your first diagnosis in under 10 minutes.*

---

## 2.1 Signing up

Go to **[factorylm.com](https://factorylm.com)** and click **"Start my beta."**

You'll enter three things:
1. Your email address
2. Your name
3. Your plant or company name

That's it. Click submit.

**What happens next:**
- MIRA creates your workspace in **pending** status
- You receive a welcome email from hello@factorylm.com within a few minutes
- The sales team reaches out to discuss which tier (Assessment, Pilot, or Operating Layer) is right for your plant
- Once pricing is agreed, your workspace activates with Atlas CMMS, the OEM knowledge base, and your team members

> **Didn't get the welcome email?** Check your spam folder and search for `factorylm.com`. Add hello@factorylm.com to your contacts. If it's been more than 10 minutes and nothing arrived, email support@factorylm.com.

---

## 2.2 Pricing and account activation

FactoryLM offers three tiers designed to fit plants of any size.

**Assessment ($500 one-time)**
Best for: evaluating MIRA for your plant before committing
- 2-week access to full MIRA platform
- One training session with the FactoryLM team
- Up to 3 assets included
- Report on fault patterns and improvement opportunities

**Pilot ($2–5K/month, 3-month minimum)**
Best for: validating MIRA on a production line before rolling out plant-wide
- Full MIRA platform (Command Center, diagnostics, work-order tracking)
- Up to 10 assets included
- Custom on-site setup and training
- Weekly check-ins with FactoryLM support

**Operating Layer ($499/month per plant)**
Best for: running MIRA as your digital maintenance backbone
- Unlimited assets and technicians
- Full command center, integrations, and reporting
- Priority support (2-hour response time for production issues)
- Quarterly reviews and recommendations

**To get started:**
Email [sales@factorylm.com](mailto:sales@factorylm.com) with your plant name, number of lines, and which tier interests you. The FactoryLM team will set up your workspace and get you started within 24 hours.

> **Questions about pricing?** Contact [sales@factorylm.com](mailto:sales@factorylm.com) — we're happy to discuss what works best for your plant.

---

## 2.3 Logging in

MIRA offers three login options. Choose whichever is most convenient for your workflow.

**Option 1: Magic link (default)**
1. Go to [app.factorylm.com](https://app.factorylm.com)
2. Enter your email address
3. Click **"Send login link"**
4. Check your email — a login link arrives within 1–2 minutes
5. Click the link — you're in

> ⚠️ **Important:** Magic-link emails expire in **10 minutes**. If you don't click it in time, go back to the login page and request a new one. This is the most common source of confusion — especially if you request the link on your computer and try to click it 15 minutes later after walking back from the floor.

**Option 2: Google sign-in**
1. Go to [app.factorylm.com](https://app.factorylm.com)
2. Click **"Continue with Google"**
3. Authorize with your Google account
4. You're in

**Option 3: Password sign-in**
1. Go to [app.factorylm.com](https://app.factorylm.com)
2. Click **"Sign in with password"** (toggle at the bottom of the login box)
3. Enter your email and password
4. You're in

All three options are equally secure and can be mixed — you can use any of these methods on different devices.

---

## 2.4 Install MIRA on your phone (highly recommended)

MIRA is a **Progressive Web App (PWA)** — it runs in your phone's browser but can be installed like a native app. Once installed, MIRA gets its own home screen icon, runs full-screen, and opens in one tap.

### On iPhone (Safari):
1. Open [app.factorylm.com](https://app.factorylm.com) in **Safari** (must be Safari, not Chrome)
2. Tap the **Share** button (the box with an arrow pointing up, bottom center of the screen)
3. Scroll down and tap **"Add to Home Screen"**
4. Tap **"Add"** in the top right
5. MIRA appears on your home screen

### On Android (Chrome):
1. Open [app.factorylm.com](https://app.factorylm.com) in **Chrome**
2. Tap the **three-dot menu** (top right)
3. Tap **"Install app"** or **"Add to Home Screen"**
4. Tap **"Install"**
5. MIRA appears on your home screen

> **Why install it?** Once installed, MIRA launches faster, fills the full screen, and works more reliably on plant-floor networks. It also makes it one tap away from any technician's home screen — which matters at 2 AM.

---

## 2.5 Your first 5 minutes — the onboarding wizard

When you log in for the first time, MIRA launches an **onboarding wizard** that walks you through setup step by step. The wizard covers:

1. **Name your plant** — the site name appears in all reports and on QR sticker sheets
2. **Add your first asset** — enter an equipment name (e.g., "Line 3 VFD - Yaskawa GS20") and location. You can snap a nameplate photo to fill in the details automatically.
3. **Run your first diagnosis** — the wizard walks you through a practice diagnostic conversation so you know what to expect
4. **Invite a teammate** — optional, but doing it now means your team can start from day one

You can skip any step and come back to it. The wizard saves your progress automatically.

---

## 2.6 Your first diagnostic conversation (the quick version)

If you want to jump straight into MIRA without the wizard, here's the fastest path:

1. Open MIRA → tap **Conversations** in the sidebar
2. Tap **"New conversation"**
3. Type (or tap the microphone and speak):

   *"My Yaskawa GS20 VFD on Line 3 is showing fault code F030. It trips about 3 seconds after startup."*

4. MIRA will ask a clarifying question or two, then walk you through the diagnosis
5. The answer will cite the specific manual page and section

That's it. You've just run your first AI-powered maintenance diagnosis.

---

## 2.7 Inviting your team

During beta, we're managing team members manually to ensure smooth onboarding.

**To add a technician to your workspace:**
Email [support@factorylm.com](mailto:support@factorylm.com) with:
- The team member's name and email address
- Their role: **Technician** (read/diagnose/create work orders) or **Admin** (manage namespace, uploads, settings) — see Chapter 10 for the difference

We'll add them to your workspace within one business day. They'll receive a login email and can start diagnosing immediately.

> **Coming soon:** In-app team management (invite members directly from Settings → Team).

---

## What's next?

Now that you're in, here's what to do depending on your role:

**If you're a technician:**
- → Chapter 5 (Running a Diagnosis) — learn every way to start a diagnostic conversation
- → Chapter 8 (QR Asset Tagging) — the fastest way to scope MIRA to the machine you're standing in front of

**If you're a maintenance manager or admin:**
- → Chapter 4 (Your Equipment / Assets) — build your asset list
- → Chapter 7 (Knowledge Base) — upload your OEM manuals
- → Chapter 13 (Running Your Maintenance Program) — the 30-day rollout plan

**If you just want to try the Telegram bot:**
- → Chapter 11 (FactoryLM on Telegram) — send a photo, get a work order
