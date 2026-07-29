# Sensor Control Unit 2 — Technician Reference (GOLD)

> Source: verified graph of drawing **AP31971**, "Sensor Control Unit 2 V3.5". All items in the source graph carry `trust: proposed`; statements below use **"is"** for pixel-verified facts, **"appears to be"** for probable/inferred items, and **"could not be resolved"** for anything not legible in the photos. Nothing has been invented — illegible items are listed in §9.

---

## 1. Title & Purpose

This **is** drawing **AP31971** (doc 31971), **"Sensor Control Unit 2 V3.5"**, IEC 81346 designation **=LA2 +SCU2**. Project **"Launch System"**, customer **[customer] ([customer] Rides)**, engineered by **INTRASYS (Innovative Transport Systeme)**, location **[site], USA**.

Cabinet **+SCU2 is the middle cabinet of a three-cabinet daisy chain: +SCU1 → +SCU2 (this) → +SCU3.** Its job **is** threefold:

1. **Pass power through** — 115 VAC (L/N/PE) plus a UPS pair (UL/UN) enter from +SCU1 and continue to +SCU3 on cables W5443 (in) / W5471 (out).
2. **Pass the fieldbus through** — EtherCAT/LAN enters from +SCU1 and continues to +SCU3 on cables W5445 (in) / W5473 (out).
3. **Read local field sensors** — a Beckhoff EtherCAT I/O station reads four field units **ME05–ME08**, each providing a temperature RTD **and** a Klixon over-temp switch, plus occupancy/position I/O from a marshalling station.

The cabinet also self-supplies a 24 VDC control rail and a 115 V anti-condensation heater.

---

## 2. Power-Flow Overview

Four power domains are present. Three current-carrying domains plus PE (§7).

**A. 115 VAC mains + heater branch — sheet 3 ("Versorgung 115V, Heizung")**
L/N/PE arrive from +SCU1 on cable **-W5443**, land on strip **-3/X0**, and continue to +SCU3 on cable **-W5471**. Breaker **-3/F2** (Heating, B10A/2-pole) taps L/N for the **250 W / 115 V** heater **-3/E1**, gated by hygrostat **-3/S10** and thermostat **-3/S11**.

**B. UPS / USV branch (UL/UN → USVL1/USVN) — sheet 3 → 4**
A **second L/N pair (UL/UN)** rides the same cables W5443/W5471 through **-3/X0:2 / :N2**, is breakered by **-3/F1** (UPS Supply, B10A/2-pole), and exports as **USVL1/USVN** to sheet 4, where it powers PSU **-4/G1** and thermal-switch output **-4/F3 → -4/X2**.
*Voltage note:* this UPS-derived net **is labelled "230V" on sheets 4 and 7**, while sheet 3 is titled 115V. The actual voltage of the UL/UN pair **could not be resolved** on sheet 3 (see §9).

**C. 24 VDC control — sheet 4 → 5 / 15 / 20**
PSU **-4/G1** (2.5 A) outputs +24V/0V, distributed on **-4/X24VDC** (+24V) and **-4/X24GND** (0V, bonded to PE), and fanned out to sheet 15, sheet 5 (EtherCAT coupler A100), and sheet 20.

**D. 230 VAC field sense — sheet 4 → 12 → 7**
The USV/230V output **-4/X2** feeds the ME05–ME08 Klixon loop, read by the EL1722 inputs **-5/A105 / -5/A106**.

---

## 3. Device-by-Device Callouts

