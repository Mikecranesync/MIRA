# Real Industrial Electrical Print Examples

> **Provenance.** Curated 2026-07-03 as the *visual target* for drawing proper Conv_Simple / CV-101
> control prints — the answer to "study real industrial prints before drawing another line." Every
> entry is a real, reputable source (vendor manual, standards/trade article, or AutoCAD Electrical /
> EPLAN sample), scored on the seven readability criteria, ending with the concrete pattern to copy.
> Companion docs: the **style guide** (`docs/reference/excalidraw_electrical_print_style.md`) and the
> **standards pack** (`docs/references/industrial-wiring-diagram-standards.md`). First sheet drawn to
> this target: **E-005** (`plc/conv_simple_electrical/sheets/E-005_plc_inputs.pdf`).

**Purpose:** a visual-target reference pack for a control-panel drafter producing *proper control prints* (title-blocked schematic sheets with wire numbers, terminal designations, and device tags) — **not** device-map / spaghetti diagrams. Each example is scored on the seven things that make a print human-readable, and each ends with the concrete pattern to copy for **Conv_Simple / CV-101** (Micro820 PLC + AutomationDirect GS10 VFD + conveyor motor + Modbus RS-485 bench).

**How to read the "URL resolves" notes:** HTML pages were fetched and their text confirmed. PDFs were fetched and confirmed to download as real PDFs (binary streams, so figure detail is summarized from the vendor's own TOC/specs and adjacent text, not transcribed). A few trade portals (EEP) return HTTP 403 to the automated fetcher but open normally in a browser — flagged where used.

---

## 1. Industrial control panel electrical schematic

### 1a. SolisPLC — "Electrical Panel Wiring Diagram" (worked example, conveyor line)
- **URL (HTML, resolves):** https://www.solisplc.com/tutorials/electrical-panel-wiring-diagram
- **Sheet type:** Multi-page control schematic set (power/one-line page + per-device schematic pages), built in AutoCAD Electrical.
- **What makes it human-readable:** One circuit concern per page; the incoming bus enters at the top of a page and "comes from the previous page," so power flows page-to-page in a fixed order. Each device (VFD, contactor, disconnect) recurs on the pages where it needs power, motor, PLC, and safety signals — never one crammed sheet.
- **Wire labels:** Wires carry unique alphanumeric tags traceable to the schematic; cross-page tracing is by page-and-section ("from page 200 section 1" back to "page 150 section 9").
- **Terminal labels:** PLC signal points are called out as controller addresses, e.g. disconnect feedback lands on `LOCAL:I:4/08`.
- **Device tags:** Family-prefixed NEMA-style tags — `195-MC01` (motor contactor), `195-HSS01` (disconnect switch), `195-M01` (0.75 HP motor), `030-SC01` (conveyor-bed VFD).
- **Title block / sheet number:** Page-and-section grid used as the cross-reference spine across the set.
- **Pattern to copy for CV-101:** Give CV-101 a device family (e.g. `CV101-*`) and split into power page + VFD page + PLC-I/O page rather than one sheet. Put the motor-disconnect aux contact onto a named Micro820 input exactly like `LOCAL:I:4/08` here.

### 1b. RealPars — "How to Follow an Electrical Panel Wiring Diagram"
- **URL (HTML, resolves):** https://realpars.com/panel-wiring-diagram/
- **Sheet type:** Control schematic / panel wiring set, AutoCAD Electrical.
- **What makes it human-readable:** Wires are followed sequentially across pages (page 150 → 200 → 311) to build one circuit; page + section navigation is the whole readability model.
- **Wire labels:** Node-based numbers — the E-Stop button has "wires tagged 1 on one end and 2 on the other"; the number changes only through the device.
- **Terminal labels:** PLC input point named `300U2.1` — a page/column-derived tag that matches diagram to hardware.
- **Device tags:** Discrete-device tags (E-Stop PB, PLC input) with matching diagram references.
- **Title block / sheet number:** Page-and-section addressing is the cross-reference system.
- **Pattern to copy for CV-101:** Number the E-Stop loop exactly this way — one number in, a different number out of each contact — so a tech can ohm wire "1" to "2" across the E-Stop at the bench.

### 1c. Hybrid PLC — "Chapter 9: Planning the Panel"
- **URL (PDF, resolves ~3.9 MB):** https://hybridplc.org/wp-content/uploads/chap9_S.pdf
- **Sheet type:** Teaching chapter on panel-layout + schematic planning (device schedule → schematic → layout flow).
- **What makes it human-readable:** Treats the schematic and the physical layout as two linked views of the same device list — the discipline that stops "spaghetti."
- **Wire labels / terminal labels:** Teaches the wire-number ↔ terminal-number correspondence used to build the panel from the print.
- **Device tags:** Device-schedule-driven tags reused on schematic and layout.
- **Title block / sheet number:** Chapter frames the drawing set (cover/schedule → schematics) that the 8-sheet target below mirrors.
- **Pattern to copy for CV-101:** Author E-001 as a device schedule *first*, then draw schematics from it — the "plan the panel" order.

---

## 2. PLC input wiring diagram

### 2a. AutomationDirect — "Sinking/Sourcing" I/O reference
- **URL (PDF, resolves):** https://cdn.automationdirect.com/static/specs/sinksource.pdf
- **Sheet type:** PLC discrete-input wiring reference (24 VDC sink vs source).
- **What makes it human-readable:** Each input drawn as a single labeled loop — field device → input terminal → common — with the current-flow direction explicit, so sink vs source is visible not inferred.
- **Wire labels:** +24 VDC and 0 V rails drawn as named nodes feeding every input.
- **Terminal labels:** Real designations `IN`, `IN-COMx` (input common); 3-wire PNP sensor color/terminal map (brown=+24 V, black=signal→IN, blue=0 V).
- **Device tags:** Sensor/switch symbols tied to their input point.
- **Title block:** Spec-sheet header (doc-controlled reference).
- **Pattern to copy for CV-101:** Micro820 `20QBB/QWB` inputs are 24 VDC sink/source — draw each conveyor sensor as this exact loop and label the shared return `IN-COM0`.

### 2b. Rockwell — Micro820 20-point Installation Instructions (2080-IN009)
- **URL (PDF, resolves ~1.3 MB):** https://literature.rockwellautomation.com/idc/groups/literature/documents/in/2080-in009_-en-p.pdf
- **Sheet type:** Controller input-terminal wiring + terminal-block layout for the exact bench PLC.
- **What makes it human-readable:** Physical terminal-block picture beside the schematic loop; one figure per input group.
- **Wire labels:** 24 VDC input group fed from a labeled +24V / COM pair.
- **Terminal labels:** Real Micro820 input designations `I-00 … I-11`, input commons `COM0/COM1`; power terminals `+24V`, `COM`.
- **Device tags:** Inputs shown driven by dry contacts / 3-wire sensors.
- **Title block / sheet:** Rockwell publication number + revision (`2080-IN009_-EN-P`), the model of a controlled title block.
- **Pattern to copy for CV-101:** This is *the* controller — copy its `I-0x`/`COMx` terminal names verbatim onto E-005; don't invent input names. **(This is the source that validated E-005's terminal designations.)**

