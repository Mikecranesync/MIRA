# Ingest Layer Comparison — MIRA Hub vs CMMS Competitors

**Created:** 2026-05-11
**Owner:** Mike Harper
**Source data:**
- `docs/competitive/competitor-ingest-research.md` — web research, 7 platforms
- `docs/competitive/mira-ingest-audit.md` — internal capability audit, 18 items
- `docs/reports/2026-04-03-competitive-intelligence.md` — broader landscape
- `.claude/skills/promo-director/references/COMPETITOR_ANALYSIS.md` — video/positioning refresh
- Existing specs: `public-ingest-api-spec.md`, `demo-readiness-may21-spec.md`, `dt-scorecard-spec.md`

**Purpose:** decide what to build / spec / mock before the May 18, 2026 change freeze (T-7 days to expo). Demo is May 21.

---

## Legend

| Symbol | Meaning |
|--------|---------|
| ✅ | Built and shipping, demo-safe |
| 🟡 | Partial — wired or behind flag; risky to demo without verification |
| 🔴 | Missing — no code path exists |
| ❓ | Unknown — public docs / repo signals inconclusive |
| — | Out of scope for that platform |

---

## Capability Matrix

| Capability | MIRA Hub | MaintainX | UpKeep | Limble | Fiix | Maintastic | Threaded | Edmund AI |
|------------|----------|-----------|--------|--------|------|------------|----------|-----------|
| Photo scan → asset creation | ✅ | 🔴 | 🔴 | ✅ (Asset Snap) | 🔴 | 🔴 | 🔴 | ❓ |
| PDF OEM manual → KB chunks | ✅ | 🔴 | 🔴 | 🔴 | 🔴 | 🔴 | 🔴 | ❓ |
| **PDF manual → auto-PM extraction** | 🟡 | 🔴 | 🔴 | 🔴 | 🔴 | 🔴 | 🔴 | ❓ |
| CSV/spreadsheet bulk import (assets) | 🟡 (WO only) | ✅ | ✅ | ✅ | ✅ | 🔴 | ❓ | ❓ |
| Public REST API for ingest | 🔴 (spec) | ✅ | ✅ | ✅ | ✅ | 🟡 | 🔴 | ❓ |
| MCP / AI-agent tool surface | ✅ | 🔴 | 🔴 | 🔴 | 🔴 | 🔴 | 🔴 | 🔴 |
| Google Drive / SharePoint / Dropbox | 🟡 (OAuth wired) | 🔴 | 🔴 | 🔴 | 🔴 | 🔴 | 🔴 | ❓ |
| Zapier (no-code bridge) | 🔴 | ✅ | ✅ | ❓ | ✅ | 🔴 | 🔴 | ❓ |
| ERP connector (SAP / NetSuite / Oracle) | 🔴 | ✅ | ✅ | ✅ | ✅ | 🟡 | 🔴 | ❓ |
| SCADA / historian / Ignition | 🟡 (read demo) | ✅ (Ignition) | 🟡 | 🟡 | ✅ (FactoryTalk) | 🟡 (IoT) | 🔴 | 🔴 |
| QR code asset binding | ✅ | 🟡 | ✅ | ✅ (via Asset Snap) | 🟡 | ✅ | 🔴 | ❓ |
| UNS / ISA-95 hierarchical asset paths | 🟡 (stored, unenforced) | 🔴 | 🔴 | 🔴 | 🟡 (Rockwell) | 🔴 | 🔴 | 🔴 |
| Knowledge graph (asset↔component↔fault) | ✅ | 🔴 | 🔴 | 🔴 | 🔴 | 🔴 | 🔴 | 🔴 |
| Vendor-scoped RAG | 🟡 | 🔴 | 🔴 | 🔴 | 🔴 | 🔴 | 🔴 | 🔴 |
| i3X compatibility envelope | 🔴 (spec) | 🔴 | 🔴 | 🔴 | 🔴 | 🔴 | 🔴 | 🔴 |
| Self-service trial / sandbox | 🟡 (Stripe ✅, 7-day sandbox 🔴) | 🔴 (sales-call) | ✅ (free trial) | 🔴 (demo-gated) | 🔴 (sales-call) | ✅ (free trial) | 🔴 | ❓ |
| Nameplate OCR | ✅ | 🔴 | 🔴 | ✅ | 🔴 | 🔴 | 🔴 | ❓ |
| Telegram / Slack ingress for chat | ✅ (Telegram) | 🔴 | 🔴 | 🔴 | 🔴 | 🟡 (collab) | 🔴 | ❓ |
| CMMS write-through (Atlas/MaintainX/Fiix/Limble) | ✅ | — | — | — | — | — | — | — |
| LLM diagnostic chat over your data | ✅ | 🟡 (CoPilot, admin only) | 🟡 (Nova) | 🟡 (predictive) | 🟡 (AI WO) | 🟡 (AI Agent) | 🟡 (pre-GA) | ❓ |
| AR / video remote assist | 🔴 | 🔴 | 🟡 | 🔴 | 🔴 | ✅ | 🔴 | 🔴 |
| Public DT-maturity scorecard | 🟡 (UI only) | 🔴 | 🔴 | 🔴 | 🔴 | 🔴 | 🔴 | 🔴 |

