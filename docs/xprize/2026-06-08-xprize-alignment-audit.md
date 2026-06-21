# XPRIZE Alignment Audit — MIRA / FactoryLM

**Date:** 2026-06-08
**Competition:** Build with Gemini XPRIZE (geminixprize.com / xprize.devpost.com)
**Submission deadline:** Aug 17, 2026, 1:00 PM PT (~70 days out)
**Auditor stance:** Skeptical referee. Graded as if a judge sat down with the repo and the live sites for one afternoon. Every claim in the founder's own `xprize-registration-brief.pdf` and `xprize-70-day-sprint-plan.pdf` was treated as a hypothesis to verify, not a fact. Where the self-assessment was optimistic, this report says so.

> **One-line verdict:** MIRA has a genuinely differentiated story (real industrial domain depth, a real autonomous-ops fleet, real grounded-diagnosis engine) — but **as of today it would fail the two hard technical gates** (a *verifiably executing* Gemini call and a *distinct* Google Cloud product) **and score near-zero on Business Viability** ($0 revenue, Stripe in test mode). The AI-Native Operations pillar is the one place MIRA can already win. The path from "would be disqualified / bottom-quartile today" to "credible runner-up / category contender" is ~5 well-scoped engineering days plus one real customer.

---

## Scorecard at a glance

### The two hard technical gates (pass/fail, gate the whole submission)

| Gate | Status today | Why |
|---|---|---|
| **≥1 Gemini API call in the deployed app** | ❌ **Failing today (live-verified)** | **Live probe 2026-06-08:** every Gemini call path returns **HTTP 403 `PERMISSION_DENIED` — "Your project has been denied access"** — tested on both the OpenAI-compat chat endpoint (Bearer, `router.py` path) and native `generateContent?key=` (`route_fallback.py` path). **Both the `prd` *and* `dev` keys 403** → this is a **project-level ban on the GCP project the Gemini keys belong to** (the error is `"Your project has been denied access"`, and both keys share the ban), not a stale per-key issue. A fresh key on the same project will also 403. So **no Gemini call executes anywhere in production right now** — including the schematic-vision path that was the "strongest" evidence. Even if unblocked, Gemini is **position 3/3** in the chat cascade and never fires while Groq + Cerebras are healthy. |
| **≥1 Google Cloud product** | ⚠️ **Likely failing** | Every Gemini call hits `generativelanguage.googleapis.com` = **Google AI Studio**, not GCP. No Vertex AI, Cloud Run, GCS, BigQuery, Firestore, Cloud SQL anywhere. Production runs entirely on a **DigitalOcean** VPS. Google Drive Picker is wired (Workspace API, GCP project `246891599587`) but that's a Workspace product, not a GCP infra product. |

These two gates are the single most important finding in this report. They are both closable in **under one day combined** (see Action 1).

### The three judged criteria (each 33%)

| Criterion | Grade today | Trajectory by Aug 17 (with sprint) | Drivers |
|---|---|---|---|
| **Business Viability (33%)** | **D−** (hard requirement = real revenue = unmet; $0) | **C+ → B−** *if* 2–4 paid assessments + 1 pilot close | Stripe plumbing is real but **test mode**, wrong price routing, no live webhook. Zero customers. |
| **AI-Native Operations (33%)** | **B−** (strongest pillar) | **A−** with evidence polish + 1–2 deterministic "agents" given a real LLM decision | ~4–5 genuinely LLM-driven, scheduled, logged agents. Excellent exportable artifacts. But the "14 agents" claim is inflated — several are keyword scripts. |
| **Category Impact (33%) — Small Business Services** | **C−** (coherent thesis, zero demonstrated impact) | **B−** with one real SMB pilot + a sample deliverable | ICP/pricing genuine and well-reasoned. But 0 customers, broken HubSpot push, the $500 Assessment has no deliverable template, and the lead list skews Fortune-500 (Pfizer, Publix, US Sugar). |

### Supporting-area grades (feed the criteria above)