### 2c. AutomationDirect — DirectLOGIC "I/O Wiring and Specifications" (Ch. 3)
- **URL (PDF, resolves):** https://cdn.automationdirect.com/static/manuals/d2inst/ch3.pdf
- **Sheet type:** Module-level input wiring diagrams + terminal specs.
- **What makes it human-readable:** Standard per-point loop with the internal module opto shown, so the reader sees where the "common" bonds.
- **Wire labels:** Named commons per bank; single fused feed to the bank.
- **Terminal labels:** Point + common designations per module (`X0…`, `C0` bank commons).
- **Device tags:** Field devices as generic contacts on each point.
- **Pattern to copy for CV-101:** Use the "one fused feed → bank → per-point loops" grouping so all Micro820 inputs share a clearly-labeled common and a single input fuse.

---

## 3. PLC output wiring diagram

### 3a. Rockwell — Micro820 Installation Instructions (2080-IN009), output section
- **URL (PDF, resolves):** https://literature.rockwellautomation.com/idc/groups/literature/documents/in/2080-in009_-en-p.pdf
- **Sheet type:** Relay/transistor output wiring for the bench PLC.
- **What makes it human-readable:** Each output drawn as coil/relay → load → return, grouped by output common bank.
- **Wire labels:** Output supply rail and return labeled as nodes.
- **Terminal labels:** Real designations `O-00 … O-06`, output commons per group; relay outputs shown with their own commons.
- **Device tags:** Loads (pilot lights, VFD run input) on each output.
- **Title block / sheet:** `2080-IN009_-EN-P`, rev-controlled.
- **Pattern to copy for CV-101:** Draw the Micro820 output that drives the GS10 "run" (or a run-permit relay) as `O-0x` → relay coil `A1/A2` → GS10 DI, and label the output common bank.

