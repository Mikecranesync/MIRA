# Crane Sync Corporation — MIRA

## The Problem

Factory maintenance technicians spend 40% of their diagnostic time searching for information — flipping through manuals, calling vendors, or relying on tribal knowledge from senior technicians who are retiring faster than they can be replaced.

The problem isn't that technicians are bad at their jobs. It's that the knowledge they need is locked in PDFs, in equipment vendor portals, and in the heads of a shrinking population of 20-year veterans. When a VFD trips at 2 AM, a junior tech is on their own.

## The Solution

MIRA (Maintenance Intelligence & Response Assistant) is an AI co-pilot that lets technicians diagnose equipment faults by texting a photo to the messaging app they already use.

**How it works:**

1. Technician sends a photo of the faulted equipment via Telegram, Slack, Teams, or WhatsApp
2. MIRA identifies the equipment, reads nameplates and fault codes via computer vision
3. Using Guided Socratic Dialogue, MIRA asks 3-4 targeted diagnostic questions
4. MIRA delivers a diagnosis with step-by-step fix guidance, grounded in equipment manuals

## What Makes MIRA Different

- **Equipment-agnostic** — works on any industrial equipment with a nameplate
- **No app to install** — delivered through existing messaging platforms technicians already use
- **Guided, not guessing** — Socratic method ensures accurate diagnosis through structured questioning rather than a wall of text
- **Privacy-first** — runs on-premise or hybrid cloud, no data leaves the facility without permission
- **Knowledge base** — 5,493+ equipment knowledge entries with pgvector semantic search

## Current State

- Working prototype with live demo available
- 4 messaging platforms supported (Telegram, Slack, Microsoft Teams, WhatsApp)
- AI inference via Anthropic Claude API with local fallback (runs fully on-site if needed)
- Vision pipeline: photo analysis + OCR + fault code extraction
- 120+ industrial fault test cases validated
- Deployed on Mac Mini hardware (production-ready edge deployment)
- NeonDB RAG with pgvector — equipment manuals, fault codes, diagnostic procedures

## Product Tiers

| Tier | Delivery | Target |
|------|----------|--------|
| Cloud Free | SaaS | Lead generation, small shops |
| Config 1-2 | Hardware box | 50-500 employee plants |
| Config 3 | + Vision pipeline | Plants with mixed/older equipment |
| Config 4-6 | + Live PLC data | Plants with Allen-Bradley, Micro820 |
| Config 7 | Enterprise multi-site | Regional manufacturers, OEM service |

## Team

**Mike Harper, Founder & CEO**

20+ years as an industrial maintenance technologist. Deep expertise in PLC programming (Allen-Bradley, Micro820), VFD commissioning, motor control, and factory floor operations across Central Florida manufacturing. Built MIRA from the ground up to solve the problems he's lived every day.

## Contact

[DEMO VIDEO LINK]

mike@cranesync.com | cranesync.com

Lake Wales, Florida
