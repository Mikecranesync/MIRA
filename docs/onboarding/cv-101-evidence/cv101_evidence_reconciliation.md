# CV-101 Evidence Reconciliation

**Date:** 2026-07-02 · **Scope:** read-only analysis. Reconciles the CITED bench-photo evidence
(`docs/onboarding/cv-101-evidence/wiring_evidence.md`) against the APPROVED context model
(`plc/conv_simple_anomaly/context_model.cv101.json`) and rule config
(`plc/conv_simple_anomaly/config.yaml` + `rules_core.py`).

**Rule of this document:** nothing is invented. Where the evidence file says UNKNOWN, it stays
UNKNOWN. Recommended edits are **proposals only** — none are applied here.

> **⚠️ UPDATE 2026-07-02 (GS10 nameplate photo …150) — supersedes the FLA recommendation below.**
> The drive is **GS11N-20P2: 0.25 HP, 1-phase 200-240 V in, 3-PH 0-230 V out, max 1.8 A (VT) / 1.6 A (CT)**.
> The motor is 1 HP / FLA 3.8 A — so the **drive is undersized** and can never source 3.8 A. The A8
> overcurrent reference should therefore be the **drive ceiling (~1.8 A)**, NOT the motor FLA (3.8 A), and
> not the 5.0 placeholder. Also: **supply is now confirmed 1-phase 230 V** (was UNKNOWN), matching the
> ~320 V DC-bus baseline. The "set `motor_fla_a` to 3.8 A" line in §2 below is thus too high for this
> VFD-fed bench — treat ~1.8 A (drive limit) as the effective overcurrent ceiling. Full detail: the KEY
> FINDING block in `wiring_evidence.md`.

Sources reconciled:
- `docs/onboarding/cv-101-evidence/wiring_evidence.md` — bench photos (authoritative for the physical bench)
- `plc/conv_simple_anomaly/context_model.cv101.json` — approved context model
- `plc/conv_simple_anomaly/config.yaml` + `plc/conv_simple_anomaly/rules_core.py` — A0–A12 rules + thresholds
- `plc/GS10_Integration_Guide.md` — GS10 reference

---

## 1. Confirmations (physical evidence MATCHES approved context)

| Approved context claim | Photo evidence | Verdict |
|---|---|---|
| PLC = Allen-Bradley Micro820 `2080-LC20-20QBB` (`context_model…json` `plc.model`) | Nameplate catalog `2080-LC20-20QBB` SER C (`wiring_evidence.md` …142) | ✅ **Confirmed** — exact catalog match |
| PLC Modbus host `192.168.1.100` (`plc.modbus.host`) | Sticky-note IP `192.168.1.100` (…142/…144) | ✅ **Confirmed** |
| Drive = AutomationDirect GS10 DURApulse (`drive.make`/`drive.model`) | Front cover branding "DURApulse GS10" (…151/…152) | ✅ **Confirmed** family; exact model still UNKNOWN (nameplate not photographed) |
| "GS10 telemetry mirrored into Micro820 HRs … read through the PLC over Modbus TCP; GS10 RS-485 link not directly reached" (`drive.note`) | PLC RS-485 D+/D-/G wired (blue/white/green, …145) → GS10 RJ45 with purple cable (…152) | ✅ **Confirmed** — the physical PLC↔GS10 RS-485 (Modbus RTU) link exists; MIRA reads it via the PLC |
| GS10 commanded over RS-485 (implied by `vfd_cmd_word` decode + `run_cmd_values`) | GS10 hardwired FWD/REV likely unused; consistent with P00.21=2 "RS-485 command source" (`GS10_Integration_Guide.md` §1) | ✅ **Consistent** (drive is serially commanded; hardwired DI unread) |
| Micro820 is Modbus **master**, GS10 is slave node 1 | Guide §4 (PLC serial = Modbus Master) + §1 (P09.00=1) | ✅ **Consistent** with the D+/D-/G 2-wire link |

**Corroborating (not a direct nameplate read, but internally consistent):** the approved model's
idle DC-bus baseline is `320.0 V ±0.8` (`vfd_dc_bus.nominal`, bench-measured). A ~320 V idle bus is
what a **230 V**-fed GS10 produces (√2 × 230 ≈ 325 V), **not** a 460 V drive (~650 V bus). This is
consistent with the motor nameplate being used on its **230 V** tap — see §2 discrepancy #1. Treat
as supporting inference, **not** a confirmed input-voltage reading (the GS10 R/S/T power terminals
are covered by the caution label — UNKNOWN, `wiring_evidence.md` line 125).

---

## 2. Discrepancies

