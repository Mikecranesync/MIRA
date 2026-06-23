# Ask MIRA — Conv_Simple demo answer card

**Question:** Why did the conveyor stop?

**Most likely cause:** Photoeye PE-101 appears blocked — the conveyor stopped on a photo-eye jam, not a drive or motor fault.
**Confidence:** High

**Why MIRA thinks that:**
- Photoeye PE-101 beam is blocked (DI_05 latched)
- Ladder asserts the photo-eye jam (anomaly A12)
- Conveyor soft-stops to protect product
- Motor RPM drops to 0 — but the GS10 reports NO drive fault

**Evidence for:**
- Photoeye PE-101 beam (DI_05) [`enterprise.proveit.bench.conv_simple.photoeye_pe101.status.blocked`] = BLOCKED (TRUE)
- Conveyor run state [`enterprise.proveit.bench.conv_simple.conveyor.status.running`] = FALSE (stopped)
- GS10 reported motor RPM [`enterprise.proveit.bench.conv_simple.conveyor_motor.process.rpm`] = 0
- Anomaly A12 'Photo-eye jam' fired (di05_photoeye blocked ≥ threshold).

**Evidence against:**
- GS10 fault code [`enterprise.proveit.bench.conv_simple.gs10_vfd.faults.fault_code`] = 0 (no GS10 fault)
- GS10 DC-bus voltage [`enterprise.proveit.bench.conv_simple.gs10_vfd.process.dc_bus_v`] = ~320 V (nominal)
- No GS10 fault code present → this is NOT a VFD fault (rules out the drive).

**Manuals / procedures used (receipts):**
- DURApulse GS10 User Manual (GS10M) — `https://cdn.automationdirect.com/static/manuals/gs10m/gs10m.pdf`  ·  Confirm the GS10 is healthy (no drive fault, V/Hz, comm) so a stopped conveyor is NOT a VFD fault — points the diagnosis at the photoeye.
- GS10 Manual Ch.06 — Fault & Warning Codes — `https://cdn.automationdirect.com/static/manuals/gs10m/ch06.pdf`  ·  Decode/rule out GS10 fault codes (E07, CE/CF comm). Absence of a fault code is the evidence-against a VFD cause.
- Micro820 Programmable Controllers User Manual (2080-UM005) — `https://literature.rockwellautomation.com/idc/groups/literature/documents/um/2080-um005_-en-e.pdf`  ·  Confirms DI_05 wiring + serial (8N2/9600) so the photoeye input (di05_photoeye) is read correctly.
- Photoeye PE-101 notes (UNKNOWN_MODEL) — `demo/evidence/photoeye/notes.md`  ·  The cleaning/check procedure for the photoeye on DI_05 — the recommended technician actions for a blocked beam. Exact model unknown (honest).
- Factory I/O documentation — `https://docs.factoryio.com/`  ·  The conveyor + diffuse/retro-reflective sensor behaviour in the visual layer.
- GS10 + Micro820 Integration Guide (wiring + comm + tag map) — `plc/GS10_Integration_Guide.md`  ·  The authoritative wiring + register map: DI_05 photoeye, GS10 HRs, comm params. The IO map the diagnosis grounds tags against.
- Modbus server / register map (MbSrvConf_ConvSimple_v1.9.xml — the deployed map; v2.1 reuses it) — `plc/MbSrvConf_ConvSimple_v1.9.xml`  ·  Coils + holding registers actually deployed (di05_photoeye at coil 000023) — proves the photoeye tag is real and addressed.
- Conv_Simple anomaly rules (A12 photo-eye jam) — `plc/conv_simple_anomaly/`  ·  Defines A12 'Photo-eye jam' (di05_photoeye blocked >= X s) — the deterministic rule that fires the scenario.

**Similar history:**
- Bench log: a 'flaky_photoeye' event was captured before (plc/conv_simple_anomaly/live_logger.py --label flaky_photoeye). Same DI_05 signature.

**Technician checks:**
- Clean the PE-101 lens (product debris / condensation / label adhesive).
- Clear the beam and confirm DI_05 (di05_photoeye) toggles in the PLC.
- Inspect the belt for a jammed item holding the beam broken.
- Confirm the GS10 shows NO fault (no E07 / CE comm fault) — drive is healthy.

**Human review needed:**
- Confirm on the bench before acting — this is MIRA's most likely hypothesis.
- PE-101 exact model is UNKNOWN_MODEL (not on file) — read the sensor part number off the bench and record it in demo/evidence/photoeye/notes.md.

_Every manual above is a real entry in demo/evidence/evidence_manifest.json. Nothing is invented; UNKNOWN_MODEL assets are flagged, not fabricated._