### Sheet 3 — 115V supply / heater
| Tag | What it is | Key detail |
|---|---|---|
| **-3/F1** | 2-pole MCB — **is** "UPS Supply" | B10A/2pol, MOE.132702. Fed from UL/UN (X0:2 / X0:N2); output = USVL1/USVN to sheet 4. |
| **-3/F2** | 2-pole MCB — **is** "Heating" | B10A/2pol, MOE.132702. Upper pole feeds S10/S11 line; second pole carries heater neutral. |
| **-3/S10** | Rittal **hygrostat** — **is** RIT.3118.000 | Term 1 = Drying, 2 = Humidif., 3 = L (common, from F2). Switched-output destinations are not on this sheet and **could not be resolved** here. |
| **-3/S11** | Rittal **thermostat** | Printed **"RIT.3110000"**; catalog form **appears to be** RIT.3110.000 (a dot appears dropped). Bottom term 3 = Heating (→ X1:1), 4 = Cooling (unused). Top terminal numbers 5,6,7,1,2 are legible; their function labels **could not be resolved**. |
| **-3/E1** | Resistive panel **heater** — **is** 250W-115V | "L Heizung". Three leads: L → X1:1, N → X1:N, PE → X1:PE. |

### Sheet 4 — 24V supply *(carried from reader; not re-photographed — no cross-sheet conflict)*
| Tag | What it is | Key detail |
|---|---|---|
| **-4/G1** | 24 VDC switch-mode **PSU** | 2.5 A, article **PXC.2909576** (Phoenix Contact). Model name (STEP-PS/1AC/24DC/2.5) **appears to be** correct but is inferred from the article number, **not printed** — see §9. |
| **-4/F3** | 2-pole **thermal cutout** — "Temperature Switches" | B2/2pol, MOE.132695. Pole 1 in the USV→X2 line; pole 2 routing **could not be resolved** (reads as open stubs). |

### Sheet 5 — EtherCAT station (each module **is** the Beckhoff type printed)
| Tag | Module | Function |
|---|---|---|
| **-5/A100** | **EK1100** | EtherCAT bus coupler — head of the E-bus stack (ETH In/Out; 24V/0V/PE). |
| **-5/A101** | **EL2008** | 8-ch digital **output** (DO8×24VDC/0.5A). |
| **-5/A102** | **EL1008** | 8-ch digital **input** (occupancy). |
| **-5/A103** | **EL1008** | 8-ch digital **input** (broken-sensor + position bits). |
| **-5/A104** | **EL3204** | 4-ch **PT100/RTD** analog input. |
| **-5/A105** | **EL1722** | 2-ch **120…230 VAC** digital input (ME05/ME06 Klixon). |
| **-5/A106** | **EL1722** | 2-ch **120…230 VAC** digital input (ME07/ME08 Klixon). |
| **-5/A107** | **EL9011** | E-bus **end cap / terminator** (no I/O). |
| **-5/U1** | Metz Connect **1309426003-E** | RJ45 panel **feed-through** on the ETH-In (upstream) side. **Is** a pass-through connector, **not** a media/fibre converter (resolved from pixels). |
| **-5/U2** | Metz Connect **1309426003-E** | RJ45 panel **feed-through** on the ETH-Out (downstream/outdoor) side. |

### Field units (sheets 6 & 7)
- **ME05, ME06, ME07, ME08** — each **is** a field unit carrying **both** a PT100 RTD (→ A104) **and** a Klixon thermal over-temp switch (→ A105/A106). The "ME" abbreviation expansion **could not be resolved** (inferred as a measuring/motor unit).

### Off-page devices (referenced, drawn elsewhere)
- **-A1** — the marshalling/PLC station with terminal strips X3/X4/X5; **appears to be** the field-wiring landing point for A101 (DO) and A102/A103 (DI). Drawn on **sheet 13**.
- **-A10 / -A11 / -A12** — DIG-OUT sources for **Position Bit 1 / 2 / 3** into A103. Drawn on **sheet 20**.

---

## 4. Cable / Wire Tracing