### Discrepancy 1 — Motor FLA: nameplate **3.8 A @ 230 V** vs config placeholder `motor_fla_a: 5.0`  · **Severity: HIGH**

**Evidence.** Motor nameplate (`wiring_evidence.md` …153): 1 HP, **230/460 V** dual-voltage 3-phase,
**FLA 3.8 A @ 230 V / 1.9 A @ 460 V**, 1725 RPM. `config.yaml` line 3 sets `motor_fla_a: 5.0` and
labels it a starred value to be "set from the nameplate"; `rules_core.py` `DEFAULT_CFG` carries the
same `5.0` placeholder (line 62).

**Impact on the A8 overcurrent rule.** `r_a8_overcurrent` (`rules_core.py` lines 192–199) fires when
`vfd_current > motor_fla_a`, comparing the drive output current (signal `vfd_current`, HR 107 scaled
÷100 → Amps) **directly** against `motor_fla_a`. With the placeholder `5.0`:
- The motor's true full-load current is **3.8 A** (at 230 V). A threshold of 5.0 A is **~132 % of FLA**,
  so A8 will **not** flag a genuine sustained overload/jam until the motor is already ~32 % over
  nameplate. The rule is meant to be an early "output over motor FLA" precursor to the GS10 `oL`
  overload trip (which is 150 %/1 min per the rule message + config `torque_hi_pct`) — at 5.0 A it
  mostly overlaps `oL` instead of leading it. **The rule under-protects / misses early overload.**

**What it should be — and the 230 V vs 460 V dependence.** The correct threshold is the motor FLA at
the voltage the motor is actually wired for:
- If the motor is on its **230 V** tap → `motor_fla_a: 3.8`.
- If on its **460 V** tap → `motor_fla_a: 1.9`.

The dual-voltage nameplate does **not** tell us which tap is in use, and the GS10 R/S/T power
terminals are UNKNOWN (covered). The DC-bus corroboration in §1 **points to 230 V** (~320 V idle bus),
so **3.8 A is the most-likely-correct value** — but the wiring-voltage confirmation is still owed
(pending the GS10 nameplate + power-terminal photos listed in `wiring_evidence.md` "Still needed").
**Recommend 3.8 A once 230 V is confirmed; do not set 1.9 A unless the 460 V tap is proven.**

> Note: A8 compares to the **motor** FLA, but the GS10's own `oL` protection uses the **drive/motor
> parameter** P05.01 (`GS10_Integration_Guide.md` §1). For the drive's internal trip to match reality,
> P05.01 should also be set to the nameplate FLA on the keypad — that's a bench commissioning action,
> out of scope for this doc, flagged for completeness.

---

### Discrepancy 2 — PLC firmware: nameplate **FW 12.011** vs context model CIP rev **14.11**  · **Severity: LOW (informational)**

**Evidence.** Nameplate reads **FW 12.011** (`wiring_evidence.md` …142, line 19). The context model's
`plc.evidence.source_name` records "CIP List Identity 2026-06-30 … rev 14.11" (`context_model…json`
line 29).

**Assessment.** The nameplate records the **as-manufactured** firmware (unit made 2023-03-18,
Singapore); the CIP List Identity reports the firmware **currently running**. A field firmware update
(12.011 → 14.11) fully explains the difference — this is the expected direction and the
`wiring_evidence.md` cross-ref already reads it as "likely field-updated firmware." **Not a data
error.** No functional impact on the signal map or the rules (firmware rev is metadata, not a signal).

**Fix.** Cosmetic only: annotate the context model so the two numbers don't read as a contradiction —
record the nameplate ship firmware alongside the live CIP rev. See §4 edit E-2. **Do not** change the
CIP-read rev — the running firmware is the operationally correct value.

---

### Discrepancy 3 — Two different MAC addresses: nameplate `…D9:75:DC` vs front label `…E4:D7`  · **Severity: MEDIUM (unresolved — one PLC or two?)**

**Evidence.** Nameplate MAC `5C:88:16:D9:75:DC` (✅ clean read, …142). A **second** MAC on the front
label reads `5C:88:16:D?:E4:D7` — partly hidden by a wire, and it **differs** from the nameplate
(`wiring_evidence.md` line 21, marked ⚠️). Same OUI prefix `5C:88:16` (Rockwell/AB), different device
portion.

**Assessment — genuinely ambiguous, do not resolve by guessing.** Two readings are possible and the
evidence cannot currently distinguish them:
1. **One PLC, misread.** The front-label MAC is partly obscured by a wire; the visible digits may be a
   misread of the same address. (A single 2080-LC20-20QBB has one MAC.)
