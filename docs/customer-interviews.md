# Customer Interviews & Market Validation Commentary

**Purpose:** Track customer discovery conversations and market validation signals for the Gust Launch accelerator program. Each entry documents a real conversation or signal that validates (or challenges) MIRA's value proposition.

---

## Interview Log

### Interview #1 — Lead Maintenance Technician (Internal)

**Date:** April 21, 2026  
**Who:** Lead tech on Mike's maintenance team  
**Context:** Casual conversation about daily workflow pain points  
**Format:** In-person / informal

**Key Quote:**
> "It would be really nice to have an AI summarization of the pass-down being sent to him digitally ahead of time."

**What this validates:**
- **Morning pass-down report feature (#466)** — the automated 6AM email digest we designed in the video marketing plan (Short #8, "The Morning Report") maps DIRECTLY to a stated need from a real technician
- **Digital-first communication** — techs want information pushed TO them, not something they have to go look for
- **AI summarization** — they're not asking for "more data" or "a dashboard to check" — they want the intelligence layer to SUMMARIZE and DELIVER proactively

**MIRA feature alignment:**
| Stated need | MIRA feature | Status |
|-------------|-------------|--------|
| AI summarization of pass-down | Morning maintenance report (#466) | Code shipped, needs Resend domain verification for email delivery |
| Sent digitally ahead of time | Push notifications (ntfy.sh) + email (Resend) | ntfy LIVE, email pending domain verify |
| Before the shift starts | 6AM Celery scheduled task | Built, ready to deploy |

**Competitive note:** This is EXACTLY what differentiates MIRA from traditional CMMS tools. UpKeep/Limble/MaintainX have dashboards the manager has to go CHECK. MIRA DELIVERS the intelligence proactively. The tech doesn't open an app — the app comes to the tech.

**Action items from this interview:**
1. ✅ Morning report feature already built (#466)
2. ⬜ Get Resend domain verified so the email actually sends
3. ⬜ Prototype: send a sample morning report to this tech's phone and get feedback on format
4. ⬜ Ask follow-up: "What would you want IN the summary? Just faults? Or also parts used, follow-ups needed, who worked on what?"

---

## Signal Tracker

| # | Date | Source | Signal | Validates Feature | Strength |
|---|------|--------|--------|-------------------|----------|
| 1 | 2026-04-21 | Lead tech (internal) | Wants AI-summarized pass-down sent digitally before shift | Morning report (#466) | STRONG — unprompted, specific |

---

## Interview Template (for future conversations)

### Interview #N — [Role] at [Company/Context]

**Date:**  
**Who:** [Title, relationship, how you know them]  
**Context:** [How did the conversation come up? Cold outreach? Casual? Demo?]  
**Format:** [In-person / phone / video / text]

**Key Quotes:**
> [Exact words if possible. Paraphrase if not, but mark it.]

**What this validates (or challenges):**
- [Feature or assumption this supports]
- [Feature or assumption this contradicts]

**MIRA feature alignment:**
| Stated need | MIRA feature | Status |
|-------------|-------------|--------|

**Follow-up actions:**
1. [What to do next with this person]

---

## Notes for Gust Launch

This document supports the customer discovery phase of the Gust Launch accelerator. Each entry is evidence that the product-market fit hypothesis is (or isn't) correct.

**MIRA's core hypothesis:** Maintenance technicians and their managers need an AI copilot that diagnoses equipment faults in real-time, captures the knowledge, and delivers proactive intelligence — all from their phone, without learning new software.

**Validation criteria (what we're testing):**
1. Do techs actually want AI help with diagnostics? Or is it a solution looking for a problem?
2. Do managers want automated reporting? Or do they prefer their current pass-down meeting format?
3. Will a plant pay $499/mo for this? Or is the value prop not strong enough at that price?
4. Is the phone the right form factor? Or do they need something else (tablet, desktop, radio)?
5. Is QR code entry the right onboarding path? Or is it friction they won't adopt?

Each interview should produce evidence for or against at least one of these five questions.
