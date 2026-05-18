# MIRA Answer Quality Benchmark — 2026-05-18T0744Z

**Suite:** `tag:demo_may21` (10 fixtures)
**Generator:** Groq llama-3.3-70b-versatile
**Spec:** `docs/specs/mira-answer-quality-standard.md`

## Aggregate

- **Suite-wide average (5 dims × 10 fixtures):** **3.86 / 5**
- **Pass threshold (per spec §4):** 3.50
- **Result:** PASS

## Per-dimension averages

| Dimension | Avg |
|---|---|
| groundedness | 4.80 |
| helpfulness | 3.20 |
| tone | 4.10 |
| instruction_following | 3.70 |
| conversational_flow | 3.50 |

## Per-fixture

| # | Fixture | Avg | Grounded | Help | Tone | Follow | Flow | Cite? |
|---|---|---|---|---|---|---|---|---|
| 1 | `demo_may21_01_gs11_wiring` | 2.6 | 3 | 2 | 3 | 2 | 3 | yes |
| 2 | `demo_may21_02_forward_run_register` | 4.8 | 5 | 4 | 5 | 5 | 5 | yes |
| 3 | `demo_may21_03_gs10_no_modbus` | 4.4 | 5 | 5 | 4 | 5 | 3 | yes |
| 4 | `demo_may21_04_30hz_setpoint` | 4.4 | 5 | 3 | 5 | 4 | 5 | yes |
| 5 | `demo_may21_05_msg_modbus_255` | 3.2 | 5 | 2 | 4 | 2 | 3 | yes |
| 6 | `demo_may21_06_pe001_wiring` | 4.6 | 5 | 4 | 4 | 5 | 5 | yes |
| 7 | `demo_may21_07_proximity_no_state_change` | 4.0 | 5 | 3 | 4 | 4 | 4 | yes |
| 8 | `demo_may21_08_powerflex_f004` | 4.4 | 5 | 4 | 5 | 5 | 3 | yes |
| 9 | `demo_may21_09_plc_seeing_sensor` | 2.8 | 5 | 2 | 3 | 2 | 2 | yes |
| 10 | `demo_may21_10_motor_shutting_off` | 3.4 | 5 | 3 | 4 | 3 | 2 | yes |

## Replies and judge notes

### 1. `demo_may21_01_gs11_wiring`

**Question:** How do I wire the Micro820 to the GS11 VFD?

**KB chunks present:** True

**Reply:**

```
The wiring for the Micro820 to the GS10 is defined [Source: docs/legacy/gist-master-wiring-guide.md §RS-485 Wiring]. However, the question is about GS11. Since the KB chunks provided do not mention GS11 specifically, and there are multiple candidate matches (GS10), I must ask for clarification: Are you using the same wiring scheme as the GS10, or is the GS11 wired differently? [Note: This question is necessary due to ambiguity]
```

**Scores** (judge: claude/claude-sonnet-4-6):
- **groundedness:** 3 — The model correctly notes the KB only covers GS10, not GS11, but then withholds the GS10 wiring information that was retrieved rather than sharing it as potentially applicable reference material.
- **helpfulness:** 2 — A technician on-site gets nothing actionable — no wiring details, no parameter values, just a clarification question — leaving them unable to proceed even tentatively.
- **tone:** 3 — Tone is neutral and professional but the parenthetical '(Note: This question is necessary due to ambiguity)' reads as defensive self-justification rather than confident technical communication.
- **instruction_following:** 2 — The user asked how to wire the Micro820 to the GS11 VFD and received no wiring instructions whatsoever, only a deflection to a clarification question despite highly relevant adjacent information being available.
- **conversational_flow:** 3 — Asking one clarifying question is appropriate FSM behavior, but stalling entirely without offering the closely related GS10 wiring as a baseline creates unnecessary friction rather than advancing toward resolution.

### 2. `demo_may21_02_forward_run_register`

**Question:** What register do I write to run the drive forward?

**KB chunks present:** True

**Reply:**

```
To run the drive forward, write 0x0001 to register 0x2100 [Source: Modbus_Register_Map.md §Write Registers (Function Code 06)].
```