2. **Two Micro820 units on the bench.** The garage bench has an open one-vs-two-PLC question already
   (`wiring_evidence.md` "Still needed", line 134). If a second unit exists, the context model — which
   assumes a single PLC at `192.168.1.100` — would be under-describing the bench.

**Impact.** If there are two PLCs, the Modbus host/IP mapping and "which PLC owns CV-101" could be
ambiguous; the current model silently assumes one. Low run-time risk today (only `192.168.1.100` is
referenced), but it undermines the "each mapping traced to evidence" guarantee.

**What to verify (from `wiring_evidence.md` line 134):** a clean, unobstructed shot of the front-label
MAC (`…E4:D7`), and confirmation of how many Micro820 units are physically present + their IPs. Until
then, keep this **OPEN / UNKNOWN** in the model — do not assert "one PLC" as fact.

---

## 3. Physical → logical mapping (two DIFFERENT layers)

**The core point:** the panel labels give **physical PLC input terminals** (I-00…I-06 on the embedded
input block). The approved context model lists **internal Modbus coil addresses** (`C@0`, `C@3`, `C@5`,
`C@9`). **These are not the same address space.** The Micro820 **ladder logic** maps physical DI
terminals → internal booleans → the Modbus coil table that Litmus/MIRA reads over TCP. A physical
terminal number (I-04) is **not** a coil offset, and no photo establishes the ladder mapping between
them.

### Layer A — Physical DI terminals (confirmed from panel + input-block photos)

| Physical terminal | Panel-label function | Confirmed? | Src |
|---|---|---|---|
| I-00 (DI:0) | **FWD** (selector) | ✅ label-confirmed | …142 + …146 |
| I-01 (DI:1) | **REV** (selector) | ✅ label-confirmed | …142 + …146 |
| I-04 (DI:4) | **START** (NO pushbutton) | ✅ label-confirmed | …142 + …146 |
| I-02 (DI:2) | wired, function **NOT label-confirmed** — ⚠️ *likely* E-stop ch.1 | ❌ not confirmed | …146 |
| I-03 (DI:3) | wired, function **NOT label-confirmed** — ⚠️ *likely* E-stop ch.2 | ❌ not confirmed | …146 |
| I-05 (DI:5) | wired, function **NOT label-confirmed** — ⚠️ *likely* photo-eye | ❌ not confirmed | …146 |
| I-06 (DI:6) | spare (unwired) | ✅ (unwired) | …146 |

### Layer B — Modbus signals the context model actually maps (read over TCP)

| Signal (`context_model…json`) | Coil | rules_core topic | Reads which physical layer? |
|---|---|---|---|
| `motor_running` | C@0 (FC1) | `motor/m101/running` | Derived ladder output (motor run state), not a raw DI |
| `vfd_comm_ok` | C@3 (FC1) | `vfd/vfd101/comm_ok` | Derived (RS-485 link health), not a DI |
| `e_stop_active` | C@5 (FC1) | `safety/estop` | Derived e-stop state (ladder-combined), not a raw DI terminal |
| `estop_wiring_fault` | C@9 (FC1) | `safety/wiring` | Derived dual-channel disagreement flag |

**What is CONFIRMED:**
- The **physical** identity of I-00=FWD, I-01=REV, I-04=START (panel labels, three sources).
- The **existence** of the Modbus coil signals `motor_running`/`vfd_comm_ok`/`e_stop_active`/
  `estop_wiring_fault` in the live sparse map (approved, `plc_register_map` evidence, 0 Modbus
  exceptions per the approval note).

**What is NOT confirmed (the ladder bridge between the layers):**
- Whether the **E-stop** is physically on **I-02 / I-03** — `wiring_evidence.md` calls this "likely"
  but **not label-confirmed** (lines 93–94, 133). So the chain "I-02/I-03 (raw dual-channel DI) →
  `safety/estop` C@5 + `safety/wiring` C@9" is **inferred, not proven**.
- Whether the **photo-eye** is on **I-05** — again "likely" but **not label-confirmed** (line 97, 133).
  The context model already lists `photo_eye` as `approval_status: "proposed"` and its signal
  `safety/pe_latched` as **unmapped** (`context_model…json` `unmapped[0]`) — this is **consistent**
  with the evidence: MIRA must not assert/rule out a photo-eye jam (A12) from data.
