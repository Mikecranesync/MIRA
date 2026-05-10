# MIRA Conveyor — Phase 1 Simple Ladder Reference

**Source:** `specs/phase1_conveyor.iecst`
**Target:** Allen-Bradley Micro820 2080-LC20-20QBB
**Program name:** `Phase1_LD` (new Ladder Diagram program in CCW)

This is the stripped-down starting point — 9 rungs, no state machine, no Modbus poll loop. Add sections from `Prog2_ladder.md` once this runs correctly.

---

## Notation legend

| ASCII | Meaning | CCW LD element |
|---|---|---|
| `--[ A ]--` | NO contact (XIC) | Direct Contact |
| `--[/ A ]--` | NC contact (XIO) | Reverse Contact |
| `--( A )--` | output coil (OTE) | Direct Coil |
| `[MOV s d]` | move source → dest | MOV instruction |
| `[TON: name PT=T#500ms]` | on-delay timer | TON function block |

**Variable naming:** `DI_00`=`_IO_EM_DI_00`, `DI_01`=`_IO_EM_DI_01`, `DI_02`=`_IO_EM_DI_02`, `DO_02`=`_IO_EM_DO_02`. Use the full `_IO_EM_*` name when clicking the contact in CCW.

---

## Global variables to declare

Open **Controller → Global Variables → Add** for each:

| Name | Type |
|---|---|
| `e_stop_active` | `BOOL` |
| `dir_fwd` | `BOOL` |
| `dir_rev` | `BOOL` |
| `poll_timer` | `TON` |
| `vfd_cmd` | `INT` |
| `vfd_freq` | `INT` |

Physical I/O (`_IO_EM_DI_xx` / `_IO_EM_DO_xx`) is auto-declared — do not add those manually.

---

## Section 1 — E-stop

### Rung 1.1 — e_stop_active

DI_02 is NC wired (healthy = TRUE). Open contact = tripped.

```
-------[/ DI_02 ]-------( e_stop_active )----
```

---

## Section 2 — Safety contactor

### Rung 2.1 — Safety contactor Q1 (DO_02)

Energize contactor only when e-stop is healthy.

```
-------[/ e_stop_active ]-------( DO_02 )----
```

---

## Section 3 — Direction decode

### Rung 3.1 — dir_fwd

```
-------[ DI_00 ]----[/ DI_01 ]-------( dir_fwd )----
```

### Rung 3.2 — dir_rev

```
-------[/ DI_00 ]---[ DI_01 ]-------( dir_rev )----
```

---

## Section 4 — VFD command word

Three rungs implement the IF/ELSIF/ELSE chain. Later rungs can overwrite earlier ones; run order matters.

### Rung 4.1 — Default STOP (1)

Unconditional — always writes 1 unless overridden below.

```
-------[MOV 1 vfd_cmd]---
```

### Rung 4.2 — FWD+RUN (18) when forward selected and e-stop healthy

```
-------[ dir_fwd ]----[/ e_stop_active ]------[MOV 18 vfd_cmd]---
```

### Rung 4.3 — REV+RUN (20) when reverse selected and e-stop healthy

```
-------[ dir_rev ]----[/ e_stop_active ]------[MOV 20 vfd_cmd]---
```

---

## Section 5 — Fixed frequency

### Rung 5.1 — Load 300 (= 30.0 Hz in Modbus units) into vfd_freq

```
-------[MOV 300 vfd_freq]---
```

---

## Section 6 — Poll timer

### Rung 6.1 — 500ms repeating pulse

```
-------[/ poll_timer.Q ]------[FB: poll_timer]---
```

- Type: `TON`
- IN = (rung condition above — wire to the `IN` pin, not `EN`)
- PT = `T#500ms`

`poll_timer.Q` goes TRUE for one scan every 500 ms. Gate your Modbus write triggers off this contact when you add that section later.

---

## Build and download

1. **Ctrl+S** → save
2. **Build → Build Project** (Ctrl+B) — resolve any errors before continuing
3. **Controller → Connect** → select Micro820 at `192.168.1.100`
4. **Controller → Download to Controller** → accept Program mode warning
5. Set mode to **Run** — confirm `dir_fwd` / `dir_rev` highlight correctly when you toggle the selector

---

## PDF instructions

**Option A — VS Code (fastest):**
1. Open `phase1_ladder.md` in VS Code
2. Press `Ctrl+Shift+V` to open Markdown Preview
3. Right-click the preview pane → **Open in Browser**
4. In the browser press `Ctrl+P` → set destination to **Save as PDF** → Save

**Option B — browser only:**
Drag `phase1_ladder.md` onto a browser tab that has a Markdown viewer extension installed, then `Ctrl+P` → Save as PDF.

**Option C — command line (if you have pandoc):**
```
pandoc specs\phase1_ladder.md -o specs\phase1_ladder.pdf
```
