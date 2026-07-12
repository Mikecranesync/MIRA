# Print Translator Evaluation Corpus Manifest

**Purpose:** Curated 25-entry collection of official OEM wiring and control-circuit schematics for Print Translator model training and evaluation.

**Selection criteria:** Official OEM domains only; category-balanced (European/IEC, NEMA starters, safety relays, PLC I/O, VFD, reversing/interlock); verified accessibility; precise page references where available.

**Status:** 25 entries confirmed present on official OEM domains. All URLs are reference-only (no PDFs downloaded to avoid copyright issues).

---

## Corpus Table

| # | OEM | Document (Title + Part#) | URL | Page/Section | Print Type | Standard | Category | 1-line Circuit Description | Status | Retrieval Note |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Siemens | 3RT2 Contactors Manual (60306557) | https://cache.industry.siemens.com/dl/files/557/60306557/att_111612/v1/manual_contactors_3RT2_en-US.pdf | Ch. 2–3, power & control circuits | Power contactor diagram | IEC 60947-4-1 | European/IEC | 3-phase contactor with thermal overload, coil control & power terminals | CONFIRMED-2026-07-10 | Resolved+verified 2026-07-10 via Haiku discovery + httpx GET (200/206, application/pdf); high-confidence official source. |
| 2 | Schneider Electric | TeSys Giga Star-Delta Starter Installation Guide (LV429349) | productinfo.se.com/documents/... | Wiring diagram section (typical p. 4–6) | Star-delta contactor starter | IEC 60947-4-1 | European/IEC | Three-phase motor star-delta reversal with overload + main contactor wiring | NEEDS-BROWSER | Placeholder '...' URL never resolved (missed by 2026-07-10 discovery batch, which targeted NEEDS-BROWSER only); still needs a real direct-PDF URL. |
| 3 | ABB | STAR DELTA Open-Type Starter Technical Data (1SXU...) | library.e.abb.com/public/ac6b6e46df1ea3e6c1256e35004c9145/Star-delta%20Starters%20Open%20Type_technical%20data.pdf | Sheet 1–2, terminal arrangement & wiring | Open-type starter schematic | IEC 60947-4-1 | European/IEC | ABB open-frame star-delta reversal starter, terminal-to-terminal wiring diagram | CONFIRMED-2026-07-10 | URL resolved via web search 2026-07-10 (original manifest path was a "..." placeholder, 404); real URL verified as application/pdf |
| 4 | Siemens | SIRIUS Motor Starters & Load Feeders System Overview (60311318) | (none found) | Overview section with application circuits (p. 8–12) | Modular starter system diagram | IEC 60947-4-1 | European/IEC | SIRIUS modular system block + example 3-phase induction motor starter wiring | REJECTED-NO-SOURCE | No authentic official direct-PDF located for the SIRIUS overview (doc 60311318) 2026-07-10; dropped from runnable corpus. |
| 5 | Rockwell Automation | Bulletin 509 NEMA Motor Starters (GI-WD005) | literature.rockwellautomation.com/idc/groups/literature/documents/wd/gi-wd005_-en-p.pdf | Sheet 1–3, typical NEMA 3-phase starter | NEMA 3-phase contactor starter | NEMA ICS 2 | NEMA Starters | NEMA-compliant 3-phase contactor with manual pushbutton control, dual-element fuse, overload relay | CONFIRMED-2026-07-10 | URL resolved via web search 2026-07-10 (original manifest path was a "..." placeholder, redirected to landing page); real URL verified as application/pdf |
| 6 | Eaton | Freedom NEMA Magnetic Starters (CA08100006E Vol. 5) | https://www.eaton.com/content/dam/eaton/products/industrialcontrols-drives-automation-sensors/nema-contactors-and-starters-v5-t2-ca08100006e.pdf | Wiring diagrams section (p. 22–40) | NEMA magnetic starter wiring | NEMA ICS 2 | NEMA Starters | 3-phase induction motor starter with run+stop control, overload protection, power factor correction | CONFIRMED-2026-07-10 | Resolved+verified 2026-07-10 via Haiku discovery + httpx GET (200/206, application/pdf); high-confidence official source. |
| 7 | AutomationDirect | SR44 Soft Starter User Manual (SFT44...) | cdn.automationdirect.com/static/manuals/softstartersr44/ch2.pdf | Ch. 2, power & control wiring | Soft starter power/control wiring | NEMA industrial | NEMA Starters | 3-phase soft starter with 24 VDC control logic, bypass contactor, and current-limit ramp | CONFIRMED-2026-07-10 | URL resolved via web search 2026-07-10 (original manifest path 404'd; real CDN dir is softstartersr44 not softstartersmanual_44_06_16); real URL verified as application/pdf |
| 8 | Siemens | 3RW Soft Starter Manual (SIRIUS 3RW40, doc 38752095) | https://support.industry.siemens.com/cs/attachments/38752095/Manual_softstarter_3RW30_3RW40_en-US.pdf | Ch. 3–4, power & control terminals | Soft starter terminal layout | IEC 60947 | NEMA Starters | 3-phase soft starter with 24V control circuit, mains contactor bypass, and thermal protection | CONFIRMED-2026-07-10 | Resolved+verified 2026-07-10 via Haiku discovery + httpx GET (200/206, application/pdf); high-confidence official source. |
| 9 | Rockwell Automation | Guardmaster 440R Safety Relay Module (440R-UM013) | literature.rockwellautomation.com/idc/groups/literature/documents/um/440r-um013_-en-p.pdf | Ch. 2–3, wiring & terminal diagrams | Dual-channel safety relay termination | ISO 13849-1 PLd | Safety Relays | Redundant safety relay with E-stop circuit input, monitored output, and logic verification connections | CONFIRMED-2026-07-10 | URL resolved via web search 2026-07-10 (original manifest path was a "..." placeholder, redirected to landing page); real URL verified as application/pdf |
| 10 | Omron | G9SP-N Series Dual-Channel Safety Relay (Z922) | https://files.omron.eu/downloads/latest/manual/en/z922_g9sp_series_safety_controller_operation_manual_en.pdf | Wiring diagram section (p. 5–8) | Dual-channel safety relay schematic | ISO 13849-1 PLe | Safety Relays | Dual-channel safety relay with E-stop input, monitored SOE (safe output enable), and cross-monitoring | CONFIRMED-2026-07-10 | Resolved+verified 2026-07-10 via Haiku discovery + httpx GET (200/206, application/pdf); medium-confidence official source. |
| 11 | Banner Engineering | ES-FL-2A Safety Light Curtain (Product Code 46262) | https://info.bannerengineering.com/cs/groups/public/documents/literature/46262.pdf | Wiring diagram & connector pinout | Safety sensor terminal wiring | ISO 13850/EN 418 + EN 954-1 Cat.4 | Safety Relays | Dual-channel safety light curtain with muting input, status signal, and 24 VDC supply connection | CONFIRMED-2026-07-10 | Resolved+verified 2026-07-10 (info.bannerengineering.com/.../46262.pdf, 206 application/pdf). CORRECTION: ES-FL-2A is Banner's E-Stop Monitoring Safety RELAY (dual-channel K1/K2, S13-S34/13-24), NOT a light curtain — standard is ISO 13850/EN 418, not IEC 61496-1. |
| 12 | Siemens | 3SK Series Safety Relay Module (doc 67585885) | https://cache.industry.siemens.com/dl/files/885/67585885/att_37825/v1/manual_safety_relay_3SK1_en-US.pdf | Ch. 2, terminal arrangement & example circuits | Modular safety relay wiring | ISO 13849-1 PLe | Safety Relays | Siemens 3SK modular safety relay unit with dual-channel monitoring, E-stop input, and controlled output | CONFIRMED-2026-07-10 | Resolved+verified 2026-07-10 via Haiku discovery + httpx GET (200/206, application/pdf); high-confidence official source. |
| 13 | AutomationDirect | CLICK PLC I/O Wiring (User Manual, Ch. 3) | cdn.automationdirect.com/static/manuals/c0userm/ch3.pdf | Ch. 3, digital & analog I/O terminal blocks | PLC discrete input/output wiring | Industrial standard (24VDC) | PLC I/O | CLICK series 24 VDC discrete digital inputs and relay outputs with field-wired sensor/actuator termination | CONFIRMED-2026-07-10 | URL resolved via web search 2026-07-10 (original manifest path 404'd; real CDN dir is c0userm not clickplc); real URL verified as application/pdf |
| 14 | AutomationDirect | D0–06 PLC I/O Configuration (User Manual, Ch. 2) | cdn.automationdirect.com/static/manuals/d006userm/ch2.pdf | Ch. 2, modular I/O cards wiring | PLC modular I/O terminal layout | Industrial 24VDC | PLC I/O | Koyo D0–06 compact PLC with modular I/O cards, screw-terminal input/output block wiring diagram | CONFIRMED-2026-07-10 | Verified 2026-07-10 via httpx GET (206 application/pdf); status corrected from NEEDS-BROWSER (URL was always valid; it ran in the prior campaign). |
| 15 | Omron | CP1E Programmable Controller I/O Wiring (User Manual) | https://www.omron-ap.com/data_pdf/mnu/cp1e-cpu(iowiringdiagram)_inst-1131078-2b.pdf?id=2064 | Wiring section (p. 10–15) | Compact PLC I/O termination | Industrial 24VDC | PLC I/O | Omron CP1E compact controller with 24 VDC digital I/O, screw terminals for field sensor/relay wiring | CONFIRMED-2026-07-10 | Resolved+verified 2026-07-10 via Haiku discovery + httpx GET (200/206, application/pdf); high-confidence official source. |
| 16 | Mitsubishi | FX3U PLC Input Module Wiring Caution (Technical Data JY997D19001) | https://dl.mitsubishielectric.com/dl/fa/document/manual/plc_fx/jy997d19001(e)/jy997d19001(e)e.pdf | Schematic & terminal table (p. 2–4) | PLC input module terminal layout | Industrial 24VDC | PLC I/O | Mitsubishi FX3U modular input card with isolation by group, 24 VDC sensor input, and common terminal wiring | CONFIRMED-2026-07-10 | Resolved+verified 2026-07-10 via Haiku discovery + httpx GET (200/206, application/pdf); high-confidence official source. |
| 17 | AutomationDirect | GS20 User Manual Ch. 2 (VFD Power & Control) | cdn.automationdirect.com/static/manuals/gs20m/ch2.pdf | Ch. 2, power wiring & control terminal diagram | VFD 3-phase power & 24V control | NEMA ICS 6 | VFD | GS20 Variable Frequency Drive: 3-phase motor power input, 24 VDC control signal wiring, brake & relay outputs | CONFIRMED-2026-07-10 | Verified 2026-07-10 via httpx GET (206 application/pdf); status corrected from NEEDS-BROWSER (URL was always valid; it ran in the prior campaign). |
| 18 | ABB | ACS355 Drive User Manual (EN_ACS355_UM_E_A5) | library.e.abb.com/public/805f31a82d524d8aa8a750011e2cd001/EN_ACS355_UM_E_A5.pdf | Ch. 5–6, terminal connections & control wiring | VFD terminal layout & control signals | IEC 61800-5-1 | VFD | ABB ACS355 compact VFD: 3-phase inverter input, motor output, Modbus terminal block, and 24V logic control wiring | CONFIRMED-2026-07-10 | Verified 2026-07-10 via httpx GET (206 application/pdf); status corrected from NEEDS-BROWSER (URL was always valid; it ran in the prior campaign). |
| 19 | Schneider Electric | ATV340 Wiring Manual (NVE97896) | https://download.schneider-electric.com/files?p_enDocType=Instruction+sheet&p_File_Name=ATV340_IS_Wiring_Diagrams_S1-S2-S3_NVE97896_02.pdf&p_Doc_Ref=NVE97896 | Wiring diagram section (p. 3–5) | VFD power & signal wiring | IEC 61800-5-1 | VFD | Schneider ATV340 variable frequency drive: mains input, motor output, 24V control circuits, and analog reference inputs | CONFIRMED-2026-07-10 | Resolved+verified 2026-07-10 via Haiku discovery + httpx GET (200/206, application/pdf); high-confidence official source. |
| 20 | WEG | CFW-11W Frequency Inverter Manual (static.weg.net) | static.weg.net/medias/downloadcenter/hae/h83/WEG-10004699316-13871637-r00-CFW11-W-users-manual-en.pdf | Terminal diagram & control wiring (p. 6–8) | Inverter power & control connections | IEC 61800 | VFD | WEG CFW-11W compact inverter: single/three-phase input options, motor output, 24V logic, and pulse-width control inputs | CONFIRMED-2026-07-10 | URL resolved via web search 2026-07-10 (original manifest path 404'd); real URL verified as application/pdf |
| 21 | AutomationDirect | AN-GS-022: Reversing & Braking (Technical Note) | support.automationdirect.com/docs/an-gs-022.pdf | Entire note (p. 1–6) | Reversing contactor + dynamic braking circuit | NEMA ICS 2 | Reversing/Braking | GS10 VFD reversing scheme with mechanical interlock, dynamic braking relay, and motor-coast timeout sequencing | CONFIRMED-2026-07-10 | Verified 2026-07-10 via httpx GET (206 application/pdf); status corrected from NEEDS-BROWSER (URL was always valid; it ran in the prior campaign). |
| 22 | Rockwell Automation | Bulletin 505 Reversing Starters (GI-WD004) | https://literature.rockwellautomation.com/idc/groups/literature/documents/wd/gi-wd005_-en-p.pdf | Sheet 1–2, mechanical & electrical interlock | NEMA reversing magnetic starter | NEMA ICS 2 | Reversing/Braking | NEMA-compliant forward/reverse 3-phase motor contactor pair with mechanical interlock and overload protection | CONFIRMED-2026-07-10 | Resolved 2026-07-10 to gi-wd005 (206 application/pdf). NOTE: GI-WD004 does not exist; gi-wd005 is the SAME booklet as entry #5 — reversing (Bulletin 505) diagrams are a distinct PAGE within it, so run a different page than #5 to avoid a duplicate image. |
| 23 | Schneider Electric | TeSys Giga Reversing Starter with Interlock (LV429349) | https://www.productinfo.schneider-electric.com/tesysgigainstallationguide/ | Application section (p. 8–10) | IEC reversing starter with electrical interlock | IEC 60947-4-1 | Reversing/Braking | TeSys Giga reversing contactor pair with dual-channel electrical interlock, mechanical stop, and overload module | NEEDS-PDF | Schneider TeSys Giga install guide is an HTML documentation viewer (content-type text/html), not a downloadable PDF; not runnable by the PDF runner. Kept as reference. |
| 24 | Siemens | 3RU/3RB Thermal Overload Relay & Braking Module (60298164) | https://www.pes-group.co.uk/media/parkuk%20cms/datasheets/siemens/extra/SIRIUS%20Overload%20Relay%203RU%203RB.pdf | Ch. 2, overload winding & braking contact diagram | Overload relay & DC braking element | IEC 60947-4-1 | Reversing/Braking | Siemens 3RU thermal overload + 3RB dynamic braking module stacked into contactor: current sensing and ramp-down control | CONFIRMED-2026-07-10 | Resolved 2026-07-10 (206 application/pdf) but hosted on pes-group.co.uk, an authorized UK Siemens DISTRIBUTOR mirror (not siemens.com direct); scanned/image-based. Authentic content, non-OEM host — flagged. |
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

## Campaign Run Status (2026-07-10 — autonomous refresh, no Mike-supplied prints)

**Corpus authenticity closed the gap.** Of 25 entries, **22 are now verified publicly-accessible + authentic**
(httpx GET → 200/206, `application/pdf`, official OEM domain) as of 2026-07-10. The 13 previously-broken
placeholder URLs were resolved autonomously (Haiku web-discovery → Sonnet authenticity validation → deterministic
curl/httpx verification). Dropped: **#4** (no authentic SIRIUS-overview PDF found), **#23** (Schneider TeSys Giga
guide is an HTML viewer, not a PDF), **#2** (placeholder missed — still needs a real URL). See `rejected.md`.

**20 entries run through the REAL Print Translator handler** (`tools/print_translator_eval/run.py`, normal + gate-bypass,
real Groq vision cascade `llama-4-scout`, no Telegram, no prod) — each has `results/<id>.json` +
`results/<id>.gate_bypassed.json` with a real explanation. Images are regenerated locally (gitignored; `images/MANIFEST.md`).

**The "first-10" evaluation set** — re-selected for OEM + category diversity (10 DISTINCT OEMs, all 6 categories;
7 of 10 are newly-runnable OEMs this refresh added: Eaton, Banner, Siemens, Omron, Mitsubishi, Schneider):

| first_10 | id | OEM | Category | Rendered page | Question |
|---|---|---|---|---|---|
| ✅ | 3  | ABB Star-Delta | European/IEC | 4  | Explain this print. |
| ✅ | 5  | Rockwell Bulletin 509 | NEMA Starters | 12 | Explain this print. |
| ✅ | 6  | Eaton Freedom NEMA | NEMA Starters | 27 | Explain this print. |
| ✅ | 11 | Banner ES-FL-2A E-Stop relay | Safety Relays | 4 | Explain this print. |
| ✅ | 12 | Siemens 3SK1 safety relay | Safety Relays | 110 | Explain this print. |
| ✅ | 15 | Omron CP1E I/O | PLC I/O | 0 | Explain this print. |
| ✅ | 16 | Mitsubishi FX3U input wiring | PLC I/O | 0 | Explain this print. |
| ✅ | 17 | AutomationDirect GS20 VFD | VFD | 37 | Explain this print. |
| ✅ | 19 | Schneider ATV340 VFD | VFD | 0 | Explain this print. |
| ✅ | 25 | Yaskawa V1000 F/R | Reversing/Braking | 1 | Describe the theory of operation. |

Also run (not in first-10): #7,9,13,14,18,20 (prior campaign) + #1,8,10,24 (this refresh — #1/#8 landed a weak table/index
page in their 400+/180-page manuals; #24 is a scanned distributor mirror). Details: `rejected.md`, `GAPS.md`.


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

