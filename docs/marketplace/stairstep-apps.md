# MIRA Marketplace App Catalog & Build Roadmap

**Last updated:** 2026-05-04  
**Owner:** Mike Harper  
**Status:** Active reference — update as apps ship or markets shift

---

## 0. The Stairstep Model for MIRA

Rob Walling's stair-step approach says: don't start with your most ambitious product. Start with something focused, low-support, and saleable on someone else's platform — build cash, market proof, and brand presence, then step up.

For MIRA, that means packaging individual diagnostic capabilities as standalone marketplace apps before asking a plant to adopt the full platform. Each app:

- Solves exactly **one workflow problem** for a maintenance team
- Lives inside a CMMS the customer already uses (no new login, no adoption friction)
- Uses capabilities MIRA has **already built** — no greenfield work
- Generates early MRR and LinkedIn proof-of-work posts
- Feeds users into the full MIRA platform once they trust the brand

The stair: **Marketplace app ($49/mo) → MIRA Troubleshooter ($97/mo) → MIRA Integrated ($297/mo)**. Each step is easier because the prior step proved value.

**MIRA's unfair advantage:** The capabilities that power these apps — nameplate OCR, fault-history reasoning, PM schedule extraction from OEM PDFs, multi-turn diagnostic FSM — don't exist as off-the-shelf components. Competitors would need 12–18 months to match them. MIRA already has them running in production.

---

## 1. Marketplace Landscape

### Supported Platforms

