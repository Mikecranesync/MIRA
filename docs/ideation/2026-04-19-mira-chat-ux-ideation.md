---
date: 2026-04-19
topic: mira-chat-ux
focus: make MIRA chat feel elegant / industrial-native instead of un-elegant-admin-panel
mode: repo-grounded
related_refs:
  - docs/references/open-webui/mobile-and-theming.md
  - docs/references/open-webui/feature-catalog.md
  - docs/references/open-webui/competitive-ux-patterns.md
  - docs/references/open-webui/review-and-recommendations.md
---

# Ideation: MIRA Chat UX

## Codebase Context

MIRA is an industrial maintenance AI at app.factorylm.com. Plant-floor technicians reach it on mobile browsers. Stack: phone → Open WebUI `v0.8.10` (near-stock, one CSS rule, no PWA, 15/90 features enabled) → mira-pipeline:9099 (OpenAI-compat wrapper around GSDEngine FSM: IDLE→Q1→Q2→Q3→DIAGNOSIS→FIX_STEP→RESOLVED) → Claude cascade with Gemini/Groq/Cerebras fallback.

Other surfaces in the repo: `mira-web` (Hono/Bun PWA — manifest, apple-mobile-web-app, service worker already configured), `mira-mcp` (FastMCP 3.2 with CMMS tools: Atlas/MaintainX/Limble/Fiix adapters), `mira-ingest` (25K NeonDB pgvector chunks, Two-Brain architecture: shared_oem + per-tenant), `mira-bridge` (Node-RED orchestration, SQLite WAL shared state), `mira-hud` (Express + Socket.IO AR scaffold), Telegram/Slack bot adapters, Ollama (qwen2.5vl:7b vision, nomic-embed-text embeddings), 3,694 equipment photos indexed. Atlas CMMS live on cmms-net.

**Industrial constraints:** gloves (capacitive touch fails), grease, sunlight glare, one-handed use, pockets butt-dial, intermittent LTE, loud environments, respirator-muffled voice, shared devices across shifts, arc-flash PPE, overhead work, harness-tethered.

**Current UX pain (from four reference docs this session):** iOS viewport keyboard bug #20722; touch targets <44px; no swipe; composer hides on long threads; no PWA install; admin chrome (model picker, settings, API keys) visible to technicians; no mic in composer; no suggested prompts; no citation rendering (even though mira-pipeline returns them); SaaS prod missing RAG config that local has; zero branding beyond one logo + red-outline CSS; OW won't reach Grok-grade polish without enterprise license.

**Baseline plan already proposed** (in `review-and-recommendations.md`): Tier 1 (one-week OW env/CSS hotfix), Tier 2 (2-3 sprint OW polish), Tier 3 (3-4 sprint custom `/chat` in mira-web).

## Ranked Ideas

### 1. Camera-as-chat (viewfinder is the interface)
**Description:** App opens to the camera, not the chat. Point at a VFD/motor/cabinet; MIRA overlays fault LED state, last service date, next diagnostic step, torque specs in the live viewfinder. A text transcript drawer sits under the viewfinder. Long-press captures a photo and auto-asks "what's wrong with this?" — zero typing. Forward-compatible with AR glasses via existing `mira-hud`.
**Rationale:** Five of six ideation frames independently converged on this — strongest signal. Leverages qwen2.5vl:7b already local, 3,694 indexed photos, and mira-hud scaffold. No chat competitor (Grok/Gemini/ChatGPT/Claude/Perplexity) has viewfinder-native entry. This is where MIRA stops looking like "worse ChatGPT" and starts looking like a different product.
**Downsides:** Camera permission friction (iOS PWA OK, Android flaky). Vision model latency on low-end phones. UX invention, not a copy of an existing pattern.
**Confidence:** 85%
**Complexity:** Medium — MVP photo-first in 1 sprint; full AR overlay 2-3 sprints.
**Status:** Unexplored