**Edmund AI:** domain exists but no shippable product confirmed in research. Treated as ❓ across the board.

---

## Findings — Where We Win, Where We're Behind

### What MIRA does that nobody else does (✅ where ≤1 of 7 also has it)

1. **PDF OEM manual → KB chunks + auto-PM extraction** — zero competitors do this. Limble's photo-only Asset Snap is the closest analog and it does *not* read the manual. This is the unique flywheel claim from `NORTH_STAR.md`.
2. **MCP tool surface for AI agents** — categorically alone. No CMMS exposes itself to OpenAI/Anthropic agents.
3. **Knowledge graph (asset↔component↔fault)** — none of the seven exposes a graph; they all store flat tables. Multi-hop diagnostic reasoning is uniquely ours.
4. **Vendor-scoped RAG with per-tenant + public OEM corpus** — none.
5. **Telegram / Slack chat ingress** — Maintastic has "collaboration with AI," but nobody else has *real* chat-platform native diagnostic.
6. **CMMS write-through to all four (Atlas + MaintainX + Fiix + Limble)** — MIRA is the *integration substrate*, not the destination. This is the "we feed your CMMS" Walker frame.
7. **Public DT-maturity scorecard** — top-of-funnel quiz nobody else runs. (Backend scoring still 🟡.)

### Where competitors beat us (✅ at ≥4 of 7)

1. **CSV/spreadsheet bulk import for assets** — MaintainX, UpKeep, Limble, Fiix all ship this. We only have CSV import for *work orders*. **A prospect asking "can I bulk-load my asset register?" gets a "no" today.** Demo-relevant.
2. **Public REST API for ingest** — MaintainX, UpKeep, Limble, Fiix all have public APIs. Ours is spec-only. Not a blocker for the live demo, but it's a question every system integrator at the expo will ask.
3. **ERP connectors (SAP/NetSuite/Oracle)** — table stakes for enterprise prospects. We have none. Defer past MVP — not in our ICP per `STRATEGY.md`.
4. **Zapier** — every other CMMS has it. Cheap to add. Worth scheduling post-expo.

### Threats to watch

- **Limble's Asset Snap** is the only competitor doing photo→asset. Our demo language must distinguish: Asset Snap = *create an asset record*. MIRA Scan = *create asset record + pull manual + extract PMs + ground the chat*. The bar is higher.
- **MaintainX's Ignition connector (May 2026 listing)** crosses into our SCADA story. We need to keep the i3X/UNS narrative crisp.
- **Maintastic's free trial + AR remote assist** is the closest in low-friction onboarding. Their offline AR is something we don't have, but it's adjacent, not core.

---

## Top 5 Things to Build / Mock / Spec Before May 18