| Area | Grade | Headline |
|---|---|---|
| A. Gemini compliance | **C+** | Wired into 5 prod services, but key 403'd + dormant 3rd-tier fallback |
| B. Google Cloud usage | **D** | AI Studio ≠ GCP; zero distinct GCP product; DigitalOcean host |
| C. AI-native operations | **B−** | ~4–5 real LLM agents + strong logs; "14 agents" is inflated |
| D. Production readiness | **C+** | Both sites UP; marketing B+, Hub C− (7 "Coming Soon" stubs, unauth no-rate-limit LLM endpoint) |
| E. Revenue infrastructure | **D+** | Full Stripe flow built, but TEST mode + wrong price + no live webhook |
| F. Demo-ability | **C+** | Engine works (47/57, citations enforced); best demos aspirational/off-branch |
| G. Category impact | **D+** | Real positioning, zero traction, no deliverable artifact |

---

## A. Gemini API Compliance — Grade C+

**Requirement:** "At least one Gemini API LLM call in the deployed/production application."

### Where Gemini is actually called in production code

| Path | File | Role | Fires when? |
|---|---|---|---|
| Chat cascade | `mira-bots/shared/inference/router.py:133-183` | 3rd provider (Groq → Cerebras → **Gemini**), model `gemini-2.5-flash`, endpoint `generativelanguage.googleapis.com/v1beta/openai/chat/completions`, raw `httpx`, `LLM_CALL provider=gemini` logging + `api_usage` SQLite row | **Only if Groq AND Cerebras both fail** — never under normal operation |
| Schematic vision | `mira-mcp/schematic_intelligence.py:138-193` | **Direct, non-cascaded** — Gemini is the only vision provider, fires first & exclusively for schematic/nameplate image analysis | Every image-analysis call (low traffic) — **strongest compliance evidence** |
| Manual URL discovery | `mira-core/mira-ingest/route_fallback.py:279-308` | Gemini tried **first**, native `v1beta/models/{model}:generateContent` endpoint | Every OEM-manual URL discovery (admin-triggered) |
| Hub cascade (×3) | `mira-hub/src/lib/llm/cascade.ts`, `.../api/reports/generate/route.ts`, `.../api/assets/[id]/chat/route.ts` | Same Groq → Cerebras → **Gemini** pattern, inline | 3rd-tier fallback only |

Production containers wired with `GEMINI_API_KEY` (per `docker-compose.saas.yml`): `mira-pipeline-saas`, `mira-bot-telegram`, `mira-bot-slack`, `mira-mcp-saas`, `mira-hub`.

**Dev-only (do NOT count for "deployed app"):** `graphify`/orchestrator KG (`wiki/orchestrator/kg/` — uses `dev` key, its README literally says *"The prd Gemini key is 403-blocked — use dev"*), `mira-scan-monday`, `mira-machine-logic-graph`, CI `code-review.yml`, `tests/eval/judge.py`.

### Live verification (2026-06-08)

I did not take the docs at their word — I probed the actual keys:

```
prd  generateContent(?key=)        → 403   openai-compat-chat(Bearer) → 403
dev  generateContent(?key=)        → 403   openai-compat-chat(Bearer) → 403
body: {"error":{"code":403,"message":"Your project has been denied access. Please contact support.","status":"PERMISSION_DENIED"}}
```

**Both keys, both call forms, 403 `PERMISSION_DENIED`.** This is worse than the docs say: it is a **project-level access ban on the GCP project the keys belong to** (`"Your project has been denied access"`), not a per-key expiry. The `wiki/orchestrator/kg/README.md` "use dev" workaround is **also dead**. Consequence: **Gemini is provably non-functional in production today** — the chat cascade silently skips it, and the schematic-vision path (the one unconditional caller) 403s on every image. The repo's claim "no artifact proves a real prod Gemini call ever completed" is now backed by a live failure artifact.

### Why the grade is only C+

1. **Every Gemini path 403s today (live-tested above).** A judge testing any surface observes zero Gemini execution. The integration *code* is correct (hence C+ not F), but the *execution* requirement is unmet. Docs corroborate: `docs/known-issues.md` (2026-05-26), `CLAUDE.md:157`, `tests/eval/README.md:43`, `wiki/orchestrator/kg/README.md`.
2. **In the primary chat path Gemini is last** — a judge testing the Telegram/Slack bot will *never observe Gemini* unless they first break the two upstream providers.
3. **`AGENTS.md:5` is stale and contradicts the code** — it lists `Gemini → Groq → Cerebras → Codex` (Gemini first, and still references Anthropic/Codex). `router.py` builds the reverse. This actively misleads a doc-reading judge.
4. **No artifact proves a real prod Gemini call ever completed** — the vision smoke fixture (`tests/eval/fixtures/vision_gemini_smoke.yaml`) is explicitly "no live API call in CI."

