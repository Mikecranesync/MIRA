# What is MIRA?

**MIRA — Maintenance Intelligence & Response Assistant** — is an AI-powered diagnostic assistant built for industrial maintenance technicians.

## The problem we solve

A technician on a plant floor encounters a fault. Today, they have three bad options:

1. **Thumb through the manual.** Hundreds of pages per machine. The fault code index is three clicks deep. Ten minutes to find the right page, if the manual is even on hand.
2. **Ask a senior colleague.** If they're available. If they remember this specific fault. If they pick up the radio.
3. **Call the OEM's support line.** Wait 20 minutes for a tier-1 tech who reads from a script.

The average industrial fault resolution takes 45–90 minutes of technician time. Most of that time is **searching for information**, not fixing things.

## What MIRA does

MIRA replaces the "search for information" step with a conversation:

- **Asset-aware from the start.** Scan a QR on the machine; MIRA already knows it's a Yaskawa GS20, 5 HP, last serviced February 14th, with three prior faults in the last 60 days.
- **Grounded in your manuals.** MIRA's knowledge base is 25,000+ chunks of OEM manuals, fault code lookups, and plant-specific tribal knowledge. Answers cite the page and source.
- **Conversational, not Q&A.** MIRA asks clarifying questions ("Does it trip at startup or during acceleration?") the way a senior tech would.
- **Multi-channel.** Web browser, Telegram, Slack, Teams, WhatsApp — use whichever your team already uses.
- **CMMS-integrated.** When the fault is resolved, MIRA drafts the work-order closeout and posts to Atlas, MaintainX, Limble, or Fiix. No forms, no end-of-shift documentation debt.

## What makes MIRA different from ChatGPT / Claude / Gemini

General-purpose chatbots don't know:
- What equipment you have
- What your CMMS says
- What fixed the same fault last Tuesday
- Your plant's safety procedures
- Which manual page answers this specific question

MIRA does — because MIRA was built for maintenance from the ground up. Every piece of the architecture (asset scoping, manual ingestion, CMMS write-back, safety guardrails, multi-vendor support) exists to make the plant-floor use case fast and trustworthy.

## Who MIRA is for

- **Maintenance technicians** — the daily users, on phones in the field
- **Maintenance supervisors** — who want visibility into fault patterns and tech efficiency
- **Maintenance / Reliability managers** — who need better CMMS data and want to reduce MTTR
- **Plant managers** — who don't want to think about any of the above, but notice when downtime drops

## What MIRA is not

- Not a CMMS replacement. MIRA **feeds** your CMMS; it doesn't replace it.
- Not a predictive maintenance system. MIRA reacts to faults; predictive scheduling is a separate product category.
- Not an MES or SCADA. MIRA integrates with those systems (via MIRA Connect), but does not replace them.
- Not "just a chatbot." A chatbot with no equipment context, no manual grounding, and no CMMS write-back is a toy. MIRA is the opposite of that.

## Where to go next

- [Getting started](getting-started.md) — sign up and run your first diagnosis
- [QR asset tagging](qr-system.md) — the fastest way to get MIRA scoped to your equipment
- [CMMS integration](cmms-integration.md) — connect MIRA to Atlas / MaintainX / Limble / Fiix
- [Troubleshooting](troubleshooting.md) — common issues and fixes
