# MIRA Demo-Readiness Punch List

**Date:** 2026-06-05
**Author:** Claude Code (CHARLIE) — audit of the three demo surfaces
**Goal:** Know exactly what works, what's broken, and what to fix before Mike records demo videos.
**Method:** Live HTTP probing (GET-only, no prod mutations) + full source analysis + Ignition gateway probing over Tailscale.
**Detailed evidence:** `docs/demos/_audit/hub-audit.md`, `marketing-audit.md`, `ignition-audit.md` (cited file:line for every claim).

---

## TL;DR — Brutal Honesty

| Surface | Verdict | One-line summary |
|---|---|---|
| **factorylm.com** (marketing) | 🟢 **Nearly ready** | All 22 public routes 200. ONE real bug: `/assess` radar chart is blank in every browser (CSP). One messaging conflict (free-trial vs paid-only). Both fixable in <1h. |
| **app.factorylm.com** (Hub) | 🟡 **Conditional** | Container healthy, ~30 routes load. But **7 pages show "Coming Soon"**, **4 pages show hardcoded fake data**, and the **real pages are empty unless the demo tenant is seeded**. Needs data + a scripted nav path. |
| **Ignition "Ask MIRA" panel** | 🔴 **Cannot shoot today** | Two hard blockers: the cloud chat secret (`MIRA_IGNITION_HMAC_KEY`) doesn't exist in Doppler → every turn 503s; and the WebDev module isn't deployed to the gateway → panel iframe 404s. ~30–60 min of ops to unblock. |

**The single fastest path to a recordable demo is the marketing site + the Hub conveyor/diagnostic flow once seeded. The Ignition panel needs two ops actions before it can be filmed at all.**

---

## 1. Hub Pages (app.factorylm.com) — Route-by-Route

Container `mira-hub` is **UP / healthy** on the prod VPS (`127.0.0.1:3101`, fronted by app.factorylm.com). `NEXT_PUBLIC_LABS_ENABLED` is **UNSET** in prod and staging — confirmed.

**Legend:** 🟢 demo-ready · 🟡 ready *if data seeded* · 🔴 blocker (empty/fake/coming-soon) · ⚪ not a content page

### Real-query pages (good once the demo tenant has data)
| Route | Data source | Verdict | Note |
|---|---|---|---|
| `/` → `/feed` | `/api/work-orders`, `/api/pm-schedules` | 🟡 | Empty = "All caught up" placeholder. Seed WOs+PMs. |
| `/namespace` | `/api/namespace/tree` | 🟡 | Empty = "Your namespace is empty". Seed UNS tree. |
| `/assets` | `/api/assets` | 🟡 | Empty = "No assets found". Seed 4–6 assets. |
| `/workorders` | `/api/work-orders` | 🟡 | Empty = "No work orders". Strong page once seeded. |
| `/schedule` | `/api/pm-schedules` | 🟡 | Empty calendar = boring but safe. |
| `/knowledge/map` | `/api/kg/graph` | 🟡 | Empty = **blank dark canvas (bad)**. Needs ingested manuals/entities. |
| `/knowledge/manuals` | `/api/knowledge`, `/api/uploads` | 🟡 | Empty = upload CTA (acceptable). |
| `/knowledge/suggestions` (`/proposals` redirects here) | `/api/proposals` | 🟡 | Empty = helpful CTA. |
| `/command-center` | `/api/command-center/tree` (10s poll) | 🟡 | Empty = "No equipment yet". Live iframe depends on Ignition gateway. |
| `/event-log`, `/usage` | `/api/events` | 🟡 | Empty unless diagnostic events exist. |
| `/channels` | `/api/auth/status` | 🟢 | Real connector config; renders fine regardless. |
| `/workorders/new`, `/workorders/[id]` | real APIs | 🟢/🟡 | Wizard works; detail rich if WO seeded. |
| `/scan` | camera API | 🟢 | Functional QR scanner. |
| `/onboarding`, `/quickstart` | real | 🟢 | Wizards render with no data. |
| `/login`, `/signup` | static forms | 🟢 | Clean, branded. Login flow works. |
| `/admin/*` | real NeonDB | 🟢 | Users/roles/review queue real (admin-only). |

### 🔴 DEMO_BLOCKER pages — DO NOT navigate to these on camera