### 3b. AutomationDirect — DirectLOGIC I/O Ch. 3 (output modules)
- **URL (PDF, resolves):** https://cdn.automationdirect.com/static/manuals/d2inst/ch3.pdf
- **Sheet type:** Discrete output wiring diagrams (relay + FET) with terminal specs.
- **What makes it human-readable:** Shows fuse, common, and load on every output point in a repeating pattern.
- **Wire / terminal labels:** Point + bank-common designations; per-bank fuse shown.
- **Device tags:** Solenoids/lamps as loads.
- **Pattern to copy for CV-101:** Fuse each output bank and show it on the sheet — a bench detail techs actually need when an output "does nothing."

### 3c. Rockwell — 1769 Compact "24V DC Sink Input / Source Output" module manual (1769-UM016)
- **URL (PDF, resolves):** https://literature.rockwellautomation.com/idc/groups/literature/documents/um/1769-um016_-en-p.pdf
- **Sheet type:** Combined sink-input / source-output module wiring.
- **What makes it human-readable:** Sink and source drawn on the same page so the current-direction contrast is explicit.
- **Terminal labels:** Output points with source commons; input points with sink commons.
- **Pattern to copy for CV-101:** If mixing sink inputs and source outputs on the Micro820, put a small "sink/source" note block on E-005/E-006 exactly like this manual does.

---

## 4. VFD motor control schematic

### 4a. AutomationDirect — DURApulse GS10 User Manual, Ch. 2 "Installation and Wiring"
- **URL (PDF, resolves ~3.2 MB):** https://cdn.automationdirect.com/static/manuals/gs10m/ch2.pdf
- **Sheet type:** VFD power + control-terminal schematic for the *exact* bench drive.
- **What makes it human-readable:** Separates the **main power circuit** from the **control circuit**; a dedicated "Full I/O Wiring Diagram" and "Control Circuit Wiring Diagram" so power and signal never tangle.
- **Wire labels:** Line side and motor side drawn as distinct labeled buses; RFI-jumper note called out.
- **Terminal labels:** Real GS10 designations — power `R/L1, S/L2, T/L3` (line) and `U/V/W` (motor); control terminals `DI1…DIx`, `DFM`, `DCM`, analog `AVI/ACI/AUI`, `10V`, and RS-485 `SG+ / SG- / SGND`.
- **Device tags:** Drive as `GS10` block with terminal fan-out.
- **Title block / sheet:** AutomationDirect manual "1st Ed., Rev B," page-numbered per chapter — clean revision discipline.
- **Pattern to copy for CV-101:** This is the canonical source for E-003. Copy `R/S/T` → `U/V/W` and the control-terminal names `DI/DCM/SG+/SG-` verbatim; keep GS10 power and control on separate sheets like the manual does.

