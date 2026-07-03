# Excalidraw Electrical-Print Style Guide (model-first)

> The rule that produced this doc: **stop drawing the conveyor as a network graph.** A control print
> is not "a box for the PLC and a box for the VFD with lines between them." It is a set of
> title-blocked sheets, one circuit family each, drawn terminal-to-terminal, wire-numbered, and
> marked verified vs field-verify — something a technician can put meter leads on.
>
> Companions: `docs/reference/electrical_print_examples.md` (the visual target) and
> `docs/references/industrial-wiring-diagram-standards.md` (the standards pack).
> Reference implementation: `plc/conv_simple_electrical/` (model + `render_sheet.py` → **E-005**).

## 0. The one principle

**The wiring MODEL is the source of truth. Excalidraw (or any renderer) is only the drawing/review
layer.** Never hand-draw random lines and call it a print. The pipeline is:

```
structured model (YAML)  ->  sheet renderer  ->  Excalidraw scene / SVG / PDF  (review output)
```

If a conductor isn't in the model, it doesn't get drawn. If it's drawn, it traces back to a model row
with evidence. This is the same discipline as MIRA's ingest/KG rules: preserve source, don't invent,
mark confidence, flag for review.

## 1. The model (the five files — source of truth)

Under `plc/conv_simple_electrical/model/`:

| File | Holds | Key fields |
|---|---|---|
| `devices.yaml` | Device schedule | `tag, type, model, role, evidence` |
| `terminals.yaml` | Every landing point | `id, function, opc, healthy_state, status` |
| `wires.yaml` | Every conductor | `proposed_number, from, to, signal, type, status` |
| `sheets.yaml` | The print set (E-001..E-009) | `id, title, status, scope` |
| `open_items.yaml` | Everything unverified | `id, sheet, item, verify` |

`evidence` / `status` vocabulary: **`verified`** (traced to a cited repo artifact — program, tag
export, install doc) · **`field_verify`** (must be metered/confirmed on the bench) · **`proposed`**
(a suggested value, not yet confirmed).

## 2. Hard drawing rules

1. **No solid wire unless it exists in `wires.yaml`** with source terminal, destination terminal,
   signal name, voltage/type, and evidence status. A conductor not in the model may not be drawn.
2. **Unknown wiring is dashed and labeled `FIELD VERIFY`**, or it is omitted and listed in
   `open_items.yaml`. Never draw a guess as a confident solid line.
3. **`status: verified` → solid. Anything else → dashed** + a `FIELD VERIFY` marker. (In E-005 the
   PLC terminal↔function map is verified/solid; all field wiring is field-verify/dashed because the
   repo has no as-built wire list.)
4. **Color is NOT the primary meaning.** Wire numbers and terminal labels carry the meaning. Reserve
   red for the *unverified/FIELD-VERIFY* marker only. Do not encode signal type in color alone.
5. **Real terminal labels, never generic boxes.** `PLC1 I-02 / COM0`, `VFD1 SG+/SG-/SGND`,
   `VFD1 U/V/W`, coil `A1/A2` — not a box labelled "START".
6. **Device tags** are stable: `S0` (E-stop), `S2` (run PB), `SS1` (selector), `B1` (photo-eye),
   `PLC1`, `VFD1`, `M1`, `Q1`, `PS1`, `X1`.
7. **Every sheet has a title block** (drawing/sheet number, revision, date, drawn-by) **and a zone
   grid** (columns 1–8, rows A–D). See the E-005 renderer's title block + border.
8. **Two anti-spaghetti laws (print them on E-001):** (a) *same electrical node = same wire number; a
   number changes only through a device*; (b) *number wires by `[page][line]`* (e.g. `5003` = sheet
   E-005, line 3) so a wire tag alone tells you which sheet to open.

## 3. One sheet, one circuit family

Never one giant page. The set:

| Sheet | Circuit family |
|---|---|
| **E-001** | Cover / legend / device schedule / wire-number convention key |
| **E-002** | Power one-line (source → breaker → VFD → motor) |
| **E-003** | VFD power (GS10 `R/S/T` → `U/V/W`) |
| **E-004** | 24 VDC control power (PS1 → +24V/0V bus → fused branches) |
| **E-005** | PLC inputs (Micro820 `I-00..I-11` / `COM0`) — **drawn first** |
| **E-006** | PLC outputs (`O-00..O-06`) |
| **E-007** | RS-485 Modbus (PLC1 Ch2 `D+/D-/G` ↔ GS10 RJ45 `SG+/SG-/SGND`) |
| **E-008** | Terminal strip (X1) + wire list |
| **E-009** | Open items / field verification (generated from `open_items.yaml`) |