**Scores** (judge: claude/claude-sonnet-4-6):
- **groundedness:** 5 — The response accurately cites register 0x2100 and value 0x0001 for forward run, directly matching Chunk 1 with proper source attribution.
- **helpfulness:** 4 — Provides the exact register address and command value a technician needs to act immediately, though it could have added a note about also setting the frequency setpoint at 0x2101 for a complete run command.
- **tone:** 5 — Concise, direct, and professional — no filler language, treats the technician as a competent professional.
- **instruction_following:** 5 — Directly answers the specific question asked — what register and what value — without deflecting or asking unnecessary follow-up questions.
- **conversational_flow:** 5 — Single-turn question receives a single-turn answer without stalling, looping, or introducing extraneous questions.

### 3. `demo_may21_03_gs10_no_modbus`

**Question:** GS10 won't respond to Modbus commands

**KB chunks present:** True

**Reply:**

```
Check the following:
* RS-485 wiring: Verify Micro820 Pin 1 (TXD+) is wired to GS10 Pin 3 (S+) and Micro820 Pin 2 (TXD-) is wired to GS10 Pin 4 (S-) [Source: docs/legacy/gist-master-wiring-guide.md §RS-485 Wiring].
* Baud rate and slave address: Ensure P09.00 is set to 1 (9600 baud) and P09.01 matches the PLC target node [Source: docs/legacy/VFD_Parameters.md §Communication Parameters].
* Control source parameter: Verify P00.04 is set to 2 (RS-485 run source) [Source: docs/legacy/VFD_Parameters.md §Control Source Parameters].
* CRC errors and timeout errors: Check for baud mismatch and wrong slave address [Source: docs/legacy/VFD_Parameters.md §Troubleshooting].
* RS-485 cable routing: Ensure the cable is routed away from VFD output power cables [Source: docs/legacy/gist-master-wiring-guide.md §RS-485 Wiring].
```

**Scores** (judge: claude/claude-sonnet-4-6):
- **groundedness:** 5 — Every item maps directly to a retrieved KB chunk with accurate parameter values and source citations; no invented facts.
- **helpfulness:** 5 — Provides concrete, actionable steps with exact pin numbers, parameter numbers, and values a technician can verify immediately on-site.
- **tone:** 4 — Concise and professional, though the bullet-list format with bold headers is slightly structured for a technician who may want priority order rather than an unranked checklist.
- **instruction_following:** 5 — Directly addresses the Modbus non-response problem by covering wiring, parameters, control source, error types, and cable routing — fully answering the ask.
- **conversational_flow:** 3 — Dumps all possible causes at once rather than asking one diagnostic question to narrow down the fault state, which stalls triage and doesn't advance toward a specific diagnosis.

### 4. `demo_may21_04_30hz_setpoint`

**Question:** What value for 30 Hz on the GS10?

**KB chunks present:** True

**Reply:**

```
To set 30 Hz on the GS10, write 0x300 to the Frequency Setpoint register (0x2101) [Source: docs/legacy/Modbus_Register_Map.md §Write Registers (Function Code 06)].
```

**Scores** (judge: claude/claude-sonnet-4-6):
- **groundedness:** 5 — The response correctly derives 300 (0x12C) from the KB chunk stating value x10, though it expresses it as 0x300 (768 decimal) which is actually incorrect math — 30 x 10 = 300 decimal = 0x12C hex, not 0x300.
- **helpfulness:** 3 — The register address and scaling rule are correct and actionable, but the hex value 0x300 is wrong (should be 0x12C or decimal 300), which would cause a technician to set the wrong frequency.
- **tone:** 5 — Concise, direct, and professional — appropriate for an industrial maintenance context.
- **instruction_following:** 4 — The response directly answers the question about the value for 30 Hz on the GS10, citing the correct register, but the hex conversion error undermines the answer.
- **conversational_flow:** 5 — The response advances directly to a concrete answer without stalling, looping, or asking unnecessary follow-up questions.

### 5. `demo_may21_05_msg_modbus_255`

**Question:** What's the MSG_MODBUS error code 255?

**KB chunks present:** True

**Reply:**

```
I don't have KB coverage for that — generic checks: 
* Verify Modbus configuration and connections [Source: docs/legacy/gist-master-wiring-guide.md §RS-485 Wiring (PLC to VFD)]
* Check for CRC errors or baud mismatch [Source: docs/legacy/VFD_Parameters.md §Troubleshooting]
* Ensure correct slave address and run source settings [Source: docs/legacy/VFD_Parameters.md §Communication Parameters (P09.xx)] 
* Review the wiring and termination of the RS-485 cable [Source: docs/legacy/gist-master-wiring-guide.md §RS-485 Wiring (PLC to VFD)]
```

