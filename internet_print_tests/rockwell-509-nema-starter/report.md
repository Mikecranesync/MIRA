# MIRA Print Translator Test — rockwell-509-nema-starter

## 1. Source & drawing metadata
- Publisher: Rockwell Automation
- Title: Bulletin 509 NEMA Motor Starters — Wiring Diagrams (GI-WD005)
- Sheet: Bulletin 509 Sizes 7 & 8 — 3-Phase Starters, standard START-STOP pushbutton (booklet p.13)
- Equipment: NEMA 3-phase magnetic motor starter
- Standard: NEMA ICS 2
- Category: motor_starter
- Source URL: https://literature.rockwellautomation.com/idc/groups/literature/documents/wd/gi-wd005_-en-p.pdf
- Access date (UTC): 2026-07-21T05:57:06Z
- Original sha256: `9d3f977104c86a6ee38aa3f85630a3ad9ff890ec138a43b0d85977479bde6993`

## 2. Why selected
Page index 12 of the Rockwell WD booklet is a genuine NEMA 3-phase magnetic-starter wiring diagram (verified by render 2026-07-13): incoming L1/L2/L3, current transformers 1CT/2CT/3CT (terminals 20-25), motor T1/T2/T3, START-STOP pushbutton station, CR control relay, K1/K2, A1X-A4Y coil terminals, overloads, and a separate-control-source ladder. Pages 0-3 are cover/intro/contents/key-to-symbols (text) — page 12 is the first dense starter schematic. Publicly published on literature.rockwellautomation.com; provenance verified 2026-07-10 (httpx 200/206 application/pdf).

## 3. Exact Telegram bot response (verbatim, unmodified)

```
# Bulletin 509, Sizes 7 and 8 — 3 Phase Starter (Standard Wiring with START-STOP Push Button Station)

This sheet (page 17/13) shows the **standard wiring** for an Allen-Bradley Bulletin 509 Size 7 or 8 three-phase motor starter. It contains two views of the same circuit:

## Top view — Physical / pictorial layout
Shows how the devices are arranged and terminated:

- **Incoming Lines L1, L2, L3** land on terminals **20, 22, 24** (with **21, 23, 25** as the load-side run terminals).
- **1 C.T., 2 C.T., 3 C.T.** (current transformers) on **T1, T2, T3** feed the motor.
- **(L.B.)** — overload relay block, with the **M** coil between terminals **6 and 9**.
- **Mov.** (MOV, surge suppressor) and **Rect.** (rectifier) wired between terminals **4, 8, 9**.
- **1 Econ. Cap.** and **2 Econ. Cap.** — economizer capacitors on terminal **8**, feeding the **FU 1A** fuse block (terminals **1–7**, with **1A**).
- **O.L.'s** (overload contacts) with **Grd** (ground), terminals **20/21, 22/23, 24/25**.
- **K1 / K2** interlock contacts and the **CR** relay with terminals **A1X, A2X, A3X, A4X, A1Y, A2Y, A3Y, A4Y**.
- **1 Res.** and **2 Res.** (resistors) on terminals **5–7** and **12–6**.
- **MOTOR** leads **T1, T2, T3**.
- **Stop** and **Start** push buttons (terminals **1–2** and **2–3**).

## Bottom view — Schematic ladder diagram
Shows the control logic in schematic form:

- **FU 1A** fuse feeds a **Separate Control Source** (terminal **4**).
- Control line: terminal **1 → Stop (1–2) → Start (2–3) → CR (A1Y/A1X) holding contact → CR coil → K1 / K2 contacts → O.L. (terminal 4)**.
- The **CR** coil, when energized, seals in through its own **A1Y/A1X** contact around the Start button.
- **2 Res.** with **CR (A4X/A4Y)** contact feeds the **M** (master/contactor) coil.
- **1 Res.** with **CR (A2Y/A2X)** and **CR (A3X/A3Y)** contacts, in series with the **M (L.B.)** overload contact, feeds the **Rect.** (rectifier terminals **8, 4, 9**).
- **1 Econ. Cap.** and **2 Econ. Cap.** are switched in via the **Mov.** (MOV) branch on terminal **8**.

## What the circuit does
Pressing **Start** energizes **CR**; CR's contacts then pick the **M** (main contactor) through the resistor/capacitor economizer network, with the rectifier and MOV providing DC coil power and surge protection. Releasing **Start** is permitted because **CR (A1Y/A1X)** holds the circuit. Pressing **Stop**, or an **O.L.** trip, drops **CR** and the motor.

## Note on live state
The print shows the **wiring**, not the present condition of the starter. To confirm whether the contactor is currently energized or which contacts are open/closed, the technician must verify with a meter at the terminals.
```

- classification: **ELECTRICAL_PRINT** (conf 0.85)
- interpreter used (Anthropic PrintSynth): **False**
- model: together/MiniMaxAI/MiniMax-M3 · effort medium · latency 59.96s

## 4. LLM judge grade (PROVISIONAL, qualitative — not technician approval until Mike calibrates)
- score: **None/100** (None)
- hard failure: **None**
- summary: None

## 5. Verified strengths

## 6. Suspected errors / hallucinations

## 7. Items requiring technician review

## 8. Build & runtime
- commit: `a3033b7f9607074493da92761904be4e86d9ceb2` · branch: feat/printsense-prod-recall-gate · version: 3.184.0
- judge model: None · run: 2026-07-21T05:58:11Z

## 9. Source URL
https://literature.rockwellautomation.com/idc/groups/literature/documents/wd/gi-wd005_-en-p.pdf