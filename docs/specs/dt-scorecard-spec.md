# Digital Transformation Scorecard — Spec

**Status:** Draft (lead magnet)
**Owner:** Mike Harper
**Surface:** `factorylm.com/assess`
**Created:** 2026-05-11

## Purpose

Lead magnet that lets a plant/maintenance manager self-assess their facility's
digital transformation maturity in ~10 minutes on their phone, then receive a
benchmarked scorecard with prioritized next steps and a FactoryLM CTA.

Drives LinkedIn re-engagement campaign (May 12 – Jun 8, 2026) and converts
followers → assessment completions → paid on-site visits ($500/visit).

## Framework

Adapted from CESMII Smart Manufacturing Business Practices, simplified for
maintenance buyers. Six dimensions, each scored on a 1–5 maturity scale
(1 = paper-only, 5 = AI-driven / closed-loop).

| # | Dimension              | Questions | What it measures |
|---|------------------------|-----------|------------------|
| 1 | Data & Documentation   | 3 | Manuals digital? Equipment history reachable from the floor? |
| 2 | Work Order Management  | 4 | Paper/whiteboard vs CMMS. WO creation, tracking, close-out. |
| 3 | Preventive Maintenance | 4 | Calendar vs condition. PM compliance rate. Auto-scheduling. |
| 4 | Asset Intelligence     | 3 | QR codes. Nameplate digitization. Component tracking. |
| 5 | Knowledge Sharing      | 3 | Tribal knowledge captured. Onboarding time. Cross-shift handoffs. |
| 6 | Technology Readiness   | 3 | Mobile fluency. WiFi on floor. Budget for digital tools. |

Total: **20 questions**, estimated **10–15 min**.

## Scoring

- Each answer scores 1–5 (mapped from the option index).
- Dimension score = mean of its questions, rounded to 1 decimal.
- Overall maturity score = mean of dimension scores.

## Industry Benchmarks

Plant Engineering / Plant Services / Reliabilityweb 2023–2024 surveys, rounded
to defensible mid-market averages (US discrete + process manufacturing,
50–500 employees):

| Dimension              | Benchmark |
|------------------------|-----------|
| Data & Documentation   | 2.4 |
| Work Order Management  | 2.8 |
| Preventive Maintenance | 2.6 |
| Asset Intelligence     | 2.0 |
| Knowledge Sharing      | 2.2 |
| Technology Readiness   | 3.0 |
| **Overall avg**        | **2.5** |

Source values are claims, not citations — revisit before any external pitch
makes a claim more specific than "industry average".

## Output

Single page, no auth, no backend persistence in v1:

1. **Radar chart** (Chart.js) — user vs benchmark, 6 axes.
2. **Maturity tier badge** — `Foundational` (<2.0), `Developing` (2.0–3.0),
   `Practicing` (3.0–4.0), `Leading` (>4.0).
3. **Top 3 next steps** — rule-based, keyed on the user's three lowest
   dimensions. Each step names the dimension, the gap, and a concrete action.
4. **CTA** — "Get a free 30-min on-site assessment" → mailto / LinkedIn DM
   stub for v1; wire to `/api/assess/booking` later.
5. **Print / PDF** button — `window.print()` with print-friendly CSS so the
   user can share with their manager.

## Tech

- Single static file: `mira-web/public/assess.html`.
- Vanilla JS, no build step. Chart.js 4 via CDN (MIT, allowed under PRD §4).
- FactoryLM brand tokens from `_tokens.css` (loaded inline for self-contained
  print rendering).
- Mobile-first: 1 question per screen on <600px, 2-column on desktop.
- Served by Hono via `app.get("/assess", ...)` returning `Bun.file(...)`.
- LocalStorage caches in-progress answers so a refresh doesn't lose work.

## Non-goals (v1)

- No email capture before showing results (would tank completion rate).
- No backend persistence — results live in the page session only.
- No A/B testing — that comes after we have ≥100 completions of v1.
- No multi-facility comparison — single-facility scorecard only.

## Success metrics

- Completion rate ≥ 60% (start → finish).
- Assessment bookings ≥ 3 in first 30 days from `/assess` page traffic.

## Open questions

- Should we gate "Top 3 next steps" behind email capture? (Default: no, keeps
  trust; revisit if conversion to booking is low.)
- Should the radar render in dark mode? (Default: yes, follow `_dark-theme.css`.)