### Recommendations (ranked)

1. **Get Gemini access onto a *clean* GCP project — a new key on the currently-banned project will not work** (the whole project is denied access; live-verified, both keys). Two real options: (a) create a brand-new Google AI Studio project + key and swap it into Doppler `prd`/`dev`, or (b) go straight to **Vertex AI on a fresh GCP billing project** (see §B — this also closes the Google-Cloud gate). Verify with the same curl above expecting `200`. *Nothing else in this section matters until a Gemini call returns 200.*
2. **Add a dedicated guaranteed-Gemini route** (e.g. `POST /api/v1/analyze/gemini` in `mira-pipeline`, no fallback, `GEMINI_DIRECT_CALL` log line) so a judge has one URL that provably uses Gemini.
3. **Prefer Gemini-first for image requests** in `router.py` (it's already the best vision model) — makes Gemini the *primary* provider for the photo-diagnostics feature.
4. **Surface a `provider-stats` endpoint** reading `api_usage` so a live demo can show `"gemini": N` calls.
5. Fix `AGENTS.md`; remove the "Gemini blocked" line from `known-issues.md` once the key works.

---

## B. Google Cloud Product Usage — Grade D

**Requirement:** "At least one product from Google Cloud."

- **Gemini = Google AI Studio**, not GCP. Endpoint is `generativelanguage.googleapis.com` everywhere (`router.py:175`, `schematic_intelligence.py:178`, `judge.py:52`). Zero Vertex AI (`aiplatform.googleapis.com`) anywhere.
- **Google Drive Picker is wired** (`mira-hub/src/components/UploadPicker.tsx`, `.../api/picker/google/token/route.ts`, Doppler `GOOGLE_PICKER_API_KEY` + `GOOGLE_CLOUD_PROJECT_NUMBER=246891599587`) — but Drive API is a **Workspace** product, weak as a "GCP product" claim.
- **Google Chat bot code exists** (`mira-bots/gchat/`) but is **not in `docker-compose.saas.yml`** — not deployed.
- **Zero** Cloud Run / Cloud Functions / Vertex / GCS / BigQuery / Firestore / Cloud SQL / Pub/Sub. Production = **DigitalOcean VPS `165.245.138.91`** (ATL1).

If judges require an unambiguous GCP product, this is closer to an **F**; the D reflects that a real Google API (Gemini) and Google OAuth/Drive are live.

### Fastest legitimate path (ranked by effort × defensibility)

| Option | GCP product | Effort | Defensibility |
|---|---|---|---|
| **Switch Gemini calls to Vertex AI endpoint** (same model, billed via GCP project, OpenAI-compat shim) | **Vertex AI** | **1–2 d** (service account + billing + a *clean* project — the existing project is banned) | **Excellent — kills gates A *and* B at once** |
| Deploy one route (schematic-intel or report generator) on **Cloud Run** | Cloud Run | 1–2 d | Excellent |
| Store assessment-report PDFs / agent logs in **GCS** | Cloud Storage | 4–8 h | Good |

**Recommended:** Use the **$300 free GCP credits** → spin up a **fresh GCP project** (the keys' current project is access-banned) → enable Vertex AI → service account → `GEMINI_USE_VERTEX=true` with the Vertex OpenAI-compat endpoint in `router.py`. This single change makes Gemini a *Vertex AI* (GCP) call **and** gives a guaranteed-execution Gemini path — closing both hard gates in one session. (Do **not** misrepresent AI Studio as Vertex in docs; judges can test the endpoint.)

---

## C. AI-Native Operations — Grade B− (the strongest pillar)

**Requirement:** "The extent to which AI is live in production and executes key decisions continuously."

The founder claims ~14 autonomous agents. Verified count of **genuinely LLM-driven + scheduled + logged** agents is **~4–5**. Several "agents" are deterministic keyword scripts wearing an AI label.

### Agent verification (condensed)

| Agent | Exists | Scheduler (verified) | LLM-driven? | Evidence location | Grade |
|---|---|---|---|---|---|
| **Eval Regression + Eval-Fixer** | ✅ | launchd `com.factorylm.mira-offline-eval` (4h) + `com.mira.eval-fixer` (01:00) + GHA weekly | **YES** — live cascade + LLM-judge + `claude --print` patch/PR agent | `tests/eval/runs/` (50+ files), `/tmp/mira-eval-fixer.log` | **A** |
| **Slack Agent** | ✅ | launchd `com.mira.slack-agent` (RunAtLoad/KeepAlive) | **YES** — pydantic-ai + Groq | `/tmp/mira-slack-agent/*.log` | **A** |
| **PR Code Review** | ✅ | GHA on every PR | **YES** — Groq→Cerebras→Gemini review + self-fix | PR comments, `code-review.yml` runs | C (the *merge-sweep decision* itself is deterministic) |
| **Orchestrator Pulse** | ✅ | "Cowork 4h" — **launchd not found on CHARLIE** | **NO** (scan/score are keyword-weight Python; KG build via Gemini is a separate manual step) | `wiki/orchestrator/{HISTORY,STATE,BETA_READINESS}.md`, `artifact.html` | C |
| **Lead Discovery / Enrichment** | ✅ | launchd `com.mira.lead-hunter` (hourly, **confirmed running**) | **NO** — `ICP_WEIGHTS` keyword table, Hunter.io + scraping, zero LLM | `marketing/prospects/hardening-alerts.jsonl` (3,557 discovered), `lead-hunter.log` | B running / D not-AI |
| **Competitive Intel** | ✅ output | **no scheduler found** | YES (clearly LLM-synthesized) | `competitors-2026-06-08.md` etc. | B output / D unscheduled |
| **QA Regression** | ✅ | GHA `0 */2 * * *` | YES (skip-guarded until `TELEGRAM_TEST_SESSION_B64` set) | GHA logs | B |
| Inbox Triage, Morning Brief, KB-Growth cron, Uncommitted-Nag, Stale-Branch | partial | mostly unverified / VPS-only / subsystem of Pulse | mostly NO | scripts only | D |

### Crown-jewel evidence (screenshot these for the submission)

1. **`wiki/orchestrator/BETA_READINESS.md`** — 6-lens auto-generated audit with file:line findings. The single most impressive AI-governance artifact; could not be faked at this cadence.
2. **`tests/eval/runs/`** — 50+ timestamped runs (through `2026-06-08T1554`); open one to show live output.
3. **`marketing/prospects/hardening-alerts.jsonl`** — continuous hourly autonomous runs.
4. **`wiki/orchestrator/HISTORY.md`** — 6 weeks of 4h SHIP/FINISH/DEFER/KILL decisions.
5. The installed launchd plists (`com.mira.lead-hunter`, `com.factorylm.mira-offline-eval`, `com.mira.eval-fixer`, `com.mira.slack-agent`) — proof the fleet is *installed*, not aspirational.

### Honesty fixes before submission

- **Don't claim "14 agents."** Claim ~5 real LLM-driven agents + a governance layer, and lead with Beta-Readiness. Inflation invites a judge to find the keyword scripts.
- **Give Lead Discovery a real LLM ICP score** (one Groq/Gemini call per company) — biggest credibility gain for least work; makes the "AI scores leads" claim true.
- **Confirm/install schedulers** for Orchestrator Pulse and Competitive Intel (launchd plist or GHA cron) or drop the "scheduled" claim for them.
- Note in the narrative: HubSpot push is broken (`hs_pushed=0` every run) — fix or don't claim CRM automation.

---

## D. Production Readiness — Grade C+

Both live sites are **UP** (curl 2026-06-08): `factorylm.com` → 200, `app.factorylm.com` → 301→200, `/assess` 200, `/blog` 200, `/signup` 200.

- **Marketing (`mira-web`, factorylm.com): B+** — fast, honest, polished. Homepage, `/assess`, `/blog`, `/limitations`, `/pricing`, `/buy`, register flow all work. Deduction: `/demo/work-orders` is static ticker data; value is behind a payment wall.
- **Hub (`mira-hub`, app.factorylm.com): C−** — signup renders (Google OAuth + email/pw), but a fresh user hits **7 Labs-gated "Coming Soon" stubs** (`conversations, alerts, team, requests, parts, documents, reports`), `/channels` has a literal "Coming Soon" badge, `/namespace` + `/schedule` are partial placeholders. Core "upload manual → cited answer" is behind auth + approval + (potentially) payment — **not reachable by a stranger in one session**.
- **Sharpest credibility risk:** `/api/quickstart/ask` is a **public, unauthenticated LLM endpoint with no rate limit** (drains shared Groq/Cerebras/Gemini free tier). A patch already exists: `patches/2026-06-07-quickstart-rate-limit.patch`.
- **Infra: B** — staging-gate + smoke-gate + bypass audit trail in `deploy-vps.yml`. Caveats: smoke test runs against localhost, not the live public URLs; `mira-web` is **not** in default deploy `TARGETS`; the 2026-06-04 502 (container removed, self-healer can't recreate) shows an ops gap.

**Top fixes:** (P1) hide or fill the 7 Coming-Soon nav items; (P2) apply the quickstart rate-limit patch; (P3) make the public `/quickstart` "ask a VFD fault question, get a cited answer in <60s, no signup" the hero CTA; (P4) add `mira-web` to deploy targets; (P6) seed demo data + document a demo login.

---

## E. Revenue Infrastructure — Grade D+

The Stripe integration is **real and complete** — `mira-web/src/lib/stripe.ts` (checkout, direct checkout, portal, webhook construct), three checkout routes (`server.ts:946-1042`), webhook handler (`server.ts:1044-1243`) writing `stripe_customer_id/subscription_id` to `plg_tenants` + triggering Hub activation, PostHog funnel events. **1 click** from `/buy` to the Stripe page.

But **no real dollar can move today:**

1. **TEST MODE.** `STRIPE_SECRET_KEY` = `sk_test_51SiegW…` (confirmed in Doppler `prd`). Corroborated in `docs/system-health-2026-05-15.md`, `scripts/demo-preflight.sh:129`, and the Florida-expo runbook. Still test as of 2026-06-08.
2. **Wrong price routing.** The `/buy` page advertises a **$500 one-time Assessment**, but `GET /api/checkout/session?plan=assessment` **ignores the `plan` param** and charges `STRIPE_PRICE_ID` = the **$97/mo subscription**. The Hub `/upgrade` page documents this gap explicitly. A buyer clicking "Book Your Assessment — $500" would be enrolled in $97/mo recurring.
3. **No live webhook.** `STRIPE_WEBHOOK_SECRET` is the test-account secret; after flipping to live, `checkout.session.completed` would fail signature verification → paid accounts wouldn't activate.
4. **Two contradictory pricing motions** ($500 / $2–5K-mo / $499-mo services vs. $97/mo SaaS) — documented as an unresolved fork in `docs/strategy/services-vs-saas-pricing-fork.md`; ADR-0014's "single source of truth" decision is unfulfilled.

**Fastest path to first dollar (~4–6 h, mostly Mike's manual Stripe steps):** flip to live keys → register live webhook at `https://factorylm.com/api/stripe/webhook` → either create a live $500 one-time **Stripe Payment Link** (15-min, zero code) for the Assessment *or* add `STRIPE_ASSESSMENT_PRICE_ID` + `plan` routing in `server.ts:947` → redeploy `mira-web` → test-charge from a real card.

---

## F. Demo-ability — Grade C+

| Demo | Verdict | Evidence |
|---|---|---|
| **Grounded VFD diagnosis w/ cited evidence** | **WORKS** | `tests/eval/runs/2026-06-08T1554-offline-text.md`: **47/57 (82%)**, `CitGrond ✓` all 57, **3 identical runs today** against live Groq cascade. `gs10_overcurrent_01` & `full_diagnosis_happy_path_07` pass 6/6 every run. Citation enforced once at `engine.py:672`. |
| SimLab bottling line | **ASPIRATIONAL** | `tests/simlab/` has framework + 5 scenario YAMLs but **no `runs/` dir** (never executed) and **no bottling scenario**. |
| Garage conveyor / Fault Detective | **PARTIAL** | Real hardware + `plc/live_monitor.py` + screenshots (`docs/promo-screenshots/2026-06-02_command-center-conveyor-running-30hz_desktop.png`). But `docker-compose.fault-detective.yml` is **BENCH-ONLY**, hardware-dependent, requires deployed Modbus map. |
| Hub KG graph (`/knowledge/map`) | **WORKS (thin data)** | NaN crash **fixed** (`GraphCanvas.tsx:88` finite-coord guard); renders real `kg_entities/relationships` but data is sparse (`same_model=0`). |
| Train-before-deploy Validate tab | **PARTIAL** | PRs #1781/#1783/#1790 merged to `origin/main`, but current branch `feat/orchestrator-kg-query` shows **mock data** in `assets/[id]/page.tsx`, no Validate tab — **checkout main to demo**. |

**Known correctness bug (disclose, don't hide):** `vfd_danfoss_04` cites a **Siemens** manual for a **Danfoss** question and still reads `CitGrond ✓` — the check verifies tag *presence*, not *relevance*. The "offline" eval also hits live Groq, so 82% carries ±5% noise (47/50/47/47 across runs).

**Film recommendation:** the grounded `gs10_overcurrent_01` flow, side-by-side vs. ChatGPT's generic answer, then cut to the eval scorecard as proof-of-rigor. Runs today, no hardware, no branch switch, not a cherry-pick.

---

## G. Category Impact (Small Business Services) — Grade D+

**Real:** ICP is explicitly SMB/mid-market (50–500 employees, 2–20 techs — `STRATEGY.md`), pricing is coherent ($500 Assessment / $2–5K-mo Pilot / $499-mo Operating Layer), pain articulation is credible (tribal knowledge, filing-cabinet manuals, PLC-tag mismatch), the `/assess` scorecard is **live and functional** (`mira-web/public/assess.html`, 692 lines, radar chart).

**Aspirational / unproven:**
- **Zero customers, zero pilots, zero case studies, zero revenue.**
- **HubSpot push broken** — 655 facilities scraped to NeonDB, **0 ever pushed** (`HUBSPOT_ACCESS_TOKEN` missing). "Pipeline" is a scrape with **0 enriched personal contacts**.
- **The $500 Assessment has no deliverable** — no gap-report template, no sample, no namespace-blueprint artifact. The product sold is undefined.
- **Lead list skews enterprise** — top "leads" are Publix, Mosaic, Pfizer, US Sugar, US Foods (Fortune 500), contradicting the 50–500-employee ICP.
- Core transformation deliverables (PLC-tag reconciliation, PM extraction, tribal-knowledge capture) are `NORTH_STAR.md`-labeled **NOT BUILT**.

**To make the category fit convincing:** (1) one real SMB pilot with a before/after artifact; (2) a sample gap-report/namespace-blueprint template; (3) fix HubSpot auth; (4) filter the lead list to true SMBs; (5) confirm the full 20-question `/assess` flow end-to-end.

---

## Ranked gap list (severity × effort)

| # | Gap | Severity | Effort | Closes |
|---|---|---|---|---|
| 1 | **Gemini non-functional in prod — the keys' GCP project is access-banned (403, live-verified both keys); + Gemini is last-in-cascade** | 🔴 Gate | 0.5–1.5 d (needs a *new* project, not a new key) | Hard gate A |
| 2 | **No distinct Google Cloud product** | 🔴 Gate | 1–2 d (Vertex AI on a fresh billing project — OAuth/service-account, not a drop-in key) | Hard gate B (with #1) |
| 3 | **$0 revenue / Stripe in test mode + wrong price routing + no live webhook** | 🔴 Critical | 0.5 d plumbing + outreach weeks | Business Viability |
| 4 | **Zero customers / no SMB pilot / no deliverable template** | 🔴 Critical | weeks (sales) + 0.5 d (template) | Business Viability + Category |
| 5 | 7 Hub "Coming Soon" stubs + unauth no-rate-limit `/quickstart/ask` | 🟠 High | 0.5 d | Production readiness (judge session) |
| 6 | "14 agents" inflated; lead-scoring not actually AI; 2 schedulers unverified | 🟠 High | 0.5–1 d | AI-Native credibility |
| 7 | HubSpot push broken (0 leads pushed since April) | 🟠 High | 0.25 d | Category / ops |
| 8 | Citation-relevance bug (wrong-vendor manual passes green) | 🟡 Med | 0.5–1 d | Demo trust |
| 9 | Validate tab / best visual demos on `main`, not current branch | 🟡 Med | 0.25 d (checkout/merge) | Demo |
| 10 | `AGENTS.md` stale (Gemini-first + Anthropic refs), `mira-web` not auto-deployed | 🟡 Med | 0.25 d | Doc/ops hygiene |

---

## Top 10 highest-impact actions (do in this order)

1. **Stand up Gemini on a *fresh* GCP project via Vertex AI** (`GEMINI_USE_VERTEX=true`, Vertex OpenAI-compat endpoint, service account + billing, $300 GCP credits). The keys' current GCP project is access-banned (403, live-verified — a new key on it won't help), so a clean project is required *anyway* — doing it as Vertex closes **both** hard gates at once. ~1–2 d (OAuth/service-account/billing setup, not a drop-in key swap — estimate, not a promise). *Without this the submission risks technical disqualification.*
2. **Add a guaranteed-execution, Gemini-tagged route** (`/api/v1/analyze/gemini`) + a `provider-stats` endpoint reading `api_usage`, so judges can *see* live Gemini/Vertex calls. ~0.25 d.
3. **Flip Stripe to live + register live webhook + fix the $500 Assessment price** (Payment Link is the 15-min path). Unblocks the first real dollar. ~0.5 d.
4. **Publish the `/assess` → $500 checkout funnel and start outreach to the warm Florida leads + expo contacts** (Shingle & Gibb, Aercon). The clock on "real arms-length revenue" starts now. (Sales, ongoing.)
5. **Write a sample DT Assessment deliverable** (gap report + namespace blueprint, even anonymized) so the $500 offer is a defined product. ~0.5 d.
6. **Make the public `/quickstart` the hero "try it free, cited answer in <60s" path + apply the rate-limit patch.** Gives a stranger (and a judge) instant value without signup. ~0.5 d.
7. **Hide or fill the 7 Hub "Coming Soon" stubs + the `/channels` badge** so a judge never hits a dead end. ~0.5 d.
8. **Give Lead Discovery a real per-company LLM ICP score + fix HubSpot push.** Turns a keyword script into a true AI agent and a real CRM. ~0.5 d.
9. **Package the AI-Native evidence pack** (Beta-Readiness 6-lens, eval `runs/`, lead-hunter JSONL, orchestrator HISTORY, launchd plists) and confirm Orchestrator-Pulse + Competitive-Intel schedulers are actually installed. ~0.5 d. *This is where MIRA wins points — make it bulletproof.*
10. **Film the 3-min video around the grounded `gs10_overcurrent_01` diagnosis** (cited vs. ChatGPT generic + eval scorecard), and fix the citation-relevance bug first so the demo can't be impeached. ~1 d.

---

## "Submit today" vs. "Submit Aug 17 with sprint"

| Pillar | **Submit today** | **Submit Aug 17 (sprint executed)** |
|---|---|---|
| Hard gate: Gemini executing | ❌ Fail (every path 403s — project access-banned, live-verified) | ✅ Pass (Gemini on a fresh project via Vertex + dedicated route) |
| Hard gate: Google Cloud product | ⚠️ Fail-risk (AI Studio only, no distinct GCP product) | ✅ Pass (Vertex AI / Cloud Run) |
| Business Viability (33%) | **D−** — $0 revenue, test-mode Stripe | **C+ → B−** — 2–4 paid assessments + 1 pilot ($2.5–11K), live Stripe export + P&L |
| AI-Native Operations (33%) | **B−** — real but inflated, some schedulers unverified | **A−** — ~5 honest LLM agents, full evidence pack, real LLM lead-scoring |
| Category Impact (33%) | **C−** — coherent thesis, zero proof | **B−** — ≥1 named SMB pilot + deliverable + testimonial |
| **Realistic outcome** | **Disqualification-risk or bottom quartile** | **Credible runner-up ($50K) / Small-Business-Services category contender ($50K); Top-5 if revenue + demo land** |

**Bottom line for the founder:** The differentiation is genuine and rare in this field — don't let it die on two checkbox gates and a test-mode Stripe key. Actions 1–3 (≈2–3 engineering days, with the Vertex/GCP project setup the long pole) move MIRA from *likely-disqualified* to *technically compliant with a real revenue path*. The most urgent single fact in this report: **the Google Cloud project behind every Gemini key is access-banned — a fresh key won't fix it, you need a clean project (do it as Vertex AI and you also satisfy the GCP-product gate).** Everything after that is execution: one customer, one deliverable, one clean demo, and a disciplined evidence pack around the AI-ops fleet you already run.

---

*Evidence basis: full-repo audit 2026-06-08 across `mira-bots/`, `mira-mcp/`, `mira-core/`, `mira-hub/`, `mira-web/`, `mira-pipeline/`, `plc/`, `tools/`, `tests/`, `wiki/`, `docs/`, `marketing/`, `docker-compose.saas.yml`, `.github/workflows/`, Doppler `factorylm/prd` (names only), and live curl of factorylm.com / app.factorylm.com. Graded against `xprize-registration-brief.pdf` + `xprize-70-day-sprint-plan.pdf`.*