### 2. Asset owns the thread (QR deep-link + per-asset persistent memory)
**Description:** Every piece of equipment has a printed QR sticker that opens MIRA pre-loaded with that asset_tag, vendor, model, last 14 messages from any shift, open work orders, and recent faults. The thread is attached to the machine, not the user. Scanning VFD-07 shows: "3rd-shift reported overheating Tuesday 3am → MIRA suggested check filter → resolved."
**Rationale:** Collapses "find phone / unlock / open app / describe what I'm looking at" to one tap. Converts MIRA from chat app into the digital equipment logbook every plant already has in paper form. Uses NeonDB tenant partitioning from Two-Brain architecture. Creates switching cost ChatGPT Enterprise cannot replicate — "leaving MIRA means leaving your logbook."
**Downsides:** QR print-and-stick op per plant is bureaucratic. Stickers fall off / get grease-covered. Cross-shift visibility requires tenant policy. Surface overlap with Atlas CMMS asset records.
**Confidence:** 80%
**Complexity:** Medium — URL route + DB table + print-sheet admin page = ~1 sprint.
**Status:** Explored

**Explored expansion (2026-04-19, this session):**
- User challenged whether QR was over-weighted in ideation. Reconciled: QR is ONE of five valid entry mechanics (QR, NFC, visual recognition, telemetry-triggered, CMMS deep-link, manual search). QR is cheapest ($0.01/sticker), most universal, and infrastructure-free — best starting point. Telemetry-triggered is stronger where PLC is integrated; visual recognition scales better long-term.
- Chat is still the medium for Stages 2-6 of the diagnostic flow (symptom, clarifying Qs, descriptions, fix suggestions, outcome). QR only compresses Stage 1 ("what are we talking about") from 30s to 1s. Competitor chat has no Stage 1 because there's no scoping; our Stage 1 is the win.
- Concrete MVP shape decided:
  - **URL:** `https://app.factorylm.com/m/{asset_tag}` — human-readable, uses existing Atlas asset tags, inspectable.
  - **DB:** two tables in NeonDB — `asset_qr_tags(tenant_id, asset_tag, printed_at, first_scan, last_scan, scan_count)` and `qr_scan_events(id, tenant_id, asset_tag, user_id, scanned_at, user_agent)`.
  - **Scan handler:** new route in `mira-web/src/routes/m/[asset_tag].ts` — UPSERT tag, INSERT event, redirect to OW chat with `?asset_tag=X&greeting=symptom`.
  - **QR generator:** `mira-web/src/lib/qr-generate.ts` using npm `qrcode` (stays in Bun, no new Python dep).
  - **Print workflow:** `mira-web/src/routes/admin/qr-print.tsx` admin page → lists Atlas assets via `cmms_list_assets` → checkbox select → PDF on Avery 5163 label layout (2"×4", 10/sheet).
  - **Physical stickers:** Avery 5163 printable vinyl for indoor (~$20/100); anodized aluminum tags for harsh/outdoor.
  - **mira-pipeline change:** accept `asset_tag` query-param, skip IDLE, enter at Q1 with "what's the symptom on {asset}?".
  - **v1 scope (1 sprint, ~40 hrs):** DB migration (4h), scan route + event log (4h), QR generator + single-PDF test (4h), admin list + batch PDF with Avery layout (8h), pipeline query-param integration (6h), end-to-end on real vinyl sticker (6h), analytics view + polish (8h).
  - **NOT in v1:** signed/opaque tokens, rotation/expiry, NFC (layer later on same URL), per-tech private stickers, cross-tenant public stickers, sticker-revocation workflow.
- Handed off to `ce-brainstorm` on this date to develop the full requirements doc (wireframes, edge cases, auth/tenant policy, label-print testing, rollout plan).

