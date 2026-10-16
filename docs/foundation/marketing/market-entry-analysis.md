# FactoryLM market entry analysis: where we go in
*Prepared for Mike Harper, Oct 10, 2026. Plain-English draft. Every number has a source listed at the end. Anything marked **Estimate** is my own math, and its basis is shown.*

## 1. Bottom line
**Go in through single-site plants with about 50–500 employees and a 2–15 person maintenance crew running mixed-brand automation (Allen-Bradley, Siemens, Mitsubishi and others).** Sell one thing MIRA can already prove: *"Your machines' manuals in your crew's pocket. Every answer cites the page."* Start with one line of machines, as a paid 30-day pilot. **Runner-up:** independent controls contractors and small system integrators. Keep the Drive Commander technician pages as a free top-of-funnel, not as the first revenue bet. Don't lead with the $500 Assessment or the PLC-tag/CMMS "namespace" story until those parts are proven.

## 2. What MIRA can prove today (honest inventory)
| Proven | Not proven / broken |
|---|---|
| Upload an OEM manual and get a cited answer. Oct 4 live audit: Rockwell Micro810 manual, answer cited p.57. | Short fault-code queries ("F0004", "oC") often return "Not found" or repeat the previous answer. |
| Honest refusal when the manual doesn't cover the question. Sept 5 Festo test: abstained correctly, then cited SPC200 p.7 on a covered question. | No "New chat" control, so earlier answers bleed into later ones. |
| Mobile app + Hub notebook chat (app.factorylm.com) share one cited-answer path. | A notebook with no sources answers from general knowledge, and it isn't clearly labeled as such. |
| Drive Commander G120 page is live: 8 faults, 5 with cited detail. | Nameplate photo → automatic manual discovery isn't proven live. The mobile app is sideloaded for dogfood, and I found no app-store listing. |
| | Website claims (PLC-tag mapping, CMMS write-back, fault-history answers, the PowerFlex 755 example) aren't shown in any proof I found. |
| | MIRA has never been run on the Answer Radar forum questions (standing hold). I found no record of a paying customer. |

## 3. Market facts (sourced)
- **People:** 538,300 US industrial machinery mechanics, maintenance workers and millwrights (2024), with about 54,200 openings a year projected through 2034 (BLS). There are 818,700 electricians, but most work in construction, not plants (BLS).
- **Skills gap:** US manufacturing may need up to 3.8M workers by 2033, and up to 1.9M of those jobs could go unfilled (Deloitte/Manufacturing Institute, 2024).
- **Plants:** 239,265 US manufacturing firms; 235,088 have under 500 employees, and 74% have under 20 (NAM, 2022 data). **Estimate:** about 62,000 firms have 20+ employees (239,265 × 26%). That's a rough ceiling on firms big enough to have a maintenance crew. It counts firms, not plants.
- **Downtime:** Unplanned downtime costs Fortune Global 500 firms about $1.4T a year (11% of revenue). Automotive runs about $2.3M per hour, and SMEs see up to $150K per hour at the top end (Siemens TCOD 2024).
- **AI adoption and how the work really goes:** In a survey of 1,320 maintenance pros, 44% have adopted or are piloting AI and 65% expect to by 2026. 58% spend more than half their time reacting to breakdowns. The average fixed asset is 24 years old (MaintainX 2025). On r/PLC, users say generic chatbots invent instructions and part numbers unless they're working from the exact manual.

## 4. Competitors and alternatives
| Who | What it is | Price (published or reported) |
|---|---|---|
| MaintainX | CMMS. CoPilot AI uses manuals and work history | Essential $20–25/user/mo. **CoPilot only on Enterprise (custom)** |
| UpKeep | CMMS with Nova AI credits | $24 / $55 per user/mo. Higher tiers custom |
| Fiix (Rockwell) | CMMS. Foresight AI | $45 / $75 per user/mo |
| Limble | CMMS | Quote via calculator. Third parties report ~$28–69/user/mo |
| Tractian / Augury | Sensors plus condition monitoring | Tractian CMMS $60/user/mo (5-user min). Sensors and Augury are quote-only |
| Siemens Industrial Copilot (Senseye) | Enterprise predictive maintenance plus a GenAI maintenance copilot | Entry/Scale packages, sales quote |
| Rockwell + Microsoft | FactoryTalk Design Studio Copilot (for engineers). Rockwell's own Singapore maintenance copilot (internal) | Bundled or not public |
| Augmentir, Dozuki | Connected-worker and work-instruction platforms | Quote. Dozuki ~$850/mo with a 50-user minimum (2021 third-party figure, may be stale) |
| Aquant | AI for OEM field service (Siemens, Stryker, Deere) | Enterprise quote |
| **Quintess, Satori, YAFEX** (new) | Cited troubleshooting from your manuals and history. Quintess is voice-first, for fleets, rail and field work | Demo or quote. A third party lists Quintess at $30–100/mo (unverified) |
| ChatGPT / Gemini | Generic AI | $8–20/mo. No citations from your manual |
| Free help | OEM phone support (e.g. AutomationDirect, M–F 9–6 ET), PLCTalk, r/PLC, YouTube | $0, but slow, after-hours gaps, uncited |

