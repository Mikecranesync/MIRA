# Live cell — Conv_Simple (supervised bench)

- status: **supervised bench OFFLINE — degraded to evidence snapshot**
- mode: `live_supervised_bench`  ·  requires_supervision: **true**  ·  runs_24_7: **false**
- A supervised bench is not 24/7; an offline bench degrades to the evidence snapshot and the demo still passes.

## Live answer cards

# Ask MIRA — pe101_blocked (live_supervised)

**Asset:** `enterprise.proveit.bottling.plant1.packaging.conv_simple.photoeye_pe101`
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
- DURApulse GS10 User Manual (GS10M) — `https://cdn.automationdirect.com/static/manuals/gs10m/gs10m.pdf`
- GS10 Manual Ch.06 — Fault & Warning Codes — `https://cdn.automationdirect.com/static/manuals/gs10m/ch06.pdf`
- Micro820 Programmable Controllers User Manual (2080-UM005) — `https://literature.rockwellautomation.com/idc/groups/literature/documents/um/2080-um005_-en-e.pdf`
- Photoeye PE-101 notes (UNKNOWN_MODEL) — `demo/evidence/photoeye/notes.md`
- Factory I/O documentation — `https://docs.factoryio.com/`
- GS10 + Micro820 Integration Guide (wiring + comm + tag map) — `plc/GS10_Integration_Guide.md`
- Modbus server / register map (MbSrvConf_ConvSimple_v1.9.xml — the deployed map; v2.1 reuses it) — `plc/MbSrvConf_ConvSimple_v1.9.xml`
- Conv_Simple anomaly rules (A12 photo-eye jam) — `plc/conv_simple_anomaly/`

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

# Ask MIRA — gs10_fault (live_supervised)

**Asset:** `enterprise.proveit.bottling.plant1.packaging.conv_simple.gs10_vfd`
**Question:** Why did the conveyor stop with a drive fault?

**Most likely cause:** The GS10 VFD tripped on a drive fault (E07 overcurrent) — this IS a drive fault, not a photoeye jam.
**Confidence:** High

**Why MIRA thinks that:**
- GS10 reports fault code E07 (overcurrent)
- Conveyor run = FALSE and motor RPM = 0
- The photoeye beam is CLEAR — so this is NOT a photo-eye jam (contrast pe101_blocked)

**Evidence for:**
- vfd_fault_code = E07 (overcurrent)
- conv_run = FALSE (stopped)
- vfd_motor_rpm = 0

**Evidence against:**
- di05_photoeye = CLEAR (beam not blocked)
- Photoeye clear → rules out the A12 photo-eye jam path.

**Manuals / procedures used (receipts):**
- DURApulse GS10 User Manual (GS10M) — `https://cdn.automationdirect.com/static/manuals/gs10m/gs10m.pdf`
- GS10 Manual Ch.06 — Fault & Warning Codes — `https://cdn.automationdirect.com/static/manuals/gs10m/ch06.pdf`
- Micro820 Programmable Controllers User Manual (2080-UM005) — `https://literature.rockwellautomation.com/idc/groups/literature/documents/um/2080-um005_-en-e.pdf`
- GS10 + Micro820 Integration Guide (wiring + comm + tag map) — `plc/GS10_Integration_Guide.md`

**Similar history:**
- GS10 E07 overcurrent has been seen on belt-overload — see the GS10 fault chapter.

**Technician checks:**
- Read the GS10 keypad fault (confirm E07) and the last current peak.
- Under LOTO, check the belt/motor for a mechanical bind or overload.
- Confirm the load is free before clearing the fault and restarting.

**Human review needed:**
- Confirm the GS10 fault on the keypad before resetting (do not auto-reset).