Prioritized by *impact on a 3-minute booth conversation*, weighted against feasibility before the change freeze. Each has a clear build / spec / mock decision.

### #1 — Auto-PM extraction visible at demo time (BUILD / SEED)

**Why:** This is the flywheel. `NORTH_STAR.md` says PM extraction from manuals is THE core feature. The demo script Step 2 hinges on showing "7 PM schedules extracted from this Yaskawa manual." If that count isn't real on the demo tenant, the whole pitch collapses to "another AI chatbot."

**Current state:** 🟡 — PM schedule storage exists; automated LLM extraction during PDF ingest is not confirmed end-to-end.

**Decision:** **Build the small piece + seed data both ways**:
- Verify the manual→PM pipeline runs end-to-end on at least one OEM manual (Yaskawa GA500). If broken, fix the one missing step.
- If a fix isn't feasible by May 16, **pre-seed the demo tenant** with 7 hand-curated PMs against the Yaskawa GA500 asset so the *visible* claim holds. The demo doesn't have to extract live in front of the prospect — the manual was "already ingested" the day before.
- Either way: the **count must match the manual's actual content**. No fake numbers.

**Effort:** 0.5–1 day to verify; 2h to seed manually as fallback.

**Owner:** Mike + 1 engineer. Verify by May 14. Seed by May 16.

---

### #2 — Asset CSV bulk import (BUILD)

**Why:** Every CMMS comparison from a prospect at the booth will include the question "can I import my asset list from a spreadsheet?" Today: no. This is the cheapest table-stakes gap we can close.

**Current state:** 🟡 — work-order CSV importer exists at `mira-web/src/lib/csv-import.ts`. Asset model is well-defined. Replicating the WO pattern for assets is a 1-day task.

**Decision:** **Build**.
- Endpoint: `POST /api/assets/import` (multipart CSV).
- Columns: `tag, name, manufacturer, model, serial_number, location, parent_asset_id` (parent_asset_id optional, lookup by tag).
- Validate, upsert by `(tenant_id, tag)`, return `{ imported, failed, errors[] }`.
- UI surface: a button on the Assets page → modal → upload CSV → show progress. If the UI piece is too risky, expose endpoint only and demo via Telegram (`/import` command) or `curl`.

**Effort:** 1 day backend + 0.5 day UI = 1.5 days. Or 0.5 day endpoint-only for demo-mode.

**Owner:** assign by May 13. Done by May 16.

**Demo line:** "Bulk import from any spreadsheet — same shape MaintainX or UpKeep gives you. We don't lock you in."

---

### #3 — DT Scorecard backend scoring + lead capture wired end-to-end (BUILD)

**Why:** Step 5 of the demo script hands the phone to the prospect to run `/assess`. If they tap "Submit" and nothing happens, the close fails. This is the lead-capture machinery for the whole expo's pipeline.

**Current state:** 🟡 — `mira-web/public/assess.html` renders; backend scoring + lead capture + (optional) PDF report not wired.

**Decision:** **Build the minimum** — submission stores `(email, plant_name, role, answers, score)` to NeonDB; computes a 0–100 score against the 5-level maturity rubric in `dt-scorecard-spec.md`; returns the score + one-line maturity tier; sends a thank-you email with score. PDF report is post-expo.

**Effort:** 1 day end-to-end (Hono route + NeonDB insert + simple scoring function + Loops/Resend email).

**Owner:** assign by May 13. Done by May 16.

**Fallback:** If scoring isn't ready, gate the form to show "Thanks — we'll email your score within 24 hours" and capture leads manually. Pipeline still works; demo close still lands.

---

### #4 — Sandbox tenant for "your messy folder → structured" live demo (MOCK)

**Why:** The Walker open ("here's the messy reality") is much stronger if Mike can pull up a *real* messy Google Drive folder and show it being structured live. The full sandbox / playground from `public-ingest-api-spec.md §8` is a 5-day build — too much for the freeze.

