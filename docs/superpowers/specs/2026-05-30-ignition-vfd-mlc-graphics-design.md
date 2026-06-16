# Ignition VFD + MLC mimic graphics — design

**Date:** 2026-05-30
**Status:** Approved (design); pending implementation plan
**Target:** `plc/ignition-project/ConvSimpleLive` Perspective view on the laptop gateway (`localhost:8088`)
**Reference (proven):** `plc/edge-stack/web/panel.html` — live at `http://100.68.120.99:8080/panel.html`

## What this accomplishes (plain English)

The Ignition operator view (`ConvSimpleLive`) today shows only the PMC STATION
pilot lamps (5 lamps, START PB, selector, E-STOP). It does **not** show the drive
or the motor contactor. This work adds the two machine graphics that are already
proven in the web `panel.html`:

1. A live **GS10 VFD drive readout** — frequency, current, DC-bus voltage,
   run/stop state, and the active command.
2. An **MLC1 main-line-contactor schematic** — a 3-pole symbol that shows
   closed/energized vs open/de-energized.

Both are **rebuilt natively in Perspective** (styled coordinate-container labels
and shapes), exactly the way the existing PMC lamps are built — so every element
is bindable via `expr` and the view stays internally consistent. The web
`panel.html` is the visual reference, not an embedded asset.

## Scope

In scope:
- Extend the `ConvSimpleLive` Perspective view with a VFD card and an MLC card.
- Add the VFD analog OPC tags the cards depend on.
- Deploy to the laptop gateway and verify against live PLC data.

Out of scope (separate tracked items):
- Maker license / trial reset (the view will not *render* without it, but that is
  its own task).
- Panel-as-default landing view.
- Auto-starting the MQTT publisher.
- Any write/control path — these graphics are **read-only**.

## Data sources and scaling

The VFD globals on the Micro 820 are **raw scaled WORD integers**, confirmed in
`Conv_Simple_1.5/.../Prog_init.stf` and `MbSrvConf.xml`:

| Global         | Meaning              | Raw scale   | Display expression          |
|----------------|----------------------|-------------|-----------------------------|
| `vfd_frequency`| output frequency     | Hz × 100    | `raw / 100.0` → "xx.x Hz"   |
| `vfd_current`  | output current       | A × 100     | `raw / 100.0` → "x.x A"     |
| `vfd_dc_bus`   | DC-bus voltage       | V × 10      | `raw / 10.0` → "xxx Vdc"    |
| `vfd_cmd_word` | GS10 command echo    | code        | 1→STOP, 18→FWD·RUN, 20→REV·RUN, else raw |
| `vfd_voltage`  | output volts (V × 10)| V × 10      | *not displayed (kept lean)* |

**Scaling lives in the Perspective binding**, not in the tag — the tag stores the
raw WORD, mirroring how `panel.html`'s publisher scales on the way out. This keeps
one source of truth for the raw value and makes the binding self-documenting.

The MLC contactor is the existing boolean `DO_02`.

### Tag-source checkpoint (must verify on the live gateway)

The existing view binds to Ignition tags under `[default]MIRA_IOCheck/…`. The DI/DO
tags are OPC-bound, but the **VFD analog tags do not exist yet**. During
implementation, verify on the running gateway **which driver exposes the VFD
globals**:

- **Micro800 CIP driver** (`[MIRA_PLC]`, by variable name) — preferred if the
  globals browse in the OPC browser as `vfd_frequency`, etc.
- **Modbus TCP driver** (by holding-register address, e.g. HR 107/108/110/115) —
  fallback if CIP does not expose them.

Create the tags accordingly. Either way the tag holds the **raw WORD** (Int/Word
datatype, read-only); the view binding applies the scale.

## View changes

