# MIRA v1 Customer-Ready Scope

**Date:** 2026-04-14
**Status:** DRAFT — needs Mike review before feature freeze (#272)
**Closes:** #270
**Prerequisite for:** #272 (feature freeze until 5 paying users)

---

## 1. The Product (one paragraph)

MIRA is a maintenance diagnostic assistant that lives in the messaging tools your technicians already use — Telegram, Slack, or Open WebUI. When a tech is standing in front of a broken machine, they describe the fault (or snap a photo of the nameplate/error code), and MIRA walks them through a structured diagnosis: identifies the asset, pulls the relevant section from the OEM manual, asks targeted clarifying questions, and delivers a step-by-step fix in plain language — with a lockout/tagout escalation if the situation is unsafe. When a fix is confirmed, MIRA can log a work order directly to the CMMS. No laptop, no PDF hunting, no radio call to the engineer's office. Just the tech, their phone, and the answer.

---

## 2. The Buyer vs. The User

| Role | Who They Are | What They See | What's In It For Them |
|------|-------------|---------------|----------------------|
| **Buyer** — Maintenance Manager or Plant Engineer | Signs the contract. Manages 10–100 technicians. Answers to operations when lines go down. | CMMS work-order feed, eval scorecards, crawl coverage reports, cost per incident. | Reduced mean-time-to-repair, fewer repeat failures, documented fixes instead of tribal knowledge. |
| **User** — Floor Technician | Hourly or shift worker. Usually working alone. May not have a laptop. Has a smartphone. | Telegram/Slack chat interface or Open WebUI. Photo upload. Step-by-step diagnosis text. | Fast answers without waiting for the engineer. Confidence to fix things they've never seen before. |

The buyer signs and pays. The user adopts (or kills) the product with word-of-mouth. Both must win.

---

## 3. Customer-Ready Capability Table

| Capability | Status | Notes |
|-----------|--------|-------|
| **Conversational diagnosis (text)** | READY | FSM-driven, 5-phase (INIT→ASSET_ID→SYMPTOM_GATHER→DIAGNOSIS→CLOSE). Eval 10/10. |
| **Photo ingest → asset identification** | READY | Structured JSON output from nameplate photos via vision model (v2.7.0 / #220). Groq llama-4-scout vision confirmed. |
| **Manual lookup + scrape-trigger** | READY | `GET_DOCUMENTATION` intent fires vendor URL + async Apify crawl. Pilz confirmed end-to-end (#214). |
| **Safety escalation (LOTO keywords)** | READY | 21 safety keyword triggers → hard stop with de-energize instruction. Never routes to diagnosis FSM. |
| **Telegram adapter** | READY | Production. 9/9 tests. Only channel running live today. |
| **Slack adapter** | READY | Code-complete, tested. Needs customer's Slack workspace to wire up (no Azure/cloud setup required). |
| **Open WebUI chat (browser)** | READY | VPS path: phone → Open WebUI → mira-pipeline → GSDEngine. P0 UX fixes shipped (v0.5.4). |
| **LLM-as-judge eval (4-dimension Likert)** | READY (internal) | CUT-FOR-V1 as customer-facing feature. Running nightly internally. |
| **Active learning loop** | READY (internal) | CUT-FOR-V1 as customer-facing feature. 👎 → fixture → draft PR. Runs nightly. |
| **CMMS work-order trigger** | SHIP-BLOCKER | Atlas CMMS is running (#mira-cmms, port 8088). Work-order creation from bot conversation not yet wired end-to-end. Must demo before v1. |
| **Multi-vendor KB (VFDs, motors, PLCs)** | SHIP-BLOCKER | 20+ VFD fixture scenarios pass. KB coverage depends on crawl runs completing. Must confirm top 10 vendors have ≥5 chunks before v1 demo. |
| **Teams adapter** | CUT-FOR-V1 | Code-complete. Needs Azure Bot Service registration. Not blocking v1 — exclude from demos. |
| **WhatsApp adapter** | CUT-FOR-V1 | Code-complete. Needs WhatsApp Business API. Expensive + approval gated. Post-v1. |
| **Voice in / TTS out** | CUT-FOR-V1 | No implementation today. Kokoro TTS deferred post-MVP. |
| **Billing / Stripe** | CUT-FOR-V1 | No Stripe integration in codebase. V1 billing is manual invoice via email. |
| **Multi-tenant isolation** | SHIP-BLOCKER | `tenant_id` scoping exists in NeonDB. Must verify per-tenant KB isolation before putting two customers on the same instance. |
| **mira-web (Next.js frontend)** | CUT-FOR-V1 | Still calls sidecar `:5000/rag`. Cutover to mira-pipeline pending (#197). Not publicly routed. Exclude from v1. |
| **AR HUD** | CUT-FOR-V1 | Needs local terminal session, keychain blocks. Not customer-ready. |
| **CMMS Phase 4–6 (PM scheduling, asset registry)** | CUT-FOR-V1 | Atlas Phase 1–3 scope only for v1. Full PM automation is post-5-customer milestone. |
| **Free tier** | CUT-FOR-V1 | Kill per #271. No freemium in v1. Paid or nothing. |

**Ship-blockers summary (must fix before first customer):**
1. Work-order creation from bot → CMMS wired end-to-end
2. Multi-tenant KB isolation verified on staging
3. Top 10 vendor KB coverage confirmed (crawl runs)

---

## 4. Demo-Script-Able Use Cases

### UC-1: VFD Fault Code on the Shop Floor

**Setup:** Telegram or Slack connected to MIRA. Customer has a Yaskawa V1000 VFD in their facility.
**User actions:**
1. Tech texts: "Yaskawa V1000 showing OC fault, conveyor won't start"
2. MIRA asks: "Is the motor coupled to load or uncoupled right now?"
3. Tech: "Coupled, line was running when it tripped"
4. MIRA: Delivers OC (overcurrent) cause list, check sequence (accel time, load, cable), parameter to inspect (C1-01 accel time)
**Expected MIRA response:** Step-by-step with parameter names, thresholds, and a "safe to re-energize" checklist
**Outcome:** Tech clears the fault without calling the engineer. Time to resolution: under 5 minutes.
**Known bugs blocking this:** None — eval fixture `vfd_yaskawa` passes.

---

### UC-2: Nameplate Photo → Asset Identified → Diagnosis

**Setup:** Telegram. Tech has a motor they've never worked on.
**User actions:**
1. Tech sends a photo of the motor nameplate
2. MIRA responds with: manufacturer, model, frame size, voltage, FLA extracted from photo
3. Tech: "The overload relay is tripping every hour"
4. MIRA: Walks through thermal overload diagnosis (ambient temp, FLA setting, duty cycle check)
**Expected MIRA response:** Structured asset summary + diagnostic questions tailored to that specific motor
**Outcome:** Tech identifies wrong FLA setting on relay — resets and documents fix.
**Known bugs blocking this:** Gemini key blocked (403). Cascade falls to Groq llama-4-scout vision — confirmed working.

---

### UC-3: Manual Request → Crawl Triggered → Vendor URL Returned

**Setup:** Slack or Telegram.
**User actions:**
1. Tech: "Can you find a manual for the Pilz PNOZ safety relay?"
2. MIRA: Returns Pilz support URL immediately + "searching for documentation now"
3. Background: Apify crawl fires, chunks land in KB within ~2 minutes
4. Follow-up question: "What's the wiring diagram for the PNOZ X3?"
5. MIRA: Retrieves chunk from freshly indexed manual, answers with terminal labeling
**Expected MIRA response:** Fast URL + async crawl confirmation, then RAG-backed answer on follow-up
**Outcome:** Tech has the wiring diagram without leaving the chat.
**Known bugs blocking this:** None — Pilz end-to-end confirmed (`GET_DOCUMENTATION` → Apify run `9ELqsnRqp384TeoxJ`).

---

### UC-4: Safety Escalation

**Setup:** Any channel.
**User actions:**
1. Tech: "I need to check the wiring on a live panel, the disconnect is locked out but the panel is still energized"
2. MIRA: Immediately escalates — "STOP. This is a live-work situation. Do not proceed until the panel is fully de-energized and locked out under OSHA 29 CFR 1910.147."
**Expected MIRA response:** Hard stop. No diagnosis. Explicit LOTO reference.
**Outcome:** Tech does not work on live equipment. Liability protection for the buyer.
**Known bugs blocking this:** None — safety keyword "live panel" / "energized" triggers confirmed.

---

### UC-5: Work Order Creation After Fix

**Setup:** Telegram. After a successful diagnosis session.
**User actions:**
1. MIRA has walked tech through a pump bearing replacement
2. Tech: "Fixed it, bearing replaced"
3. MIRA: "Should I log a work order in the CMMS?"
4. Tech: "Yes"
5. MIRA: Creates WO in Atlas CMMS with asset ID, fault description, resolution, tech ID, timestamp
**Expected MIRA response:** "Work order #WO-XXXX created. Asset: [pump ID]."
**Outcome:** Fix is documented automatically. Manager sees it in Atlas.
**Known bugs blocking this:** SHIP-BLOCKER — bot→CMMS work-order creation not wired end-to-end yet. **This use case is blocked until that wire-up ships.**

---

## 5. Pricing for v1

### Competitive anchors
- PTC Vuforia Instruct / TeamViewer Frontline: $50–80/user/mo (AR-heavy, overkill for most shops)
- ServiceMax, UpKeep, Limble CMMS: $35–65/user/mo annually
- Typical 100-person manufacturer: $20–25K ACV at $20/user/mo is attainable
- Edmund's $135–350K Year 1 PdM model is NOT the target — that's ML-on-historian, enterprise procurement cycle

### Three options

| Option | Price | Model | Best For |
|--------|-------|-------|---------|
| **A — Per-seat monthly** | $29/user/mo (annual), $39/user/mo (M2M) | Predictable. Easy to quote. | Shops with 10–30 techs. Simple to understand. |
| **B — Per-site flat rate** | $499/mo per facility (up to 50 users) | Easy to sell to managers who hate per-seat. | Mid-size plants (30–100 techs). Manager-friendly. |
| **C — Starter pack + overage** | $299/mo (up to 10 seats) + $25/seat over 10 | Low barrier to start. Scales with customer. | Pilot-friendly. Best for "let us try it for 3 months." |

**Recommended: Option B — $499/mo per facility (flat rate).**

Reasoning: Maintenance managers don't want to count seats. They want one line on the P&L. A flat facility rate removes the "how many licenses do I need?" conversation. $499/mo = $5,988/yr — well within discretionary budget for a plant manager, no capital approval needed. At 5 customers that's $2,495 MRR / $29,940 ARR — meaningful proof before scaling pricing.

Annual prepay discount: 2 months free ($4,990/yr vs. $5,988 M2M).

---

## 6. The 5-Paying-Customer Definition

A customer counts toward the v1 milestone if ALL of the following are true:

1. **Signed agreement** — either a 12-month contract or a 3-month paid pilot agreement. Free trials do not count. POC with no payment commitment does not count.
2. **Payment received** — first invoice paid (ACH, credit card, or check). Payment pending does not count.
3. **Active deployment** — at least one technician has sent at least one diagnostic conversation through MIRA in the past 30 days.
4. **Not family/friends** — internal users, personal contacts testing the product, or barter arrangements do not count.
5. **Not us** — FactoryLM internal use does not count.

A "pilot" counts if points 1–4 are met with a paid pilot agreement at any dollar amount (even $99/mo). The purpose is to verify that someone other than us values it enough to exchange money for it.

**Milestone end condition:** 5 customers meeting all 5 criteria simultaneously for at least 30 days.

---

## 7. What's Explicitly NOT in v1

The following will NOT ship before the 5-customer milestone. If a PR or issue exists for these, it is frozen until milestone is hit.

| Item | Issue/Ref | Why Cut |
|------|-----------|---------|
| Free tier / freemium | #271 | Kill it. Freemium dilutes sales focus. Support cost with zero revenue. |
| mira-web → mira-pipeline cutover | #197, PR open | Still calls sidecar. Not blocking v1 since mira-web isn't publicly routed. |
| Teams adapter cloud setup | — | Azure Bot Service registration required. Not needed for first 5. |
| WhatsApp adapter | — | WhatsApp Business API approval gated + expensive. Post-v1. |
| Voice / TTS (Kokoro) | — | No implementation. Post-MVP. |
| Billing / Stripe integration | — | V1 billing is manual invoice. Stripe is post-5-customer. |
| CMMS Phase 4–6 (PM scheduling, asset registry, full workflow) | — | Atlas Phase 1–3 only. PM automation is a v2 upsell. |
| Gemini fine-tuning | — | No dataset yet. Long-horizon project. |
| Phase 3 monitoring dashboard (customer-facing) | #226 ref | Running internally. Not exposing to customers in v1. |
| AR HUD | — | Keychain issue + niche use case. Post-v1. |
| mira-sidecar removal | #195 | OEM migration (398 chunks) still pending. Leave it running. |
| LlamaIndex RAG upgrade | PRD exists | Hand-rolled RAG is working. Upgrade is post-5-customer. |

---

## 8. Sales Motion for First 5

**Where do they come from?**

1. **LinkedIn maintenance/MRO communities** — You already have engagement in the hydraulics group (#109). Post case study content from UC-1 and UC-2 above. Target: Maintenance Managers and Reliability Engineers. 2 posts/week, consistent for 8 weeks. Goal: 3 of 5 customers from this channel.

2. **Direct intros from shop-floor contacts** — Every tech you know who has worked in a plant. Ask for one warm intro to their manager. Goal: 1 of 5 from personal network.

3. **SMRP September 2026 annual conference** — Society for Maintenance and Reliability Professionals. Booth or speaking slot. Timing: after 5-customer milestone is already hit (use it to scale to 20, not to find 5). Don't wait for SMRP to find first customers.

4. **Targeted cold outreach** — LinkedIn Sales Navigator. Filter: title "Maintenance Manager" OR "Reliability Engineer", company size 50–500, industry "Manufacturing" OR "Food & Beverage" OR "Chemical". Sequence: 3-message cadence over 2 weeks. Personalize with plant type. Goal: 1 of 5 from outbound.

5. **G2 / Capterra** — Zero presence today. Takes 3–6 months to build reviews. Do NOT rely on this for first 5. Set up profiles now so they're ready when you have customers to write reviews.

**Message that lands:** "Your tech is standing in front of a broken machine at 2am. They text MIRA the fault code and get step-by-step fix instructions from the OEM manual — in 30 seconds. No PDF hunt, no waking up the engineer. We just need one machine in your facility and 15 minutes to demo it."

---

## 9. Definition of Done for v1

Before the first paying customer goes live, ALL of the following must be true:

| Metric | Target | How to Measure |
|--------|--------|----------------|
| Eval pass rate (binary checkpoints) | ≥ 9/10 | `python3 tests/eval/run_eval.py` — last scorecard before go-live |
| Eval judge score (Likert avg) | ≥ 3.5/5.0 on all 4 dimensions | Nightly judge scorecard |
| Crawl success rate on top 10 vendors | ≥ 80% SUCCESS or LOW_QUALITY on first attempt | `GET /ingest/crawl-verifications` last 50 runs |
| Mean response latency (text diagnosis) | ≤ 8 seconds P95 | mira-pipeline logs, measured over 24h with real traffic |
| Zero P0 bugs in `feedback_log` | 0 `/bad` ratings for 7 consecutive days | `feedback_log` table in SQLite |
| Multi-tenant KB isolation verified | 2 tenants, zero cross-tenant retrieval | Manual test: seed tenant A with fake KB, query from tenant B, assert zero match |
| CMMS work-order creation end-to-end | Demo UC-5 without bugs | Manual walkthrough with real Atlas instance |
| Safety escalation confirmed | LOTO keywords → hard stop, 0% routing to FSM | Eval fixture `safety_*` + manual test with "live panel" phrase |

---

*This doc is a working draft. Mike should edit sections 5 (pricing) and 6 (customer definition) before it drives any sales conversations. Section 4 (use cases) should be validated against actual system behavior before demo prep begins.*
