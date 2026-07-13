# Demo summary -- Litmus collects, MIRA contextualizes

**Asset:** enterprise.garage.demo_cell.bottling_demo.cv_101 / Discharge conveyor CV-101  
**Data source (this run):** REPLAY fixture 'cv101_comm_down' (deterministic, no PLC)

## The thesis, in one screen

1. **Litmus gets the data.** Litmus Edge / DeviceHub polls CV-101's Micro820 with **zero modbus exceptions** -- the same registers shown below, live in its UI.
2. **Raw tags are not enough.** A register wall (`H@109 = 3215`, `C@0 = false`) does not tell a technician what to do.
3. **MIRA adds the context model.** The approved CV-101 model maps each register to a named maintenance signal -- with scale, unit, component, evidence and a human approval on every mapping.
4. **MIRA answers, and refuses to guess.** It runs the A0-A12 machine-card rules and answers "Why is CV-101 stopped?" from grounded signals, and explicitly declines what it cannot ground.

## This run

- **Answer:** CV-101 is stopped and there IS an active condition: **GS10 RS-485 link down** (CRITICAL). vfd_comm_ok is FALSE - the PLC<->GS10 serial link is down; all VFD values are stale (frozen from the last good poll). Because the drive link is down, every GS10 value (frequency, current, DC bus, fault code) is STALE -- I will NOT diagnose them until comms are restored. Fix the RS-485 link first, then re-read.
- **Findings:** [CRITICAL] A1_COMM_STALE
- **Declined (unmapped):** 2 signal(s) MIRA refused to assert.

## Honest gap

The **direct** Litmus-API read (`--source litmus`) is a deferred follow-up: the internal `loopedge-access :8094` read path needs a supported credential/route and is container-internal (see `docs/discovery/litmus_mira_demo_decision.md`). It does NOT block this proof -- MIRA reads the SAME live conveyor data over `--source plc`, and Litmus is demonstrably collecting it in parallel.