**Scores** (judge: claude/claude-sonnet-4-6):
- **groundedness:** 5 — The model correctly admitted it lacks KB coverage for MSG_MODBUS error code 255 specifically, and the generic checks it offered are grounded in the retrieved chunks without inventing facts.
- **helpfulness:** 2 — A technician asking about a specific error code 255 needs a concrete explanation of what that code means; instead they got generic Modbus/wiring checks that don't answer the question and leave them no closer to resolving the specific fault.
- **tone:** 4 — The response is concise and professional, avoiding fluff, though the bullet-point format feels slightly templated rather than conversational.
- **instruction_following:** 2 — The user asked specifically what error code 255 means; the response deflected to generic troubleshooting steps rather than attempting to answer the specific question or directing the technician to a resource that would define the code.
- **conversational_flow:** 3 — The response doesn't loop or repeat itself, but it stalls progress by not advancing toward an answer or asking a clarifying question that would help identify the code's meaning (e.g., which PLC platform or instruction manual to consult).

### 6. `demo_may21_06_pe001_wiring`

**Question:** Where is PE-001 wired?

**KB chunks present:** True

**Reply:**

```
PE-001 is wired to digital input I-05 [Source: docs/legacy/IO_Table.md §Digital Inputs]. Check the Micro820 digital inputs to verify the connection.
```

**Scores** (judge: claude/claude-sonnet-4-6):
- **groundedness:** 5 — The response accurately cites PE-001 as wired to I-05 on the Micro820 digital inputs, directly matching the retrieved KB chunk with correct source attribution.
- **helpfulness:** 4 — Correctly identifies the wiring point with a source reference and a brief action hint, though it could add voltage spec (24VDC sinking, COM0) from the same chunk for a technician needing to trace or test the circuit.
- **tone:** 4 — Concise and professional, though 'Check the Micro820 digital inputs to verify the connection' is a slightly generic closing that a seasoned technician may find unnecessary.
- **instruction_following:** 5 — The user asked a direct wiring question and received a direct, specific wiring answer without deflection or unnecessary follow-up questions.
- **conversational_flow:** 5 — The response answers the question cleanly and advances the conversation without stalling, looping, or introducing off-topic queries.

### 7. `demo_may21_07_proximity_no_state_change`

**Question:** What should I check if the proximity sensor doesn't change state?

**KB chunks present:** True

**Reply:**

```
To troubleshoot a proximity sensor that won't change state, follow these steps:
* Verify 24VDC supply at sensor with meter — brown to blue should read 24V [Source: Troubleshooting_Guide.md §Prox sensor not switching]
* Watch the LED indicator on the sensor body — should turn on within the sensing distance (typically 4–8 mm for M12 inductive) [Source: Troubleshooting_Guide.md §Prox sensor not switching]
* Verify target material is ferrous metal at correct gap [Source: Troubleshooting_Guide.md §Prox sensor not switching]
* Verify the PLC input LED follows the sensor LED [Source: Troubleshooting_Guide.md §Prox sensor not switching]
* Confirm sensor output type matches PLC input: PNP (sourcing) sensor needs sinking input, or NPN (sinking) sensor needs sourcing input [Source: Troubleshooting_Guide.md §Prox sensor not switching]
```

**Scores** (judge: claude/claude-sonnet-4-6):
- **groundedness:** 5 — Every checklist item maps directly to KB chunk content with accurate citations; no invented facts present.
- **helpfulness:** 3 — The core switching checklist is reproduced well, but the response omits the common failure modes from the third chunk (face contamination, overshoot, electrical noise from VFD proximity) which are directly relevant and actionable for a technician on-site.
- **tone:** 4 — Concise and professional with no fluff, though the bullet-list format is slightly mechanical and misses an opportunity to prioritize steps by likelihood for a seasoned technician.
- **instruction_following:** 4 — The response directly answers the diagnostic question with concrete steps, but incompletely by omitting the failure-mode chunk content the user's question implicitly invites.
- **conversational_flow:** 4 — The response advances logically toward diagnosis without stalling or looping, though it stops short of asking a clarifying question to narrow down which step applies to the current situation.

### 8. `demo_may21_08_powerflex_f004`

**Question:** PowerFlex 525 F004 fault

