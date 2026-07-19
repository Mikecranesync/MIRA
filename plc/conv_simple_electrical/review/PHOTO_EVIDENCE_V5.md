# CV-101 — Full-Resolution Photo Findings (V5 input)

Source: the same 4 bench photos, but pulled as **full-resolution originals (3000×4000)** from the
user's Google Drive via the claude.ai connector (the Telegram copies were 768×1024 vision-resized).
Full-res + detail crops in `review/photos/` (`*_full.jpg` + `gs10_control_terminals.jpg`,
`mlc_top_terminals.jpg`, `mlc_bottom_terminals.jpg`). This sheet REFINES `PHOTO_EVIDENCE_V4.md` —
the V4 device corrections all hold; V5 sharpens the two "hybrid/what's-wired" open items with
terminal-level reads.

## Refined findings (what the full-res added over the 768px copies)

### GS10 control terminals — OI-22 substantially RESOLVED (`gs10_full.jpg` + `gs10_control_terminals.jpg`)
The GS10 has TWO green control connectors; the full-res crop reads them cleanly:
- **Top connector `FWD REV DI3 DI4 DI5 +24V +24V DCM DCM` — EMPTY / no conductors landed.** (verified)
  ⇒ run, direction, and digital-input control are **NOT hardwired**. The run/dir/speed **command
  path is Modbus** (consistent with P00.21=2 and the purple RJ45 RS-485 cable, both confirmed).
- **Bottom connector `+10V ACM AI AO1 DO1 DOC PE` — WIRED** (yellow-ferruled conductors enter from
  below; verified present, exact per-terminal map not fully traceable). Most plausible use given
  which terminals are populated: an **analog interface** — `+10V`/`AI`/`ACM` = an external speed
  reference (pot or 0-10 V), and/or `AO1`/`DO1`/`DOC` = analog/digital **feedback** to a PLC.
- **Net:** the drive is a **hybrid** — Modbus for command, plus analog/output I/O on the bottom row.
  This is more precise than V4's "which of FWD/REV/DI/AI/AO1/DO1 are landed": the **DI/run row is
  empty**; the **analog/output row is what's used**. → OI-22 narrowed to "identify the bottom-row
  analog/output terminals (`+10V/AI/ACM` speed ref? `AO1/DO1/DOC` feedback?) and confirm nothing on
  the top run/DI row."

### MLC control relay — OI-26 partially RESOLVED (`mlc_full.jpg` + `mlc_top/bottom_terminals.jpg`)
Schneider TeSys **CA3KN22BD** (confirmed again at full res; "2F2048 2" batch, "1,3 N·m Max"):
- **Coil A1(+)/A2(−) — both WIRED** (verified). Confirms O-02 → coil (and the panel photo shows the
  Micro820 **OUT-2 LED lit** = O-02 energized = coil on).
- **NO contacts 13-14 and 43-44 — conductors present** (in use as the interlock/enable contacts).
- **NC contacts 21-22 and 31-32 — no clear conductors** (appear unused).
- **Destinations still not traceable** — the contact wires disappear into the loom and **carry no
  visible number sleeves**. → OI-26 narrowed to "trace where 13-14 / 43-44 (NO) land."

### PS1 — E-004 device confirmed (`panel_full.jpg`)
Mean Well DIN supply, nameplate read cleanly: **24 V / 1.0 A** out, **100-240 VAC 0.55 A 50/60 Hz**
in, `+V / −V / DC-OK` top, `⏚ N L` bottom, `+V ADJ` pot, green DC-OK LED. (≈ Mean Well MDR-20-24
class; exact model number not printed on the visible face.) Verified device for E-004.

### DC distribution block — OI-25 (`dc_block_full.jpg`)
Push-in (WAGO-style) 2-level distribution block: a **bare-copper jumper** bridges the top-left
terminals, a **red** conductor feeds in top, **blue** and **white/gray** conductors distribute
(matches the caption "blue and white … positive and negative"). Which color = +24 V vs 0 V still
needs a meter (blue = 0 V by common convention, red/white = +24 V feed) → OI-25 stays FIELD VERIFY.

### Motor contactor — OI-21 (all 4 photos)
Still **none observed** — no 3-phase motor contactor (LC1D-class, T1/T2/T3 poles) appears in any of
the 4 photos. Consistent with V4's E-003 (CB1 → GS10 direct, no contactor). The GS10 line feed /
breaker is not in frame.

### Panel context — OI-23 / OI-24 (`panel_full.jpg`)
Confirmed at full res, still logged-not-wired: **Siemens CPU 1212C AC/DC/RLY** (S7-1200, with an
analog-input block) and a gray device labeled **"PMr"** with a **"192."** sticky (IP). Neither is
linked to CV-101 by any evidence; the Micro820 remains the conveyor controller (per the program).

## What the photos could NOT close (honesty)
No conductor in any photo carries a printed **wire number** — the bench wiring is ferruled but
un-numbered. So the proposed W-numbers stay **proposed**, and the per-terminal wire *destinations*
(GS10 bottom row, MLC NO contacts, DC-block polarity) remain **FIELD VERIFY / meter items**. The
full-res photos resolved **device identities and which terminals are used**, not the point-to-point
wire map.

## Net V5 changes
1. E-006/E-007 note: GS10 hybrid sharpened — **top run/DI connector EMPTY (Modbus command)**;
   **bottom analog/output connector WIRED** (speed-ref / feedback). RJ45 Modbus confirmed.
2. E-006: MLC — coil A1/A2 wired (confirmed); **NO contacts 13-14 & 43-44 in use, NC unused**;
   destinations FIELD VERIFY.
3. OI-22 and OI-26 narrowed (above). OI-21/23/24/25 unchanged (still open).
4. Evidence upgraded to full-resolution originals in `review/photos/`.
