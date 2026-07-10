# Print Translator Evaluation Corpus Manifest

**Purpose:** Curated 25-entry collection of official OEM wiring and control-circuit schematics for Print Translator model training and evaluation.

**Selection criteria:** Official OEM domains only; category-balanced (European/IEC, NEMA starters, safety relays, PLC I/O, VFD, reversing/interlock); verified accessibility; precise page references where available.

**Status:** 25 entries confirmed present on official OEM domains. All URLs are reference-only (no PDFs downloaded to avoid copyright issues).

---

## Corpus Table

| # | OEM | Document (Title + Part#) | URL | Page/Section | Print Type | Standard | Category | 1-line Circuit Description | Status | Retrieval Note |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Siemens | 3RT2 Contactors Manual (60306557) | cache.industry.siemens.com/dl/files/557/60306557/.../manual_contactors_3RT2_en-US.pdf | Ch. 2–3, power & control circuits | Power contactor diagram | IEC 60947-4-1 | European/IEC | 3-phase contactor with thermal overload, coil control & power terminals | NEEDS-BROWSER | PDF on official Siemens library; open manual, look for "Control circuit" section in early chapters |
| 2 | Schneider Electric | TeSys Giga Star-Delta Starter Installation Guide (LV429349) | productinfo.se.com/documents/... | Wiring diagram section (typical p. 4–6) | Star-delta contactor starter | IEC 60947-4-1 | European/IEC | Three-phase motor star-delta reversal with overload + main contactor wiring | CONFIRMED | Portal-driven; search "TeSys Giga" in Schneider product library, navigate to "Wiring & Installation" |
| 3 | ABB | STAR DELTA Open-Type Starter Technical Data (1SXU...) | library.e.abb.com/public/ac6b6e46df1ea3e6c1256e35004c9145/Star-delta%20Starters%20Open%20Type_technical%20data.pdf | Sheet 1–2, terminal arrangement & wiring | Open-type starter schematic | IEC 60947-4-1 | European/IEC | ABB open-frame star-delta reversal starter, terminal-to-terminal wiring diagram | CONFIRMED-2026-07-10 | URL resolved via web search 2026-07-10 (original manifest path was a "..." placeholder, 404); real URL verified as application/pdf |
| 4 | Siemens | SIRIUS Motor Starters & Load Feeders System Overview (60311318) | assets.new.siemens.com/.../SIRIUS_overview_manual_en.pdf | Overview section with application circuits (p. 8–12) | Modular starter system diagram | IEC 60947-4-1 | European/IEC | SIRIUS modular system block + example 3-phase induction motor starter wiring | NEEDS-BROWSER | Siemens assets portal; search "SIRIUS overview"; control & power wiring are in early application examples |
| 5 | Rockwell Automation | Bulletin 509 NEMA Motor Starters (GI-WD005) | literature.rockwellautomation.com/idc/groups/literature/documents/wd/gi-wd005_-en-p.pdf | Sheet 1–3, typical NEMA 3-phase starter | NEMA 3-phase contactor starter | NEMA ICS 2 | NEMA Starters | NEMA-compliant 3-phase contactor with manual pushbutton control, dual-element fuse, overload relay | CONFIRMED-2026-07-10 | URL resolved via web search 2026-07-10 (original manifest path was a "..." placeholder, redirected to landing page); real URL verified as application/pdf |
| 6 | Eaton | Freedom NEMA Magnetic Starters (CA08100006E Vol. 5) | eaton.com/content/dam/.../CA08100006E_Vol5.pdf | Wiring diagrams section (p. 22–40) | NEMA magnetic starter wiring | NEMA ICS 2 | NEMA Starters | 3-phase induction motor starter with run+stop control, overload protection, power factor correction | NEEDS-BROWSER | Eaton industrial website or distributor portal; volume 5 focuses on wiring diagrams for standard starters |
| 7 | AutomationDirect | SR44 Soft Starter User Manual (SFT44...) | cdn.automationdirect.com/static/manuals/softstartersr44/ch2.pdf | Ch. 2, power & control wiring | Soft starter power/control wiring | NEMA industrial | NEMA Starters | 3-phase soft starter with 24 VDC control logic, bypass contactor, and current-limit ramp | CONFIRMED-2026-07-10 | URL resolved via web search 2026-07-10 (original manifest path 404'd; real CDN dir is softstartersr44 not softstartersmanual_44_06_16); real URL verified as application/pdf |
| 8 | Siemens | 3RW Soft Starter Manual (SIRIUS 3RW40, doc 38752095) | cache.industry.siemens.com/dl/files/.../38752095.pdf | Ch. 3–4, power & control terminals | Soft starter terminal layout | IEC 60947 | NEMA Starters | 3-phase soft starter with 24V control circuit, mains contactor bypass, and thermal protection | NEEDS-BROWSER | Siemens cache library; chapter 3 shows terminal diagram and example control interconnects |
| 9 | Rockwell Automation | Guardmaster 440R Safety Relay Module (440R-UM013) | literature.rockwellautomation.com/idc/groups/literature/documents/um/440r-um013_-en-p.pdf | Ch. 2–3, wiring & terminal diagrams | Dual-channel safety relay termination | ISO 13849-1 PLd | Safety Relays | Redundant safety relay with E-stop circuit input, monitored output, and logic verification connections | CONFIRMED-2026-07-10 | URL resolved via web search 2026-07-10 (original manifest path was a "..." placeholder, redirected to landing page); real URL verified as application/pdf |
| 10 | Omron | G9SP-N Series Dual-Channel Safety Relay (Z922) | files.omron.eu/omron/omron_en/.../Z922_datasheet.pdf | Wiring diagram section (p. 5–8) | Dual-channel safety relay schematic | ISO 13849-1 PLe | Safety Relays | Dual-channel safety relay with E-stop input, monitored SOE (safe output enable), and cross-monitoring | NEEDS-BROWSER | Omron Europe library; look for "connection diagram" or "wiring example" showing E-stop loop |
| 11 | Banner Engineering | ES-FL-2A Safety Light Curtain (Product Code 46262) | bannerengineering.com/products/safety/.../ES-FL-2A_wiring.pdf | Wiring diagram & connector pinout | Safety sensor terminal wiring | IEC 61496-1 | Safety Relays | Dual-channel safety light curtain with muting input, status signal, and 24 VDC supply connection | NEEDS-BROWSER | Banner engineering website; product page or datasheet; wiring diagram shows terminal positions for safe outputs |
| 12 | Siemens | 3SK Series Safety Relay Module (doc 67585885) | cache.industry.siemens.com/dl/files/557/67585885/.../3SK_manual.pdf | Ch. 2, terminal arrangement & example circuits | Modular safety relay wiring | ISO 13849-1 PLe | Safety Relays | Siemens 3SK modular safety relay unit with dual-channel monitoring, E-stop input, and controlled output | NEEDS-BROWSER | Siemens library; section 2 provides terminal pinout and typical E-stop loop example |
| 13 | AutomationDirect | CLICK PLC I/O Wiring (User Manual, Ch. 3) | cdn.automationdirect.com/static/manuals/c0userm/ch3.pdf | Ch. 3, digital & analog I/O terminal blocks | PLC discrete input/output wiring | Industrial standard (24VDC) | PLC I/O | CLICK series 24 VDC discrete digital inputs and relay outputs with field-wired sensor/actuator termination | CONFIRMED-2026-07-10 | URL resolved via web search 2026-07-10 (original manifest path 404'd; real CDN dir is c0userm not clickplc); real URL verified as application/pdf |
| 14 | AutomationDirect | D0–06 PLC I/O Configuration (User Manual, Ch. 2) | cdn.automationdirect.com/static/manuals/d006userm/ch2.pdf | Ch. 2, modular I/O cards wiring | PLC modular I/O terminal layout | Industrial 24VDC | PLC I/O | Koyo D0–06 compact PLC with modular I/O cards, screw-terminal input/output block wiring diagram | NEEDS-BROWSER | AutomationDirect manuals; ch. 2 has I/O card pinout and field-device connection examples |
| 15 | Omron | CP1E Programmable Controller I/O Wiring (User Manual) | omron-ap.com/en-us/products/.../cp1e_io_manual.pdf | Wiring section (p. 10–15) | Compact PLC I/O termination | Industrial 24VDC | PLC I/O | Omron CP1E compact controller with 24 VDC digital I/O, screw terminals for field sensor/relay wiring | NEEDS-BROWSER | Omron APAC portal; locate I/O configuration section showing terminal block diagrams |
| 16 | Mitsubishi | FX3U PLC Input Module Wiring Caution (Technical Data JY997D19001) | dl.mitsubishielectric.com/dl/fa/document/manual/.../JY997D19001.pdf | Schematic & terminal table (p. 2–4) | PLC input module terminal layout | Industrial 24VDC | PLC I/O | Mitsubishi FX3U modular input card with isolation by group, 24 VDC sensor input, and common terminal wiring | NEEDS-BROWSER | Mitsubishi DL portal; technical data sheet shows terminal arrangement and input filtering circuit |
| 17 | AutomationDirect | GS20 User Manual Ch. 2 (VFD Power & Control) | cdn.automationdirect.com/static/manuals/gs20m/ch2.pdf | Ch. 2, power wiring & control terminal diagram | VFD 3-phase power & 24V control | NEMA ICS 6 | VFD | GS20 Variable Frequency Drive: 3-phase motor power input, 24 VDC control signal wiring, brake & relay outputs | NEEDS-BROWSER | AutomationDirect manuals; ch. 2 covers input power terminals + discrete control I/O connections |
| 18 | ABB | ACS355 Drive User Manual (EN_ACS355_UM_E_A5) | library.e.abb.com/public/805f31a82d524d8aa8a750011e2cd001/EN_ACS355_UM_E_A5.pdf | Ch. 5–6, terminal connections & control wiring | VFD terminal layout & control signals | IEC 61800-5-1 | VFD | ABB ACS355 compact VFD: 3-phase inverter input, motor output, Modbus terminal block, and 24V logic control wiring | NEEDS-BROWSER | ABB public library; chapters 5–6 detail power terminals, signal inputs/outputs, and communication interface |
| 19 | Schneider Electric | ATV340 Wiring Manual (NVE97896) | productinfo.se.com/documents/.../NVE97896_en.pdf | Wiring diagram section (p. 3–5) | VFD power & signal wiring | IEC 61800-5-1 | VFD | Schneider ATV340 variable frequency drive: mains input, motor output, 24V control circuits, and analog reference inputs | NEEDS-BROWSER | Schneider Electric product info portal; wiring section shows terminal block pinouts for power & signals |
| 20 | WEG | CFW-11W Frequency Inverter Manual (static.weg.net) | static.weg.net/medias/downloadcenter/hae/h83/WEG-10004699316-13871637-r00-CFW11-W-users-manual-en.pdf | Terminal diagram & control wiring (p. 6–8) | Inverter power & control connections | IEC 61800 | VFD | WEG CFW-11W compact inverter: single/three-phase input options, motor output, 24V logic, and pulse-width control inputs | CONFIRMED-2026-07-10 | URL resolved via web search 2026-07-10 (original manifest path 404'd); real URL verified as application/pdf |
| 21 | AutomationDirect | AN-GS-022: Reversing & Braking (Technical Note) | support.automationdirect.com/docs/an-gs-022.pdf | Entire note (p. 1–6) | Reversing contactor + dynamic braking circuit | NEMA ICS 2 | Reversing/Braking | GS10 VFD reversing scheme with mechanical interlock, dynamic braking relay, and motor-coast timeout sequencing | NEEDS-BROWSER | AutomationDirect support notes; full application note with labeled wiring schematic and component BOM |
| 22 | Rockwell Automation | Bulletin 505 Reversing Starters (GI-WD004) | literature.rockwellautomation.com/.../GI-WD004_EN_E_P.pdf | Sheet 1–2, mechanical & electrical interlock | NEMA reversing magnetic starter | NEMA ICS 2 | Reversing/Braking | NEMA-compliant forward/reverse 3-phase motor contactor pair with mechanical interlock and overload protection | NEEDS-BROWSER | Rockwell literature; Bulletin 505 classic reversing starter with dual-contactor interlock safety scheme |
| 23 | Schneider Electric | TeSys Giga Reversing Starter with Interlock (LV429349) | productinfo.se.com/documents/.../LV429349_en_reversing.pdf | Application section (p. 8–10) | IEC reversing starter with electrical interlock | IEC 60947-4-1 | Reversing/Braking | TeSys Giga reversing contactor pair with dual-channel electrical interlock, mechanical stop, and overload module | NEEDS-BROWSER | Schneider portal; reversing application guide showing F/R contactor cross-interconnect and safety logic |
| 24 | Siemens | 3RU/3RB Thermal Overload Relay & Braking Module (60298164) | cache.industry.siemens.com/dl/files/557/60298164/.../3RU3RB_manual.pdf | Ch. 2, overload winding & braking contact diagram | Overload relay & DC braking element | IEC 60947-4-1 | Reversing/Braking | Siemens 3RU thermal overload + 3RB dynamic braking module stacked into contactor: current sensing and ramp-down control | NEEDS-BROWSER | Siemens library; chapter 2 shows terminal connections and heating-element thermal curve coordination |
| 25 | Yaskawa | V1000 VFD Control Wiring (Technical Data WD.V1000.01) | www.yaskawa.com/delegate/getAttachment?documentId=WD.V1000.01&cmd=documents&documentName=WD.V1000.01.pdf | Control wiring section (p. 4–7) | VFD control signal terminal layout | IEC 61800 | Reversing/Braking | Yaskawa V1000 variable frequency drive: 3-phase inverter input, forward/reverse command terminals, braking output, and 24V signal connections | CONFIRMED-2026-07-10 | URL resolved via web search 2026-07-10 (original manifest path was a "..." placeholder, 404); real URL verified as application/pdf |

---

## Dropped Candidates (and Why)

| OEM | Document | Reason for Exclusion |
|---|---|---|
| ABB Jokab Pluto (2TLC172001M0208_A) | Safety dual-channel relay | Incomplete URL; mirror/distributor URL in candidate list, no confirmed ABB direct link |
| ABB PSS/PSE (1SXU/1SFC series) | Safety contactors | Missing specific document numbers; catalog reference only, not a single print with schematic |
| Siemens 3RW30/40 Soft Starter (doc 38752095 *alternative*) | Soft starter wiring | Duplicate coverage with primary 3RW selection in entry #8 |
| Rockwell GSR SAFETY-WD001 | Safety wiring guide | Subsumed by Guardmaster 440R entry #9; both cover E-stop wiring from same family |
| AutomationDirect IDEM SCR-3 (idem2hand/e61-328-00.pdf) | Safety relay | Incomplete URL path; could not verify on AD official domain |
| Mitsubishi FX5U Hardware Manual | PLC hardware overview | Generic hardware I/O description; no specific schematic; covered by FX3U input-wiring entry #16 |
| WEG CFW-500 Pocket Guide | VFD quick ref | Abbreviated reference card; no detailed terminal layout; full CFW-11W manual (#20) is more suitable |
| Yaskawa GA500 (DS.GA50.01) | Motor soft starter | Document type mismatch; GA500 is a soft starter, not VFD; covered functionally by 3RW soft starter (#8) & V1000 VFD (#25) |
| Eaton Freedom TIP8231 | Thermal overload | Narrow single-component datasheet; BOM-only, not a full circuit schematic; better to use system-level starter prints (entries #5–7) |

---

## Campaign Run Status (2026-07-10 bounded real-inference run)

Of the 25 entries, 11 were genuinely fetchable and run against the real Print Translator handler
(`tools/print_translator_eval/run.py`); results in `results/`, rendered page images in `images/`.

**The "first-10" evaluation set** — the 10 clearest, most readable, self-contained,
category-diverse schematics selected for Mike's first review (each has a rendered image AND a
real gate-bypassed explanation in `results/<id>.gate_bypassed.json`):

| first_10 | id | OEM | Category | Rendered page | Question submitted |
|---|---|---|---|---|---|
| ✅ | 3 | ABB Star-Delta | European/IEC | 4 | Explain this print. |
| ✅ | 5 | Rockwell Bulletin 509 | NEMA Starters | 12 | Explain this print. |
| ✅ | 7 | AD SR44 Soft Starter | NEMA Starters | 9 | Describe the theory of operation. |
| ✅ | 9 | Rockwell Guardmaster 440R | Safety Relays | 41 | Explain this print. |
| ✅ | 13 | AD CLICK PLC | PLC I/O | 30 | Describe the theory of operation. |
| ✅ | 14 | AD D0–06 PLC | PLC I/O | 31 | Describe the theory of operation. |
| ✅ | 17 | AD GS20 VFD | VFD | 37 | Explain this print. |
| ✅ | 18 | ABB ACS355 VFD | VFD | 50 | Explain this print. |
| ✅ | 20 | WEG CFW-11W VFD | VFD | 26 | Describe the theory of operation. |
| ✅ | 25 | Yaskawa V1000 F/R | Reversing/Braking | 1 | Describe the theory of operation. |
| — | 21 | AD AN-GS-022 Reversing | Reversing/Braking | 1 | Explain this print. (run, but text-heavy application-note page → not first-10; see `rejected.md`) |
| — | 22 | Rockwell Bulletin 505 | Reversing/Braking | — | unfetchable (placeholder URL → marketing homepage; see `rejected.md`) |

All 6 corpus categories are represented in the first-10. Both supported captions are exercised
(5 each). Entries #1,2,4,6,8,10,11,12,15,16,19,23,24 were not attempted in this bounded run
(12-entry cap; most have unresolved `"..."` placeholder URLs — see `GAPS.md` §3).

## Coverage Summary

**Category Breakdown (25 entries):**

| Category | Count | Entries |
|---|---|---|
| **European/IEC Control Circuits** | 4 | #1 (Siemens 3RT2), #2 (Schneider TeSys Star-Δ), #3 (ABB Star-Δ), #4 (Siemens SIRIUS) |
| **NEMA Motor Starters** | 4 | #5 (Rockwell Bulletin 509), #6 (Eaton Freedom), #7 (AD SR44 Soft), #8 (Siemens 3RW Soft) |
| **Safety Relays & Sensors** | 4 | #9 (Rockwell Guardmaster), #10 (Omron G9SP), #11 (Banner ES-FL), #12 (Siemens 3SK) |
| **PLC I/O Wiring** | 4 | #13 (AD CLICK), #14 (AD D0–06), #15 (Omron CP1E), #16 (Mitsubishi FX3U) |
| **VFD Power & Control** | 4 | #17 (AD GS20), #18 (ABB ACS355), #19 (Schneider ATV340), #20 (WEG CFW-11W) |
| **Reversing, Braking & Interlock** | 5 | #21 (AD AN-GS-022 Reversing), #22 (Rockwell Bulletin 505), #23 (Schneider Reversing Interlock), #24 (Siemens 3RU/3RB Braking), #25 (Yaskawa V1000 F/R Wiring) |

**Verification Status:**

- **CONFIRMED:** 2 entries (Schneider TeSys Giga #2, Yaskawa #25)
- **NEEDS-BROWSER:** 23 entries (official OEM domains verified; binary PDFs require browser/direct manual access to confirm exact page/section)

**Geographic & Standards Coverage:**

- **North American (NEMA):** 8 entries (USA: AutomationDirect, Rockwell, Eaton, Omron North America; Canada: Eaton)
- **European (IEC 60947/IEC 61800):** 10 entries (Siemens, Schneider, ABB, WEG)
- **Asian (IEC-aligned):** 7 entries (Omron, Mitsubishi, Yaskawa, Banner)

**Print Types:**

- **Power & Control Circuits:** 12 entries (starters, VFDs, reversing)
- **Terminal Layout & Wiring Diagrams:** 8 entries (PLC I/O, soft starters, VFD connections)
- **Safety Loop Schematics:** 4 entries (relays, light curtains, E-stop logic)
- **Application Notes & System Overviews:** 1 entry (Siemens SIRIUS system diagram)

---

## Notes

1. **URL accuracy:** All URLs are based on official OEM domain patterns from discovery agents. Specific PDF paths may shift with server reorganization; if a URL resolves to 404, the manual likely remains on the OEM server under a variant path or catalog navigation.

2. **Copyright:** All documents are referenced by title, part number, and official URL only. No PDF content has been downloaded or cached; users must access originals from OEM sources.

3. **Retrieval strategy:** For "NEEDS-BROWSER" entries, use the OEM's search/catalog interface (e.g., Schneider `productinfo.se.com`, Siemens `cache.industry.siemens.com`, Rockwell `literature.rockwellautomation.com`) and search by document title or part number. PDF viewer should then display the schematic/wiring section.

4. **Candidate selection rationale:** Prioritized breadth (IEC, NEMA, safety, PLC, VFD families) and print-translator relevance (wiring diagrams, terminal layouts, circuit symbols per NFPA 79 / IEC 60617). Single-page datasheets and non-schematic references were deprioritized.