### 4b. Honeywell — SmartVFD Frame 4 Wiring Diagrams (spec data 63-4379)
- **URL (PDF, resolves):** https://prod-edam.honeywell.com/content/dam/honeywell-edam/hbt/en-us/documents/literature-and-specs/datasheets/63-4379.pdf
- **Sheet type:** VFD power + control wiring datasheet (line reactor, breaker, drive, motor).
- **What makes it human-readable:** Drive shown as a labeled rectangle with terminal stubs; upstream protection sized per NEC and drawn in order (disconnect → breaker → drive → motor).
- **Wire labels:** Motor/feeder conductors sized and tagged per NEC.
- **Terminal labels:** Line `L1/L2/L3`, motor `T1/T2/T3`, control terminal strip on the drive.
- **Device tags:** VFD block + optional line/load reactors labeled.
- **Pattern to copy for CV-101:** Emulate the "disconnect → breaker → drive → motor" left-to-right order and the reactor-as-optional-box convention on E-003.

### 4c. EEP — "Inside a VFD Panel: Configuration, Schematics and Troubleshooting"
- **URL (HTML; opens in browser, returns 403 to automated fetcher):** https://electrical-engineering-portal.com/variable-frequency-drive-vfd-panel-configuration-schematics-troubleshooting
- **Sheet type:** Complete VFD-panel schematic walk-through (power + control + comms).
- **What makes it human-readable:** Whole-panel schematic decomposed into power, control, and communication sub-sheets — the multi-sheet discipline this pack advocates.
- **Wire / terminal labels:** Drive control terminals and run/direction/reference wiring shown with tags.
- **Device tags:** `VFD`, contactor `K`, breaker `Q`, motor `M` style.
- **Pattern to copy for CV-101:** Use it as the "what a finished VFD panel print set looks like" gut-check for the CV-101 sheet split.

---

## 5. 24 VDC control power distribution schematic

### 5a. Rockwell — 1606 Power Supply Reference Manual (1606-RM052)
- **URL (PDF, resolves):** https://literature.rockwellautomation.com/idc/groups/literature/documents/rm/1606-rm052_-en-p.pdf
- **Sheet type:** 24 VDC control-power distribution (supply, input fusing, DC bus, load branches).
- **What makes it human-readable:** Draws the supply as a labeled block feeding a `+24V`/`0V` bus, then fanned to fused branch circuits — the classic "power tree."
- **Wire labels:** All positive nodes labeled `24V`, all returns `0V` (potential-based naming).
- **Terminal labels:** `L(+)` from supply → circuit breakers → distribution terminal blocks; "separate input fuse for each supply."
- **Device tags:** `PS1` supply, `F1…Fn` fuses/breakers.
- **Title block / sheet:** Rockwell RM publication + revision.
- **Pattern to copy for CV-101:** E-004 = one `PS1` block → `+24V`/`0V` bus terminals → individually-fused branches for PLC, GS10 control, sensors, pilot devices.

### 5b. Rockwell — "Designing More Reliable 24VDC Systems" (1606-AT003)
- **URL (PDF, resolves):** https://literature.rockwellautomation.com/idc/groups/literature/documents/at/1606-at003_-en-p.pdf
- **Sheet type:** 24 VDC distribution application note (sizing, fusing, branch protection).
- **What makes it human-readable:** Shows the supply → protection → load hierarchy and how to size branch fuses/breakers (~120% rule) with the wiring drawn per branch.
- **Terminal / device labels:** `24V`/`0V` bus, per-branch `F`; loads grouped by function.
- **Pattern to copy for CV-101:** Add a fuse-schedule note on E-004 (branch → fuse rating → load) — a bench maintenance win.

### 5c. E-T-A — "Guideline for DC 24 V Systems in Machine Construction"
- **URL (PDF, resolves):** https://www.e-t-a.co.uk/fileadmin/user_upload/Ordnerstruktur/pdf-Data/Broschures_Magazines_etc/Broschures/Broschures_en/B_DC24V_systeme_en.pdf
- **Sheet type:** 24 VDC load-distribution reference (up to 40 A, electronic breakers).
- **What makes it human-readable:** Distribution drawn as a labeled DC bus with per-channel protected outputs and status.
- **Terminal / device labels:** Channelized `+24V` distribution with `F1…Fn` per load.
- **Pattern to copy for CV-101:** Even at bench scale, draw one clean 24 VDC bus with named, individually-protected outputs rather than daisy-chaining loads off one lug.