**Cables** (multi-core assemblies — *not* devices):
| Cable | Type | Route |
|---|---|---|
| **-W5443** | 5-core **power**, incoming | +SCU1 → **-3/X0**. Cores: 1=L, 2=N, GNYE=PE, 3=UL, 4=UN. Carries the 115V mains pair **and** the UPS pair. |
| **-W5471** | 5G2.5mm² **power**, outgoing | **-3/X0** → +SCU3. Cores 1/2/GNYE/3/4 → +SCU3 L/N/PE/UL/UN. |
| **-W5445** | LAN / **EtherCAT** | +SCU1 (−ETH.D) → **-5/U1** → A100 **ETH In**. Upstream leg. |
| **-W5473** | LAN "**outdoor**" | A100 **ETH Out** → **-5/U2** → +SCU3 (+SCU3-ETH.D). Downstream leg. |

**Conductors / nets** (individual wires):
- **-L / -N / -PE(GNYE) / -UL / -UN** — the five W5443 cores daisy-chained through -3/X0 to W5471 (SCU1→SCU2→SCU3).
- **USVL1 / USVN** — UPS-backed L/N, F1 output → sheet 4 (feed G1 and F3).
- **Heater switched line** — F2 → S11 common → **S11:3 (Heating)** → **X1:1** → E1. Thermostat-switched.
- **X24V (+24V) / X0V (0V)** — control rails from G1, distributed off X24VDC/X24GND.
- **-ETH.D / +SCU3-ETH.D** — EtherCAT data nets upstream/downstream.
- **230V_2 / 230V_N2** — 230V L/N out of -4/X2 (to sheets 18 / 12).

---

## 5. Terminal-by-Terminal — X0 / X1 / X24

### -3/X0 — 5-way pass-through (grid 3.2, between W5443 in and W5471 out)
| Terminal | Net | Connections |
|---|---|---|
| **1** | L | W5443:1 → X0:1 → W5471:1 |
| **N1** | N | W5443:2 → X0:N1 → W5471:2 |
| **PE** | PE | W5443:GNYE / W5471:GNYE, **plus** branches PE.5DA0 (→ sheet 5 A100 PE) and E1.PE (→ heater) — see §7 |
| **2** | UL | W5443:3 / W5471:3 → feeds **-3/F1** upper pole |
| **N2** | UN | W5443:4 / W5471:4 → feeds **-3/F1** lower pole |

### -3/X1 — heater strip (grid 3.7)
| Terminal | Net | Connections |
|---|---|---|
| **1** | L Heizung | from **S11:3** → heater E1 (L) |
| **N** | heater N | heater E1 (N). Onward tie to system neutral **could not be resolved** (faint — §9) |
| **PE** | heater PE | E1 PE → E1.PE net → X0:PE |

### -4/X24VDC — +24V distribution *(carried from reader; not re-shot)*
Points 1/2/3 bridged, fed from **G1(+)**. Distributes **X24V.2 → /15.1**, **X24V.3 → /5.4** (to A100 24V), **X24V.4 → /20.0**. Point 3 spare.

### -4/X24GND — 0V distribution *(carried from reader; not re-shot)*
Points PE/1/2/3; **PE jumpered to pt 1 (0V–PE bond)**, fed from **G1(−)**. Distributes **X0V.2 → /15.1**, **X0V.3 → /5.4** (to A100 0V), **X0V.4 → /20.0**.

---

## 6. PLC I/O + EtherCAT Network

### EtherCAT node (sheet 5) — one contiguous Beckhoff node at +SCU2
E-bus lineup, left → right:
**A100 (EK1100) → A101 (EL2008) → A102 (EL1008) → A103 (EL1008) → A104 (EL3204) → A105 (EL1722) → A106 (EL1722) → A107 (EL9011 end cap).**

**Network path (SCU1 → SCU2 → SCU3):**
`+SCU1/5.3 (−ETH.D) → -W5445 → -5/U1 → A100 ETH In` … `A100 ETH Out → -5/U2 → -W5473 (LAN outdoor) → +SCU3/5.2 (+SCU3-ETH.D)`.