## 4. Reusable symbol templates (never hand-draw)

Build a template per symbol; instantiate from the model. Current renderer implements the input-sheet
subset; extend for the rest:

`plc_input_terminal_block` · `plc_output_terminal_block` · `vfd_block` (R/S/T, U/V/W, control, SG±) ·
`motor` · `circuit_breaker` · `24v_power_supply` · `terminal_block` · `pushbutton_no` ·
`estop_nc` / `estop_no` (dual channel) · `selector_contact` · `pilot_light` · `photo_eye` (3-wire) ·
`rs485_cable` · `earth_pe` · `source_destination_arrow` · `field_verify_dashed_connector` ·
`wire_number_tag` · `title_block` · `zone_grid`.

## 5. Excalidraw as the review layer (not the truth)

Excalidraw is fine for a human-readable mockup and for review markup — but it must never become the
source of truth. Two acceptable uses:
- **Render target:** generate an `.excalidraw` scene from the model so a person can open, review, and
  redline it (then fold changes back into the YAML, re-render — the YAML stays authoritative).
- **Review overlay:** annotate a rendered sheet during a design review.

Do **not** draw a print by dragging shapes in Excalidraw and treating that file as the record. If the
Excalidraw scene and the model disagree, the model wins and the scene is regenerated.

## 6. The E-005 acceptance test (applies to every sheet)

> A technician must be able to put meter leads on the terminals shown. If the drawing doesn't tell
> him where to put the leads, it is not a good electrical print.

E-005 must (and does) answer:
1. Where does **+24 VDC start**? → `PS1` (E-004), rail `W24`.
2. What **device contact** does it pass through? → `SS1` FWD/REV, `S0` E-stop NC/NO, `S2` Run, `B1` photo-eye.
3. What **wire number**? → `W200..W205` (proposed — no as-built list).
4. What **PLC terminal** does it land on? → `I-00..I-05` (verified names).
5. What **PLC tag/function**? → `dir_fwd`, `dir_rev`, e-stop NC/NO, run PB, photo-eye (+ OPC vars).
6. What **common/0V** completes the circuit? → `COM0` → `W0V` → 0V (E-004).
7. **Verified vs field-verify** clearly marked? → legend + dashed field wiring + red wire-number tags.

Worked meter check the sheet enables: *I-02 to COM0 should read ~24 VDC when the E-stop chain is
healthy; ohm S0 11-12 across the NC channel.*

## 7. Safety (non-negotiable)

Monitored e-stop **inputs** (I-02/I-03) are **not** a safety stop. A compliant install must also
**hardwire** the E-stop to remove drive power (NFPA 79 / EN 60204-1, stop category 0/1). Any sheet
touching the E-stop must carry that note. De-energize + LOTO before metering. Read-only — no PLC
writes implied by these drawings.

## 8. How to add / advance a sheet

1. Add/confirm rows in `devices.yaml` / `terminals.yaml` / `wires.yaml`, each with an `evidence`
   status and a cited source for anything `verified`.
2. Put every unknown in `open_items.yaml` (don't fake it on the drawing).
3. Extend `render_sheet.py` with the sheet's symbol templates; render to `sheets/<id>.pdf`.
4. Set the sheet `status: drafted` in `sheets.yaml`.
5. Review the PDF against the matching example in `electrical_print_examples.md`.

## 9. Cross-references

- `docs/reference/electrical_print_examples.md` — the real-print visual target (per-sheet emulation map).
- `docs/references/industrial-wiring-diagram-standards.md` — NFPA 79 / UL 508A / NEMA / IEC / ISA standards pack + MIRA extraction model.
- `plc/conv_simple_electrical/` — the model + renderer + E-005 sheet.
- `plc/GS10_Integration_Guide.md` — verified GS10 terminals, RS-485 pinout, register map (feeds E-003/E-007).
- `plc/Prog_init_ConvSimple_v2.1.st`, `plc/ccw/controller/Controller/LogicalValues.csv`, Ignition `MIRA_IOCheck/Inputs/tags.json` — the verified I/O evidence behind E-005.