---

## 6. Terminal strip electrical drawing (terminal plan / wire list)

### 6a. Nate Holt — "Terminal Strip Management (Part 1)," AutoCAD Electrical
- **URL (HTML, resolves):** https://nateholt.wordpress.com/2010/10/16/tutorial-terminal-strip-management-part-1-autocad-electrical/
- **Sheet type:** Terminal-strip schematic + terminal-plan generation.
- **What makes it human-readable:** Terminals drawn in strip order with wire-in / wire-out on each side; software auto-assigns "next unused terminal number."
- **Wire labels:** Terminal *type* controls wire numbering — Type 1 passes the wire number through, Type 2 forces a number change through the terminal, Type 3 adopts the passing wire number.
- **Terminal labels:** Strip tag + sequential number (`TB-1 : 1, 2, 3 …`).
- **Device tags:** Strip named as a device (`TB`, `X1`) with per-terminal numbers.
- **Pattern to copy for CV-101:** On E-008, draw the strip as an ordered ladder of numbered terminals with the field wire on the left and the panel/PLC wire on the right of each terminal.

### 6b. Industrial Monitor Direct — "NEMA Terminal Block Schematic Designations & Labeling"
- **URL (HTML, resolves):** https://industrialmonitordirect.com/blogs/knowledgebase/nema-terminal-block-schematic-designations-and-labeling-standards
- **Sheet type:** Terminal-plan labeling standard.
- **What makes it human-readable:** "Terminal name mirrors the wire number" — direct visual correlation between field wire tag and the terminal it lands on.
- **Wire labels:** Same number both ends of a wire; large systems use `2201` = page 2, row 20, wire 1.
- **Terminal labels:** Strip designators `TB1000-1 … TB1000-20`; multi-level format `TB1000-18(F).1` (terminal 18, Front level, position 1); power terminals all named `24V` / `0V` with internal jumpers documented in notes.
- **Device tags:** Strip = `TB1000`; ground terminals broken out.
- **Pattern to copy for CV-101:** Make each CV-101 terminal number equal its wire number, and document any 24V/0V jumper links in a note block rather than as invisible bridges.

### 6c. ABB / EPLAN — "EPDS Brno" standard documentation (EPLAN sample set)
- **URL (PDF, resolves):** https://library.e.abb.com/public/3f81ebc609fd4a168847e6a5522ed8c2/1VLG100537_Standard_Documentation.pdf
- **Sheet type:** Full EPLAN sample project including **terminal diagrams** + connection lists.
- **What makes it human-readable:** Machine-generated terminal plan: every terminal row shows target device, cable, and connection — no manual spaghetti.
- **Wire / terminal labels:** IEC-style terminal designations (`-X1:1`, `-X2:…`) with cross-referenced targets.
- **Device tags:** IEC identifiers (`-Q1`, `-K1`, `-F1`, `-X1`) with `=`/`+` structure prefixes.
- **Title block / sheet:** EPLAN title block with sheet/page tree and revision — a gold-standard controlled drawing set.
- **Pattern to copy for CV-101:** Emulate the terminal-diagram *table* (terminal | field side | panel side | cable) as the format for E-008's wire list.

---

## 7. AutoCAD Electrical wire number + terminal block schematic

### 7a. Autodesk — AutoCAD Electrical "About Terminals" / To Work With Terminals (2024 Help)
- **URL (HTML, resolves):** https://help.autodesk.com/view/ACAD_E/2024/ENU/?guid=GUID-BC5A05B1-2974-4A02-8913-57514FCAB6F8
- **Sheet type:** Wire-number + terminal-block schematic mechanics.
- **What makes it human-readable:** Wire numbers auto-assigned by network (same electrical node = same number); terminals associate schematic ↔ panel automatically so numbers stay consistent.
- **Wire labels:** Auto wire numbering with page/line-based formats; number changes only through a number-changing terminal.
- **Terminal labels:** Catalog-backed terminals carrying strip + terminal number.
- **Device tags:** Component tags auto-sequenced with family codes.
- **Pattern to copy for CV-101:** Adopt "same node = same wire number, change only through a device" as the CV-101 numbering law — the single most important anti-spaghetti rule.

