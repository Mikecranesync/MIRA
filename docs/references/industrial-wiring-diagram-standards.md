# Industrial Control Wiring-Diagram Standards — Resource Pack for FactoryLM / MIRA

> **Purpose.** Teach FactoryLM/MIRA how to *read* real, standards-compliant industrial
> electrical control prints — not generic "drawings of wires," but machine control documentation
> drawn to recognized North-American (NFPA/UL/NEMA/JIC) and European (IEC/DIN/EN/EPLAN) standards,
> plus the instrumentation layer (ISA-5.1) — and how to extract **evidence-backed** relationships
> (device ↔ terminal ↔ wire ↔ cable ↔ PLC I/O ↔ physical component) into a unified maintenance
> context model. The goal is grounded reading, not pretty drawing.
>
> **Companion code.** MIRA already has a diagram *generator* (`mira-bots/shared/wiring_diagram/` —
> LLM → `DiagramSpec` → renderer). This pack is the inverse discipline: the *reader/extractor*.
> The extraction model in §4 is designed to feed MIRA's existing shapes — `kg_entities` /
> `kg_relationships` (proposed→verified), evidence citations, and confidence bands.
>
> **Status:** reference doc. Editions/titles verified against issuing-body/ANSI/IEC/ISO listings as
> of **2026-07-03**. Access status and price caveats are in the [Appendix](#appendix--access-status--verification-caveats).

---

## 0. Orientation — the "gold standard" and the two regimes

The reference example that anchors the **North-American style** in this pack is the classic
**Allen-Bradley / Rockwell "Wiring Diagrams" booklet** (historical Pub. **GI-2.0**, June 1990; the
current successor is **GI-WD005-EN-P, "Typical Wiring Diagrams"**). Its symbols, device
designations, and terminal markings are taken from **NEMA Standard Publication ICS-1-1978** — the
lineage now carried forward by **NEMA ICS 19** and **NFPA 79**. It shows across-the-line and
reversing motor starters (Bulletins 509/505/520): power lines `L1/L2/L3`, thermal overloads `O.L.`,
motor terminals `T1/T2/T3`, contactor coils, N.O./N.C. **main** and **auxiliary** contacts,
START-STOP push-button stations, two-wire vs three-wire control, jogging/plugging, and jumper
letters (`A/W/X/Y`) that reconfigure a circuit. That booklet *is* the NEMA/JIC reading target.

Two regimes, plus one cross-cutting layer, cover essentially every machine print MIRA will meet:

| Regime | Where you see it | Governing standards |
|---|---|---|
| **North-American / NEMA / JIC** | US/Canada-built machinery, motor-control centers, shop-floor ladder prints | NFPA 79, UL 508A, NEMA ICS 19 / ICS 1, JIC (historical), IEEE/ANSI 315 |
| **IEC / DIN / EN / EPLAN** | European-built machinery, EPLAN project sets, global OEMs | IEC 60204-1, IEC 60617, IEC 61082, ISO/IEC 81346, IEC 61355, IEC 60445, IEC 60757 |
| **Instrumentation (cross-cutting)** | Sensors/instruments & their loops on either regime's prints | ISA-5.1, ISA-5.4, IEC 62424 |

A single install often **mixes** them (a European machine on a US floor). MIRA must *detect the
dominant convention per sheet* and flag mixed sheets for review — see §4.6.

---

## 1. Resource bibliography

Access legend: **🟢 free/free-read** · **🟡 free-preview only (scope/TOC), full text paid** · **🔴 paywalled**.
Prices are indicative — confirm on the official page (many NEMA/NFPA docs have a free registered read/download).

### 1A. U.S. / NFPA / UL / NEMA / JIC

| # | Standard | Ed. (verified) | What it governs | Official source | Access |
|---|---|---|---|---|---|
| 1 | **NFPA 79 — Electrical Standard for Industrial Machinery** | **2024** | The dominant NA standard for how a machine's electrical system is built **and documented**: required documentation package (schematic/ladder, wiring, connection, installation diagrams), conductor **color coding**, wire/terminal identification & marking, emergency-stop / safety-related control circuits, grounding, disconnect labeling. Applies from the machine supply terminals forward (≤1000 V AC/1500 V DC). Absorbed the old JIC electrical content. | [nfpa.org/79](https://www.nfpa.org/product/nfpa-79-standard/p0079code) · [free read](https://link.nfpa.org/all-publications/79/2024) | 🟢 free read-online; PDF ~$150 |
| 2 | **UL 508A — Industrial Control Panels** | **3rd ed. 2018** (rev. 2025) | Construction standard for industrial control **panels** — component selection, spacings, wiring, overcurrent protection, marking. Home of the **SCCR** (Short-Circuit Current Rating) methodology (Supplement SB) that **NEC Art. 409** + NFPA 79 require to be marked on the nameplate. | [shopulstandards](https://www.shopulstandards.com/ProductDetail.aspx?productId=UL508A) · [SCCR guide](https://www.ul.com/resources/determining-short-circuit-current-rating-sccr-machinery) | 🔴 paid; 🟢 free UL summary/SCCR method |
| 3 | **NEMA ICS 19 — Diagrams, Device Designations, and Symbols for Industrial Controls and Systems** | **2002 (R2022)** | The "how to draw & label the print" standard: diagram types (elementary/ladder, connection, interconnection), diagram identification, **device designation letters** (CR, M, OL…), **coil/contact designations and cross-referencing**, graphic symbols, terminal markings. | [nema.org](https://www.nema.org/standards/view/diagrams-device-designations-and-symbols) | 🔴/🟡 (NEMA often free registered PDF) |
| 4 | **NEMA ICS 1 — Industrial Control & Systems: General Requirements** | **2022** (hist. **1978**) | Umbrella general requirements for industrial control equipment/terminal blocks. The **1978** edition is the symbol/designation basis cited by the Allen-Bradley wiring booklet. | [nema.org](https://www.nema.org/Standards/view/Industrial-Control-and-Systems-General-Requirements) | 🔴 ~$245 (or free NEMA PDF) |
| 5 | **JIC (Joint Industrial Council) Electrical Standards** — EMP-1-67, EGP-1-67, EL-1-71 | **withdrawn** | The *ancestor* NA ladder convention (two rails, one output per rung, rungs numbered down the left margin, device-letter designations, coil/contact cross-ref). **Superseded**: JIC electrical content folded into **NFPA 79 (1985)**. Cite NFPA 79 + NEMA ICS 19 as current authority. | [JIC symbol legend (Womack, reference)](https://www.womackmachine.com/engineering-toolbox/design-data-sheets/jic-standard-symbols-for-electrical-ladder-diagrams.aspx) | 🟢 reference-only |
| 6 | **IEEE Std 315-1975 / ANSI Y32.2 — Graphic Symbols for Electrical & Electronics Diagrams** (+ **315A-1986**) | **1975 (R1993)**; *Inactive-Reserved 2019* | The master US dictionary of **component-level graphic symbols** and **reference-designation class letters** (contacts, coils, switches, semiconductors, machines). The symbol authority NEMA ICS 19 leans on. Still de-facto despite inactive status. | [standards.ieee.org/315](https://standards.ieee.org/ieee/315/515/) | 🔴 paid; 🟢 free record/scope |
| 7 | **NFPA 70 (NEC)** — *relationship, not a machine-print standard* | **2023** | Governs **premises wiring up to and including the machine disconnect**; NFPA 79 governs everything past it. Bridge = **NEC Art. 409** + UL 508A (SCCR marking). | [nfpa.org](https://www.nfpa.org/) | 🟢 free read-online |

### 1B. IEC / DIN / EN / German / EPLAN

Pattern: IEC base doc → CENELEC **EN IEC 6xxxx** → German **DIN EN IEC 6xxxx** (VDE class, e.g. VDE 0113 for 60204-1). All paid; most have free IEC/VDE scope previews.

| # | Standard | Ed. (verified) | What it governs | Official source | Access |
|---|---|---|---|---|---|
| 8 | **IEC 61082-1 — Preparation of documents used in electrotechnology (Rules)** | **3.0 : 2014** (EN 61082-1:2015) | The master "how to lay out the drawing" rulebook: rules for circuit/function/connection diagrams, and **where reference designations, connections and cross-references are placed** on a sheet. Layout partner to 60617 (symbols) & 81346 (labels). | [IEC webstore 4469](https://webstore.iec.ch/en/publication/4469) | 🟡 |
| 9 | **IEC 60617 — Graphical symbols for diagrams** ("IEC 60617 DB") | **live database** (2026-03 release; ~1500+ symbols) | The canonical **IEC symbol library** — the actual glyphs for contacts, coils, switches, motors, protective devices, connectors, measuring instruments. Every EPLAN IEC symbol traces here. Now a subscription database (GIF/DWG/EPS export). | [IEC webstore 2723](https://webstore.iec.ch/en/publication/2723) | 🔴 sub CHF 710 / CHF 280 renew |
| 10 | **IEC 60204-1 — Safety of machinery — Electrical equipment of machines — Part 1** | **6.0 : 2016** (EN 60204-1; DIN EN 60204-1 / VDE 0113-1) | The safety-of-machinery electrical rulebook cabinets are built to: supply disconnection, shock protection, **protective bonding/PE**, emergency stop, control circuits, conductor selection & **identification**, terminals, and the required **technical documentation**. Cross-refs 60445 for conductor/terminal ID. | [IEC webstore 26037](https://webstore.iec.ch/en/publication/26037) | 🔴 CHF 430; 🟡 scope |
| 11 | **ISO/IEC 81346-1 — Structuring principles & reference designations (Basic rules)** | **2.0 : 2022** | Defines the **three aspects** & prefixes: **`=` function** (what it does), **`+` location** (where mounted), **`-` product** (the device). Full tag concatenates, e.g. `=A1+K3-Q1`. The backbone of EPLAN project structure. | [iso.org/82229](https://www.iso.org/standard/82229.html) | 🔴; 🟡 scope |
| 12 | **IEC 81346-2 — Classification of objects and codes for classes** | **2.0 : 2019** (rev. in progress) | The **letter codes for object classes** applied after `-` (Q, K, F, M, S, B, T, X, W, G, P…). See the [class-letter table](#iec-81346-2-device-class-letter-codes). 2009 text browsable free on ISO OBP. | [iso.org/75265](https://www.iso.org/standard/75265.html) · [2009 free OBP](https://www.iso.org/obp/ui#iso:std:iec:81346:-2:ed-1:en) | 🔴; 🟢 2009 text free |
| 13 | **IEC 61355-1 — Classification and designation of documents (DCC)** | **2.0 : 2008** (EN 61355-1) | Classifies & names the **documents themselves** — each drawing/list/diagram gets a standardized *document-kind* code, so any sheet in a 100k-document set is identifiable by type. (Often mis-cited "81355" — correct is **61355**.) | [ANSI listing](https://webstore.ansi.org/standards/iec/iec61355ed2008) | 🔴; 🟡 scope |
| 14 | **IEC 60445 — Identification of equipment terminals, conductor terminations and conductors** | **7.0 : 2021 → 7.1 : 2026 (AMD1)** (DIN EN IEC 60445 / VDE 0197) | Rules for **marking terminals & conductors**: line `L1/L2/L3`, neutral `N`, protective earth `PE` (green-yellow), `PEN`, motor `U/V/W`. Why a motor box reads U/V/W and PE is green-yellow. Merged the old 60446. | [IEC webstore 111816](https://webstore.iec.ch/en/publication/111816) | 🔴; 🟡 scope |
| 15 | **IEC 60757 — Code for designation of colours** | **2.0 : 2021** (EN IEC 60757) | The **two-letter colour codes** for conductor cores: BK, BN, RD, OG, YE, GN, BU, VT, GY, WH, PK, TQ, and **GNYE** (green-yellow, reserved for PE). Pairs with 60445 (which assigns *meanings*). | [ANSI listing](https://webstore.ansi.org/standards/iec/iec60757ed2021) | 🔴; 🟡 scope |
| 16 | **EPLAN Electric P8 documentation conventions** | software | Implements **81346** (=/+/- project structure), **61355** (page/doc types), **61082** (layout), **60617** (symbols): device tags (DT), the **contact mirror** under coils, page/path cross-references, terminal & cable management, PLC card overviews. | [EPLAN 81346 structuring](https://www.eplan.help/help/platform/2.8/en-US/help/Content/htm/projectstructure_k_referenzkennzeichnung.htm) | 🟢 free docs |

### 1C. Instrumentation / P&ID / loop diagrams

| # | Standard | Ed. (verified) | What it governs | Official source | Access |
|---|---|---|---|---|---|
| 17 | **ANSI/ISA-5.1 — Instrumentation & Control Symbols and Identification** | **2024** (title gained "and Control"; annexes → TR5.1.02 / TR5.1.03) | *The* instrument tag/bubble language: functional identifier (measured-variable first letter + function letters), loop numbers, and the **bubble outline + line-through-bubble** that encodes *where the function lives* (field / panel / shared DCS-PLC) and operator accessibility. See [tag anatomy](#isa-51-tag-anatomy). | [ISA-5.1 committee](https://www.isa.org/standards-and-publications/isa-standards/isa-standards-committees/isa5-1) | 🔴; 🟡 scope |
| 18 | **ANSI/ISA-5.4 — Instrument Loop Diagrams** | **1991** (current) | The per-loop **installation drawing**: every device in one loop (sensor→transmitter→I/O→controller→final element) and exactly how they're wired/tubed — terminal blocks, wire numbers, cable IDs, power sources, ranges. What a tech uses to land wires / troubleshoot a loop. | [ISA-5.4](https://www.isa.org/products/isa-5-4-1991-instrument-loop-diagrams) · [free preview](https://webstore.ansi.org/preview-pages/isa/preview_s_54.pdf) | 🔴; 🟢 free preview |
| 19 | **IEC 62424 — Representation of process control engineering in P&IDs (CAEX)** | **2.0 : 2016** (EN 62424) | IEC counterpart-plus-extension to ISA-5.1 aimed at **tool-to-tool data exchange**: how a PCE "request" is drawn on a P&ID *and* serialized in **CAEX** (XML basis behind AutomationML) so P&ID and control-engineering tools round-trip tags. | [IEC webstore 25442](https://webstore.iec.ch/en/publication/25442) | 🔴; 🟡 scope |
| 20 | **ISA-5.2 (binary logic, 1976 R1992)** · **ISA-5.3 (DCS/shared-display, 1983, legacy)** | as noted | Interlock/sequencing **binary-logic** symbology (5.2); DCS "shared display" symbols (5.3, largely absorbed into 5.1). Met mainly on older/interlock prints. | [ISA-5.2](https://www.isa.org/products/isa-5-2-1976-r1992-binary-logic-diagrams-for-proce) | 🔴; 🟢 previews |

> **Not a print standard:** **ANSI/ISA-101.01-2015 (HMI)** governs operator-screen design lifecycle,
> not drawings — listed only so it isn't confused with the ISA-5.x symbol standards. (MIRA's own HMI
> work follows the `industrial-hmi-scada-design` skill.)

### 1D. Practical vendor guides & examples (verified free downloads)

**NEMA / motor-control**
- **Rockwell/Allen-Bradley — "Typical Wiring Diagrams," GI-WD005-EN-P** — the successor to the gold-standard booklet; "Key to Symbols" + dozens of worked full-voltage/reversing/multi-speed/jogging/plugging circuits. → [PDF](https://literature.rockwellautomation.com/idc/groups/literature/documents/wd/gi-wd005_-en-p.pdf) 🟢
- **Eaton — Wiring Manual (PU08703001Z)** — contactor/relay circuits, DOL/star-delta/reversing starting, overload protection, worked schematics. → [PDF](https://www.eaton.com/content/dam/eaton/markets/machinebuilding/eaton-wiring-manual-pu08703001z-en-en-us.pdf) 🟢
- **Eaton — Vol.5 NEMA Manual Starters (CA08100006E)** — elementary/wiring diagrams for NEMA manual & magnetic starters (1-φ, 3-φ, DC). → [PDF](https://www.eaton.com/content/dam/eaton/products/industrialcontrols-drives-automation-sensors/manual-motor-starters-/nema_manual_starters.pdf) 🟢
- **Rockwell — NEMA Contactors & Starters Selection Guide (500-SG008-EN-P)** — Bulletin 500/509 ratings & selection. → [PDF](https://literature.rockwellautomation.com/idc/groups/literature/documents/sg/500-sg008_-en-p.pdf) 🟢
- **AutomationDirect — "How to Wire a Motor Starter" (AN-MC-004)** — start/stop seal-in + reversing with interlocked contactors. → [page](https://library.automationdirect.com/how-to-wire-a-motor-starter/) 🟢

**IEC vs NEMA & reference designation (IEC 81346)**
- **Eaton — "Comparison of NEMA and IEC Electrical Schematic Diagrams" (MZ081001EN)** — the NEMA↔IEC "Rosetta Stone" of symbols & designations. → [PDF](https://www.eaton.com/content/dam/eaton/products/electrical-circuit-protection/medium-voltage-vacuum-circuit-breakers/comparison-nema-iec-schematic-diagrams-mz081001en.pdf) · [fallback article](https://knowledgehub.eaton.com/s/article/NEMA-and-IEC-standards-Overview) 🟢
- **Siemens — Industrial Control Panels & Electrical Equipment (NA Reference Manual)** — IEC symbols/abbreviations alongside UL 508A/NFPA 79 practice. → [PDF](https://assets.new.siemens.com/siemens/assets/api/uuid:292ff8d1305f1852a53c9c1f0714ddd4de9fdabf/us-df-industrial-control-panels-na-en.pdf) 🟢
- **Siemens — Technical Guide: Compliant with IEC Standards (ICP)** — IEC ratings, utilization categories (AC-1/AC-3), symbol framework. → [PDF](https://assets.new.siemens.com/siemens/assets/api/uuid:3c7f5528-3e77-4e3b-ad34-04574843f984/iecstandards-technicalguide-icp-us.pdf) 🟢
- **EPLAN — "Structuring of Projects per EN 81346"** — the =/+/- aspects in practice. → [page](https://www.eplan.help/en-us/Infoportal/Content/Plattform/2022/Content/htm/projectstructure_k_referenzkennzeichnung.htm) 🟢 · **"Identifier Sets"** maps letter codes across IEC 61346 / 81346 / 81346-2:2019 / NFPA / GB/T 5094. → [page](https://www.eplan.help/en-us/Infoportal/Content/Plattform/2025/Content/htm/fctdeflibdataexchangegui_d_kennbuchstaben.htm) 🟢
- **ABB — System 800xA System Planning (3BSE041389-600)** — object/reference designation per IEC 61346/81346 on a real platform. → [PDF](https://library.e.abb.com/public/fc7813f0a7c647599e33e9e6c7b930b2/3BSE041389-600_B_en_System_800xA_6.0_System_Planning.pdf) 🟢

**Terminals & wire marking**
- **Phoenix Contact — MARKING System (2621703)** — terminal/conductor/device markers + CLIP PROJECT workflow (IEC 60445/60446, IEC 60947-7-1). → [PDF](https://www.farnell.com/datasheets/2621703.pdf) 🟢
- **WAGO — Marking (technical documentation)** — WMB terminal-strip strips (TOPJOB S), conductor markers, Smart Printer/Script. → [PDF](https://www.electromate.com/media/assets/catalog-library/pdfs/wago/Wago-Marking.pdf) 🟢
- **Weidmüller — PrintJet CONNECT / MultiCard** — terminal/device/conductor marking + M-Print PRO (eCAD import). → [PDF](https://assets.dam.weidmueller.com/assets/api/bd72eb61-285e-4174-85c6-f54989374382/Original/MB_PRINTJET_CONNECT_EN_WEB.pdf) 🟢 · **SAK modular TB marking** → [PDF](https://www.lcautomation.com/wb_documents/weidmuller/weidmuller%20sak%20modular%20terminal%20block%20marking%20systems.pdf) 🟢

**Safety circuits (E-stop, safety relays, EN 60204-1 / ISO 13849)**
- **Rockwell — Machinery Safebook 5 (SAFEBK-RM002-EN-P)** — the canonical free machinery-safety handbook: risk assessment, category/PL, worked safety-relay + E-stop examples (ISO 13849-1, IEC 62061, EN/IEC 60204-1, ISO 13850). → [PDF](https://literature.rockwellautomation.com/idc/groups/literature/documents/rm/safebk-rm002_-en-p.pdf) 🟢
- **Siemens — SIRIUS Safety Integrated Application Manual** — worked wiring for 3SK/3TK safety relays (E-stop, door, light curtain) to SIL/PL targets. → [PDF](https://cache.industry.siemens.com/dl/files/718/81366718/att_20400/v1/application_manual_sirius_safety_integrated_en-US.pdf) 🟢
- **Pilz — Safety Compendium** — vendor-neutral functional-safety handbook. → [PDF](https://downloads.pilz.nl/downloads/Docu-Machineveiligheid/safety_compendium_en_2014_01.pdf) 🟢
- **Phoenix Contact — PSR Safety Relay Application Guide (2888712)** — 1- vs 2-channel, feedback loops, up to SIL 3/Cat 4/PL e. → [PDF](https://blog.phoenixcontact.com/marketing-gb/wp-content/uploads/sites/3/2021/09/102597_en_02_safety-application-guide-pdf.pdf) 🟢

**General "how to read a print"**
- **AutomationDirect — "Understanding Ladder Logic"** — rail/rung structure, NO/NC contacts, coils, PB/CR/M/L symbols. → [page](https://library.automationdirect.com/understanding-ladder-logic/) 🟢
- **AutomationDirect — "Condensed Guide to Automation Control Systems, Part 3"** — how a schematic is drawn as a ladder; schematic vs panel-layout vs wiring diagram. → [page](https://library.automationdirect.com/a-condensed-guide-to-automation-control-system-part-3/) 🟢

> Reachable-but-not-auto-verified (browser-only, real): Siemens "Standardization Guideline for TIA
> Portal" (SIOS 109756737), Festo Didactic "Reference identification per ISO 1219 / EN 81346",
> Schneider "Safe Machinery Handbook" (SE7847). Confirm interactively before citing.

---

## 2. What each standard controls (plain English) — by artifact on the print

Read a print as a set of *artifacts*. Here is which standard is the authority for each, and what the
artifact means, in both regimes.

### Concept → authority map

| Artifact on the print | North-American authority | IEC / European authority |
|---|---|---|
| **Graphic symbols** (the glyphs) | IEEE/ANSI 315 → NEMA ICS 19 | IEC 60617 (DB) |
| **Device tags / designations** | NEMA ICS 19 (letters: CR, M, OL…) ; JIC legacy | ISO/IEC 81346-1 (=/+/-) + 81346-2 (class letters) |
| **Wire numbers** | NFPA 79 §§ ident. + NEMA ICS 19 (same node = same number) | IEC 61082-1 layout + project convention (EPLAN) |
| **Terminal identification** | NEMA ICS 19 / NFPA 79 (L/T, control #) | IEC 60445 (A1/A2, 13/14, U/V/W, PE) + IEC 60947 contact #s |
| **Conductor colours** | NFPA 79 (red=AC control, blue=DC, orange=foreign) | IEC 60445 (meanings) + IEC 60757 (colour letter codes) |
| **Page / rung / line references** | JIC/NEMA ladder line numbers (often page-prefixed) | IEC 61082-1 + 61355 (page/path, doc-kind codes) |
| **Coil ↔ contact cross-references** | NEMA ICS 19 (line-number list; underline = N.C.) | IEC 61082-1 / EPLAN **contact mirror** (page/path under coil) |
| **Cable schedules** | NFPA 79 documentation package | IEC 61082-1 + cable (`W`) device lists + 60757 core colours |
| **Safety circuits** | NFPA 79 (E-stop, safety-related control) | EN/IEC 60204-1 + ISO 13849-1 / IEC 62061 + ISO 13850 |
| **PLC I/O references** | NEMA ICS 19 elementary + address labels | IEC 61082-1 + EPLAN PLC card overview |
| **Drawing types** (schematic vs connection vs layout) | NFPA 79 / NEMA ICS 19 | IEC 61082-1 (+ 61355 doc-kind codes) |
| **Instrument tags / bubbles** | ISA-5.1 | ISA-5.1 / IEC 62424 |
| **Loop diagrams** | ISA-5.4 | ISA-5.4 / IEC 62424 |
| **Panel construction + SCCR** | UL 508A (marked per NEC 409 / NFPA 79) | (IEC world: IEC 61439 assemblies) |

### The artifacts, explained

- **Symbols.** The glyph vocabulary. NA prints use IEEE 315 symbols carried into NEMA ICS 19 (a NO
  contact `—| |—`, NC `—|/|—`, coil `—( )—`, thermal overload heater, 3-φ squirrel-cage motor).
  IEC prints use the IEC 60617 library (visually different — e.g. contacts and contactor coils are
  drawn to IEC forms). MIRA matches a detected symbol to a library key and records *which* key.

- **Device tags.** *Who is this device?* NA = **function letter + number** (`CR1` control relay,
  `M`/`1M` starter, `OL` overload, `PB` pushbutton, `CPT` control transformer, `LS` limit switch,
  `PL` pilot light, `FU` fuse, `SS` selector). IEC = **81346 reference designation** with aspect
  prefixes `=function +location -product`, the product letter from 81346-2 (`-Q1` contactor,
  `-K1` relay/PLC, `-F1` protection, `-M1` motor, `-S1` manual control, `-B1` sensor, `-T1`
  transformer, `-X1` terminals, `-W1` cable). The same physical starter is `M1` (NEMA) or `-Q1`/`-K1`
  (IEC).

- **Wire numbers.** *What node is this?* The core NEMA rule: **every conductor landing on the same
  electrical node carries the same wire number**; the number changes only across a component. Common
  hierarchical schemes (100=power, 200=control, 300=24 VDC, 400=ground) are convention, not mandate —
  NFPA 79 requires only *consistent, documented* identification. IEC/EPLAN numbers connections by
  potential or source-target and tags cables as `W` devices with per-core colour codes.

- **Terminal blocks & terminals.** *Where does the wire land?* NA motor: `L1/L2/L3`→`T1/T2/T3`,
  control terminals numbered to the wire. IEC (60445 + 60947): coil `A1/A2`; aux NO `13/14`, NC
  `21/22`; main poles `1/2 3/4 5/6`; overload fault contacts `95/96` (NC) `97/98` (NO); motor
  `U/V/W`; earth `PE`. Terminal strips are `X`-tagged (`-X1`) with terminal-strip overviews.

- **Page / rung / line references.** *Where on the sheet?* NA ladder rungs are numbered down the left
  margin, often page-prefixed (`2003` = page 2, line 3) so references resolve across sheets. IEC uses
  page + column **path** references (`/3.2`) and 61355 document-kind codes to organize the set.

- **Coil ↔ contact cross-references.** *Where are this coil's contacts?* This is the single most
  important reading skill. NA: beside a coil, the right margin lists the **line numbers** of every
  contact that coil operates — an **underlined** line number = a **normally-closed** contact there.
  IEC/EPLAN prints a **contact mirror** (Kontaktspiegel) directly under the coil: a compact table of
  every contact with the **page/column path** where each is drawn (and each remote contact
  back-references the coil). Either way you jump coil→contacts instantly without tracing wire.

- **Cable schedules / connection diagrams.** *What physically runs between enclosures?* A **cable
  schedule** enumerates multi-core cables (cable ID, cores, from/to locations, core colours). This
  lives on connection diagrams / cable lists — **not** on schematics (schematics show logic, not
  cabling). MIRA must not invent cable data from a schematic; mark it `unknown` and read it from the
  connection diagram.

- **Conductor colours.** NFPA 79: black=power, red=AC control, blue=DC control, **orange = foreign
  voltage energized with the disconnect open** (2024 added orange/blue-stripe), green or green-yellow
  = equipment ground. IEC: 60445 assigns meanings (green-yellow=PE, blue=neutral) and 60757 gives the
  two-letter abbreviations (GNYE, BU, BK…) used in cable schedules.

- **Safety circuits.** The E-stop → safety-relay → contactor-coil chain that removes power
  independently of the PLC. NA: NFPA 79 (emergency stop, safety-related control functions). IEC:
  EN/IEC 60204-1 for the electrical implementation, **ISO 13849-1** (Categories B/1/2/3/4, Performance
  Level a–e) or IEC 62061 (SIL) for the rating, ISO 13850 for the E-stop device, plus **stop
  categories 0** (immediate power removal) and **1** (controlled stop then power removal). MIRA always
  flags safety chains for human review and co-activates the `mira-industrial-safety` STOP behavior.

- **PLC I/O references.** Modern prints show PLC I/O as ladder/schematic elements even though the
  logic is software: a field device wired to a **module terminal** labelled with the **address**
  (`I:1/0`, `%I0.3`, tag name) and wire number; outputs drive coils/solenoids/pilots with their
  address (`O:2/5`, `%Q…`). **Overloads and E-stop contacts stay hardwired** around the PLC for
  safety. EPLAN adds a PLC card overview cross-referencing each channel to its page/path.

- **Drawing types (don't confuse them).**
  - **Schematic / elementary / ladder** — *logic & function*; how the circuit works (rungs, contacts,
    coils). Not physical layout.
  - **Wiring / connection diagram** — *physical connections*; which terminal wires to which, wire
    numbers, cable cores. What you use to land wires.
  - **Panel layout / GA drawing** — *physical arrangement*; where each device sits in the enclosure.
  - **Interconnection diagram** — connections *between* enclosures/units.
  - **Loop diagram (ISA-5.4)** — one instrument loop end-to-end.
  - **One-line** — power distribution overview.
  MIRA records `drawing_type` per sheet because the *same devices* mean different things on each.

---

## 3. Comparison table — NEMA / JIC vs IEC / DIN / EPLAN

| Dimension | American / NEMA / JIC | IEC / DIN / German / EPLAN |
|---|---|---|
| **Symbol library** | IEEE/ANSI 315 → NEMA ICS 19 (contact `—\| \|—`, coil `—( )—`, thermal OL heater) | IEC 60617 DB (different contact/coil forms; ~1500+ standardized glyphs) |
| **What differs visually** | Ladder between two vertical rails; one output per rung; rungs numbered down the **left margin**; contacts left→coil right | Circuit spread across **pages by function**; **column/path** grid; coil with a **contact mirror** beneath; often horizontal current paths |
| **Device naming** | Function letters + number: `CR`, `M`/`1M`, `OL`, `PB`, `CPT`, `LS`, `PL`, `FU`, `SS` | 81346 reference designation `=func +loc -product`; product letter from 81346-2: `-Q` switching, `-K` relay/PLC, `-F` protection, `-M` motor, `-S` manual, `-B` sensor, `-T` transformer, `-X` terminal, `-W` cable |
| **Relay/coil/contact cross-ref** | Line-number list beside the coil; **underline = N.C.** contact at that line | **Contact mirror / image** under the coil listing each contact's **page/column path**; remote contacts back-reference the coil |
| **Terminal numbering** | Motor `L1/L2/L3`→`T1/T2/T3`; control terminals numbered to the wire | 60445/60947: coil `A1/A2`; aux NO `13/14`, NC `21/22`; poles `1/2 3/4 5/6`; OL `95/96`·`97/98`; motor `U/V/W`; `PE` |
| **Wire numbering** | **Same node = same number**; changes only across a device; optional 100/200/300/400 banding | Potential- or source-target-based connection IDs; cable cores by 60757 colour code; per-project scheme in EPLAN |
| **Conductor colours** | NFPA 79: red=AC ctrl, blue=DC ctrl, orange=foreign-energized, black=power, gn/gn-yel=ground | 60445 meanings (PE=green-yellow, N=blue) + 60757 letter codes (GNYE, BU, BK…) |
| **PLC I/O documentation** | Field device → module terminal on the ladder, labelled `I:1/0` / `%I0.3` + wire #; OL/E-stop stay hardwired | PLC card overview + per-channel `%I/%Q` address, symbolic name, terminal, function text; cross-referenced to field page/path |
| **Safety circuits** | NFPA 79 E-stop / safety-related control; hardwired around PLC | EN/IEC 60204-1 + ISO 13849-1 (Cat/PL) or IEC 62061 (SIL); ISO 13850 E-stop; **stop category 0/1** |
| **Panel construction / rating** | UL 508A; **SCCR** marked per NEC 409 / NFPA 79 | IEC 61439 assemblies (rated short-circuit withstand) |
| **Document classification** | NFPA 79 documentation package (by drawing type) | IEC 61355 document-kind codes; 81346 structures objects |
| **Current authority for the style** | NFPA 79 + NEMA ICS 19 (JIC is the withdrawn ancestor) | IEC 60204-1 + 60617 + 61082 + 81346, as implemented by EPLAN |

### IEC 81346-2 device class letter codes

| Letter | Class (purpose) | Machine-control examples |
|---|---|---|
| **B** | picks up / converts information (input) | proximity/photo sensors, encoders, transducers |
| **F** | direct protection (self-acting) | fuses, MCBs, overload relays, SPDs |
| **G** | provides controllable energy flow | power supplies, generators, UPS, batteries |
| **K** | processes signals/information | relays, contactor-relays, timers, **PLCs**, control modules |
| **M** | provides mechanical movement/force | motors |
| **P** | presents perceptible information | indicator lamps, meters, HMI |
| **Q** | controlled switching of energy flow | power contactors, motor starters, main breakers, disconnects |
| **R** | restricting / stabilising | resistors, reactors |
| **S** | detects human action → signal | pushbuttons, selector switches, manual actuators |
| **T** | transforms/converts energy (kind preserved) | transformers, VFD power section, converters |
| **W** | guides/transports place to place | cables, wires, busbars |
| **X** | connects / interfaces | terminals, terminal blocks, plugs, sockets |

(Legacy DIN 40719 / IEC 60617-7 tables on older German prints map similarly with slightly different
wording — EPLAN ships both current and legacy identifier sets.)

### ISA-5.1 tag anatomy

An instrument tag = **function letters + loop number** (e.g. `TIC-101`):

- **First letter = measured/initiating variable:** **A** analysis · **F** flow · **L** level ·
  **P** pressure · **T** temperature · **S** speed · **W** weight/force · **V** vibration ·
  **Z** position · **H** hand · **E** voltage · **I** current.
- **Succeeding letters = function:** **T** transmit · **I** indicate · **R** record · **C** control ·
  **S** switch · **V** valve/final element · **E** primary element · **A** alarm · **Y** relay/compute ·
  with modifiers **H/L/HH/LL** for limits. → `FT-101` flow transmitter; `TIC-205` temperature
  indicating controller; `LSH-330` level switch high; `PAHH-410` pressure alarm high-high.
- **Bubble outline + line through it = where the function lives / accessibility:** plain circle no
  line = discrete field instrument; solid horizontal line = front-of-main-panel (operator-accessible);
  dashed line = behind panel / field-inaccessible; circle-in-square = shared display/control (DCS/PLC);
  hexagon = computer/PLC-internal.
- **A conveyor photo-eye / prox switch** is a discrete position detector → **`ZS-###`** (position
  switch; `ZSH`/`ZSL` for extended/retracted states), drawn as a field bubble with a dashed electrical
  signal line to the PLC input; the wiring detail lives on the ISA-5.4 loop diagram / the ladder.

---

## 4. FactoryLM / MIRA extraction model

> This is the structured target MIRA should extract from every wiring print. It is a
> **read-only, evidence-first** model that plugs into MIRA's existing shapes: proposed-vs-verified
> edges (`kg_entities` / `kg_relationships`), evidence with page/section refs, and confidence
> **bands** (not invented numeric scores). Every extracted fact must trace to a page + grid/rung/line
> or it does not get asserted — it gets flagged for human review. Nothing here writes to a PLC or
> asserts a `verified` edge automatically (that is an admin action).

### 4.1 Three levels: Document → Entity → Relationship

A print is not a flat list of tags. MIRA extracts a **document header**, a set of **entities**
(devices, terminals, wires, cables, PLC points, safety functions), and the **relationships** between
them (a wire connects terminal A to terminal B; a coil commands a contact; a sensor feeds a PLC
input). Relationships are where maintenance intelligence lives ("what feeds this? what does this
drop out?"), so they are modeled explicitly, not left implicit in geometry.

### 4.2 `WiringPrintDocument` (document header — one per sheet)

| Field | Type | Notes |
|---|---|---|
| `document_title` | str | From the title block. |
| `drawing_number` | str | Title-block drawing/pub number (e.g. `GI-2.0`, `CV101-E-002`). |
| `revision` | str | Rev letter/number from title block. |
| `sheet` | str | `"2 of 7"`. |
| `page_number` | int | Physical page in the PDF (extraction anchor). |
| `drawing_type` | enum | `schematic` \| `ladder` \| `connection_diagram` \| `wiring_diagram` \| `panel_layout` \| `terminal_plan` \| `cable_schedule` \| `loop_diagram` \| `one_line` \| `block_diagram` \| `pandid`. |
| `standard_style` | enum | `NEMA_JIC` \| `IEC_EPLAN` \| `ISA_5_1` \| `mixed` \| `unknown` — the detected drawing convention (see §4.6). |
| `standard_evidence` | str | *Why* that style was detected (e.g. "NEMA ICS-1 note in legend; L1/L2/L3 + T1/T2/T3; OL symbol"). |
| `title_block` | obj | `{drawn_by, date, scale, project, customer, approved_by}` — whatever the block yields; unknown fields = `unknown`. |
| `grid_system` | enum | `zone_grid` (A1..H12) \| `line_numbers` (rung/line 1..n) \| `page_column` (IEC path) \| `none` — how positions are referenced on this sheet. |
| `uns_path` | str | UNS subtree this sheet documents, built via `mira-crawler/ingest/uns.py` builders — never hand-formatted. |
| `confidence` | band | `high` \| `medium` \| `low` per the resolver bands. |
| `needs_review` | bool | True if title block is illegible, style is `mixed`/`unknown`, or OCR confidence low. |

### 4.3 `DeviceRecord` (one per device/component)

| Field | Type | Notes |
|---|---|---|
| `device_tag` | str | As printed: `M1`, `K1`, `Q1`, `-K1`, `1M`, `CR`, `OL`, `PB1`, `LS1`, `1PE`, `801` (JIC uses relay/line numbers). Preserve prefix sign for IEC (`-K1`). |
| `device_class` | enum | Normalized class: `motor` \| `contactor` \| `motor_starter` \| `overload_relay` \| `circuit_breaker` \| `fuse` \| `disconnect` \| `power_supply` \| `transformer` \| `control_relay` \| `timer` \| `safety_relay` \| `estop` \| `pushbutton` \| `selector_switch` \| `pilot_light` \| `limit_switch` \| `proximity_sensor` \| `photo_eye` \| `pressure_switch` \| `temperature_sensor` \| `vfd` \| `plc_input_card` \| `plc_output_card` \| `plc_cpu` \| `terminal_block` \| `terminal` \| `connector` \| `cable` \| `instrument` \| `unknown`. |
| `designation_system` | enum | `NEMA` (functional letters CR/M/OL/PB/LS/PL/CPT) \| `IEC_81346` (`=func +loc -product`, letter codes K/Q/F/M/S/B/T/X/W/G/P) \| `ISA` (loop tag) \| `JIC` (numeric/line) \| `unknown`. |
| `iec_aspects` | obj \| null | For IEC prints: `{function: "=A1", location: "+K3", product: "-K1"}` parsed from the aspect prefixes (81346). Null on NEMA prints. |
| `symbol_type` | str | The graphical symbol matched (from the §4.6 symbol library key): `contactor_coil`, `no_main_contact`, `nc_aux_contact`, `overload_thermal`, `motor_3ph`, `estop_mushroom`, `no_held_closed_limit`, etc. |
| `label_text` | str | Human label printed near the device ("Undervoltage Coil", "Photo Eye", "Run"). |
| `ratings` | obj | `{voltage, current, power, poles, frequency, sccr, ip_nema_type}` — each `unknown` if absent. |
| `catalog_number` | str \| null | If the print names one (`700-C200`, `800T-2TA`, `140M-...`). |
| `terminals` | list[`TerminalRecord`] | See §4.4. |
| `location` | str | Grid/rung/line where the device's primary symbol sits (`C4`, `rung 12`, `/3.2`). |
| `equipment_entity_id` | uuid \| null | FK to the `kg_entities` / `cmms_equipment` row this device maps to, once resolved. |
| `evidence` | `Evidence` | See §4.5 — mandatory. |
| `confidence` | band | `high`\|`medium`\|`low`. |
| `needs_review` | bool | True when the class is `unknown`, the tag is ambiguous, or the symbol match is low. |

### 4.4 `TerminalRecord` (connection points) and wires/cables

`TerminalRecord`: `{terminal_id, functional_label, side, parent_device_tag, evidence}`.
Terminal IDs are style-specific and MUST be preserved verbatim, then normalized:
- **NEMA/JIC motor:** `L1/L2/L3` (line), `T1/T2/T3` (motor load), `1/2/3` control, coil unmarked, aux
  contacts numbered per bulletin.
- **IEC (IEC 60445):** coil `A1/A2`; aux NO `13/14`, NC `21/22`; main poles `1/2 3/4 5/6`; motor
  `U/V/W` (+ `U1/V1/W1`, `U2/V2/W2` for dual-voltage); protective earth `PE`; neutral `N`.

`WireRecord`: `{wire_number, from: "device_tag.terminal", to: "device_tag.terminal", wire_class:
power|control|signal|earth|neutral|safety, gauge, color, evidence, confidence, needs_review}`.
Wire numbers are read as printed (`2`, `3`, `21`, `+24V`, `L1`, jumper letters `A/W/X/Y` in the
A-B booklet) and classified. A wire with only one resolvable end is `needs_review`, not dropped.

`CableRecord`: `{cable_number, cores: [wire_number...], from_location, to_location, type, evidence}` —
populated from a **cable schedule / connection diagram**, not a schematic (schematics rarely carry
cable data — mark absent fields `unknown`, don't invent).

### 4.5 `Evidence` (mandatory on every record — this is the non-negotiable)

```
Evidence = {
  page_number: int,              # PDF page
  location_ref: str,             # grid "C4" | rung/line "12" | IEC path "/3.2"
  symbol_matched: str,           # which library symbol keyed the extraction
  nearby_labels: list[str],      # OCR text near the symbol used to disambiguate
  source_region: [x0,y0,x1,y1],  # bounding box on the page (for the review UI to highlight)
  ocr_confidence: float          # 0-1 from the OCR/vision pass (informs the band, not asserted as truth)
}
```

No `Evidence` → the fact is **not** asserted. This mirrors `citation_compliance.py`: MIRA cites where
the print supports the claim, on the exact grid/rung, or it says "unknown" and flags review. This is
the wiring-print analogue of the "preserve source / don't invent missing data" ingest rules.

### 4.6 `standard_style` detection (how MIRA decides NEMA vs IEC vs ISA)

Detection is evidence-based and recorded in `standard_evidence`. Signals:

| Signal → | NEMA / JIC | IEC / EPLAN | ISA-5.1 |
|---|---|---|---|
| Legend note | "NEMA ICS-1", "JIC" | "IEC 60617", "EN 60204-1", DIN | "ISA-5.1" |
| Line/load terminals | `L1/L2/L3` → `T1/T2/T3` | `L1/L2/L3` → `U/V/W` | n/a |
| Coil terminals | often unmarked | `A1/A2` | n/a |
| Device tags | `M`, `CR`, `OL`, `PB`, `CPT`, numeric lines | `-K`, `-Q`, `-F`, `=+-` prefixes | bubble tags `FT-101` |
| Contact cross-ref | line number + underline (N.C.) | contact mirror / path `/col.row` | n/a |
| Overload symbol | thermal "OL" heater curl | `F` with thermal element | n/a |
| Instrument symbol | — | — | circle/bubble w/ tag |

A sheet that mixes them (common on US installs of European machines) is `mixed` and gets
`needs_review = true` so a human confirms the dominant convention before MIRA reasons over it.

### 4.7 How the records map into MIRA's graph (proposed, never auto-verified)

- Each `DeviceRecord` → an `AISuggestion` of type `kg_entity` (a proposed `kg_entities` row) with
  its `uns_path` and evidence. Status starts `proposed` / `needs_review`.
- Each electrical relationship (`wire connects`, `coil commands contact`, `sensor feeds PLC input`,
  `breaker protects motor`, `estop drops safety_relay`) → a `RelationshipProposal` +
  `relationship_evidence` rows, surfaced as an `AISuggestion` of type `kg_edge`.
- **Upstream/downstream** is derived from the wire graph (power flow L→load, control rung
  top→bottom) and stored as directional edges `feeds` / `protects` / `commands` / `interlocks` /
  `signals`. Promotion `proposed → verified` is an **admin/technician sign-off**, per the KG rules —
  MIRA proposes, a human verifies. No auto-verify.
- `safety_function` is a first-class edge attribute: an E-stop → safety-relay → contactor-coil chain
  is tagged `safety_function = emergency_stop (Cat per EN ISO 13849 / EN 60204-1 stop category 0/1)`
  and always `needs_review` (safety-rated logic is never auto-asserted — it co-activates the
  `mira-industrial-safety` STOP behavior).

### 4.8 Field-by-field crosswalk to the requested extraction list

| Requested field | Model field |
|---|---|
| document title | `WiringPrintDocument.document_title` |
| page number | `.page_number` (+ `Evidence.page_number` per fact) |
| drawing type | `.drawing_type` |
| standard/style detected | `.standard_style` + `.standard_evidence` |
| device tag | `DeviceRecord.device_tag` |
| device class | `.device_class` |
| symbol type | `.symbol_type` |
| terminal numbers | `TerminalRecord.terminal_id` |
| wire numbers | `WireRecord.wire_number` |
| cable numbers | `CableRecord.cable_number` |
| PLC input/output address | `DeviceRecord` (class `plc_*`) + `WireRecord` to the point; `plc_address` on the point terminal |
| safety function | edge attribute `safety_function` |
| source/destination device | `WireRecord.from` / `.to` |
| upstream/downstream relationship | directional `kg_relationships` edge (`feeds`/`protects`/`commands`/`interlocks`) |
| evidence citation (page, grid/rung/line, symbol, nearby labels) | `Evidence` |
| confidence level | `confidence` band on every record |
| human review flag | `needs_review` on every record |

---

## 5. Conveyor-specific worked example

A single conveyor control panel, documented the way MIRA must read it. This is the CV-101 garage
conveyor shape (Micro820 + GS10 VFD) generalized to a full NEMA/IEC panel. Devices, their tags in
**both** styles, and the relationships MIRA extracts.

### 5.1 Device inventory (dual-style tags)

| Device | NEMA/JIC tag | IEC tag | Class | Key terminals |
|---|---|---|---|---|
| Main disconnect | `DISC` / `1DS` | `-Q0` | `disconnect` | L1/L2/L3 → line |
| Branch breaker / fuses (motor) | `CB1` / `1FU-3FU` | `-Q1` / `-F1..F3` | `circuit_breaker`/`fuse` | line/load |
| Control transformer | `CPT` | `-T1` | `transformer` | H1/H2/H3/H4 (pri), X1/X2 (sec) |
| Control fuses | `FU` | `-F4/-F5` | `fuse` | X1→fused |
| 24 VDC power supply | `PS1` | `-G1` | `power_supply` | L/N in, +24V/0V out |
| E-stop (panel + field) | `ESTOP`/`PB-ES` | `-S0` | `estop` | 2× NC (21/22, 31/32) |
| Safety relay | `SR1` | `-K0` (or `-KF1`) | `safety_relay` | A1/A2, 13/14, 23/24, S11-S34 |
| Motor starter / VFD | `M1` (starter) / `VFD1` | `-K1` / `-T2` (drive) | `motor_starter`/`vfd` | L1/L2/L3, T1/T2/T3 (U/V/W) |
| Overload relay | `OL` | `-F6` | `overload_relay` | in series w/ T1-T3; 95/96 NC, 97/98 NO |
| PLC (Micro820) | `PLC` | `-K10` | `plc_cpu` | I/O terminals |
| PLC input card/points | `I:0/0..` | `-K10 :I0..` | `plc_input_card` | 24V sink/source |
| PLC output card/points | `O:0/0..` | `-K10 :Q0..` | `plc_output_card` | to `-K1` coil, pilots |
| Photo eye | `PE1` | `-B1` (ISA: `ZS-101`) | `photo_eye` | +24V, 0V, signal |
| Proximity sensor | `PROX1`/`LS1` | `-B2` (ISA: `ZS-102`) | `proximity_sensor` | +24V, 0V, signal (PNP) |
| Start / Stop / Reset PB | `PB1/PB2/PB3` | `-S1/-S2/-S3` | `pushbutton` | NO/NC |
| Hand-Off-Auto selector | `SS1` | `-S4` | `selector_switch` | positions H/O/A |
| Pilot lights (Run/Fault) | `PL1/PL2` (G/R) | `-P1/-P2` | `pilot_light` | X2, switched leg |
| Terminal blocks | `TB1` | `-X1` | `terminal_block` | numbered terminals |
| Motor | `MTR`/`M1` | `-M1` | `motor` | U/V/W (T1/T2/T3), PE |
| Field wiring | wire numbers | cable `-W1` cores | `cable`/`wire` | between panel `-X1` and field |

### 5.2 The relationships MIRA extracts (the maintenance-context payload)

Power path (upstream → downstream, `feeds`/`protects`):
```
-Q0 (disconnect) → -Q1/-F1..3 (branch protection) → -K1/-T2 (starter/VFD) → -F6 (overload) → -M1 (motor)
CPT -T1 pri (L1,L2) → sec X1/X2 → -F4 → control rung
-G1 24VDC (from X1/X2 or L/N) → +24V bus → PLC, sensors, safety relay
```
Safety path (`interlocks`/`safety_function = emergency_stop`, stop category 0/1):
```
-S0 E-stop (2 NC channels) → -K0 safety relay (S11-S34) → -K0 outputs 13/14,23/24 →
   drop -K1 coil (A1) AND/OR enable-input on -T2 VFD  ⇒ motor de-energizes
```
Control path (`commands`):
```
+24V → -S2 Stop(NC) → -S1 Start(NO) ∥ -K1 aux(13/14 seal-in) → -F6 OL(95/96 NC) → -K1 coil A1 → 0V
PLC -K10 output Q0 → -K1 coil (auto mode via -S4 selector)
-B1 photo-eye signal → PLC input I0 ;  -B2 prox signal → PLC input I1
PLC output Q1 → -P1 Run light ;  Q2 → -P2 Fault light
```

### 5.3 What a single extracted record looks like (photo eye → PLC input)

```json
{
  "device": {
    "device_tag": "-B1", "device_class": "photo_eye",
    "designation_system": "IEC_81346", "symbol_type": "proximity_sensor",
    "label_text": "Photo Eye — product present",
    "terminals": [
      {"terminal_id": "1", "functional_label": "+24V", "side": "top"},
      {"terminal_id": "3", "functional_label": "0V", "side": "bottom"},
      {"terminal_id": "4", "functional_label": "signal (PNP)", "side": "right"}
    ],
    "location": "/4.3",
    "evidence": {"page_number": 4, "location_ref": "/4.3", "symbol_matched": "proximity_sensor",
                 "nearby_labels": ["Photo Eye", "-B1", "product present", "I0.0"],
                 "source_region": [512,210,690,360], "ocr_confidence": 0.94},
    "confidence": "high", "needs_review": false
  },
  "relationship": {
    "type": "signals", "from": "-B1.4", "to": "-K10.I0.0",
    "wire": {"wire_number": "24", "wire_class": "signal", "color": "black"},
    "plc_address": "I0.0",
    "safety_function": null,
    "evidence": {"page_number": 4, "location_ref": "/4.3",
                 "symbol_matched": "wire_signal", "nearby_labels": ["I0.0","24"],
                 "source_region": [690,300,880,300], "ocr_confidence": 0.9},
    "confidence": "high", "needs_review": false,
    "status": "proposed"
  }
}
```

### 5.4 Why this is the point

Once these records exist, a technician asking MIRA "why did the conveyor stop?" gets an answer
grounded in the *print*: "E-stop `-S0` (page 4, /2.1) opens both channels of safety relay `-K0`,
which drops the coil of `-K1` (page 4, /3.4) — the motor `-M1` de-energizes. Check `-S0` and the
`-K0` reset." Every clause carries a page + line citation, a confidence band, and — for the safety
chain — a `needs_review`/safety-STOP flag. That is the difference between MIRA *reading a print* and
MIRA *guessing*.

---

## Appendix — access status & verification caveats

- **Editions verified 2026-07-03** against issuing-body / ANSI / IEC / ISO listings. Key confirmations:
  NFPA 79 **2024**; UL 508A **3rd ed. 2018** (rev. 2025); NEMA ICS 19 **2002 (R2022)**; NEMA ICS 1
  **2022** (hist. 1978); IEEE 315 **1975 (R1993)** + 315A-1986 (Inactive-Reserved 2019); IEC 61082-1
  **3.0:2014**; IEC 60617 **live DB** (no fixed final edition); IEC 60204-1 **6.0:2016**; ISO/IEC
  81346-1 **2.0:2022**; IEC 81346-2 **2.0:2019**; IEC 61355-1 **2.0:2008** (not "81355"); IEC 60445
  **7.0:2021→7.1:2026**; IEC 60757 **2.0:2021**; ISA-5.1 **2024**; ISA-5.4 **1991**; IEC 62424 **2.0:2016**.
- **Paywalled full text, legal free learning:** NFPA 79 & NFPA 70 are **free to read online** via NFPA
  free-access (no copy/print). ISA-5.4 / 5.2 / 5.3 and most IEC docs have **free scope/TOC previews**.
  IEC 81346-2 **2009** text is browsable free on ISO OBP. NEMA frequently offers **free registered
  PDFs** — check the NEMA product page before buying.
- **Prices are indicative** (ANSI webstore blocks automated fetch): NFPA 79 ~$150; NEMA ICS 1-2022
  ~$245; IEC 60617 DB CHF 710 initial / CHF 280 renewal; IEC 60204-1 CHF 430. Confirm on the official
  page.
- **Vendor URLs** in §1D were fetch-verified to resolve except the three flagged browser-only
  (Siemens TIA guideline, Festo Didactic, Schneider SE7847) — real but bot-blocked; confirm
  interactively before citing.
- **When MIRA cites a standard in a customer-facing answer, cite the clause/edition, not a price**, and
  prefer the free-readable source (NFPA free access, ISO OBP, IEC scope preview, vendor guide).

### Cross-references (in-repo)
- `mira-bots/shared/wiring_diagram/schema.py` — the existing diagram *generator* spec (the inverse of this reader model).
- `.claude/rules/uns-compliance.md` — every extracted device maps to a UNS path via `mira-crawler/ingest/uns.py`.
- `.claude/skills/mira-industrial-safety` — co-activates whenever an extracted safety circuit surfaces.
- `.claude/skills/plc-tag-mapper`, `.claude/skills/component-profile-builder` — downstream consumers of extracted PLC I/O + device records.
- Gold-standard reference PDF: Allen-Bradley "Wiring Diagrams" (Pub. GI-2.0 / GI-WD005-EN-P), NEMA ICS-1 lineage.
