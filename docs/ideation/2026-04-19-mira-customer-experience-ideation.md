---
date: 2026-04-19
topic: mira-customer-experience
focus: most effective improvements for customer experience
mode: repo-grounded
---

# Ideation: MIRA Customer-Experience Improvements

## Grounding Context (Codebase + External Research)

**MIRA state:** v3.4.0, AI-powered industrial-maintenance copilot. $97/mo beta, pre-PMF, 10-user-in-30-day GTM goal, 1–2 engineer team. Customer surfaces: mira-web (Stripe PLG funnel), Open WebUI + mira-pipeline (chat), mira-bots (Telegram/Slack), mira-hud (AR desktop), mira-cmms (Atlas).

**Active state (from wiki/hot.md + recent commits):** P0 #380 envelope leak fixed Apr 18. Eval floor stable at 54–56/57. Blockers: eval CI broken (#391), no auto-CD (#392), photo/vision fixture coverage 1:58 (#288), Trivy CVEs in mira-ingest (#379). In progress: OEM KB migration, MIRA Connect Modbus MVP design complete (2026-04-17) but not built.

**Customer-surface pain points (grounded in repo):**
- `mira-web/src/lib/mira-chat.ts` still calls dead sidecar `:5000/rag` — web visitors get silent failures. ADR-0008 cutover incomplete.
- 3-step post-Stripe provisioning: (A) Atlas signup fatal, (B) demo seed silent-fail, (C) email tracked. Users with `provisioning_status != 'ok'` are invisible unless admin pings `/api/admin/activation-health`.
- No activation-funnel telemetry, no "was this helpful?" on chat, no self-service activation retry UI.
- Photo/vision fixture coverage inverted from real usage.
- No live PLC/VFD data ingestion — #1 moat gap vs MaintainX/Fuuz.
- Open WebUI KB uploads are browser-only, no API.
- No CD — manual SSH deploy.

**External CX signals relevant to pre-PMF AI maintenance SaaS:**
- "Value before structure" (Gamma/Cursor/Warp): first meaningful output *before* onboarding → 26%→85% start rate in a documented case.
- Top-quartile AI activation: 50%+, time-to-value <15 min; Day-0 activation correlates with 3.2× trial-to-paid conversion.
- Chatbot trust killer: uniform presentation regardless of reliability. 48% of chatbots fail users; well-designed fallback = +30% retention.
- Field-tech UX: partial offline = abandoned tool (Limble 2026 rebuild explicit — "less cognitive load, glove-friendly, one-hand").
- Telegram: 80–90% open rate but 76% loss in 72hr if bot has dead-ends. Sub-2s response, single-trigger activation, Stripe→invite pattern well-established.
- Hospitality 70/30: automate routine, protect human attention for complex. Pre-PMF concierge: founder personally onboards first <100 customers.

**Locked constraints:** $97/mo fixed, MIT/Apache deps only, mira-sidecar decommissioned (no work there), vision local-only (Ollama qwen2.5vl on Bravo).

## Ranked Ideas

### 1. Kill the Dead Sidecar — Wire mira-web Chat to mira-pipeline
**Description:** Rip `:5000/rag` out of `mira-web/src/lib/mira-chat.ts`, point at mira-pipeline's OpenAI-compat endpoint, delete the sidecar URL from config entirely. Add a synthetic probe in CI so the path can't regress silently. Ship a "reconnecting…" banner instead of a dead input on transient failure.
**Rationale:** Today every mira-web visitor who tries chat gets silence — the single largest silent CX failure on the funnel, and the fix is a removal, not a rewrite. ADR-0008 closure. 1-day effort, unblocks 100% of web-originated trials.
**Downsides:** Requires a real end-to-end smoke test in CI; risk of latency spike on cold mira-pipeline if the current sidecar was acting as a cache buffer (verify).
**Confidence:** 95%
**Complexity:** Low
**Status:** Unexplored

### 2. Replace Demo Seed With Customer-Equipment Capture at Activation
**Description:** Drop the silent-failing `step B demo seed`. Between Stripe success and CMMS landing, insert a 60-second prompt: "Paste your asset list, upload your equipment photo, or snap the nameplate of the machine that bugs you most." Vision/OCR extracts asset tag + model + location → CMMS entries the user will actually touch on Day 1. Label anything sample-ish as "delete when ready."
**Rationale:** Day-0 activation = 3.2× trial-to-paid. Current default is fake data the user throws away; flipping to *their* data is the aha moment. Also front-loads the per-tenant RAG corpus. Aligns with "value before structure" (26→85%) and the Fihn Dramatic Demonstration beta strategy.
**Downsides:** Needs a lightweight capture UI (camera + paste + CSV drop), vision-extraction confidence might produce wrong asset names requiring inline edit. Corner-case: user doesn't want to capture yet — must allow skip without landing in empty CMMS.
**Confidence:** 80%
**Complexity:** Medium
**Status:** Unexplored

