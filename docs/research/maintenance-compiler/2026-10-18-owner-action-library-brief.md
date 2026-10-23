# Owner brief: Standardized technician actions and workflows (2026-10-18)

> Mike's direction, given during the Atomic Machines investigation. It is preserved here as written in substance so the next agent works from the owner's framing, not a paraphrase. **These are proposed action names and boundaries, not claims about what MIRA implements, and not implementation authorization.**

**TL;DR:** standardize the smallest repeatable actions industrial technicians perform, then combine them into reusable troubleshooting, inspection, repair and verification workflows. Every action must be understandable to three parties: the technician, MIRA, and eventually a robot. Start with roughly 25–35 core actions, not hundreds of workflows, and prove value first.

## 1. Proposed action library

| Group | Actions | Purpose |
|---|---|---|
| A. Identify and observe | `IDENTIFY_ASSET` · `READ_FAULT` · `OBSERVE_STATE` · `INSPECT_COMPONENT` · `CAPTURE_IMAGE` · `REVIEW_HISTORY` | Establish equipment, symptoms and existing evidence before intervening |
| B. Establish safe conditions | `ASSESS_HAZARDS` · `VERIFY_AUTHORIZATION` · `CONFIRM_ISOLATION` · `VERIFY_ZERO_ENERGY` · `CHECK_INTERLOCKS` | Safety gates. MIRA records qualified-person verification; it never declares equipment safe because a box was ticked |
| C. Measure and test | `MEASURE_VOLTAGE` · `MEASURE_RESISTANCE` · `MEASURE_CURRENT` · `READ_PLC_TAG` · `READ_DRIVE_PARAMETER` · `CHECK_CONTINUITY` · `MEASURE_TEMPERATURE` · `CHECK_SENSOR_RESPONSE` | Each defines instrument, test points, units, expected range, conditions, evidence |
| D. Diagnose and decide | `COMPARE_TO_SPEC` · `CHECK_SEQUENCE` · `CORRELATE_SIGNALS` · `EVALUATE_HYPOTHESIS` · `SELECT_NEXT_TEST` | Evidence-backed decisions; a plausible cause is not a confirmed fault |
| E. Repair and restore | `REPLACE_COMPONENT` · `ADJUST_COMPONENT` · `REPAIR_CONNECTION` · `CONFIGURE_DEVICE` · `FUNCTION_TEST` · `VERIFY_RESTORATION` | Require equipment-specific procedures, authorization and acceptance criteria |
| F. Document and learn | `RECORD_FINDING` · `ATTACH_EVIDENCE` · `RECORD_ROOT_CAUSE` · `CLOSE_WORK_ORDER` · `ESCALATE` | Preserve observations, verified diagnosis, repair and outcome |

## 2. The action contract (more important than the names)

Example, `MEASURE_RESISTANCE`:

| Field | Value |
|---|---|
| Target | PT100 temperature sensor |
| Preconditions | Approved procedure; required isolation and safe test access verified |
| Executor | Qualified technician |
| Instrument | Calibrated multimeter |
| Expected | Resistance consistent with documented PT100 type, wiring configuration and actual temperature |
| Evidence | Measured ohms, temperature, test points, instrument identification |
| Outcome | `PASS` · `FAIL` · `INCONCLUSIVE` · `BLOCKED` · `UNSAFE` |

An action never returns only "done". It returns what was measured, how, whether the evidence is trustworthy, and whether the workflow can safely advance.

## 3. Candidate workflow templates

| Workflow | Sequence | Value |
|---|---|---|
| Motor won't start | Identify → fault → permissives → drive status → electrical checks → diagnose | Very high |
| VFD fault | Fault code → manual → parameters → measurements → cause → verification | Very high |
| Sensor failure | Identify → observe → signal state → alignment → wiring → verify | Very high |
| PLC I/O fault | Address → expected state → I/O observation → field verification | Very high |
| Communication fault | Topology → node status → supply → wiring → diagnostic counters | High |
| Overtemperature | Alarm → sensor type → controller reading → thermal protection → root cause | High |
| Mechanical drive fault | Symptoms → inspection → measurements → mechanical condition → verification | High |
| Preventive inspection | Asset → checklist → observations → measurements → exceptions → record | Very high |

Templates, not rigid scripts: the path depends on asset, state, OEM procedure and evidence.

## 4. Worked example: AS-i communication or sensor fault (ASI-001 shape)

1. Identify the affected node: train, coach, seat, slave address, actual symptom.
2. Establish expected behavior: drawings, network configuration, sequence.
3. Observe the fault: diagnostic state, timing, permitted read-only controller data.
4. Separate fault categories: communication loss, supply, sensor state, wiring, sequence logic.
5. Select an approved diagnostic test against the strongest unresolved hypothesis and required safety conditions.
6. Record and verify against documented expectations; escalate if inconclusive.

Applies across AS-i installations without embedding ride-specific control logic in the generic library.

## 5. Standardized maintenance data

Every execution produces a structured record, for example:

```
Action:   READ_PLC_TAG
Asset:    CV-101
Signal:   PE-101
Observed: FALSE
Expected: TRUE under documented test conditions
Source:   Controller read, timestamped
Result:   Unexpected state; cause unconfirmed
Next:     Inspect sensor state using approved procedure
```

Unlike chat transcripts, records separate observed values, assumptions, decisions, interventions and verified results: a stronger basis for evaluating MIRA and, eventually, robotic maintenance policies.

## 6. Proposed first validation boundary

- **12** core diagnostic actions · **3** workflow templates · **1** test system
- Start: CV-101 conveyor with motor-start, VFD-fault and sensor-fault workflows
- Five workflow outcomes: `SUCCESS` · `FAILED` · `INCONCLUSIVE` · `BLOCKED` · `UNSAFE`. A workflow must be able to stop without inventing a diagnosis.

## 7. The research question

> Can a small library of standardized technician actions, composed into verified diagnostic workflows, deliver a measurable improvement over MIRA's current conversational troubleshooting without requiring a new compiler architecture?

Largest potential gains: retrieving the right technical information, eliminating repeated steps, choosing high-information tests, and preserving previous troubleshooting evidence.