### A101 — EL2008 digital outputs (sheet 6)
| Ch | Signal | Target | Ref |
|---|---|---|---|
| A1.0 | SensorUnits off | -13/A1-X3:2 | /8.0 |
| A1.1 | Position Bits on | -13/A1-X3:6 | /8.1 |
| A1.2–A1.7 | spare | — | /8.2–/8.8 |

### A102 — EL1008 digital inputs (sheet 6)
| Ch | Signal | Source | Ref |
|---|---|---|---|
| E1.0 | SensorUnit 5 occupied | -13/A1-X5:5 | /9.0 |
| E1.1 | SensorUnit 6 occupied | -13/A1-X5:6 | /9.1 |
| E1.2 | SensorUnit 7 occupied | -13/A1-X5:7 | /9.2 |
| E1.3 | SensorUnit 8 occupied | -13/A1-X5:8 | /9.4 |
| E1.4 | Occupied Upstream | -13/A1-X3:9 | /9.5 |
| E1.5–E1.7 | spare | — | /9.6–/9.8 |

### A103 — EL1008 digital inputs (sheet 6)
| Ch | Signal | Source | Ref |
|---|---|---|---|
| E1.0 | SensorUnit 5 Broken | -13/A1-X4:2 | /10.0 |
| E1.1 | SensorUnit 6 Broken | -13/A1-X4:3 | /10.1 |
| E1.2 | SensorUnit 7 Broken | -13/A1-X4:4 | /10.2 |
| E1.3 | SensorUnit 8 Broken | -13/A1-X4:5 | /10.4 |
| E1.4 | Occupied Downstream | -13/A1-X4:6 | /10.5 |
| E1.5 | Position Bit 1 | -20/A10:DIG OUT | /10.6 |
| E1.6 | Position Bit 2 | -20/A11:DIG OUT | /10.7 |
| E1.7 | Position Bit 3 | -20/A12:DIG OUT | /10.8 |

> **Address note:** A102 and A103 both print the symbolic labels **E1.0–E1.7** on the overview. Two EL1008 cards cannot share TwinCAT byte addresses, so the real addresses **appear to be** distinct (distinguished on the sheet only by card tag + the /9 vs /10 reference series). The true byte addresses **could not be resolved** from this image set — see §9.

### A104 — EL3204 RTD analog inputs (sheet 6)
| Word | Signal | Source | Ref |
|---|---|---|---|
| PEW100 | ME05 Temperature | +ME5-1.R:4 | /11.1 |
| PEW102 | ME06 Temperature | +ME6-1.R:4 | /11.3 |
| PEW104 | ME07 Temperature | +ME7-1.R:4 | /11.6 |
| PEW106 | ME08 Temperature | +ME8-1.R:4 | /11.8 |

### A105 / A106 — EL1722 230 VAC digital inputs (sheet 7)
| Addr | Card:Term | Source (Klixon) | Ref |
|---|---|---|---|
| E3.0 | A105:1 | ME05 — -18/X2KL:2 | /12.0 |
| E3.1 | A105:5 | ME06 — -18/X2KL:4 | /12.1 |
| — (230V N) | A105:3 | — | /12.3 |
| — (PE) | A105:4 | — | /12.4 |
| E4.0 | A106:1 | ME07 — -18/X2KL:6 | /12.5 |
| E4.1 | A106:5 | ME08 — -18/X2KL:8 | /12.6 |
| — (230V N) | A106:3 | — | /12.7 |
| — (PE) | A106:4 | — | /12.8 |

> **Cross-signal design:** every field unit ME05–ME08 lands **twice** — a continuous PT100 temperature on A104 (analog, sheet-11 detail) **and** a hard over-temp Klixon on A105/A106 (digital 230V, sheet-12 detail).

---

## 7. PE / Protective Earth (kept strictly separate)

PE **is** recorded as its own set of bonds and nets, never merged into any L/N/UL/UN conductor.