| Route | Why it embarrasses | Source |
|---|---|---|
| `/reports` | "Coming Soon" (Labs-gated). Behind it: hardcoded MTTR/MTBF charts. | `reports/page.tsx:57` |
| `/alerts` | "Coming Soon" (Labs-gated). | `alerts/page.tsx:84` |
| `/conversations` | "Coming Soon" (Labs-gated). | `conversations/page.tsx:83` |
| `/documents` | "Coming Soon" (Labs-gated). Use `/knowledge/manuals` instead. | `documents/page.tsx:41` |
| `/parts` | "Coming Soon" (Labs-gated). | `parts/page.tsx` |
| `/requests` | "Coming Soon" (Labs-gated). | `requests/page.tsx` |
| `/team` | "Coming Soon" (Labs-gated) — even though it also has a real `/api/team` query. | `team/page.tsx:104` |
| `/integrations` | **Hardcoded lies**: Atlas "connected, 47 assets, 312 WOs, synced 2 min ago" — none real. Use `/channels` instead. | `integrations/page.tsx:29-38` |
| `/assets/[id]` → Activity / Work Orders / Parts tabs | **Hardcoded mock** showing "John S.", "WO-2026-007", "Air Compressor #1" regardless of the actual asset. Only demo the **Overview** and **Ask MIRA** tabs. | `assets/[id]/page.tsx:42-71` |
| `/parts/[id]` | Always shows the same fake part. | `parts/[id]/page.tsx:21` |
| `/documents/[id]` | Always shows the same fake doc (only reachable via Labs-gated `/documents` anyway). | `documents/[id]/page.tsx:19` |