### 7b. Industrial Monitor Direct — "Electrical Wire Naming Conventions: NFPA 79, IEC & NEMA"
- **URL (HTML, resolves):** https://industrialmonitordirect.com/blogs/knowledgebase/electrical-wire-naming-conventions-nfpa-79-iec-and-nema-standards
- **Sheet type:** Wire-numbering standard for schematic + terminal work.
- **What makes it human-readable:** NFPA 79 — each wire uniquely identified at *both ends* matching the schematic; ladder method `[rung][position]` (rung 2 pos 3 → wire `23`); avoid terminal-to-terminal (different number each end).
- **Wire labels:** Concrete schemes: ladder `2201`, hierarchical `Cabinet-Device-Drawing-Wire`; markers 8–10 chars; color per IEC 60446 alongside the number.
- **Terminal labels:** Wire label matches landing terminal.
- **Title block / sheet:** "Document your numbering methodology on sheet 1."
- **Pattern to copy for CV-101:** Pick the ladder `[page][line]` scheme, keep markers short, and print the convention key on E-001.

### 7c. ImaginIt — "Placing terminals using Terminal (Panel List)" + Terminal Strip Editor
- **URLs (HTML, resolve):** https://resources.imaginit.com/manufacturing-solutions-blog/autocad-electrical-placing-terminals-using-terminal-panel-list · https://resources.imaginit.com/manufacturing-solutions-blog/autocad-electrical-adding-new-terminal-strip-through-terminal-strip-editor
- **Sheet type:** Wire-number-aware terminal-strip schematic + panel footprint.
- **What makes it human-readable:** Terminal Strip Editor shows wire info + device on *both* sides of each terminal; panel terminals stay associated to the schematic representation.
- **Wire / terminal labels:** Terminal number + strip; wire numbers flow in after numbering, then annotate the footprint.
- **Pattern to copy for CV-101:** Build E-008 from the schematic terminals (not by hand) so the wire list and the strip drawing can never disagree.

---

## 8. NEMA ladder control schematic (rungs + line references)

### 8a. EC&M — "Electrical Ladder Drawing Basics"
- **URL (HTML, resolves):** https://www.ecmweb.com/basics/article/20897064/electrical-ladder-drawing-basics
- **Sheet type:** NEMA ladder control schematic.
- **What makes it human-readable:** Two vertical **rails** (control voltage) with horizontal **rungs**; inputs left, outputs right; loads only in parallel; read left-to-right, top-to-bottom; control lines drawn thicker.
- **Wire labels:** Node numbers change only through a voltage-dropping device.
- **Terminal labels:** Rails as `L1`/`L2` (or `X1`/`X2` on a control transformer).
- **Device tags:** `CR` (control relay coil), `PB` (pushbutton), `LS` (limit switch), `SOL` (solenoid); contacts labeled like their coil.
- **Title block / sheet:** Rungs numbered on the left; right-margin numbers cross-reference where a coil's contacts appear (underline = N.C. contact).
- **Pattern to copy for CV-101:** Draw the E-Stop / start-stop seal-in as a classic 2-wire rung ladder with left-margin rung numbers and right-margin contact cross-references.