- The **rules_core.py** raw-DI topics `plc/di/di02_estop_nc`, `plc/di/di03_estop_no`,
  `plc/di/di05_photoeye` (lines 105, 112) exist as rule inputs (A3, A12) but are **not** in the
  approved signal map — they are not provisioned on the current sparse Micro820 map. So A3's raw
  dual-channel check and A12's photo-eye check **degrade silently** today (the code reads `snap.get →
  None`). This matches the evidence's "not label-confirmed" status — the bench simply hasn't proven
  those terminals map to those signals yet.

**Bottom line:** confirmed at the *physical* layer for FWD/REV/START; the *safety* signals exist at
the Modbus layer; the **ladder mapping that connects I-02/I-03→e-stop and I-05→photo-eye is unproven**
and must stay UNKNOWN until a labeled photo or the ladder logic confirms it.

---

## 4. Recommended edits (PROPOSALS ONLY — not applied)

None of these are applied by this document. They are recommendations for a follow-up, human-approved
change.

**config.yaml**
- **E-1 (HIGH):** Change `motor_fla_a: 5.0` → **`motor_fla_a: 3.8`** *once the 230 V wiring tap is
  confirmed* (nameplate 3.8 A @ 230 V; …153). Add an inline comment citing the motor nameplate and the
  230 V/460 V dependence (use 1.9 only if the 460 V tap is proven). Mirror the same value into
  `rules_core.py` `DEFAULT_CFG["motor_fla_a"]` so bench and gateway agree. **Do not change** until the
  input voltage is confirmed — leave 5.0 with a "placeholder — awaiting 230/460 V confirmation" note if
  it can't be confirmed yet.

**context_model.cv101.json**
- **E-2 (LOW):** In `plc.evidence`, record the nameplate ship firmware **FW 12.011** alongside the live
  CIP **rev 14.11** (e.g. a `firmware_note` field) so the two numbers don't read as a contradiction.
  Keep 14.11 as the running rev. Cite `wiring_evidence.md` …142.
- **E-3 (NEW, verified `motor` block):** Add a `motor` object (or enrich component `motor101`) with the
  **nameplate-verified** data: `hp: 1`, `voltage: "230/460"`, `fla_a_230v: 3.8`, `fla_a_460v: 1.9`,
  `rpm: 1725`, `poles: 4`, `frame: "56C"`, `enclosure: "TEFC"`, `insulation_class: "F"`,
  `service_factor: 1.15`, `model: "108074"`, `serial: "U340156C25040052"`, with
  `evidence.source_type: "nameplate_photo"`, `source_name: "motor nameplate photo …153 (2026-07-02)"`,
  `confidence: "high"`, `approval_status: "proposed"` (pending Mike's approval). This gives the A8
  threshold a traceable nameplate source instead of a placeholder.
- **E-4 (MEDIUM, keep OPEN):** Add a note to `plc` (or a new `open_questions` field) recording the
  **two-MAC / one-vs-two-PLC** ambiguity as UNRESOLVED (nameplate `…D9:75:DC` vs front `…E4:D7`), so
  the single-PLC assumption is explicit and flagged, not silent. Cite `wiring_evidence.md` lines 21/134.
- **E-5 (photo_eye — DO NOT promote yet):** Leave `photo_eye` at `approval_status: "proposed"` and
  `safety/pe_latched` in `unmapped`. **Only** promote to `approved` once I-05 is **label-confirmed** as
  the photo-eye AND the signal is provisioned on the Micro820 map (slave-map-v2). The evidence today is
  "likely, not confirmed" — promoting now would violate the evidence-based rule.
- **E-6 (optional, physical-layer trace):** If desired, record the confirmed **physical DI** identities
  (I-00=FWD, I-01=REV, I-04=START) as a `physical_io` reference block — clearly labeled as the
  *terminal* layer distinct from the Modbus coil signals — with the E-stop (I-02/I-03) and photo-eye
  (I-05) entries marked `not_label_confirmed`. This documents Layer A without implying the unproven
  ladder mapping to Layer B.

---

## Summary

- **3 discrepancies:** motor FLA placeholder (HIGH), firmware nameplate-vs-CIP (LOW/expected), two MACs
  (MEDIUM/unresolved).
- **Confirmed:** PLC catalog + IP, GS10 family, RS-485 Modbus link, Modbus-master role.
- **Unproven ladder mapping:** I-02/I-03→e-stop and I-05→photo-eye stay UNKNOWN; `photo_eye` stays
  `proposed`.
- **Most important fix → the A8 overcurrent threshold.** `motor_fla_a: 5.0` is a placeholder ~32 %
  above the motor's true 3.8 A @ 230 V FLA, so the A8 overload/jam precursor under-protects the
  conveyor. Set it to **3.8 A** once the 230 V wiring tap is confirmed (the ~320 V idle DC-bus baseline
  already points that way).