### 3. MIRA speaks first from telemetry
**Description:** No empty state. App-open or push notification greets with a pre-assembled hypothesis: "CP-14 tripped 7 min ago on thermal overload. I pulled the amperage trend and the last PM. Start there?" Triggers: Ignition alarm bits via mira-bridge Node-RED, CMMS work order assignment, Tailscale geo-fence, last session's unresolved thread.
**Rationale:** Inverts cold-start. Zero typing, zero hesitation. A move no LLM competitor can make — they have no telemetry. Leverages mira-bridge Node-RED orchestration and planned MIRA Connect P1 PLC integration.
**Downsides:** Depends on MIRA Connect roadmap. Push notification permissions. Risk of alarm noise desensitizing techs.
**Confidence:** 70%
**Complexity:** Medium-High — gated by MIRA Connect timeline.
**Status:** Unexplored

### 4. Silent CMMS auto-closeout
**Description:** When a diagnostic thread hits RESOLVED (FSM state or 15 min silence after "fixed it"), mira-mcp drafts the Atlas work order closure — symptom, root cause, action, parts, duration — and posts a toast: "WO-4471 logged." One tap to edit, one to confirm. No form, no app switch.
**Rationale:** The #1 reason CMMS data is trash is tech end-of-shift documentation fatigue. If the chat IS the documentation, compliance trends to 100% and MIRA generates the richest fault corpus the plant has ever had — which then compounds retrieval. All wiring exists (mira-mcp CMMS tools, Atlas adapter, FSM RESOLVED); missing piece is the trigger.
**Downsides:** Wrong auto-drafts reach Accounting if unedited. Auditors may require human signature per entry.
**Confidence:** 90%
**Complexity:** Low-Medium — single glue job between mira-pipeline and `cmms_complete_work_order`.
**Status:** Unexplored

### 5. Teach-MIRA + visible Memory Panel
**Description:** Collapsible sidebar per chat showing what MIRA remembers about *this* tenant: equipment list, recurring faults, tribal fixes, technician names, manual preferences. Editable inline. "Actually it was…" button writes a high-weight correction chunk into tenant NeonDB KB, scoped to equipment+fault, optionally promotable to shared OEM library. Memory visibly labeled *Shared OEM* vs *Your Plant's*.
**Rationale:** Two compounding vectors — corrections measurably improve retrieval weekly, AND visible memory makes Two-Brain architecture tangible for sales/retention. Prospects see MIRA "learn their plant" live in demo. Closes the feedback loop that today dies on the floor.
**Downsides:** Moderation needed for bad corrections. Shared-OEM promotion needs approval workflow. Surface for misuse.
**Confidence:** 85%
**Complexity:** Medium — correction write path fits NeonDB schema; Memory Panel UI ~1 sprint.
**Status:** Unexplored

### 6. SITREP 5-line fault card pinned to every thread
**Description:** Borrowed from military situation reports. Fixed card at top of every thread with five auto-maintained fields: **Asset / Symptom / Last-Known-Good / Hypothesis / Next-Action.** Chat log flows below; card is the single source of truth a tech can screenshot to a supervisor or resume from after lunch.
**Rationale:** Long LLM threads bury state. 3-second re-entry beats re-reading 40 messages. GSDEngine already carries this state internally; this is a UI projection. Zero new inference cost. Also absorbs the separate FSM progress bar concept by embedding current state as a card field.
**Downsides:** Stale-state if engine misses a transition. Mobile space tight; must collapse. Some users will want to hide it.
**Confidence:** 90%
**Complexity:** Low — one component, one engine passthrough. Days, not weeks.
**Status:** Unexplored

### 7. Safety-mode gate (LIVE / LOCKED-OUT / INFO-ONLY)
**Description:** Persistent pill in chat header showing declared session mode. Tech selects at session start (or MIRA asks on first "touch the drive" suggestion). **LIVE-EQUIPMENT** (red) forces arc-flash PPE reminders and NFPA 70E language before any actuation advice. **LOCKED-OUT** (green) allows full procedures. **INFO-ONLY** (gray) strips actuation and returns only reference info.
**Rationale:** Upgrades existing SAFETY_KEYWORDS guardrail from keyword-level to session-level. Turns LLM liability (confident wrong actuation on energized equipment) into a declared contract. Aviation-HUD analogy: pilots never guess autopilot mode; techs shouldn't have to guess MIRA mode. Clear compliance story for enterprise buyers.
**Downsides:** Session-start friction; users may click through. False LOCKED-OUT declarations are real liability. Requires ToS policy language.
**Confidence:** 75%
**Complexity:** Low-Medium — `guardrails.py` already classifies intent; promote to session state + UI pill.
**Status:** Unexplored

