# Demo summary -- Litmus collects, MIRA contextualizes

**Asset:** enterprise.garage.demo_cell.bottling_demo.cv_101 / Discharge conveyor CV-101  
**Data source (this run):** LIVE PLC (Modbus TCP 192.168.1.100:502) -- no Litmus in the code path

## The thesis, in one screen

1. **Litmus gets the data.** Litmus Edge / DeviceHub polls CV-101's Micro820 with **zero modbus exceptions** -- the same registers shown below, live in its UI.
2. **Raw tags are not enough.** A register wall (`H@109 = 3215`, `C@0 = false`) does not tell a technician what to do.
3. **MIRA adds the context model.** The approved CV-101 model maps each register to a named maintenance signal -- with scale, unit, component, evidence and a human approval on every mapping.
4. **MIRA answers, and refuses to guess.** It runs the A0-A12 machine-card rules and answers "Why is CV-101 stopped?" from grounded signals, and explicitly declines what it cannot ground.

## This run

- **Answer:** CV-101 is stopped because it is **not being commanded to run** -- the GS10 command word reads STOP and the motor-running signal is OFF. This is a normal idle stop, **not a fault**: the PLC<->GS10 link is healthy (DC bus nominal at 321.7 V), no GS10 fault is active (fault_code = 0), and the e-stop is clear. Nothing is wrong with CV-101; it simply has no run command.
- **Findings:** none active -- state is within all machine-card invariants.
- **Declined (unmapped):** 2 signal(s) MIRA refused to assert.

## Honest gap

The **direct** Litmus-API read (`--source litmus`) is a deferred follow-up: the internal `loopedge-access :8094` read path needs a supported credential/route and is container-internal (see `docs/discovery/litmus_mira_demo_decision.md`). It does NOT block this proof -- MIRA reads the SAME live conveyor data over `--source plc`, and Litmus is demonstrably collecting it in parallel.