### 3. Activation State-Machine Spine: Telemetry + Self-Heal + Rescue Hatch
**Description:** Model the first-run journey (Stripe → provision A/B/C → first chat → first photo → first work order → first PM) as a backend state machine with structured events in one `activation_events` table (Neon). A worker re-runs failed provisioning steps with backoff. Slack-pages Mike when any tenant is stuck >15 min. Every surface reads state and injects contextual nudges. On every orphanable state, render a persistent "Something went wrong — [Retry] [Book 10 min with a human] [Tell us]" bottom sheet.
**Rationale:** Stuck users are currently invisible. At 10-users-in-30-days scale, losing one silently is a 10% dent. A state spine makes every subsequent CX nudge a config change, not a code change; Checklist-as-backend is the highest-leverage activation primitive per the research brief.
**Downsides:** Dependence on Slack/Telegram pager reliability; worker retry policy must be idempotent (Atlas provision can't be double-fired). Risk of building too generic a spine for 10 users — keep v1 narrow.
**Confidence:** 85%
**Complexity:** Medium
**Status:** Unexplored

### 4. Confidence-Tiered Responses + Inline Feedback + Did-You-Mean Chips
**Description:** Every GSDEngine response renders with a visible confidence tier (Verified / Likely / Guess) computed from retrieval-score + model self-rating. Two-tap thumbs + free-form correction box write to `response_feedback` keyed to `message_id + equipment_id + intent`. When confidence is Low, replace a generic fallback with three closest-neighbor tappable chips ("Motor overheating?", "VFD fault F7?", "PLC comm loss?") — each tap becomes a labeled training pair.
**Rationale:** "Can I trust this before I un-lock the panel?" is the persona's core question. Uniform output presentation regardless of reliability is the #1 chatbot trust killer; good fallback = +30% retention. Turns every chat into eval data without asking for it. Feeds the 39 golden cases loop directly.
**Downsides:** Confidence tiers must be calibrated — mislabelled "Verified" erodes trust faster than no label. Thumbs may be ignored unless the UI places them where the user's eye already is.
**Confidence:** 90%
**Complexity:** Medium
**Status:** Unexplored

### 5. Telegram-First Onboarding: Stripe→Invite + Snap-and-Diagnose + Founder Shadow
**Description:** Stripe webhook fires → single-use Telegram deep link → bot DMs the user with a single button: "Photo the nameplate of anything that's broken." Reply routes through GSDEngine with inline confidence tiers. In parallel, auto-create a private Telegram group containing the new user + Mike + a MIRA bot that mirrors every provisioning event + every first-week chat. Mike intervenes from his phone when the bot flags a stall. Web/Atlas/email move off the critical path — they become day-3+ additions.
**Rationale:** Routes around the broken web chat entirely. Telegram: 80–90% open rate, sub-2s response, native voice + photo — exact persona fit (phone + wrench). Founder shadow = concierge at pre-PMF scale without building a ticketing system. "Dramatic demonstration" within 2 minutes of payment.
**Downsides:** Telegram requires account creation for users who've never used it (real for SMB mfg). Shadow group relies on Mike being available; doesn't scale past 50 users and needs a succession plan. Can't be the *only* surface long-term.
**Confidence:** 75%
**Complexity:** Medium
**Status:** Unexplored

### 6. Unified MIRA Identity + Session Primitive Across All Surfaces
**Description:** Extract a single `mira-identity` package (tenant, user, equipment scope, conversation handle, last-touched-asset) consumed by mira-web, Open WebUI, mira-bots, mira-hud, mira-cmms. One pairing code (6-digit or QR) links any new surface to the existing profile. Conversation state, asset context, and in-flight work order travel with the user.
**Rationale:** Compounding primitive. Every subsequent CX feature — activation telemetry, "was this helpful?", per-user memory, vocabulary learner, MIRA Connect pairing, billing events — plugs into one surface and lights up on all five. Removes the "each surface re-onboards" tax forever, not just once. Also the prerequisite for idea #5's Telegram-first to avoid siloing the user.
**Downsides:** High complexity — requires JWT/claims work, schema normalization, and careful migration of existing mira-web sessions. Risk of bikeshedding the identity model when a narrower 2-surface MVP (web + Telegram only) would deliver 80% of the value.
**Confidence:** 70%
**Complexity:** High
**Status:** Unexplored

### 7. Bridge the MIRA Connect Gap With a CSV / Screenshot Importer
**Description:** Until Modbus MVP ships, accept a PLC HMI screenshot or a CSV of tag history in chat. OCR/parse extracts `{asset, timestamp, tag, value}` rows and seeds a `live_readings` table; GSDEngine queries it alongside manuals. Label it "offline capture" in the UI so real MIRA Connect ships as an upgrade, not a retcon.
**Rationale:** #1 moat gap vs MaintainX/Fuuz is "no live equipment data." The real Connect spec is 2+ weeks out with zero team bandwidth currently. Without *any* live-data story the AI feels like a fancy search box. This is the Fihn Dramatic Demonstration for techs whose PLC is air-gapped — they can still feed MIRA reality.
**Downsides:** OCR on HMI screenshots is hard and model-specific — likely only works reliably on 3–5 vendor screens at v1 (GS20, Micro820, PowerFlex). CSV ingestion is straightforward but requires the customer to have historian access, which most SMBs don't. Risk: the "offline capture" label becomes permanent because real Connect keeps slipping.
**Confidence:** 65%
**Complexity:** Medium
**Status:** Unexplored

## Cross-Cutting Enablers (not survivors, but multipliers)

These are infrastructure investments that make every survivor cheaper and reduce CX-regression risk. Rejected as direct CX survivors because they're invisible to customers, but worth doing in parallel:

- **CD pipeline + feature flags** (raw #30) — every idea above ships in minutes instead of hours, rolls back in seconds, dark-launches to one tenant before wide. ~3× effective CX velocity for the 1-2-engineer team.
- **Replayable conversation ledger + one-click "promote to golden case"** (raw #29) — every user-reported miss becomes a permanent regression test. Pays dividends on every prompt or model upgrade.
- **One prompt + tool registry shared across surfaces** (raw #33) — fixing response style, adding a tool, tightening safety keywords becomes one PR instead of five divergent edits.

## Rejection Summary

| # | Idea | Reason Rejected |
|---|------|-----------------|
| 7 | Glove-friendly PWA shell | Subsumed by #5 (Telegram) + follow-up broader mobile work |
| 8 | 10-line upload-manual API | Infra-only; power-user path, not first-10-user CX lever |
| 15 | Email-to-KB ingest | Covered by #8 and broader; narrower surface |
| 17 | GitHub Actions CD for mira-web | Enabler, not customer-facing CX — called out as cross-cutting |
| 18 | Invert funnel: value before Stripe | Too strategic; risks the $97/mo revenue line pre-PMF |
| 19 | Kill chat-first hero, photo-first | Thematic pivot — better handled in brainstorm than ideation |
| 22 | Price per resolved work order | $97/mo pricing explicitly locked per project memory |
| 24 | Compliance as hero | Strategic pivot, not a CX improvement |
| 25 | Voice-first shop floor, text office | Principle, subsumed by #5 (Telegram voice notes) |
| 29 | Replayable ledger | Enabler — cross-cutting |
| 30 | CD + feature flags | Enabler — cross-cutting |
| 31 | Tenant vocabulary learner | Too bold pre-PMF; compounds only at 50+ tenants |
| 33 | Shared prompt registry | Enabler — cross-cutting |
| 34 | Surgical time-out (OR pre-incision) | Niche safety feature; overlaps #5 once Telegram-first lands |
| 35 | Submarine rig-for-red | Floor-mode UX; subsumed by follow-up PWA work |
| 38 | Mise-en-place chat opening | Subsumed by #3 (state spine) + #6 (identity-driven last-touched asset) |
| 40 | Veterinary SOAP ticket spine | Overlaps #3; better as a follow-up once state spine exists |
| 41 | Broadcast director channel / HUD | AR HUD adoption low pre-PMF; park |
| 43 | One-feature product | Strategic pivot, not CX improvement |
| 44 | 90-day continuous concierge | Subsumed by #3+#5; run as playbook, not product |
| 45 | Customer-authored YAML playbooks | Strategic extension point; not immediate CX |
| 46 | Call-Mike Twilio support | Subsumed by #5 (Telegram founder shadow) |
| 47 | No-chat mode / alert cards | Bold pivot; subsumed by #5 |
| 48 | Phone-only edge inference | Too far-horizon; constraint locks local-only on Bravo |
| 49 | One-account-per-tech social graph | Long-horizon strategic, not 30-day CX |
| 36 | Fire-station rigs | Subsumed by #2 (equipment pre-seed) and #3 (state spine) |
| 37 | Scuba buddy-check | Subsumed by #4 (confidence tiers) backend variant |
| 39 | National Park blaze symbols | Subsumed by #4 (confidence tiers UX) |
| 42 | Zero-typing voice+QR only | Principle, subsumed by #5 |
| (all other raw ideas) | | Merged into survivor clusters 1-7 |
