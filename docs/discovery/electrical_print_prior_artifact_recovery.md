# Electrical Print — Prior Artifact Recovery

**Date:** 2026-07-03 · **Trigger:** "Do not draw another new electrical print until you recover the
prior Modbus wiring work." The RS-485 / Modbus wiring was already solved in May 2026; this note
recovers it and makes the old work the style model for the new print package.

---

## 1. Files found

The prior work lives in a **separate CCW project** (not the MIRA repo):
`C:\Users\hharp\Documents\CCW\MIRA_PLC\` (with `.claude/worktrees/*` branch copies — ignore those).

Key artifacts in `CCW/MIRA_PLC/docs/instructions/`:

| File | Date | What it is |
|---|---|---|
| **`Conv_Simple_CommsToVFD.pdf` / `.html`** | May 16 | **THE RS-485 wiring instruction** — the style model (p2/§2 "Wire the RS-485 link"). |
| **`MIRA_PLC_WorkInstruction_v3.pdf`** | May 22 | Work instruction **MIRA-WI-001 Rev A** (issue 2026-05-21), 30 pp, 78 vars. ("MIRA-WI-PHA-001" = this WI, Phase-A scope.) RS-485 on p11/p30. |
| **`Conv_Simple_GS10_Beginner_Verify_V2.pdf`** | May 22 | 56-pp verify guide. **p48 pre-download checklist carries the CORRECTED pinout + Channel 2.** |
| `Conv_Simple_ControlsToVFD.pdf` | May 16 | The *control* (FWD/REV/command) counterpart — **not** for the comms sheet. |
| `Conv_Simple_Prog_VFD_GlobalVars.md` | May 16 | Global variable list (`vfd_comm_ok`, `vfd_frequency`, etc.). |
| `Conv_Simple_Prog_VFD_PhaseA.st` / `…PhaseA_V1.5.st` (May 26) | May 16/26 | Phase-A Modbus-comms ST. V1.5 (May 26) is the corrected build. |
| `Conv_Simple_Prog_VFD_PhaseB_V1.2 … V1.4.st` | May 16-22 | Phase-B control ST. |
| `docs/vfd/GS10_UM.txt`, `gs10usermanual (1).pdf` | — | GS10 user manual (pin/param authority). |

Cross-repo corroboration already in the MIRA repo: `plc/GS10_Integration_Guide.md` (§3 RS-485 pinout,
register map), `plc/Prog_init_ConvSimple_v2.1.st` (**Channel 2**, bench-proven 2026-05-26),
`plc/ccw/controller/Controller/LogicalValues.csv`.

Note the exact names in the request (`MIRA_PLC_PhaseA_SmokeTest.pdf`, `MIRA_PLC_SwapToPLCModbus.pdf`,
`MIRA_PLC_Micro820_AnnotatedReference.pdf`) do **not** exist as files — they are descriptive titles;
the real artifacts are the WI + the two Conv_Simple instruction PDFs above.

---

## 2. The exact old drawing/page that demonstrates the right style

**`Conv_Simple_CommsToVFD.pdf`, §2 "Wire the RS-485 link (PLC Channel 0 → GS10)" (page 3).**
Secondary: **`Conv_Simple_GS10_Beginner_Verify_V2.pdf` p48** ("Pre-download verification") for the
corrected pin/channel facts. This is the visual + content target for **E-007** — NOT the recent
"Conv_Simple Workbench" device-map drawing.

---

## 3. What that old drawing did correctly

- **Narrow circuit scope** — one job: wire the RS-485 link. No power, no control, no I/O.
- **Technician-readable title/section bar** + a "**Why this step**" box (differential pair + common reference).
- **Device-to-device wiring** with a **terminal table**: `PLC terminal | Label | Wire | GS10 terminal`.
- **Real terminal labels** — `D+ (A)`, `D− (B)`, `SG`; GS10 `SG+`, `SG−`, `SGND`.
- **Wire labels + color + cable type** — "White of pair", "Black of pair", "Third conductor",
  "Tinned drain"; **Belden 3105A** 22 AWG twisted shielded pair.
- **Pin mapping** — GS10 RJ45: pin 5 = SG+, pin 4 = SG−, SGND pin (verify).
- **Shield handling** — land the drain **at the PLC end only**, tape/float the GS10 end.
- **Troubleshooting tied to the circuit** — the "A/B polarity gotcha" box: vendors disagree on
  polarity → **swap the two signal wires first**; **CRC errors = polarity, silence = baud**.
- **No fake completeness** — "Verify against the GS10 User Manual (section 5) before you crimp."

The **p48 checklist** adds the same discipline as tick-boxes and, crucially, the **corrected**
hardware facts (see §6).

---

## 4. Why the new Excalidraw output regressed

The recent `conv_simple_wiring_diagram.pdf` ("Conv_Simple Workbench — Control Wiring") threw away
work that already existed:

- **One giant page** mixing power + VFD + 24 V + comms + safety instead of one circuit per sheet.
- **Device-map / spaghetti** — boxes with colored lines between them; meaning carried by color, not by
  wire numbers/terminals.
- **No connection table** under the drawing.
- **No cable type, no wire colors, no pin mapping, no shield handling** — the RS-485 link was a single
  gray line to a "GS10 RS-485" stub; none of the Belden/pin-5/pin-4/pin-3/drain detail that the May
  drawing already had.
- **No troubleshooting tied to the circuit.**
- It reinvented the RS-485 link from scratch (and less completely) instead of recovering the solved
  `CommsToVFD` page. Even the improved model-first **E-005** lacked the *connection-table + cable/pin/
  shield* rigor that the old RS-485 page nailed.

Root cause: I treated the drawing as the deliverable and did not first search for prior art.

---

## 5. Which patterns must be copied into the new print package

1. **The connection table** under every wiring sheet:
   `Source device | Source terminal | Destination device | Destination terminal/pin | Cable/conductor | Wire label | Evidence status | Notes`.
2. **Cable type + wire colors** (Belden 3105A; white=+/inverting side, black=−, third=SGND, drain=shield).
3. **Pin mapping** for connectorized devices (GS10 RJ45 pin 5/4/3).
4. **Shield handling** stated explicitly (one end only).
5. **A "Why this step" / purpose line** and **troubleshooting notes tied to the circuit**.
6. **Narrow scope — one circuit family per sheet.**
7. **Title block with document ID + revision + date + author** (the WI carries `MIRA-WI-001 Rev A`).
8. **"Verify against the manual" honesty** — mark unconfirmed items, never fake completeness.
9. Fold these into the **model-first** pipeline (`plc/conv_simple_electrical/`) so the table and the
   drawing are generated from the same YAML and cannot disagree.

---

## 6. What must NOT be copied (superseded / wrong)

- ❌ **"Channel 0."** The May-16 `CommsToVFD` page labels the PLC port "Channel 0." **Superseded:** the
  embedded RS-485 serial port is **MSG_MODBUS Channel 2**, bench-proven 2026-05-26 and baked into
  `Prog_init_ConvSimple_v2.1.st` and the May-22 `Beginner_Verify` p48 checklist ("Channel 2"). Use
  Channel 2; note Channel 0 as the corrected-away value. (Repo memory: `feedback_micro820_channel0`.)
- ❌ **"SGND = pin 1 or 8."** That was the May-16 *unverified hedge*. The May-22 verification resolved
  it: **SGND lands at GS10 RJ45 pin 3.** Use pin 3.
- ❌ **8N2 (P09.04=13).** The older `GS10_Integration_Guide.md` says 8N2; the bench-verified config
  (p48 + v2.1 comment) is **8N1 (P09.04=12)**. Use 8N1.
- ❌ **Any FWD / REV / VI / ACM / FA control wiring on the comms sheet.** Those belong on the VFD
  control sheet (`ControlsToVFD` → future E-006/E-003), **not** E-007. E-007 is Modbus-only.
- ❌ **The 30-/56-page mega-document format** as a single artifact — keep one circuit family per sheet.
- ❌ **The device-map "workbench" drawing** as any kind of target.

---

## 7. Updated implementation plan

1. **E-007 rebuilt first** (this pass) in the recovered `CommsToVFD` style, Modbus-only, in the
   model-first package `plc/conv_simple_electrical/` — model at `model/e007_rs485.yaml`, rendered by
   `render_sheet.py E-007` → `sheets/E-007_rs485_modbus.pdf`. Values reconciled to the **corrected**
   facts (Channel 2, pin 5/4/3, 8N1, Belden 3105A, shield at PLC end, 120 Ω at GS10). Because the
   wiring IS documented, most rows are **verified** (cite `CommsToVFD` + `Beginner_Verify` p48 +
   `Prog_init_ConvSimple_v2.1.st`); only the exact PLC chassis ground point + cable P/N are field-verify.
2. **Backfill the other sheets from recovered art, not from scratch:** E-003 VFD power + E-006 outputs
   from `ControlsToVFD`; E-002 one-line; E-004 24 VDC; E-005 already drafted; E-008 terminal strip;
   E-001 cover (carry a `MIRA-WI-…`-style doc block); E-009 open items.
3. **Every wiring sheet gets the connection table** (pattern §5.1) generated from the model.
4. **Reconcile the two style inputs:** the vendor-doc readability (this recovery) + the standards pack
   (`docs/references/industrial-wiring-diagram-standards.md`) + the model-first rule
   (`docs/reference/excalidraw_electrical_print_style.md`).
5. **Do not** produce another giant page; one good sheet at a time; verify prior art first.

---

## Cross-references
- `plc/conv_simple_electrical/` — model-first print package (E-005 drafted, E-007 this pass).
- `docs/reference/electrical_print_examples.md` — external real-print visual targets.
- `docs/reference/excalidraw_electrical_print_style.md` — model-first style rules.
- `CCW/MIRA_PLC/docs/instructions/Conv_Simple_CommsToVFD.pdf` — the recovered RS-485 style model.
- `CCW/MIRA_PLC/docs/instructions/Conv_Simple_GS10_Beginner_Verify_V2.pdf` p48 — corrected pin/channel facts.
- `plc/GS10_Integration_Guide.md`, `plc/Prog_init_ConvSimple_v2.1.st` — in-repo corroboration (Channel 2, register map).