**The gap:** A small plant can't get a cited "ask your own manuals" assistant without either (a) switching CMMS and buying an enterprise tier (MaintainX CoPilot), (b) buying an enterprise platform (Siemens, Aquant, Augmentir), or (c) trusting uncited ChatGPT. A brand-neutral, flat-priced, cited manual assistant for a 5–15 person crew is open. **But it's closing:** Quintess, Satori and YAFEX already pitch almost this exact promise. Speed matters more than polish.

## 5. Demand signals from Answer Radar (Sept 5 – Oct 9)
20 real questions were frozen from MrPLC and PLCTalk. Reddit was blocked on every run.
- **Brands:** Rockwell/Allen-Bradley 5 (CompactLogix, GuardLogix, Kinetix 5500/6500, 1756-DNB), Mitsubishi 4 (FX5U, Q06UDV, RJ71, GX Developer), Siemens 3 (TP1200 HMI ×2, S7-1212C), Omron 3 (CQM1, DeviceNet, EIP), Keyence 2, Schneider 2 (M340, TM172), plus GE RX3i, WAGO and Festo. Some questions name two brands.
- **Question types:** Network/comms setup or faults about 8 (Modbus TCP, EtherNet/IP, DeviceNet, EGD, CAN, PROFIBUS). Safety/motion 4. HMI display issues 3. Legacy recovery or old software 3 (lost CQM1 program, GX Developer export, Festo SPC/WinPISA). I/O module fault 1. Product comparison 1.
- **VFD fault codes: 0 of 20 frozen.** Drives appeared only as near-misses (PowerFlex 525/40, Durapulse GS4).
- **Who asks:** Controls people working across many brands, often on someone else's machine ("I have been asked by a customer to help them with a machine that has gone down").
- **Caveat:** This is one hand-picked question a day from controls forums. It shows *what kinds* of questions come up. It's not a random sample and says nothing about willingness to pay. It does weaken the "VFD fault-code first" bet, and it strengthens "multi-brand manual lookup."

## 6. Segment scoring (1 = weak, 5 = strong)
| Segment | Pain | Speed to $ | Reach | MIRA fit today | Defensible | **Total** | Notes (buyer, budget, cycle, willingness to pay) |
|---|---|---|---|---|---|---|---|
| **Small/mid plant maintenance teams** | 4 | 3 | 3 | 4 | 3 | **17** | Maintenance manager buys. Already pays $20–75/user/mo for CMMS. A flat price under ~$500/mo could likely go on a card (**Estimate**, assumes a typical small-plant spend limit). Cycle: weeks. Their manuals are a fixed set, which matches the proven upload→cite flow |
| **Controls contractors / small integrators** | 4 | 4 | 3 | 3 | 2 | **16** | Owner buys fast. 400+ CSIA member firms, plus many unaffiliated ones. Multi-brand pain matches the radar. They need manual discovery on demand (unproven), and many questions are programming that ChatGPT already handles |
| MRO / motor & drive repair shops | 4 | 3 | 3 | 3 | 2 | 15 | 1,700+ EASA member firms. Multi-brand drives and motors. Reach through EASA |
| Individual techs (prosumer) | 4 | 2 | 3 | 2 | 1 | 12 | Low price ($197/yr test) against ChatGPT at $8–20/mo. The short fault-code bug hits this group hardest. App not in stores. SEO takes months |
| OEMs / machine builders | 3 | 2 | 2 | 3 | 3 | 13 | High willingness to pay. Months-long cycles. Aquant is entrenched (PMMI: OEM technician shortage) |
| Distributors (AutomationDirect, Grainger, Rexel) | 2 | 1 | 2 | 3 | 3 | 11 | Great *channel later*. They already give free tech support and are building their own AI (Grainger) |
| Trade schools / apprenticeships | 2 | 1 | 3 | 3 | 2 | 11 | Academic budget cycles. Good for credibility, not first revenue |
| Large enterprise plants | 4 | 1 | 1 | 2 | 2 | 10 | Security review, SSO, CMMS integration. Siemens, Rockwell and MaintainX Enterprise already own the space |