### ⚪ Routes Mike named that DO NOT EXIST (will 307 → login on camera)
| Asked-for route | Reality | Use instead |
|---|---|---|
| `/discovery` | No Hub page (fieldbus discovery is a `plc/` CLI tool; PR #1589 put inventory inside Command Center). | `/command-center` |
| `/settings` | No Hub page. | `/channels` (connectors) + `/integrations` (CMMS) |
| `/plc` | No Hub page. | `/command-center` |
| `/assets/[id]/signals` | API route only, not a page. | `/assets/[id]` → Intel tab |

---

## 2. Marketing Site (factorylm.com)

Served by `mira-web` (Hono/Bun), container UP/healthy. **All 22 public routes return 200.** Professionally designed, no lorem ipsum, mobile-responsive, SSL valid (Let's Encrypt, expires **2026-08-27**, confirm certbot auto-renew before then).

**Pricing is correct** — matches `NORTH_STAR.md` exactly: Assessment **$500**, Pilot **$2–5K/mo** (3-mo min), Operating Layer **$499/mo**. No stale $97/mo anywhere.

### 🔴 DEMO_BLOCKER
1. **`/assess` radar chart is blank in every browser.** `assess.html:26` loads Chart.js from `cdn.jsdelivr.net`, which is **not** in the nginx `script-src` CSP (`'self' unsafe-inline unpkg.com js.stripe.com us-assets.i.posthog.com`). The radar — the scorecard's hero visual — silently fails. **Fix:** change the CDN to `https://unpkg.com/chart.js@4.4.1/dist/chart.umd.js` (already whitelisted). One line, no nginx change. **Note:** unpkg serves the un-minified `chart.umd.js` — npm ships no `.min.js` for chart.js (jsdelivr auto-minifies; unpkg does not). ✅ **Applied in working tree** `mira-web/public/assess.html:26`.
2. **Messaging conflict — Mike's decision.** Home hero says *"Try MIRA Free → 7-day free trial, no credit card."* Pricing page shows **three paid offers, no free tier**. `app.factorylm.com/signup` *is* a real free-account page. On camera a viewer asks "so is it free or not?" and the site contradicts itself. Pick one: (a) surface the free Hub account on pricing + align hero copy, or (b) change hero CTA to "Book Your Assessment →" and drop the trial line. (`home.ts:99,102,507`)

### 🟡 Nice-to-have
- `/assess` footer link `href="/privacy.html"` 404s → should be `/privacy` (`assess.html:274`).
- `/sample` shows "workspace will appear here once Phase 1 ships" to signed-in users (`cmms.ts:414`).
- `/feature/mira-ai` returns 404 (route not registered) — fine unless linked.

---

## 3. Ignition Module + "Ask MIRA" Panel

**Split verdict:** the cloud endpoint and the Perspective panel are **both blocked**, by different things.

| | Cloud chat endpoint `POST /api/v1/ignition/chat` | Perspective "Ask MIRA" panel |
|---|---|---|
| Container/gateway | 🟢 `mira-pipeline-saas` UP, engine healthy (`{"status":"ok","engine":true,"version":"0.5.3"}`), route mounted, HMAC guard active | 🟢 PLC-laptop gateway UP via Tailscale (`100.72.2.99:8088`, `StatusPing → RUNNING`), Perspective page renders, `MiraPanel` view present |
| **Blocker** | 🔴 `MIRA_IGNITION_HMAC_KEY` **missing from Doppler `factorylm/prd`** → every POST returns `503 {"detail":"Ignition HMAC key not configured"}` | 🔴 WebDev module **not deployed** → `/system/webdev/FactoryLM/mira` returns `404 No servlet "webdev" found`; the panel's chat iframe is dead |

**Code is correct** — `asset_id="conveyor_demo"` auto-stamps `uns_source="direct_connection"` (skips the chat-gate per the direct-connection rule). The flow is fully wired end-to-end (panel → WebDev `doPost.py` reads live tags → HMAC-signs → cloud `ignition_chat.py` → engine). It just isn't *turned on*.

**To shoot the "tech asks MIRA from the Perspective dashboard" demo, ALL of these must be live:**
1. 🔴 `MIRA_IGNITION_HMAC_KEY` in Doppler prd + `mira-pipeline-saas` restarted
2. 🔴 WebDev module deployed on the PLC-laptop gateway (`deploy_ignition.ps1`)
3. 🔴 `factorylm.properties` on the gateway with the **same** HMAC key + `MIRA_TENANT_ID` + `MIRA_CLOUD_URL=https://api.factorylm.com/api/v1/ignition/chat`
4. 🟡 Tags imported (`Conveyor/*`, `Mira_Monitored/conveyor_demo/*`) — not verified live
5. 🟡 PLC powered + Modbus device `Micro820_Conveyor` connected (for *live* tag values; demo can use simulated/static tags)
6. 🟢 Cloud pipeline up (already is)

---

## 4. Prioritized Fix List — DEMO_BLOCKERS ONLY

Ordered by (impact × cheapness). ✅ = I can do it now on a branch; 🔧 = needs Mike/ops (prod secret, container restart, PLC laptop, or a product decision).

| # | Blocker | Surface | Fix | Owner | Effort |
|---|---|---|---|---|---|
| 1 | `/assess` radar blank (Chart.js CSP) | Marketing | Swap `cdn.jsdelivr.net` → `unpkg.com` at `assess.html:26` | ✅ me → PR | **5 min** |
| 2 | Ignition cloud chat 503s | Ignition | Generate random key → `doppler secrets set MIRA_IGNITION_HMAC_KEY` in `factorylm/prd` → restart `mira-pipeline-saas` | 🔧 ops | **10 min** |
| 3 | Ignition WebDev 404 | Ignition | On PLC laptop: `git pull` → `deploy_ignition.ps1` → write `factorylm.properties` (same key) | 🔧 Mike (PLC laptop) | **20–30 min** |
| 4 | Demo tenant empty (Hub real pages) | Hub | Seed WOs, PMs, assets, namespace, ≥2 manuals into the demo tenant (see §6) | 🔧 me + ops (DB) | **1–2 h** |
| 5 | 7 "Coming Soon" Hub pages | Hub | **DECISION** (see below) — either script around them, or set `NEXT_PUBLIC_LABS_ENABLED=true` (shows mock data) | 🔧 Mike decides | 5 min or N/A |
| 6 | Hub fake-data pages (`/integrations`, asset sub-tabs, `/parts/[id]`) | Hub | Script around them (don't navigate). Real fix = wire to live APIs (post-demo). | 🔧 scripting now / code later | 0 (avoid) |
| 7 | Free-trial vs paid messaging conflict | Marketing | **DECISION** — align hero with pricing one way or the other | 🔧 Mike decides | 15 min after decision |

### Two decisions only Mike can make
- **Labs flag (#5):** OFF (current) = 7 pages say "Coming Soon" — honest, but dead pages on camera. ON = those pages show *polished but fake* data that **won't match** the seeded real pages (e.g. `/reports` MTTR 2.4h vs real `/workorders`). The `LabsStub` was built specifically to *avoid showing fake data on a paid product*. **Recommendation: leave OFF, script around them, lean on the real seeded pages.** Turn ON only if you accept the inconsistency for a sizzle-reel.
- **Free-trial messaging (#7):** is the free Hub account the on-ramp, or is it assessment-first? Pick one before filming the marketing flow.

---

## 5. Suggested Demo Video Scripts

### Script A — "MIRA grounds an answer in YOUR plant" (Hub + diagnostic engine) — *most ready after seeding*
**Show:** `/login` → `/feed` (busy maintenance feed with seeded WOs/PMs) → `/namespace` (UNS tree of the demo plant) → `/assets` → open the conveyor asset → **Overview tab** → **Ask MIRA tab** (ask "why is the conveyor stopped?", get a grounded answer with citations) → `/knowledge/manuals` (show the OEM manual it cited) → `/workorders/[id]` (show an auto-extracted PM with the manual quote).
**Avoid:** the asset's Activity/Work Orders/Parts tabs; `/integrations`; `/reports`; `/alerts`; anything in §1's 🔴 list.

### Script B — "60-second scorecard" (Marketing) — *ready after Fix #1*
**Show:** `factorylm.com` home → `/assess` → answer a few questions → results page with the **radar chart** (← needs Fix #1) and tier badge → "Book Your Assessment $500" CTA → `/pricing`.
**Avoid:** clicking the hero "free trial" CTA until Decision #7 is resolved.

### Script C — "Ask MIRA from the plant-floor HMI" (Ignition) — *only after Fixes #2 + #3*
**Show:** open the ConveyorMIRA Perspective page on a tablet → live ConveyorStatus/SpeedControl tiles → tap the **Ask MIRA** panel → type "what's wrong with this conveyor?" → grounded answer using live tag values, no "are you sure you're looking at X?" gate (direct-connection certified).
**Do not attempt to film this until the HMAC key and WebDev module are deployed — today it 503s/404s.**

**Safe Hub nav path (green corridor):** `/feed → /namespace → /assets → /assets/[id] (Overview + Ask only) → /knowledge/manuals → /knowledge/map → /workorders → /schedule → /command-center → /channels`.

---

## 6. Data to Seed for the Demo Tenant

Real-query Hub pages are empty without this. (Note: `tools/seeds/demo-conveyor-001.sql` seeds `knowledge_entries` for the *engine recall* path under tenant `mike-garage-demo` — it does **not** populate the Hub's `kg_entities`/asset tables for the UI demo tenant `00000000-…-d1`. These are different and both may be needed.)

| Data | Table(s) | Powers | Minimum for demo |
|---|---|---|---|
| Work orders | `cmms_work_orders` | `/feed`, `/workorders`, KPIs | 5–8, varied status, ≥2 with `source_citation`, 1 with `safety_warnings` |
| PM schedules | `pm_schedules` | `/feed`, `/schedule` | 6–10, some overdue, some `auto_extracted=true` |
| Assets | `cmms_assets` | `/assets`, `/assets/[id]` | 4–6 with mfr/model/location/criticality |
| Namespace / UNS | `kg_entities` | `/namespace`, `/command-center` | site→area→line→equipment for the garage conveyor cell |
| KG entities+edges | `kg_entities`,`kg_relationships` | `/knowledge/map` | enough nodes that the graph isn't a blank canvas |
| Manuals | `knowledge_entries` | `/knowledge/manuals`, Ask-MIRA citations | ≥2 OEM manuals (GS10 VFD, Micro820) |
| Proposals (optional) | `ai_suggestions` | `/knowledge/suggestions` | a few `proposed` rows |

**Open item (needs Mike):** which tenant does Mike actually record against — the synthetic demo tenant (`…d1`, bearer-only, token currently unset in prod) or his real logged-in tenant? The seeding target depends on this. Recommend seeding **his real demo tenant** and recording logged-in.

---

## 7. Estimated Effort Summary

| Workstream | Effort | Blocking? |
|---|---|---|
| Marketing Fix #1 (CSP/radar) | 5 min | Script B blocker |
| Marketing Decision #7 (messaging) | 15 min after decision | Script B polish |
| Ignition Fix #2 (HMAC key + restart) | 10 min ops | Script C blocker |
| Ignition Fix #3 (deploy WebDev + properties on PLC laptop) | 20–30 min | Script C blocker |
| Hub seeding (#4) | 1–2 h (write seed + apply dev→staging→prod) | Script A blocker |
| Hub Labs decision (#5) | 5 min or skip | Script A polish |
| **Total to "all three demoable"** | **~3–4 h** of focused work + 2 Mike decisions | |

**Recommended order:** (1) marketing CSP fix [me, now] → (2) Ignition HMAC key [ops] → (3) Hub seed [me] → (4) PLC-laptop WebDev deploy [Mike] → film Scripts A & B → film Script C.

---

*Backing evidence with file:line citations: `docs/demos/_audit/{hub,marketing,ignition}-audit.md`.*