### Layout
- Grow `ConvSimpleLive` `defaultSize` from `960×600` to `960×880`.
- Existing PMC panel (ends ~y=565) is unchanged.
- Add a "machine row" starting ~y=590: two dark cards side by side
  (`#161b22` fill, `1px solid #30363d`, `borderRadius 14px`), mirroring
  panel.html's `.machine` row.

### GS10 VFD card (left, native labels)
- Card title "GS10 VFD".
- Dark drive bezel (solid `#1b1f24` approximating the gradient).
- **Frequency** — large red monospace label (`#ff3b30`), bound to
  `vfd_frequency/100` formatted to 1 decimal, with a small "Hz" suffix label.
- **Subline** — `vfd_current/100` A · `vfd_dc_bus/10` Vdc bus.
- **RUN LED** — green-glow when running (`vfd_frequency/100 > 0.1` OR
  `vfd_cmd_word` ∈ {18,20}); **STOP LED** static.
- **CMD label** — decoded `vfd_cmd_word` text.

### MLC1 contactor card (right, native shapes)
- Card title "MLC1 — Main Line Contactor".
- 3-pole symbol from styled labels: top terminals L1/L2/L3, bottom T1/T2/T3,
  three vertical pole bars, a coil dot.
- **State bound to `DO_02`:**
  - Pole bars `#1a9e44` (green, closed) when true, `#8a8f95` (gray, open) when false.
  - Coil dot green (`#3fb950`) when energized, `#555` when not.
  - State label "CLOSED · ENERGIZED" (green) vs "OPEN · DE-ENERGIZED" (gray).
- Card labeled **MLC1** (user decision 2026-05-30), even though the underlying
  Ignition tag currently documents `DO_02` as "SAFETY CONTACTOR Q1" — same
  physical coil, MLC1 is the operator-facing name.

## Components and isolation

Each unit is independently understandable and testable:
- **VFD card** — depends only on the four VFD tags; renders drive state. Can be
  verified by reading the four values and comparing to panel.html.
- **MLC card** — depends only on `DO_02`; renders contactor state. Verified by
  toggling `DO_02` and watching closed/open.
- **VFD tags** — depend only on the gateway driver; hold raw WORDs. Verified in the
  OPC/tag browser independent of the view.

The view resource is a single JSON file; the cards are sibling children of the
root coordinate container, so neither affects the existing PMC panel children.

## Deployment

1. Edit `plc/ignition-project/ConvSimpleLive/com.inductiveautomation.perspective/views/ConvSimpleLive/view.json` (add cards, grow `defaultSize`).
2. Add the VFD tags to the gateway tag config (config-as-files or Designer OPC
   browse), under a `…/VFD/` folder.
3. Run `install.ps1` (elevated copy into the gateway projects dir) — requires the
   user to accept the UAC prompt.
4. Restart the Ignition service (`Restart-Service Ignition -Force`, user action —
   disruptive-to-shared-infra) so the gateway reloads the project.
5. Ensure the Perspective trial is reset or a Maker license is applied, else the
   session will not render (separate item).

## Verification

With the PLC live and the publisher/gateway reading tags:
- DC bus reads ~327 V at idle (known-good baseline).
- Frequency/current read plausible scaled values (0.0 Hz / 0.0 A at idle).
- `DO_02` toggle flips the MLC card closed↔open and the coil dot.
- If a manual jog is available, RUN LED lights and CMD shows FWD·RUN / REV·RUN.
- Eyeball the Ignition card side-by-side with the live `panel.html` for parity.

## Risks / known friction

- **UAC / elevation** — copying into the gateway projects dir has previously
  required accepting a UAC prompt; non-elevated overwrite is permission-denied.
- **No hot-load** — the gateway will not pick up the changed project without a
  restart.
- **Trial expiry** — Perspective sessions stop rendering every 2h on trial; needs
  Maker license for permanence (separate item).
- **Tag-source ambiguity** — must confirm CIP-vs-Modbus exposure of VFD globals on
  the live gateway before binding (see checkpoint above).