**Top 3:** (1) Small/mid plants, (2) controls contractors/integrators, (3) MRO repair shops.

## 7. Recommended beachhead and test
**Offer to test: "Plant Manual Desk" pilot.** It's $500 for 30 days. We load the manuals for up to 25 machines on one line into Hub notebooks, the crew asks from phone or web, and every answer cites the page. After that it's **$399/month per site, up to 15 users**, with the $500 credited. **Estimate basis:** below UpKeep Essential for 15 users ($360) plus any AI add-on, and well below MaintainX Premium for 10 users ($650/mo). If uptake is strong, test $499.

**Path to the first 10 customers:**
1. 10–15 warm intros from Mike's network and nearby plants, plus local distributor reps and friendly integrators who serve SMB plants.
2. 50 personal LinkedIn/email notes a month to maintenance managers at 50–500 employee plants with AB/Siemens/Mitsubishi equipment. The Pipeline Scout bot drafts and Mike sends.
3. Every demo uses *their* manual for *their* machine, live. Bring a real fault, the way Quintess does.
4. Each cited forum-style answer becomes a public fault page (SEO compounding, no forum ads).

**Estimate:** about 100 targeted contacts → about 10 real conversations → 3 pilots → 2 paying sites. That's a common B2B rule of thumb, not data. Ten paying sites likely takes about 3–4 months of this cadence.

**Product gaps that must close before the first pilot:**
1. **P0 Fault-code lookup:** "F0004" and "oC" must hit the manual's fault table, not return "Not found" or repeat the last answer. Techs type codes first.
2. **P0 New chat / clean context:** one question must not bleed into the next.
3. **P0 Label general answers:** if the answer isn't from their manuals, say so plainly. This keeps your "ChatGPT-like for general questions" intent without hurting citation trust.
4. **P1 Bulk manual load per line,** plus a "which manuals are loaded" view. We can do this by hand during pilots.
5. **Defer:** CMMS write-back, PLC-tag mapping, Drive Commander Pro checkout, the enterprise namespace pitch. Also trim the website claims we can't prove yet.

**30-day test (start once the three P0s pass on a 30-question check using real radar questions):**
- **Week 1:** Fix the P0s. Rewrite one landing page for the pilot offer. Build a list of 100 named plants.
- **Weeks 2–3:** Send outreach. Book demos on the prospect's own manuals. Close pilots.
- **Week 4:** Run the pilots. Log every question, whether the citation was right, and weekly active users.
- **Continue if:** at least 3 paid pilots start (or at least 2 plus 1 signed conversion), at least 50% of seats ask questions weekly, and at least 80% of answers drawn from their manuals cite the right page (checked by us).
- **Kill or pivot to the runner-up (integrators) if:** fewer than 2 paid pilots after 25+ real conversations, or crews stop asking by week 2, or citation accuracy on their real questions is below 70%.

## 8. Biggest risks
- **Trust:** one wrong cited answer on a live fault can lose the plant. The fault-code and chat-bleed bugs make that more likely today.
- **Crowding:** Quintess, Satori and YAFEX pitch the same promise, and CMMS vendors may push AI down from their enterprise tiers.
- **Over-promising:** the site sells namespace, PLC-tag and CMMS features that aren't proven.
- **Founder time:** pilots need hand-loading manuals. That's fine for 10 customers, but it doesn't scale without bulk load.
- **Manual access:** some OEM manuals are behind logins. Plants often have paper only, and OCR quality is unproven.

