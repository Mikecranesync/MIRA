# Hair-on-Fire Demand Map

**Proposal for Mike — Oct 31, 2026 (America/New_York).**  
What industrial maintenance buyers are desperately funding right now, ranked by urgency × willingness to pay × MIRA fit — with evidence links, current repo status, smallest sellable moves, and marketing hooks.

**Info only.** Nothing here is customer-facing ship work. No public prices. This map does not authorize merge, deploy, Doppler, networking, PLC, paid cloud agents, or customer-facing launch.

Source Page: [Hair-on-Fire Demand Map](https://cursor.com/canvas/store-d7c7e6d0-553b-4e90-9e59-27746c3614d9/0a3e9014-29e5-466e-a91f-b0eef86c2417)

---

## How to read this

Scores are Foreman judgment from evidence density and MIRA Capability Closure — not invented survey percentages.

**Rank** = urgency (hair-on-fire now) × willingness to pay (budget already moving) × MIRA fit (reuse the sellable SUT: mira-mobile → Hub equipment-notebook chat → manual RAG → citation SSE).

**Status tags:** REUSE what exists, CONNECT manuals/sources, FINISH near-done capabilities, BUILD only when nothing closer wins.

| | |
| --- | --- |
| **Sellable SUT** | mira-mobile → Hub equipment-notebook chat → `retrieveNodeChunks` → citation SSE |
| **Positioning** | MIRA stands alone; CMMS connectors (Atlas etc.) are optional add-ons |
| **Repo snapshot** | Mikecranesync/MIRA — CAPABILITY_CLOSURE: notebook turns + approved retrieval + `pilot_access` `production_enabled`; `guided_troubleshooting` / nameplate / photo OCR `deployed_disabled` |

---

## Priority scoreboard

| # | Pain | Urgency | Pay | Fit | Score | Status |
| ---: | --- | ---: | ---: | ---: | ---: | --- |
| 1 | Cited answers from OUR manuals at the machine | 10 | 9 | 10 | 9.7 | FINISH |
| 2 | Junior / night shift as capable as the retiring senior | 9 | 9 | 9 | 9.0 | FINISH |
| 3 | Cut recovery time when unplanned downtime hits | 10 | 10 | 8 | 9.3 | REUSE |
| 4 | Branching troubleshooting that isn’t a useless error-code echo | 8 | 8 | 9 | 8.3 | FINISH |
| 5 | Photo the nameplate → right manual → ask | 7 | 7 | 9 | 7.7 | FINISH |
| 6 | AI that works without ripping out (or depending on) the CMMS | 7 | 8 | 9 | 8.0 | REUSE |
| 7 | Record the fix once; next shift gets the guided workflow | 7 | 7 | 7 | 7.0 | CONNECT |
| 8 | Answers when the help file needs internet (or the cell drops) | 6 | 6 | 6 | 6.0 | BUILD |

Top three to build and market now: cited manual Q&A, junior/night-shift competence, and MTTR recovery (same product sold to ops).

Upper-right product lane: #1 cited manuals, #2 tribal knowledge, #3 MTTR (reuse #1), #4 guided fault trees, #6 standalone wedge. Offline (#8) stays lower until pilots prove online value.

---

## Demand detail

### #1 — Cited answers from OUR manuals at the machine

- **Status:** FINISH
- **Buyer:** Maintenance manager + plant ops (MTTR buyers)
- **Evidence:** MaintainX 2026: 28% cite skills gap and 36% labor shortage as downtime drivers; r/PLC techs already upload OEM manuals into NotebookLM/ChatGPT because generic AI hallucinates; Squint, Siemens Asset Essentials Copilot, and Rockwell’s Singapore Maintenance Copilot all sell this exact job; Rockwell reports 33% lower downtime and onboarding 9→3 months at that site.
- **MIRA status:** Core SUT exists: mira-mobile → Hub equipment-notebook chat → `retrieveNodeChunks` (manual-rag) → citation SSE. Capability Closure: `private_notebook_turns` + `approved_context_retrieval` + `pilot_access` = `production_enabled`; `notebook_manual_acquisition` = `staging_enabled`. Answer Radar freezes keep parking because plant-specific manuals are not CONNECTED into notebook `sourceDocIds` yet.
- **Smallest sellable move:** Ship one sellable pilot SKU: upload customer’s top 20 OEM manuals → ask fault/parameter questions on phone → always cite page or honest ABSTAIN. Prove on 3 Answer Radar–class machines (e.g. Rockwell drive + Siemens HMI + one Schneider I/O) before any CMMS story.
- **Marketing hook (draft for Mike — not shipped):** Stop Ctrl+F’ing a 300-page Rockwell PDF while the line is down. Ask in plain English. Get the page. Or we tell you we don’t know.

### #2 — Junior / night shift as capable as the retiring senior

- **Status:** FINISH
- **Buyer:** Plant director / reliability lead facing retirements
- **Evidence:** Deloitte + Manufacturing Institute (2024): up to 1.9M of 3.8M needed U.S. manufacturing roles could go unfilled through 2033; MaintainX 2026 ranks labor shortage and poor knowledge transfer among top downtime drivers; Rockwell Singapore plant director names ‘tribal knowledge’ as the problem the Copilot solves; r/IndustrialMaintenance ‘Zero documentation’ thread and PLCtalk ‘Documenting Projects’ show plants living this daily.
- **MIRA status:** Same notebook path amplifies juniors with OEM truth; `guided_troubleshooting` (diagnostic-plan runner + procedure sessions) exists but is `deployed_disabled`; veteran-fix capture into notebook sources is CONNECT work, not a new brain.
- **Smallest sellable move:** Pilot offer: ‘Senior in a pocket’ — bind one plant’s critical assets to manuals + 5 recorded veteran fixes as notebook sources; measure time-to-first-cited-answer for a new hire on night shift.
- **Marketing hook (draft for Mike — not shipped):** Your best tech retires Friday. Their manuals and fixes should still answer the 2am fault Monday.

### #3 — Cut recovery time when unplanned downtime hits

- **Status:** REUSE
- **Buyer:** Ops / finance sponsors who feel rising downtime cost
- **Evidence:** MaintainX State of Industrial Maintenance 2026 (n=2,234): 79% saw unplanned downtime stay the same or rise; 39% say downtime cost rose (vs 31% in 2025); half of teams still spend <40% of time on planned work despite PM programs. Buyers fund tools that shorten recovery, not another dashboard.
- **MIRA status:** Do not build a CMMS downtime module. Position MIRA as the recovery accelerator on top of whatever WO system they already have. Atlas/CMMS connectors stay optional add-ons per Mike’s positioning.
- **Smallest sellable move:** Marketing + pilot metric only: median minutes from fault code asked → cited next step, vs hunting paper/PDF. No public dollar claims.
- **Marketing hook (draft for Mike — not shipped):** Downtime isn’t getting cheaper. The fastest recovery path is the one that finds the right page first.

### #4 — Branching troubleshooting that isn’t a useless error-code echo

- **Status:** FINISH
- **Buyer:** Controls/maintenance techs burning hours on circular OEM guides
- **Evidence:** r/PLC: Automate troubleshooting books that say ‘problem with breaker x.y.z’ for hundreds of codes; Rockwell manuals described as 300-page Ctrl+F hell with chopped part numbers; Squint markets model-specific steps cited from OEM manuals; MIRA already has manufacturer diagnostic plans (e.g. SMC Flex / 150-UM008J Ch.9).
- **MIRA status:** `guided_troubleshooting` capability = `deployed_disabled` (WP-1 equipment notebook procedure route + diagnostic-plan guided runner). Smallest path: enable for one drive family in pilot, not a general agent.
- **Smallest sellable move:** Finish one OEM chapter → interactive branches in the notebook (measure → decide → next). Keep chat Q&A as the always-on fallback when no tree matches.
- **Marketing hook (draft for Mike — not shipped):** Fault Fxxx shouldn’t dump you into a book that restates the fault. Walk the branch. Cite the chapter.

### #5 — Photo the nameplate → right manual → ask

- **Status:** FINISH
- **Buyer:** Multi-OEM plants where techs can’t name the exact drive/HMI
- **Evidence:** Remote-site r/PLC users prep troubleshooting steps during 2-hour drives with Gemini because they cover ‘so many devices and manufacturers’; Answer Radar freezes repeatedly block on missing CONNECTED manuals for specific SKUs (Omron, Schneider, Siemens HMI, Kinetix, etc.). Discovery is half the fire.
- **MIRA status:** `nameplate_identification` + `photo_ocr_evidence` + `manual_discovery_judge` are `deployed_disabled` (pilot deferred per Closure — owner put first pilot on manual-grounded troubleshooting). `notebook_manual_acquisition` is `staging_enabled`.
- **Smallest sellable move:** After cited Q&A is sellable: supervised Pixel dogfood of nameplate → candidate manuals → attach → ask. Do not lead GTM with computer vision.
- **Marketing hook (draft for Mike — not shipped):** Point the phone at the nameplate. Talk to that machine’s manual — not the internet.

### #6 — AI that works without ripping out (or depending on) the CMMS

- **Status:** REUSE
- **Buyer:** Plants stuck on Fiix/Limble/UpKeep/MaintainX who still Ctrl+F manuals
- **Evidence:** r/IndustrialMaintenance: Fiix ‘too complicated for many technicians’; Limble mobile battery/load complaints; MaintainX Assist still lives inside a WO/procedure CMMS; OEM copilots (Siemens Asset Essentials) are locked to their EAM. Buyers want wrench-time answers without a CMMS migration.
- **MIRA status:** Product positioning already locked: MIRA stands alone; CMMS connectors (Atlas etc.) are optional. Honest-landing work stripped auto-WO and free-CMMS claims from public HTML.
- **Smallest sellable move:** Lead every pilot and sales deck with standalone notebook Q&A. Offer Atlas comment sync only after they love cited answers. Never imply MIRA needs a CMMS.
- **Marketing hook (draft for Mike — not shipped):** Keep your CMMS. Add the assistant that actually reads the manuals.

### #7 — Record the fix once; next shift gets the guided workflow

- **Status:** CONNECT
- **Buyer:** Reliability leads who already digitize SOPs (Augmentir/Squint buyers)
- **Evidence:** Augmentir / Squint sell capture→guided workflow and remote expert; Inductive Automation Cooley Group case: tribal troubleshooting lost when people leave; MaintainX AI turns manuals/PDFs into procedures. Content authoring labor is the competitor complaint.
- **MIRA status:** CONNECT: treat approved veteran notes / photos as notebook sources beside OEM manuals; reuse guided procedure sessions. Avoid building a full connected-worker authoring suite first.
- **Smallest sellable move:** Pilot add-on after cited OEM Q&A: ‘attach last good fix’ to the asset notebook; cite it like a manual page. Skip AR/remote-expert theater until pull is proven.
- **Marketing hook (draft for Mike — not shipped):** If it took your senior an hour to find, the next tech shouldn’t start from zero.

### #8 — Answers when the help file needs internet (or the cell drops)

- **Status:** BUILD
- **Buyer:** Basement MCC / remote plants / OT-isolated networks
- **Evidence:** r/PLC: ‘help files now require an internet connection’; PLCtalk paperless-maintenance thread: techs still print key pages for side-by-side troubleshooting. Offline is real but second to ‘right cited answer when online.’
- **MIRA status:** mira-mobile has offline WO queue work historically; full offline manual RAG + citation viewer is not the sellable SUT. BUILD only after online cited Q&A wins pilots.
- **Smallest sellable move:** Park as post-pilot: cache attached notebook manuals + last N cited answers for airplane/MCC mode. Do not delay GTM for it.
- **Marketing hook (draft for Mike — not shipped):** When the plant network hates you, your manuals shouldn’t vanish too.

---

## Recommended build order

1. **Finish the cited-manual pilot SKU** — Stranger uploads manuals → asks → gets page citations or ABSTAIN. Gate with `beta_ready_upload_retrieval_citation`-class proof on staging + one Pixel path. CONNECT the manuals Answer Radar already named.
2. **Market to the MTTR + skills-gap buyer with the same SKU** — One product, two hooks: ‘line-down recovery’ for ops and ‘senior in a pocket’ for workforce. No CMMS migration pitch. No public price tags.
3. **Enable guided troubleshooting for one OEM family** — Turn on `deployed_disabled` `guided_troubleshooting` for a single drive chapter already coded (e.g. SMC Flex). Keep chat as fallback.
4. **Optional Atlas after love** — Only once cited answers stick: optional CMMS comment/work-note sync. Never block the standalone sale on it.
5. **Park nameplate CV and offline RAG** — Supervised dogfood later. Do not let BUILD work delay the FINISH/CONNECT pilot.

---

## Competitor / market landscape

### Who is already selling the fire

1. Squint — plain-language faults answered from OEM manuals/procedures with page cites; 2am ‘best tech in their pocket’ messaging
2. Siemens Asset Essentials Maintenance Copilot — attached PDF manuals + history; cites document name and page; enterprise EAM-locked
3. Rockwell Singapore GenAI Maintenance Copilot (Microsoft Source, Sep 2026) — manuals + veteran knowledge; claimed 33% downtime cut, onboarding 9→3 months
4. MaintainX Assist — manuals + procedures + work history inside a CMMS
5. Tractian / Augmentir — document analysis, AI SOPs, connected-worker capture (heavier implementation)

### Wedge for MIRA

**Pros**

- Standalone: no CMMS rip-and-replace
- Honest ABSTAIN when manuals don’t cover it (Answer Radar discipline)
- Equipment-notebook tenancy + citation SSE already in Hub
- OEM-agnostic plant mix (Rockwell + Siemens + Schneider + Omron freezes prove demand breadth)
- Mobile-first technician path already the locked SUT

**Cons**

- Competitors have brand + installed CMMS bases
- Manual CONNECT coverage is still the pilot bottleneck
- Guided trees and nameplate ID exist but are dark

> The key thing we want to solve is the loss of knowledge, what we call the tribal knowledge… We also want consistency in troubleshooting, so there’s a standard approach to a problem regardless of who is working on it.
>
> — Li Wang, Rockwell Automation Singapore plant director ([Microsoft Source, Sep 24, 2026](https://news.microsoft.com/source/features/digital-transformation/rockwell-automation-pairs-ai-with-decades-of-shop-floor-know-how-so-workers-can-solve-glitches-faster/))

> I’ve had some success uploading equipment manuals… it often hallucinates if I just ask a general question… But if I upload the manual I want it to reference it does a good job.
>
> — r/PLC technician on uploading manuals to AI ([Sep 2025](https://www.reddit.com/r/PLC/comments/1nu8s5r/do_you_use_ai_in_your_job/))

---

## Evidence library

1. [MaintainX — State of Industrial Maintenance 2026](https://www.getmaintainx.com/state-of-industrial-maintenance-report)
2. [MaintainX 2026 report PDF](https://9125465.fs1.hubspotusercontent-na1.net/hubfs/9125465/Resources/eBooks/MaintainX%20-%20The%20State%20of%20Industrial%20Maintenance%202026.pdf)
3. [Deloitte / Manufacturing Institute — 3.8M jobs / 1.9M unfilled](https://www.prnewswire.com/news-releases/us-manufacturing-could-need-as-many-as-3-8-million-new-employees-by-2033--according-to-deloitte-and-the-manufacturing-institute-302105892.html) (2024-04-03)
4. [r/PLC — Do you use AI in your job?](https://www.reddit.com/r/PLC/comments/1nu8s5r/do_you_use_ai_in_your_job/)
5. [r/PLC — The old manuals were so much better](https://www.reddit.com/r/PLC/comments/1cg2aa7/the_old_manuals_where_so_much_better/)
6. [r/PLC — AI helper? (NotebookLM citation tip)](https://www.reddit.com/r/PLC/comments/1oiz4ex/ai_helper/)
7. [r/IndustrialMaintenance — Zero documentation](https://www.reddit.com/r/IndustrialMaintenance/comments/1sz9jwe/zero_documentation/)
8. [PLCtalk — Documenting Projects](https://www.plctalk.net/threads/documenting-projects.108859/)
9. [Squint — Maintenance & Uptime](https://www.squint.ai/solutions/maintenance-uptime)
10. [Siemens Asset Essentials — Maintenance Copilot](https://help.assetmanagement.siemens.com/help/Content/Documentation/Maintenance/Asset%20Essentials/EnterpriseFeatures/AI-Driven%20Capabilities/Maintenance%20Copilot.htm)
11. [Rockwell Singapore Maintenance Copilot (Microsoft Source)](https://news.microsoft.com/source/features/digital-transformation/rockwell-automation-pairs-ai-with-decades-of-shop-floor-know-how-so-workers-can-solve-glitches-faster/) (2026-09-24)
12. [MIRA CAPABILITY_CLOSURE.yaml](https://github.com/Mikecranesync/MIRA/blob/main/docs/architecture/convergence/CAPABILITY_CLOSURE.yaml)
13. [MIRA equipment-notebook chat route](https://github.com/Mikecranesync/MIRA/blob/main/mira-hub/src/app/api/equipment-notebooks/%5Bid%5D/chat/route.ts)

---

## What this is not

This map does not authorize merge, deploy, Doppler, networking, PLC, paid cloud agents, or customer-facing launch. Those stay Mike-only. Groq/Together are retired — not blockers.

**Next decision for Mike:** greenlight FINISH of the cited-manual pilot SKU (and which three CONNECT manual packs), or redirect.