## Rejection Summary

| # | Idea | Reason Rejected |
|---|---|---|
| 1 | F4#2 Shareable fix-thread permalinks | Viral GTM idea; doesn't address "un-elegance" — save for GTM sprint |
| 2 | F5#4 Souls-like cross-tenant hints | Bold, but privacy/moderation complexity; better as brainstorm variant of #5 |
| 3 | F6#7 Infinite-Opus 10-min deep-work mode | Different mode than chat UX; deserves own ideation |
| 4 | F5#3 M&M weekly stumped cases | Ops/supervisor-facing, not technician UX; note for analytics roadmap |
| 5 | F5#7 Mise en place parts pre-check | Depends on Atlas parts inventory not yet built |
| 6 | F2#7 FSM progress bar | Absorbed into survivor #6 (SITREP card) |
| 7 | F1#4 Grease-mode big-button composer | Fits as a skin on survivor #1 (camera-as-chat) |
| 8 | F6#3 Listening Post (passive-only MIRA) | Fascinating reframe but a different product |
| 9 | F3#8 MIRA as tool for other agents (MCP) | API business, not chat UX — flag for separate ADR |
| 10 | F6#6 Wrong-half-the-time disclaimer UX | Trust positioning, not a UX pattern |
| 11 | F6#1 Faraday Butler (offline-first local LLM) | Architectural pivot; too large for current stage |
| 12 | F2#5 Kill confidence scores + citation chips | Philosophy over product; citations are table stakes |
| 13 | F2#6 Chat evaporates on RESOLVED | Loses legitimate value (cross-session pattern matching) |
| 14 | F3#2 Supervisor cockpit | Different product (manager SaaS), not technician chat |
| 15 | F1#7 Pocket-lock auto-suspend | Low feasibility in web PWA — browser API constraints |
| 16 | F6#4 Mike's personal MIRA (1-user butler) | Founder tool, not product |
| 17 | F5#1 Rally pacenotes pre-cached | Perf idea; implementation burden > UX value |
| 18 | F1#1 NFC launch (standalone) | Absorbed into survivor #2 — same mental model, layered later |
| 19 | F1#2 Ear-pressed speakerphone | Absorbed into voice-mode work in Tier 1 hotfix plan |
| 20 | F1#3 Undignified-answer detector | Already handled by brief-by-default system prompt |
| 21 | F1#5 Shift-handoff resume card | Valuable, but absorbed into survivor #2 (asset-owned threads) |
| 22 | F1#6 Offline-draft with LTE-resume | Already in Tier 3 offline-queue plan in `review-and-recommendations.md` |
| 23 | F2#3 No Send Button — voice only | Too radical; loses keyboard escape hatch |
| 24 | F2#4 WOs Write Themselves (no confirm) | More aggressive variant of survivor #4; survivor is pragmatic cut |
| 25 | F2#8 PLC HMI is the client | Already on MIRA Connect P1 roadmap |
| 26 | F3#3–#7 assorted reframes | All duplicates of surviving cluster heads (A, B, C, D, E, K) |
| 27 | F4#5 DiagnosticCard UI primitive | Engineering pattern, not UX idea |
| 28 | F4#7 Fault-case content flywheel | Marketing/SEO compounding, out of scope for chat UX |
| 29 | F6#2 200ms Reflex pre-answered chat | Perf/latency idea; implementation burden > value |
| 30 | F6#5 AR-Glasses no-chat | Future-state; absorbed into survivor #1 forward path |
| 31 | F6#8 Zero-tag vision onboarding | Absorbed into survivor #1 |
| 32 | F5#6 Ableton parallel diagnostic clips | Novel but too experimental for current stage |
| 33 | F5#8 Waze stale-manual warnings | Absorbed into survivor #5 (Teach-MIRA broader covers it) |
