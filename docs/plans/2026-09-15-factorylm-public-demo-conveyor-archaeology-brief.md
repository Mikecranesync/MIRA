# FactoryLM Public Demo Conveyor — Archaeology & Planning Brief

**Date:** 2026-09-15  
**Status:** Planning / archaeology brief  
**Owner:** FactoryLM  
**Primary rule:** **Do not build a new simulator until the existing conveyor/demo stack has been fully inventoried and classified.**

---

## 1. Objective

FactoryLM's public marketing site is moving to the same ChatGPT-style interaction shell used by the product. The marketing surface needs a real demonstration that lets a visitor see an industrial machine operate, inject a fault, and then ask FactoryLM what happened.

The likely flagship demo is the existing FactoryLM garage conveyor / CV-101 work.

Target visitor experience:

> **machine running → inject fault → live telemetry changes → ask FactoryLM what happened → FactoryLM diagnoses from evidence → visitor inspects evidence/history → reset and try again**

This brief exists to make the **first implementation step archaeology, not reinvention**.

Claude or any implementation agent should first recover, map, and assess everything already present in the repository, Git history, stale branches, prior PRs/issues, and existing demo artifacts.

---

## 2. Product Intent

The public demo is not a separate SCADA product and not a separate marketing architecture.

It should be:

**FactoryLM shared conversation shell**  
+ **live/animated conveyor visualization**  
+ **small telemetry/evidence inspector**  
+ **controlled fault injection**

The visualization supports the conversation. It does not replace the conversation.

The demo must work continuously without requiring the physical garage conveyor to be online. Later, the physical conveyor should plug into the same logical machine model so FactoryLM can switch between:

- simulated conveyor
- replayed conveyor incident
- physical conveyor

without changing the core technician experience.

---

## 3. Known Existing Assets — Verify, Do Not Assume

A quick pre-check found substantial existing work. Treat these as starting points to verify on current `main`, not as proof that they still run today.

### SimLab / deterministic simulation

Likely relevant:

- `simlab/`
- `simlab/engine.py`
- `simlab/scenarios.py`
- `simlab/baselines/`
- `simlab/publishers.py`
- `simlab/evaluation.py`
- `simlab/dashboard.html`

Prior planning described SimLab as a deterministic, seeded industrial simulation engine with PackML behavior, fault scenarios, publishers, baselines, and evaluation infrastructure.

See:

- `docs/plans/2026-06-22-simlab-industrial-flight-simulator-assessment.md`

That prior assessment concluded that much of the hard simulation/evaluation work already existed and recommended extending it rather than adopting another simulation platform.

### Garage conveyor / CV-101

Likely relevant:

- `docs/demo/garage_conveyor_context_model_demo.md`
- `docs/runbooks/garage-conveyor-demo.md`
- `docs/testing/2026-08-06-garage-conveyor-uat.md`
- `docs/runbooks/2026-05-15_physical-conveyor-readiness.md`
- `plc/`
- `plc/litmus/`
- `plc/conv_simple_anomaly/`
- `tools/run-conveyor-live.sh`
- `tools/demo_plc_simulator.py`

The existing garage-conveyor demo documentation describes a real Micro820 + GS10 VFD bench, live tag reads, contextualized signals, grounded maintenance answers, and deterministic replay when the hardware is unavailable.

### Ignition

Likely relevant:

- `ignition/`
- `ignition/project/`
- `ignition/tags/`
- `ignition/gateway-scripts/`
- `ignition/webdev/`
- `ignition/deploy_ignition.ps1`
- `docs/specs/ignition-exchange-spec.md`
- `docs/legacy/Ignition_Tags.md`
- `docs/integrations/ignition-tag-collector.md`
- `docs/command-center-ignition-display.md`

The existing Ignition specification describes a `ConveyorMIRA` project with Perspective views, 36 PLC tags, gateway scripts, WebDev resources, and Micro820 Modbus connectivity.

### Other likely reusable pieces

Search for and assess:

- `mira-trend-viewer/`
- conveyor tag/asset seed SQL
- MQTT publishers/subscribers
- Node-RED conveyor work
- Litmus connector work
- live signal cache / relay ingest
- replay fixtures
- anomaly/fault rules
- maintenance history seeds
- manuals / GS10 VFD knowledge
- existing dashboards or SVG conveyor displays
- camera/video proof tooling
- existing synthetic/eval workers

This list is intentionally not exhaustive.

---

## 4. Archaeology Mission

Before writing new demo code, answer these questions with evidence.

### A. What exists today?

Inventory all current code and assets for:

- physical Micro820 conveyor control
- GS10 VFD integration
- Ignition Perspective conveyor UI
- PLC / Ignition tags
- live tag ingestion into MIRA
- conveyor simulation
- deterministic simulation
- fault injection
- replay/offline mode
- trend/history visualization
- current, speed, temperature, vibration, sensor signals
- photoeye/sensor faults
- motor/VFD faults
- jam/overload faults
- manuals and maintenance knowledge
- MIRA grounded/cited diagnosis
- maintenance/work-order history
- MQTT / Node-RED / Litmus paths
- public/demo UI experiments
- camera / physical bench presentation
- automated scoring against known fault ground truth

### B. What used to exist?

Search Git history, deleted files, renamed files, stale branches, worktrees, PRs, and issues for earlier conveyor/demo implementations that disappeared from current `main`.

Do not restore old code simply because it exists.

### C. Classify every meaningful discovery

Use exactly these classifications:

- **USE AS-IS** — current, proven, fits target architecture
- **REPAIR** — correct direction, currently broken/stale
- **CONNECT** — working pieces exist but are not wired together
- **REFERENCE ONLY** — useful design/history, should not return to runtime
- **OBSOLETE / DO NOT REVIVE** — conflicts with current product architecture

---

## 5. Critical Trust Architecture

The public demo must separate **simulation ground truth** from **technician-visible evidence**.

### Ground-truth channel

The simulator/evaluator may know:

- exact injected fault
- fault start time
- severity
- hidden simulation state
- expected diagnosis

### MIRA evidence channel

FactoryLM may see only the information a technician could legitimately have, such as:

- PLC tags
- VFD values
- sensors
- alarms
- event logs
- trends
- manuals
- asset configuration
- approved tag mappings
- maintenance history

**MIRA must never receive the injected fault label as part of its diagnostic context.**

This separation is mandatory because the marketing demo should also serve as a real evaluation harness. If FactoryLM correctly diagnoses a fault, the result must be earned from evidence rather than leaked from the simulator.

---

## 6. Initial Demo Scope

Do not start with many machines.

The first public demo should use one believable conveyor cell and prove the experience extremely well.

Recommended starting fault set:

1. **Conveyor jam / overload**
   - visually understandable
   - speed falls
   - current/torque rises
   - photoeye/accumulation behavior changes
   - VFD warning/trip may follow

2. **Intermittent photoeye / sensor fault**
   - demonstrates controls reasoning
   - sensor transitions disagree with physical movement
   - creates confusing PLC behavior without simply handing MIRA a fault code

3. **Developing bearing / motor condition**
   - demonstrates predictive maintenance
   - vibration/temperature/current trend gradually away from baseline
   - line may remain operational while risk increases

The jam should be the flagship first-run scenario because it is obvious to a nontechnical visitor while still allowing meaningful diagnosis.

---

## 7. Physical Conveyor Strategy

The public site must not depend on the garage hardware being online.

Preferred order:

### Phase A — always-on simulated/replayed conveyor

Use the existing deterministic simulation/replay stack where possible.

### Phase B — physical conveyor

Make the real Micro820/GS10 conveyor publish the same logical signal model used by the simulator.

FactoryLM should not need a separate UI or reasoning pipeline for real versus simulated operation.

### Phase C — optional robotics

Robot arms or other actuators can later move boxes, create accumulation, obstruct the process, or trigger realistic scenarios.

Robotics is an enhancement, not a V1 dependency.

---

## 8. External Presentation References

These are references for presentation patterns and product-demo ideas. They are not requirements and must not override existing FactoryLM architecture.

### Litmus Digital Factory Demo

https://litmus.io/blog/digital-factory-demo

Why review it:

- virtual industrial environment for product demonstration
- simulated PLC/data behavior
- lets prospects experience the value without connecting their own equipment
- very close to the FactoryLM public-demo concept

### realvirtual WEB

https://web.realvirtual.io/demo/

Why review it:

- browser-based industrial machine visualization
- conveyors, sensors, drives, robots
- useful reference for how a machine simulation can look and feel on the web

**License note:** treat as design/reference unless license compatibility is explicitly approved. Do not import incompatible code.

### Ignition public demo

https://demo.ia.io

Additional example:

https://demo.inductiveautomation.com/data/perspective/client/data-center-demo/

Why review it:

- industrial live-data presentation in a browser
- relevant because FactoryLM already has Ignition assets
- useful for observing alarm/status/trend interaction patterns

### LINEVA digital twin

https://lineva.live/digital-twin

Why review it:

- useful reference for live machine/digital-twin presentation
- machine/asset context combined with operational data and AI interaction

### CENTO demo

https://centosoftware.com/demo/

Why review it:

- industrial digital-twin / dashboard demo presentation
- good example of allowing visitors to experience product behavior rather than reading only marketing copy

---

## 9. Open-Source Projects to Evaluate

Do not add any dependency during archaeology. First determine whether FactoryLM already has equivalent capability.