- **-3/X0:PE** — main cabinet PE tie (grid 3.2): W5443:GNYE in, W5471:GNYE out, plus two branches: **PE.5DA0** (→ A100 PE, sheet 5) and **E1.PE** (→ heater).
- **Enclosure bonding strip -3/PE:** :1 RAIL DOOR · :2 CHASSIS · :3 DOOR · :4 MOUNTINGPANEL · :5 spare. (All four bonds and the spare **are** verified.)
- **E1.PE** — heater earth net: X0:PE (3.2) ↔ X1:PE / E1 (3.7), entirely on sheet 3.
- **PE.5DA0** — cabinet PE to PLC: X0:PE (sheet 3, grid 3.2) ↔ A100:PE (sheet 5, grid 5.5), reciprocal verified both ends. The meaning of the token **"5DA0" could not be resolved**.
- **0V–PE bond** — at -4/X24GND (PE jumpered to terminal 1).
- **-4/X2:PE** — fans out to DA_PE1 (/12.4) and DA_PE2 (/12.8).
- **A105/A106 PE** — landed on terminal 4 of each EL1722 (/12.4, /12.8).

---

## 8. Cross-Sheet Navigation

**Sheet index (all Blatt numbers pixel-verified except the layout):**
| Sheet | Function | By / date |
|---|---|---|
| 3 | 115V supply + heater | [design engineer 1], 23.09.2022 |
| 4 | 24V supply | [design engineer 2], 11.07.2022 *(carried, not re-shot)* |
| 5 | PLC overview / EtherCAT node A100–A107 | [design engineer 2], 11.07.2022 |
| 6 | I/O map (A101 DO / A102–A103 DI / A104 RTD) | [design engineer 2], 11.07.2022 |
| 7 | 230 VAC DI (A105/A106 EL1722, ME05–08 Klixon) | [design engineer 2], 11.07.2022 |
| ~2–3 (blurry) | Montageplatte physical layout | [design engineer 1], 18.03.2022 — Blatt number **could not be resolved** |

**Resolved reciprocal cross-references (verified both ends):**
- **PE.5DA0** — sheet 3 X0:PE (3.2) ↔ sheet 5 A100:PE (5.5)
- **E1.PE** — sheet 3 X0:PE (3.2) ↔ sheet 3 heater X1:PE (3.7)
- **USVL1 / USVN** — sheet 3 F1 output (3.7) ↔ sheet 4 (4.0)
- **24V / 0V** — sheet 4 X24VDC/X24GND → sheet 5 A100 (24V @ 4.4/X24V.3, 0V @ 4.6/X0V.3)
- **EtherCAT** — sheet 5 ↔ +SCU1/5.3 (upstream) and +SCU3/5.2 (downstream)
- **Module → detail** — A101–A104 → **/6.4** (sheet 6); A105–A106 → **/7.4** (sheet 7)

**Off-page continuations to follow:**
- Channel detail: A101 → sheet 8 (/8.x) · A102 → sheet 9 (/9.x) · A103 → sheet 10 (/10.x) · A104 → sheet 11 (/11.x) · A105/A106 → sheet 12 (/12.x)
- Marshalling strips **X3/X4/X5** → sheet 13 (station -A1)
- Position-bit sources **-A10/-A11/-A12** → sheet 20
- Klixon terminal strip **-18/X2KL** → sheet 18
- RTD field terminals **+ME5..8-1.R:4** → sheet 11

**Key correction (recorded):** Sheet 7 **is a single clean drawing** (upper ~60% blank), corner reads "Blatt 7 / von 1706". An earlier "two superimposed drawings" reading was bleed-through from sheet 5 — the A100–A107 node overview belongs **solely to sheet 5** and is not double-counted.

---

## 9. Confidence & Unresolved

**Confidence posture:** every item is `proposed`. Re-opened, pixel-verified items (sheet 3 PE/heater/F1; sheet 5 station/network/PE; sheets 6/7 I/O map) carry **0.85–0.96**. Sheet 4 (no cross-sheet conflict, not re-photographed) carries the reader's values (~0.86–0.90). The **Montageplatte layout matches are CANDIDATES only (0.25–0.35)** — no device tag is legible on the layout, so **no physical-layout device could be resolved** to a schematic tag.