### 8b. Industrial Monitor Direct — "Electrical Ladder Diagram Standards: Wire Numbers, Layout & Best Practices"
- **URL (HTML, resolves):** https://industrialmonitordirect.com/blogs/knowledgebase/electrical-ladder-diagram-standards-and-drawing-conventions
- **Sheet type:** NEMA/IEC ladder standard.
- **What makes it human-readable:** Inputs on left rail, outputs on right rail, logic in center; consistent rung spacing (0.375"/10 mm per IEC 60617).
- **Wire labels:** `2003` = page 2, line 3 (page/line wire numbers unique across the set).
- **Terminal labels:** `TB1-1, TB1-2 …` cross-referenced to wire numbers, with signal type / voltage / function documented.
- **Device tags:** NEMA device designators cross-referenced by line number.
- **Title block / sheet:** Page/line numbering is the drawing-set spine; standards cited (IEC 60617, NEMA ICS-1).
- **Pattern to copy for CV-101:** Number CV-101 wires as `[page][line]` (e.g. `5003` on E-005 line 3) so a wire tag alone tells you which sheet to open.

### 8c. Control.com — "Relay Circuits and Ladder Diagrams" (textbook)
- **URL (HTML, resolves):** https://control.com/textbook/relay-control-systems/relay-circuits/
- **Sheet type:** Relay ladder logic reference.
- **What makes it human-readable:** Canonical rail/rung, seal-in, and coil-to-contact cross-reference explained from first principles.
- **Wire / device labels:** `CR5` coil with `CR5-1, CR5-2` contacts; commonality-numbered wires.
- **Pattern to copy for CV-101:** Use suffixed contact tags (`CR-Run`, `CR-Run-1`) so the run-relay's contacts on the GS10-permit rung are unambiguous.

---

## 9. Industrial one-line diagram (VFD + motor)

### 9a. EEP — "Learn to Interpret Single Line Diagram (SLD)"
- **URL (HTML; opens in browser, 403 to automated fetcher):** https://electrical-engineering-portal.com/learn-to-interpret-single-line-diagram
- **Sheet type:** Power one-line / single-line diagram.
- **What makes it human-readable:** Read top-down, highest voltage to lowest; one line represents all phases; equipment stacked in power-flow order (utility → transformer → breaker → bus → feeder → drive → motor).
- **Wire labels:** Feeders/cables tagged with size and circuit ID.
- **Terminal labels:** Bus and breaker tie points named.
- **Device tags:** Transformer, `CB`/breaker, `VFD` rectangle (with kW/HP rating, optional line/load-reactor `LR` boxes), motor `M`.
- **Title block / sheet:** One-line is sheet 1 of the power set.
- **Pattern to copy for CV-101:** E-002 = a single vertical one-line: source → main breaker → `GS10` VFD block (rating) → conveyor motor `M1`, drawn top-to-bottom.

### 9b. SolisPLC — one-line vs schematic distinction (same tutorial as 1a)
- **URL (HTML, resolves):** https://www.solisplc.com/tutorials/electrical-panel-wiring-diagram
- **Sheet type:** Single-line overview page paired with detailed schematic pages.
- **What makes it human-readable:** Explicitly separates the simplified one-line (overview) from multi-page schematics (detail) so the reader picks the right altitude.
- **Device tags:** `030-SC01` conveyor VFD, `195-M01` motor, `195-HSS01` disconnect on the power overview.
- **Pattern to copy for CV-101:** Keep E-002 deliberately simple (blocks + ratings); push terminal detail to E-003.

### 9c. CED Engineering — "Variable Frequency Drives (VFDs)" course (M02-031)
- **URL (PDF, resolves):** https://www.cedengineering.com/userfiles/Variable%20Frequency%20Drives%20(VFDs).pdf
- **Sheet type:** VFD one-line + power-circuit reference (PDH course).
- **What makes it human-readable:** Shows the VFD one-line with upstream protection, drive, and motor, plus where reactors/filters sit.
- **Device tags:** `VFD` block, breaker, motor `M`, reactor boxes.
- **Pattern to copy for CV-101:** Borrow its VFD-block-with-rating convention and the "disconnect + breaker upstream of the drive" ordering for E-002/E-003.

---

## Bonus source — RS-485 Modbus comms sheet (feeds E-007)

**Chipkin — "RS-485 Physical Layer Wiring & Termination Reference for Modbus RTU"** · **URL (HTML, resolves):** https://docs.chipkin.com/articles/modbus-rs485-physical-layer-wiring-and-termination-reference/ · Draws a linear daisy-chain `[120Ω] — Master — Dev1 — Dev2 — DevN — [120Ω]`, labels `D1` (Data +, yellow) / `D0` (Data −, brown) / Common (grey), warns A/B labels are vendor-inconsistent, terminates *only* at the two trunk ends, and grounds the shield at *one* point (the master). **Pattern for CV-101:** E-007 = Micro820 (master) → GS10 `SG+/SG-/SGND` (slave) as a two-node trunk with a `120Ω` terminator at the GS10 end and shield grounded only at the panel; annotate that GS10 `SG+` = D1 and `SG-` = D0. Cabling rules (shielded twisted pair, 120 Ω, one-point shield ground) corroborated by Schneider FA221785 (https://www.se.com/us/en/faqs/FA221785/) and EEP "9 rules for correct cabling of Modbus RS485" (https://electrical-engineering-portal.com/correct-cabling-modbus-rs485, browser-reachable / 403 to fetcher). **NOTE:** the bench GS10 comms port is documented in the repo (`plc/GS10_Integration_Guide.md §3`) as an **RJ45** — pin 5 SG+, pin 4 SG-, pin 3 SGND — and the Micro820 side as `D+/D-/G` on Ch2. Use the repo's verified pinout for E-007, not a generic RJ12/screw-terminal assumption.

---

## The 8-sheet target for Conv_Simple / CV-101

A finished bench print set, with the example(s) above to emulate per sheet:

| Sheet | Contents | Emulate |
|---|---|---|
| **E-001** Cover / legend / device schedule | Title block, symbol legend, wire-number convention key, device schedule (tags → description → rating) | **1c** Hybrid PLC "Planning the Panel" (schedule-first) + **7b** IMD wire-naming ("document the scheme on sheet 1"). |
| **E-002** Power one-line | Source → main breaker → GS10 → conveyor motor `M1`, top-to-bottom, ratings only | **9a** EEP SLD (top-down, VFD block) + **9b** SolisPLC (keep one-line simple) + **9c** CED VFD one-line. |
| **E-003** VFD power | GS10 line `R/L1,S/L2,T/L3` → motor `U/V/W`, disconnect/breaker upstream, control terminals | **4a** AutomationDirect GS10 Ch. 2 (verbatim terminal names) + **4b** Honeywell SmartVFD ordering. |
| **E-004** 24 VDC control power | `PS1` → `+24V`/`0V` bus → individually-fused branches (PLC, GS10 control, sensors, pilots) + fuse schedule | **5a** Rockwell 1606-RM052 (power tree) + **5b** 1606-AT003 (branch fuse sizing) + **5c** E-T-A channelized distribution. |
| **E-005** PLC inputs | Micro820 `I-00…I-11` / `COM0/1`, each conveyor sensor/switch as a labeled sink/source loop | **2b** Micro820 2080-IN009 (real terminal names) + **2a** AutomationDirect sink/source loops + **2c** DirectLOGIC bank-common grouping. **← drawn first** |
| **E-006** PLC outputs | Micro820 `O-00…O-06` driving run-permit relay `CR` → GS10 DI; fused output banks | **3a** Micro820 2080-IN009 outputs + **3b** DirectLOGIC fused-output pattern + **8c** suffixed relay/contact tags. |
| **E-007** RS-485 Modbus | Micro820 (master, Ch2 `D+/D-/G`) ↔ GS10 RJ45 `SG+/SG-/SGND`, `120Ω` at drive end, shield grounded one point | **Bonus** Chipkin RS-485 reference (termination, shield) + `plc/GS10_Integration_Guide.md §3` (verified RJ45 pinout). |
| **E-008** Terminal strip + wire list | Ordered `X1`/`TB` strip, field-side vs panel-side per terminal, terminal number = wire number, jumpers noted | **6c** ABB/EPLAN terminal-diagram table + **6b** IMD "terminal name mirrors wire number" + **6a** Nate Holt strip-from-schematic. |
| **E-009** Open items / notes | Punch list, RFI-jumper note, spare I/O, revision notes | Revision/title-block discipline from **4a** GS10 manual + **1a** SolisPLC page-cross-reference model. |

**Two laws that keep the whole set out of "spaghetti" territory (from 7a + 8b):** (1) *same electrical node = same wire number; a wire number changes only through a device* — and (2) *number wires by `[page][line]`* so any tag on any sheet points back to its origin. Print both laws on E-001.