The current FactoryLM dependency policy remains **MIT or Apache-2.0 only** for newly adopted runtime dependencies unless explicitly changed by the owner.

### FUXA — MIT

https://github.com/frangoteam/FUXA

Useful ideas:

- browser SCADA/HMI presentation
- SVG industrial visualization
- OPC-UA / Modbus / MQTT / PLC integrations
- live value binding

Potential use: design/reference or selective reuse if it genuinely reduces work and fits the architecture.

Do **not** turn FactoryLM into FUXA or create a parallel SCADA product.

### Node-RED — Apache-2.0

https://nodered.org/

Potential use:

- demo orchestration
- protocol glue
- fault-injection control
- MQTT/industrial data routing

Likely better as backend/demo plumbing than as the public presentation layer.

### Three.js — MIT

https://threejs.org/

Potential use:

- lightweight browser visualization if the existing FactoryLM/Ignition/SVG presentation is insufficient
- possible later physical-layout / robot-arm visualization

Do not add 3D merely for decoration. A clear 2D/SVG representation is preferable if it demonstrates the product more effectively.

### Chart.js — MIT

https://www.chartjs.org/

Potential use:

- small live telemetry and incident trend visualizations
- current / speed / temperature / vibration history

Again, first check what FactoryLM already uses.

---

## 10. Presentation Principle

The demo should feel like FactoryLM, not like an engineer's diagnostics dashboard.

The visitor's primary action is still conversation:

> **"Why did the conveyor stop?"**

Supporting UI should make the answer believable:

- machine visibly changes state
- a few important live values move
- alarms/events appear naturally
- evidence can be inspected
- history can be replayed
- the answer cites what FactoryLM used

Avoid a giant wall of tags or dozens of charts on the main marketing experience.

The raw industrial depth can live behind inspectors/details for technical visitors.

---

## 11. Desired Future Visitor Flow

The target experience should eventually be approximately:

1. Visitor opens `factorylm.com`.
2. The normal unified FactoryLM shell appears in public demo mode.
3. Demo Conveyor CV-101 is running.
4. Boxes move on a simple visual representation.
5. A small set of live machine signals is visible.
6. Visitor can ask normal questions while healthy.
7. Visitor selects **Inject fault** or **Surprise me**.
8. The machine changes over time.
9. FactoryLM is not told the fault label.
10. Visitor asks what happened.
11. FactoryLM diagnoses from available evidence.
12. Answer shows citations/evidence and safe first checks.
13. Visitor may inspect history/replay around the incident.
14. Demo can reset to known healthy state.
15. CTA offers: **Use FactoryLM with your equipment.**

---

## 12. Reuse Before Build

Preferred architecture if archaeology confirms the pieces are viable:

- existing SimLab/replay/fault engine remains authoritative for simulated state
- existing Ignition/PLC tag model informs realistic signal names and behavior
- existing relay/live-signal architecture carries telemetry
- existing FactoryLM/MIRA reasoning/citation pipeline diagnoses the machine
- existing shared V7/ChatGPT-style shell remains the customer experience
- only the missing bridges and a polished visualization are added

Do not create:

- a second chatbot
- a second evidence system
- a second asset model
- a second public-only diagnostic backend
- a large new digital-twin architecture
- a separate marketing SCADA application

---

## 13. Required Archaeology Deliverable

Return one report with these sections:

1. **Current state**
2. **Everything relevant already present**
3. **Current architecture/data flow**
4. **What previously worked, with evidence**
5. **What is currently broken/stale/missing**
6. **What can be reused directly**
7. **What should explicitly not be revived**
8. **Ground-truth vs MIRA-evidence separation assessment**
9. **External-project ideas actually worth borrowing**
10. **Smallest path from today's repo to the public demo**
11. **Recommended first implementation PR**

For important claims include:

- exact file paths
- commit SHAs when relevant
- PR/issue numbers where useful
- tests actually run
- runtime evidence actually observed

Distinguish:

- confirmed working now
- historically worked
- inferred
- untested

---

## 14. Stop Conditions

During this first task:

- **Do not modify production.**
- **Do not deploy.**
- **Do not add dependencies.**
- **Do not redesign FactoryLM.**
- **Do not build the new marketing simulator yet.**
- **Do not revive obsolete code without evidence.**
- **Do not weaken the MIT/Apache-2.0 dependency policy.**
- **Do not claim something works today based only on old documentation.**

Stop after producing the archaeology/recovery report and proposed first implementation PR.

Wait for owner approval before implementation.

---

## 15. Success Criterion for This Planning Step

At the end of archaeology, we should be able to answer one question confidently:

> **What is the smallest amount of new work required to turn the FactoryLM conveyor assets we already own into an always-available, fault-injectable, evidence-grounded public product demo inside the unified FactoryLM interface?**

The default assumption is **reuse and reconnect**, not rebuild.