## Sources
- BLS, Industrial machinery mechanics, maintenance workers and millwrights: https://www.bls.gov/ooh/installation-maintenance-and-repair/industrial-machinery-mechanics-and-maintenance-workers-and-millwrights.htm
- BLS, Electricians: https://www.bls.gov/ooh/construction-and-extraction/electricians.htm
- Deloitte / Manufacturing Institute, 3.8M workers by 2033: https://themanufacturinginstitute.org/manufacturers-need-as-many-as-3-8-million-new-employees-by-2033/
- NAM, Facts about manufacturing: https://nam.org/mfgdata/facts-about-manufacturing-expanded/
- Siemens, True Cost of Downtime 2024: https://www.siemens.com/global/en/products/services/industrial-services/true-cost-of-downtime.html ; report PDF: https://assets.new.siemens.com/siemens/assets/api/uuid:1b43afb5-2d07-47f7-9eb7-893fe7d0bc59/tcod-2024_original.pdf ; $1.4T figure as summarized by ISM: https://www.ismworld.org/supply-management-news-and-reports/news-publications/inside-supply-management-magazine/blog/2024/2024-08/the-monthly-metric-unscheduled-downtime/
- MaintainX, 2025 State of Industrial Maintenance: https://www.getmaintainx.com/newsroom/state-of-industrial-maintenance-report-2025
- r/PLC, "Do you use AI in your job?": https://www.reddit.com/r/PLC/comments/1nu8s5r/do_you_use_ai_in_your_job/ (seen via search summary only; Reddit blocks our fetches)
- MaintainX pricing: https://www.getmaintainx.com/pricing ; plan detail: https://facilio.com/blog/maintainx-pricing/ ; CoPilot: https://www.getmaintainx.com/blog/whats-new-at-maintainx-july-2026
- UpKeep pricing: https://upkeep.com/pricing/
- Fiix pricing: https://fiixsoftware.com/cmms/pricing/
- Limble: https://limble.com/pricing ; reported ranges: https://facilio.com/blog/limble-cmms-pricing/
- Tractian CMMS pricing: https://tractian.com/en/solutions/cmms/pricing
- Augury pricing (quote): https://www.augury.com/pricing/
- Siemens Maintenance Copilot Senseye: https://press.siemens.com/global/en/pressrelease/siemens-expands-industrial-copilot-new-generative-ai-powered-maintenance-offering
- Rockwell FactoryTalk Design Studio Copilot: https://www.rockwellautomation.com/en-us/docs/factorytalk-design-studio/current/contents-ditamap/getting-started/factorytalk-design-studio-copilot.html ; Microsoft on Rockwell's maintenance copilot: https://news.microsoft.com/source/features/digital-transformation/rockwell-automation-pairs-ai-with-decades-of-shop-floor-know-how-so-workers-can-solve-glitches-faster/
- Augmentir: https://www.augmentir.ai/pricing
- Dozuki: https://www.dozuki.com/pricing ; 2021 figure: https://sopx.io/insights/dozuki-pricing/
- Aquant: https://www.aquant.ai/solutions/field-technicians
- Quintess: https://www.quintess.ai/ ; third-party price: https://saasbrowser.com/en/saas/1285204/quintess
- Satori: https://assistants.satorianalytics.com/manufacturing ; YAFEX: https://yafex.io/
- ChatGPT plans: https://openai.com/ChatGPT/pricing ; Google AI Pro: https://gemini.google/jm/subscriptions/?hl=en
- AutomationDirect tech support: https://support.automationdirect.com/techcontact.html
- Grainger GenAI: https://www.databricks.com/customers/grainger
- CSIA 2025 prospectus (400+ members): https://controlsys.org/wp-content/uploads/2024/10/CSIA-2025-Prospectus-FNL.pdf
- EASA (1,700+ firms): https://easa.com/About-EASA
- PMMI 2025 Aftermarket Parts & Service report: https://www.pmmi.org/report/2025-aftermarket-parts-services
- DOL, Advanced Manufacturing apprenticeship: https://www.apprenticeship.gov/apprenticeship-industries/advanced-manufacturing
- Internal: factorylm.com, factorylm.com/buy, factorylm.com/drive-commander/siemens-g120 (fetched Oct 10); Sept 5 Product brief "Drive Commander technician PMF loop"; AR-FIRST-QUESTION-001 Notebook Prover score; Answer Radar scans and freezes in /workspace/answer-radar and /workspace/ar-2026-10-0*; /workspace/agentic-marketing-team-plan.md; Oct 4 audit facts as relayed.