**Resolved during adjudication** (no retake needed): the "sheet 7 = two drawings" claim (rejected — single drawing) and the U1/U2 type (RJ45 feed-through, not a media converter).

**Open items — issue → retake needed:**

| # | Item | Issue | Retake |
|---|---|---|---|
| 1 | **-3/S11 top-row terminal functions** (5,6,7,1,2) | Numbers legible; per-terminal function micro-labels below photo resolution. Which top terminal carries the F2 common is inferred, not read. | Macro, square-on, even light, filling frame with the -3/S11 box. |
| 2 | **-3/S11 part number dot** | Prints "RIT.3110000"; catalog form is "RIT.3110.000" — a dot appears dropped. | Macro of the "RIT.311…" text left of the S11 box. |
| 3 | **Heater neutral upstream tie** (X1:N → system N) | E1:N → X1:N is confirmed; onward tie to system neutral is faint and merges with the sub-assembly boundary + centre fold. F2's 2nd pole is the likely source but not cleanly traceable. | Flatten the centre fold; front-lit macro of X1:N up to the F2/N bus. |
| 4 | **-3/F1 & -3/F2 internal pole routing** | Centre fold + reverse-side bleed overlap the conductor runs between X0, F1, F2. Branch assignment (UL/UN→F1, L/N→F2) is confident; exact node-by-node routing partly inferred. | Flatten sheet; front-lit rescan of the upper third (X0 through F1/F2 to the USV arrows). |
| 5 | **-4/F3 pole 2** (terms 3,4) | Reads as open stubs; cannot tell if spare or series-jumpered. | Square-on macro of -4/F3 right side. |
| 6 | **-4/X2 neutral (N1/N2) source tie** | Logically ties to USVN, but the top-rail-to-X2 junction is faint (inferred). | Macro of the right vertical run from the USVN rail to X2:N2. |
| 7 | **230V_2 cross-ref last digit** | Reads "/18.0"; a lower-res pass suggested "/18.3". | Zoom on the "230V_2 /1x.x" label above -4/X2:1. |
| 8 | **PE.5DA0 net-name meaning** | Token legible + verified both ends, but what "5DA0" designates could not be established. | Parts list / PE-bar detail (not derivable from these sheets). |
| 9 | **-18/X2KL:n parse** | Read verbatim; structure likely "sheet 18, strip X2KL, terminal n" but the token could parse differently. | Sheet-18 terminal plan, or higher-res crop of each Klixon row. |
| 10 | **A102 vs A103 duplicate E1.0–E1.7** | Both EL1008 cards print the same symbolic labels; real TwinCAT byte addresses must differ. | Cross-check sheets 9 & 10 or the PLC I/O list (this is a text/logic issue, not an image issue). |
| 11 | **-4/G1 model name** | Only article "PXC.2909576" + "2,5 A" printed; STEP-PS/1AC/24DC/2.5 is inferred. | Parts list / BOM. |
| 12 | **Voltage of UL/UN / USV bus** | 115V system (sheet 3 title, E1 250W-115V) vs "230V" labels on the USV-derived nets (sheets 4/7). UL/UN not voltage-labelled on sheet 3. | A sheet carrying a voltage note on the UL/UN or USV bus (not in this set). |
| 13 | **Montageplatte sheet no. + all device identities** | Blatt cell blurry (~2–3); no device tags/ratings legible (hand-colored render). Every layout match is a form-factor candidate only. | Flat, high-res, glare-free rescan of the title strip AND the component areas; or map components from the schematic BOM. |
| 14 | **"von 1706" field meaning** | Legible and consistent across all sheets, but "sheet N of 1706" is implausibly large — may be a document/order code, not a page total. | Drawing-set index / cover sheet. |