| Platform | App Store Status | Developer Access | Audience | Submission |
|---|---|---|---|---|
| **UpKeep Studio** | ✅ 37 apps live (March 2026) | Full read/write API + AI app builder | SMB/mid-market maintenance | Applied ([bit.ly/4aUxk53](https://bit.ly/4aUxk53)) |
| **Monday.com** | ✅ 850+ apps (general platform) | GraphQL API, mature dev program | Operations + manufacturing segments | Dev account (calendared May 5) |
| **MaintainX** | ⚠️ No dedicated app store | 30+ native integrations, custom API | SMB/mid-market + enterprise | Partnership inquiry required |
| **Limble CMMS** | ⚠️ 15 native + Zapier | Integration via Zapier or direct API | SMB manufacturing | Contact integrations team |
| **Fiix** | ✅ 15+ partner apps (B2B) | Integration Hub, partner-invite | Mid-market / enterprise | Partner program application |

**Prioritized for initial launch:** UpKeep Studio (most receptive, newest, most apps, first-mover window still open) → Monday.com (largest user base, lowest maintenance competition) → MaintainX (no app store = partnership opportunity, not marketplace listing).

### Competitive Snapshot by Platform

**UpKeep Studio (37 apps) — most developed**
- AI/automation apps present: Paper WO Scan, Asset Plate Scanner, Duplicate WO Detector, Technician Performance Coach
- Gaps: No AI diagnostic → WO generation from fault history; no electrical drawing analysis; no OEM manual → PM extraction; no shift handover AI; no knowledge base Q&A
- Key insight: UpKeep built the Paper Scan apps themselves — third-party AI diagnostic logic is the open lane

**Fiix App Exchange — strongest enterprise ecosystem**
- Partners with MachineMetrics, Nanoprecise, XMPro for IoT/predictive
- Gaps: No document intelligence apps; no field-tech Q&A; no nameplate capture; knowledge management absent
- Key insight: Rockwell Automation owns Fiix — industrial equipment focus aligns with MIRA's ICP

**MaintainX — integration ecosystem, no app store**
- 30+ native integrations (SAP, NetSuite, Ignition, Slack); AI is a built-in feature, not marketplace
- Opportunity: Become their "AI diagnostic partner" — a partner integration, not a listed app
- Key insight: MaintainX's AI is surface-level; MIRA's domain-specific diagnostic depth is the differentiator

**Limble — limited, Zapier-reliant**
- 15 native integrations, no AI apps, relies heavily on Zapier for extensibility
- Opportunity: A single well-built native integration stands out
- Key insight: Lower competition, but also lower total addressable market per platform

**Monday.com — general platform, maintenance is underserved**
- 850+ apps total, but zero purpose-built maintenance/CMMS apps visible in the store
- Manufacturing templates exist but are generic workflow templates, not AI-powered
- Key insight: White space for any app that speaks "maintenance" — even basic apps look sophisticated here

---

## 2. Full App Catalog

**Scoring rubric (each factor 1–5):**
- **E** = Effort (1=1 week, 5=3+ months)
- **R** = Revenue ceiling at steady state (1=<$50/mo, 5=$1K+/mo)
- **C** = Competition in-market (1=empty, 5=saturated)
- **M** = MIRA moat (1=anyone can build, 5=requires MIRA's specific capability stack)
- **Score** = `(R × M) / (E × C)` — higher is better, build in this order

---

### Category A — Asset Capture

| # | App Name | Tagline | Platforms | MIRA Capability | E | R | C | M | Score |
|---|---|---|---|---|---|---|---|---|---|
| A1 | **Nameplate Snap** | Photo a nameplate → auto-fill asset record | UpKeep, MaintainX, Limble, Fiix | NameplateWorker | 2 | 2 | 1 | 4 | **4.0** |
| A2 | **Drawing Detective** | Upload electrical schematic → AI explains it and identifies faults | UpKeep, MaintainX | VisionWorker (PrintWorker) | 2 | 3 | 1 | 5 | **7.5** |
| A3 | **Photo Triage** | Equipment photo → auto-classify + route to correct team | UpKeep, MaintainX | VisionWorker | 1 | 2 | 2 | 3 | **3.0** |
| A4 | **Indicator State Reader** | Photo of control panel → read all indicator states (LEDs, dials, displays) | UpKeep, MaintainX, Fiix | VisionWorker | 2 | 3 | 1 | 5 | **7.5** |

**A1 — Nameplate Snap:** Technician photos a motor, pump, or VFD nameplate in the field. MIRA extracts manufacturer, model, serial, voltage, FLA, HP, RPM and pushes a complete asset record into the CMMS. Eliminates manual data entry for new asset registration. UpKeep has a basic "Asset Plate Scanner" but it extracts far fewer fields than MIRA's NameplateWorker. Competitive gap exists on MaintainX and Limble.

**A2 — Drawing Detective:** Field tech uploads an electrical schematic, one-line, or P&ID drawing. MIRA's PrintWorker detects the drawing type (ladder logic, one-line, P&ID, wiring diagram) and provides a plain-English explanation of what the drawing shows, what to look for when troubleshooting, and which components are likely involved. No competitor has this. Saves 10–15 min per diagnostic incident. ⭐

**A4 — Indicator State Reader:** Photo of a control panel → MIRA describes every visible indicator state (LED on/off, dial position, display reading, fault code shown). Creates a structured "panel snapshot" that can be attached to a work order. Useful for remote diagnostics where a tech photos the panel and an expert interprets it later.

---

### Category B — Work Order Automation

| # | App Name | Tagline | Platforms | MIRA Capability | E | R | C | M | Score |
|---|---|---|---|---|---|---|---|---|---|
| B1 | **AI Work Order Generator** | Fault history → draft WO in seconds | UpKeep *(in progress)*, MaintainX, Limble | RAGWorker + cmms_create_work_order | 2 | 4 | 2 | 5 | **5.0** |
| B2 | **Shift Handover Generator** | End of shift → AI summary of open WOs + critical alerts | UpKeep, MaintainX, Monday.com | RAGWorker + cmms_list_work_orders | 2 | 3 | 1 | 4 | **6.0** |
| B3 | **Incident RCA Writer** | Completed WO → auto-generates root cause analysis doc | UpKeep, MaintainX, Fiix | RAGWorker + get_fault_history | 2 | 3 | 1 | 4 | **6.0** |
| B4 | **WO Smart Router** | New WO → suggests best technician by skill + availability | UpKeep, MaintainX | cmms_create_work_order + LLM | 3 | 3 | 2 | 3 | **1.5** |
| B5 | **Multi-CMMS Bridge** | Sync work orders between two CMMS platforms | UpKeep↔MaintainX, UpKeep↔Limble | mira-mcp multi-CMMS adapter | 4 | 5 | 1 | 4 | **5.0** |

**B1 — AI Work Order Generator** *(currently being built for UpKeep — Week 2, May 11–16)*: Pulls 30 days of fault history for an asset, runs MIRA's LLM cascade to generate a pre-filled WO with title, description, priority, estimated hours, and parts list. The most direct monetization of MIRA's core diagnostic capability. After UpKeep, port to MaintainX (no equivalent app exists there). ⭐

**B2 — Shift Handover Generator:** At end of shift, the outgoing tech triggers the app. MIRA reads all open/in-progress WOs from the last 8 hours, drafts a human-readable handover summary ("3 open WOs, Conveyor #4 is critical — motor bearing fault identified, parts on order") and sends it as a formatted report. UpKeep has a basic "Shift Notes & Handoff" app but it's manual. MIRA's version is AI-generated. Monday.com would be a natural fit given its template/automation culture. ⭐

**B3 — Incident RCA Writer:** After a WO is marked complete, MIRA reads the fault history, work performed, and parts used, then generates a formal Root Cause Analysis document in the format required for ISO 9001 / safety audit purposes. Saves maintenance engineers 30–60 min of documentation per incident. No competitor has this. ⭐

**B5 — Multi-CMMS Bridge:** High-value enterprise play. When a company uses UpKeep for field techs but MaintainX for managers (common in acquisitions/mergers), this keeps both in sync. MIRA already has multi-CMMS adapter logic in mira-mcp. High effort but very high revenue ceiling ($299+/mo). Best positioned for Tier 3.

---

### Category C — Reporting & Summaries

| # | App Name | Tagline | Platforms | MIRA Capability | E | R | C | M | Score |
|---|---|---|---|---|---|---|---|---|---|
| C1 | **Downtime Report Generator** | Fault event → formatted incident report with timeline | UpKeep, MaintainX, Fiix | get_fault_history + RAGWorker | 2 | 3 | 1 | 4 | **6.0** |
| C2 | **Executive Maintenance Digest** | Weekly AI-written summary: downtime, costs, top issues | UpKeep, MaintainX, Limble | get_fault_history + LLM | 2 | 2 | 2 | 3 | **1.5** |
| C3 | **Maintenance Cost Analyzer** | True cost per failure: labor + parts + downtime | UpKeep, MaintainX, Fiix | get_fault_history + LLM cost model | 3 | 4 | 1 | 3 | **4.0** |
| C4 | **Asset Replacement Advisor** | Repair vs replace? AI recommendation based on fault history + age + cost | UpKeep, MaintainX | get_fault_history + LLM | 2 | 3 | 2 | 4 | **3.0** |

**C1 — Downtime Report Generator:** A fault gets logged. MIRA automatically generates a formatted incident report: what failed, when, detection timeline, downtime hours, estimated cost, what was done to fix it. Structured for compliance (ISO, insurance, customer SLAs). No CMMS platform generates these automatically. ⭐

---

### Category D — PM & Scheduling

| # | App Name | Tagline | Platforms | MIRA Capability | E | R | C | M | Score |
|---|---|---|---|---|---|---|---|---|---|
| D1 | **Manual → PM Extractor** | Upload OEM PDF → extract PM schedule → push to CMMS | UpKeep, MaintainX, Limble, Fiix | /ingest/pdf + RAGWorker + cmms PM API | 3 | 5 | 1 | 5 | **8.3** |
| D2 | **PM Optimizer** | Fault history + PM schedule → suggest interval adjustments | UpKeep, MaintainX, Fiix | get_fault_history + cmms_list_pm_schedules + LLM | 3 | 4 | 1 | 5 | **6.7** |
| D3 | **Parts Predictor** | Fault patterns → predict parts needed in next 30 days | UpKeep, MaintainX, Fiix | get_fault_history + LLM + CMMS catalog | 3 | 4 | 1 | 4 | **5.3** |
| D4 | **PM Compliance Checker** | Flag assets with overdue PMs; weekly alert digest | UpKeep, MaintainX, Limble | cmms_list_pm_schedules | 1 | 2 | 3 | 2 | **1.3** |

**D1 — Manual → PM Extractor** *(highest priority score: 8.3)*: User uploads an OEM equipment manual PDF. MIRA extracts the PM schedule table (intervals, tasks, parts), structures it, and pushes it directly into the CMMS as scheduled maintenance tasks. This is the core MIRA flywheel in packaged form. No competitor — not UpKeep, not MaintainX, not Fiix — has this. The capability exists in `mira-mcp/server.py` (`/ingest/pdf` + `run_kb_builder`) and the PM extraction logic is partially implemented in the NORTH_STAR pipeline. Packaging it as a marketplace app is a matter of wrapping the UI and hardening the CMMS push. This is the most valuable single app in this catalog. ⭐⭐

**D2 — PM Optimizer:** MIRA analyzes the last 12 months of fault events for each asset and compares actual failure intervals against scheduled PM intervals. Where assets fail before PM is due → intervals are too long. Where PMs are done with no subsequent failures → intervals may be too short (over-maintained). MIRA outputs a recommendation table: "Conveyor #4 — reduce PM interval from 90 days to 45 days based on 6 bearing failures in the last year." No competitor has this. ⭐

---

### Category E — Knowledge Tools

| # | App Name | Tagline | Platforms | MIRA Capability | E | R | C | M | Score |
|---|---|---|---|---|---|---|---|---|---|
| E1 | **Manual Q&A Bot** | Attach OEM PDFs → ask questions in plain English | UpKeep, MaintainX, Fiix | RAGWorker + /ingest/pdf | 2 | 3 | 1 | 5 | **7.5** |
| E2 | **Fault Code Lookup** | Enter fault code → cause, common fixes, parts needed | UpKeep, MaintainX, Monday.com | RAGWorker | 2 | 2 | 1 | 4 | **4.0** |
| E3 | **KB Coverage Auditor** | Scans asset registry → flags assets with no documentation | UpKeep, MaintainX | cmms_list_assets + run_kb_builder | 2 | 2 | 1 | 5 | **5.0** |
| E4 | **Safety Risk Flagging** | WO description → AI flags safety concerns before dispatch | UpKeep, MaintainX, Fiix | guardrails.py + LLM risk scoring | 2 | 3 | 2 | 4 | **3.0** |

**E1 — Manual Q&A Bot:** Equipment manuals are uploaded once. After that, techs can ask plain-English questions inside their CMMS: "What lubricant does the GA500 compressor need?" or "What's the torque spec for the #3 bearing?" MIRA retrieves the answer with a page citation. This directly packages MIRA's RAGWorker. No CMMS platform has in-app document Q&A. ⭐

**E3 — KB Coverage Auditor:** Reads the CMMS asset registry, cross-references against the MIRA knowledge base, and produces a report: "72 assets registered — 41 have documentation, 31 do not. Top undocumented categories: conveyors (8), air compressors (6), VFDs (5)." Useful as a freemium entry point — run the audit free, pay to ingest the missing manuals.

---

### Category F — Analytics

| # | App Name | Tagline | Platforms | MIRA Capability | E | R | C | M | Score |
|---|---|---|---|---|---|---|---|---|---|
| F1 | **MTBF Tracker** | Mean time between failures per asset, trended | UpKeep, MaintainX, Fiix | get_fault_history + analytics | 2 | 3 | 2 | 2 | **1.5** |
| F2 | **Vendor Scorecard** | Which vendors' equipment fails most? Cost per incident? | MaintainX, Fiix (not UpKeep — already has this) | get_fault_history + asset metadata | 2 | 2 | 1 | 2 | **2.0** |
| F3 | **Industrial Paper Scanner** | Scan handwritten maintenance logs → digitize to CMMS | MaintainX, Limble, Fiix (not UpKeep) | VisionWorker OCR | 2 | 3 | 2 | 3 | **2.25** |

---

## 3. Competitive Gap Map

*Legend: ✅ = well-covered by existing apps, ⚠️ = partial coverage, ❌ = gap / white space for MIRA*

| Capability | UpKeep Studio | Monday.com | MaintainX | Limble | Fiix |
|---|---|---|---|---|---|
| Paper form scanning / OCR | ✅ | ⚠️ | ❌ | ❌ | ❌ |
| AI-generated work orders from fault history | ❌ | ❌ | ❌ | ❌ | ❌ |
| Nameplate capture → asset registration | ⚠️ (basic) | ❌ | ❌ | ❌ | ❌ |
| Electrical drawing analysis | ❌ | ❌ | ❌ | ❌ | ❌ |
| OEM manual → PM schedule extraction | ❌ | ❌ | ❌ | ❌ | ❌ |
| Manual Q&A (document chatbot) | ❌ | ❌ | ❌ | ❌ | ❌ |
| PM interval optimization from fault data | ❌ | ❌ | ❌ | ❌ | ❌ |
| Shift handover AI generation | ⚠️ (manual) | ❌ | ❌ | ❌ | ❌ |
| Root cause analysis document writer | ❌ | ❌ | ❌ | ❌ | ❌ |
| Parts demand prediction from fault history | ⚠️ (basic forecast) | ❌ | ❌ | ❌ | ❌ |
| IoT / sensor-based predictive maintenance | ❌ | ❌ | ⚠️ (partners) | ❌ | ✅ (partners) |
| Asset replacement advisor | ⚠️ (basic scoring) | ❌ | ❌ | ❌ | ❌ |
| Safety risk flagging on WOs | ⚠️ (manual tracker) | ❌ | ❌ | ❌ | ❌ |
| Multi-CMMS sync | ❌ | ❌ | ❌ | ❌ | ❌ |
| Duplicate WO detection | ✅ | ❌ | ❌ | ❌ | ❌ |
| Technician coaching / performance | ✅ | ❌ | ⚠️ | ❌ | ❌ |

**MIRA's cleanest white space (❌ across all platforms):**
1. OEM Manual → PM Extractor
2. AI Work Order Generator from fault history
3. Electrical Drawing Detective
4. Manual Q&A Bot
5. Incident RCA Writer
6. PM Interval Optimizer

---

## 4. Build Roadmap

### Scoring Summary (top 12 apps)

| App | Score | Effort | Competition | Notes |
|---|---|---|---|---|
| D1 Manual → PM Extractor | **8.3** | 3 | 1 | Core flywheel, highest moat |
| A2 Drawing Detective | **7.5** | 2 | 1 | Unique, builds fast |
| E1 Manual Q&A Bot | **7.5** | 2 | 1 | RAGWorker already exists |
| A4 Indicator State Reader | **7.5** | 2 | 1 | VisionWorker already handles |
| D2 PM Optimizer | **6.7** | 3 | 1 | Needs fault history analysis |
| B2 Shift Handover Generator | **6.0** | 2 | 1 | WO read + LLM, quick build |
| B3 Incident RCA Writer | **6.0** | 2 | 1 | Completed WO → LLM doc |
| C1 Downtime Report Generator | **6.0** | 2 | 1 | Fault event → formatted report |
| D3 Parts Predictor | **5.3** | 3 | 1 | Needs parts catalog integration |
| B1 AI WO Generator | **5.0** | 2 | 2 | ✅ In progress for UpKeep |
| E3 KB Coverage Auditor | **5.0** | 2 | 1 | Good freemium entry point |
| B5 Multi-CMMS Bridge | **5.0** | 4 | 1 | High revenue but high effort |

---

### Tier 1 — Build Now (May–June 2026)
*These have Effort ≤ 2, Score ≥ 5.0, and directly leverage MIRA capabilities that are already in production.*

**1. AI Work Order Generator for UpKeep** *(in progress — Week 2, May 11–16)*
Already calendared. After UpKeep ships, port the same logic to MaintainX (no equivalent exists there at all).

**2. Shift Handover Generator** *(~2 weeks after WO Generator)*
Reads open WOs from last 8 hours, generates AI handover summary. Deploy first to UpKeep, then Monday.com (huge audience, zero competition there). This is also highly LinkedIn-postable — "your shift handover now takes 30 seconds."

**3. Drawing Detective** *(parallel, ~2 weeks)*
PrintWorker already handles electrical drawing classification. Wrap it as a standalone upload-and-analyze app. Deploy to UpKeep first. Use as a proof-of-technical-depth LinkedIn post ("MIRA reads ladder logic").

**Tier 1 revenue target:** 3 apps × 20 plants × $49/mo = $2,940 MRR by end of June.

---

### Tier 2 — Build Next (July–August 2026)
*Score ≥ 6.0, Effort ≤ 3, directly compounds the MIRA flywheel.*

**4. Manual Q&A Bot**
RAGWorker is production-ready. Build the marketplace wrapper: PDF upload UI + chat interface inside UpKeep/MaintainX. This is the most demos-able app in the catalog — "ask your VFD manual a question."

**5. Incident RCA Writer**
WO completion webhook → MIRA generates RCA doc. Target MaintainX and Fiix (where enterprise customers need audit-ready documentation). Revenue ceiling higher than Tier 1 apps.

**6. Downtime Report Generator**
Fault event trigger → formatted incident report. Target UpKeep and Fiix. Pair with the RCA Writer as a bundle.

**7. Manual → PM Extractor** *(highest score: 8.3)*
This is the core flywheel feature. The NORTH_STAR pipeline already partially implements it. Hardening it as a marketplace app — with a clean PDF upload, extraction preview, and one-click CMMS push — is Tier 2 work. This app alone is worth more than all Tier 1 apps combined. It is the reason a plant stays on MIRA forever.

**Tier 2 revenue target:** 7 apps × 15 plants × $79/mo average = $8,295 MRR by end of August.

---

### Tier 3 — Scale (September 2026+)
*Higher effort or dependent on Tier 1/2 market validation first.*

**8. PM Interval Optimizer** — needs 6+ months of fault history data from real customers to validate; build after Tier 1/2 data accumulates.

**9. Parts Predictor** — requires parts catalog integration (not all CMMS platforms have complete catalog APIs); needs Tier 1/2 customer relationships to source realistic training examples.

**10. Multi-CMMS Bridge** — high value ($299+/mo) but 4-week build; wait until you have customers on multiple platforms who feel the pain.

**11. Nameplate Snap** — NameplateWorker exists but UpKeep's Asset Plate Scanner already covers this partially; differentiate by building for MaintainX/Limble/Fiix where no competitor exists.

---

### Decision Rubric for New Ideas

When evaluating a new app idea, score it against these four questions:

| Question | Weight |
|---|---|
| Does MIRA have an existing capability that powers most of it? | 40% |
| Does the target platform have a gap (no existing app doing this)? | 30% |
| Can a customer demo it in under 60 seconds? | 20% |
| Does it lead naturally into full MIRA ($97/mo tier)? | 10% |

If the total is ≥ 70%, build it. Below 50%, defer.

---

## 5. Appendix: Platform × Capability Matrix

*Which apps to build for which platform — ✅ = strong fit, ⚠️ = possible but not priority, — = not applicable*

| App | UpKeep | Monday | MaintainX | Limble | Fiix |
|---|---|---|---|---|---|
| A1 Nameplate Snap | ⚠️ (UpKeep has partial) | — | ✅ | ✅ | ✅ |
| A2 Drawing Detective | ✅ | — | ✅ | — | ✅ |
| A3 Photo Triage | ✅ | — | ✅ | — | — |
| A4 Indicator State Reader | ✅ | — | ✅ | — | ✅ |
| B1 AI WO Generator | ✅ (in progress) | ✅ | ✅ | ✅ | ✅ |
| B2 Shift Handover Generator | ✅ | ✅ | ✅ | — | — |
| B3 Incident RCA Writer | ✅ | — | ✅ | — | ✅ |
| B4 WO Smart Router | ✅ | ✅ | ✅ | — | — |
| B5 Multi-CMMS Bridge | ✅ | — | ✅ | ✅ | ✅ |
| C1 Downtime Report Generator | ✅ | ✅ | ✅ | — | ✅ |
| C2 Executive Digest | ✅ | ✅ | ✅ | ✅ | — |
| C3 Maintenance Cost Analyzer | ✅ | — | ✅ | — | ✅ |
| C4 Asset Replacement Advisor | ✅ | — | ✅ | — | — |
| D1 Manual → PM Extractor | ✅ | — | ✅ | ✅ | ✅ |
| D2 PM Optimizer | ✅ | — | ✅ | — | ✅ |
| D3 Parts Predictor | ✅ | — | ✅ | — | ✅ |
| D4 PM Compliance Checker | ⚠️ (UpKeep native) | ✅ | ⚠️ | ✅ | — |
| E1 Manual Q&A Bot | ✅ | — | ✅ | — | ✅ |
| E2 Fault Code Lookup | ✅ | ✅ | ✅ | ✅ | — |
| E3 KB Coverage Auditor | ✅ | — | ✅ | ✅ | — |
| E4 Safety Risk Flagging | ✅ | — | ✅ | — | ✅ |
| F1 MTBF Tracker | ✅ | ✅ | ✅ | — | ✅ |
| F2 Vendor Scorecard | ⚠️ (UpKeep has one) | ✅ | ✅ | — | ✅ |
| F3 Industrial Paper Scanner | ⚠️ (UpKeep has one) | — | ✅ | ✅ | ✅ |

---

## Developer Submission Checklist

| Platform | Action | Status |
|---|---|---|
| UpKeep Studio | Applied to partner program | ✅ Applied May 4 |
| Monday.com | Create dev account + sandbox app | 📅 Calendared May 5 |
| MaintainX | Send partnership inquiry (no app store — direct contact) | ⬜ Todo |
| Limble | Contact integrations@limblecmms.com | ⬜ Todo |
| Fiix | Apply to App Exchange partner program | ⬜ Todo |

---

## Related Documents

| Document | Path |
|---|---|
| Commercial strategy + ICP | `STRATEGY.md` |
| Technical flywheel | `NORTH_STAR.md` |
| 90-day MVP plan | `docs/plans/2026-04-19-mira-90-day-mvp.md` |
| UpKeep app build calendar | Google Calendar `[MIRA LAUNCH]` events (May 4–31) |
| CMMS integration docs | `docs/integrations/` |