**Current state:** 🔴 — no 7-day sandbox provisioning. Stripe tenant provisioning is ✅ but that's purchase-flow, not trial.

**Decision:** **Mock**, not build:
- Curate one *real* messy Google Drive folder (Stardust Racers — Mike's existing data). Take a desktop + mobile screenshot. Save to `docs/promo-screenshots/2026-05-demo_messy-folder_{desktop,mobile}.png` per the screenshot rule in `CLAUDE.md`.
- Run that folder through ingest **before the demo** so the resulting structured Hub view is real, not a click-through prototype.
- Demo flow shows the *transition* (messy folder screenshot → structured Hub) without claiming the transformation happens live during the 3 minutes.
- Sandbox provisioning becomes a fast-follow post-expo (1-week build per the existing spec).

**Effort:** 2h — one Stardust-Racers folder ingested + 2 screenshots captured.

**Owner:** Mike. Done by May 16.

---

### #5 — "Same brain, three surfaces" demo coherence (POLISH)

**Why:** The demo's emotional peak is Step 4 — showing the *same* diagnostic AI on Hub chat + Telegram + (optionally) the scan flow, all grounded in the same tenant data. Today these three paths sometimes diverge (different prompts, different tools, different sanitizer settings).

**Current state:** ✅ Each surface works; 🟡 the *consistency* of answers across surfaces hasn't been smoke-tested as one demo path.

**Decision:** **Polish** — no new code:
- On May 17, run the full 3-minute walkthrough end-to-end on both tablets, recording the answers.
- Fix any divergence between Hub-chat and Telegram for the demo questions ("What is fault F004 on the Yaskawa GA500?", "Show me PMs for asset PUMP-0042"). Lock the prompts/configs that produce the canonical answer.
- Cache the canonical answers (server-side or via mira-pipeline) so demo-day latency is <5s, not 10s.
- If any surface gives a *different* answer to the same question on the same tenant, that surface gets pulled from the demo path per `demo-readiness-may21-spec.md` discipline.

**Effort:** 0.5 day verification + 0.5 day prompt/config alignment = 1 day.

**Owner:** Mike. Done by May 17 dry run.

---

## What We're Explicitly NOT Doing Before May 18

These appeared in the gap analysis but are out of scope before the freeze. Logged here so they don't drift back in.

- **Public REST API (`/api/v1/*`)** — spec is solid (`public-ingest-api-spec.md`), 3-week build. Post-expo P0 for "Twilio for maintenance data" positioning.
- **i3X envelope on responses** — spec only. Add when the public API ships.
- **ERP connectors (SAP/NetSuite/Oracle)** — not in MVP ICP. Defer.
- **Zapier integration** — cheap, but not demo-blocking. Post-expo.
- **Full sandbox/playground per spec §8** — post-expo, big.
- **AR/video remote assist** — Maintastic has it; we don't need it for our pitch.

---

## Post-Expo P0 List (carry-over)

In order of customer pull:

1. **Public REST API v1 P0 endpoints** (`/assets`, `/documents`, `/work-orders`, `/ask`, `/me`, `/me/api-keys`) — every SI at the expo will ask.
2. **7-day sandbox + Swagger playground** — converts SI interest to trial without sales touch.
3. **i3X envelope** on all `/api/v1/*` responses — future-proofs and is a credibility marker with industrial buyers.
4. **Zapier app** — 1-day build via their CLI; long-tail integration coverage.
5. **PDF DT-scorecard report email** — better follow-up than a single score number.
6. **Google Drive sync end-to-end** — closes the "messy folder → structured" loop without manual upload.

---

## Acceptance — When this analysis is "good enough to act on"

- [x] Every cell in the matrix is sourced (audit file or competitor research file).
- [x] Top 5 items each have: status, decision, effort, owner, deadline.
- [x] Each P0 demo blocker from `demo-readiness-may21-spec.md` is reflected.
- [x] Walker frame (infrastructure first) appears in the rationale for each top-5 item.
- [ ] Mike has signed off on the top-5 list (pending — review with this doc).