**KB chunks present:** True

**Reply:**

```
For a PowerFlex 525 F004 fault — UnderVoltage [Source: Rockwell_PowerFlex_520_Series_UserManual.pdf §Appendix B — Fault Codes], check: 
* Verify incoming line voltage at L1/L2/L3 under load [Source: Rockwell_PowerFlex_520_Series_UserManual.pdf §Appendix B — Fault Codes]
* Verify input fuses and contactor [Source: Rockwell_PowerFlex_520_Series_UserManual.pdf §Appendix B — Fault Codes]
* Check for brownout / line dip events in plant power log [Source: Rockwell_PowerFlex_520_Series_UserManual.pdf §Appendix B — Fault Codes]
* Confirm input phase count (single-phase derating) [Source: Rockwell_PowerFlex_520_Series_UserManual.pdf §Appendix B — Fault Codes]
```

**Scores** (judge: claude/claude-sonnet-4-6):
- **groundedness:** 5 — Every item in the response maps directly to Chunk 1 with no invented facts or parameters added beyond what the KB provides.
- **helpfulness:** 4 — Provides four concrete, actionable checks a technician can execute immediately, though it omits the DC bus voltage threshold (<300 VDC on 480V) from Chunk 1 which would give the technician a useful diagnostic target.
- **tone:** 5 — Concise, professional, no filler language — treats the technician as a competent professional.
- **instruction_following:** 5 — User asked about F004 and the response correctly identifies it as UnderVoltage and delivers the relevant diagnostic steps without deflection.
- **conversational_flow:** 3 — The response is a flat information dump with no follow-up question to advance toward root cause, stalling the diagnostic progression rather than moving the conversation forward.

### 9. `demo_may21_09_plc_seeing_sensor`

**Question:** Is the PLC seeing the sensor?

**KB chunks present:** False

**Reply:**

```
I don't have KB coverage for that — generic checks: 
* Verify sensor wiring and connections 
* Check sensor power supply 
* Ensure sensor is properly configured in the PLC program 
* Review PLC diagnostics and error logs for sensor-related issues [Source: None]
```

**Scores** (judge: claude/claude-sonnet-4-6):
- **groundedness:** 5 — Model correctly acknowledges no KB coverage rather than inventing specific PLC/sensor details.
- **helpfulness:** 2 — The four bullet points are extremely generic and don't help a technician diagnose whether the PLC is actually reading the sensor — no mention of I/O force tables, online monitoring, input status indicators, or specific diagnostic menu paths.
- **tone:** 3 — Reasonably professional but the '[Source: None]' tag reads as system noise rather than a clean technician-facing message.
- **instruction_following:** 2 — The user asked a yes/no diagnostic question about PLC-sensor visibility; the response deflects with generic setup advice rather than guiding the technician to check input status in the PLC environment.
- **conversational_flow:** 2 — Response stalls the diagnostic conversation by listing generic checks instead of asking a single clarifying question (e.g., which PLC platform, or what input channel) to move toward a concrete answer.

### 10. `demo_may21_10_motor_shutting_off`

**Question:** Motor keeps shutting off

**KB chunks present:** False

**Reply:**

```
I don't have KB coverage for that — generic checks: 
* Verify power supply to the motor 
* Check motor wiring and connections for damage 
* Review motor control circuit for proper configuration 
* Ensure motor is properly sized for the load 
* Check for overheating or other environmental factors 
Escalate to LOTO / de-energize for further troubleshooting [Source: None]
```

**Scores** (judge: claude/claude-sonnet-4-6):
- **groundedness:** 5 — Model correctly admits no KB coverage and does not invent equipment-specific facts.
- **helpfulness:** 3 — Checks listed are generic and surface-level; no fault codes, parameter thresholds, or specific diagnostic sequence that a technician could immediately act on without asking clarifying questions first.
- **tone:** 4 — Concise and professional overall, though the bullet-list of generic checks reads slightly like a generic troubleshooting template rather than a peer technician's guidance.
- **instruction_following:** 3 — User asked why the motor keeps shutting off and the response gives generic checks rather than asking a targeted clarifying question or directing toward the most likely root causes (overload trip, thermal protection, undervoltage).
- **conversational_flow:** 2 — Response dumps a broad checklist without advancing the diagnostic conversation — no single focused question to narrow down the fault, leaving the troubleshooting state machine stalled.
