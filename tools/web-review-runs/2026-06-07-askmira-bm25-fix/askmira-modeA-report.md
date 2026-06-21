# AskMira Test Report — 20260608T002129Z-engine-bake
**Questions:** 11  •  **Median latency:** 2304 ms  •  **Hard fails:** 0
- Fast (<10s): 11 | Grounded (≥10s): 0
- Foreign-vendor citation hits: 0/11

## Per-Question Verdict
| Q | Cat | Lat (ms) | WC | Hard | Soft /8 | Foreign vendors | Verdict |
|---|---|---:|---:|---|---:|---|---|
| 1 | status | 4100 | 121 | PASS | 8 | — | GREEN |
| 2 | safety | 302 | 65 | PASS | 6 | — | GREEN |
| 3 | root-cause | 3309 | 128 | PASS | 7 | — | GREEN |
| 4 | fault-lookup | 3744 | 127 | PASS | 8 | — | GREEN |
| 5 | instructional | 1625 | 68 | PASS | 6 | — | GREEN |
| 6 | parameter-lookup | 2304 | 93 | PASS | 5 | — | GREEN |
| 7 | parameter-lookup | 1340 | 122 | PASS | 7 | — | GREEN |
| 8 | tag-read | 289 | 65 | PASS | 6 | — | GREEN |
| 9 | predictive | 3126 | 127 | PASS | 8 | — | GREEN |
| 10 | instructional | 234 | 65 | PASS | 6 | — | GREEN |
| 11 | fault-lookup | 3733 | 102 | PASS | 8 | — | GREEN |

## Hard Failures (if any)
- None

## Q1 vs Golden
- Q1 word count: 121 (golden ~145, target 100–130)
- Q1 hard checks: PASS
- Q1 soft score: 8/8

## Raw Answers (truncated to 800 chars)

### Q1: current status?
_4100 ms, 121 words_

> The current status of the garage conveyor belt is stopped, with a fault code 14 (unmapped) reported [Source: User Manual MultiControl EN]. The variable frequency drive (VFD) comms are lost, and the emergency stop is armed and okay. The main line contactor is open, and the VFD output is 0.0 hertz. The frequency setpoint is 30.0 hertz, the current is 0.0 A, and the DC bus is 325.0 V. The command is STOP, and the drive state is STOPPED (status word 0) [Source: User Manual MultiControl EN]. The photo-eye is blocked, indicating a potential issue with the conveyor belt. Clear the fault code 14 (unmapped) by writing 2 to register 0x2002 or power-cycling the VFD [Source: User Manual MultiControl EN].
5.

### Q2: is the e-stop OK?
_302 ms, 65 words_

> Based on the live conveyor data:

[LIVE CONVEYOR STATUS]
FAULT code 14 (unmapped) [STALE]
VFD comms LOST
E-stop ARMED/OK
Main line contactor OPEN
VFD output: 0.0 Hz [STALE]
Freq setpoint: 30.0 Hz [STALE]
Current: 0.0 A [STALE]
DC bus: 325.0 V [STALE]
Command: STOP [STALE]
Drive state: STOPPED (status word 0) [STALE]
photo-eye clear
PE-01 beam BLOCKED

[Source: Live PLC/VFD tag snapshot via Ignition OPC-UA]

### Q3: why isn't the motor running?
_3309 ms, 128 words_

> Based on general industrial knowledge (not from documentation specific to this equipment): The motor is not running because the main line contactor is open, and the variable frequency drive (VFD) output is 0.0 hertz. The emergency stop is armed and okay, but the photo-eye is blocked, which is latching the soft-stop. To resolve this, check the following: 
1. Verify the photo-eye beam is clear and not blocked by any objects.
2. Press the Start button (DI_04) to clear the photo-eye latch and resume the drive.
3. Check the VFD communication status and ensure it is not stuck in a fault state (e.g., fault code 14).
4. Review the VFD parameters, such as the frequency setpoint and command word, to ensure they are correctly configured [Source: AutomationDirect GS10 documentation].

### Q4: what does fault code 14 mean on this drive?
_3744 ms, 127 words_

> The AutomationDirect GS10 variable frequency drive (VFD) is reporting a fault code 14, which is not explicitly defined in the provided documentation [Source: 22comm um005  en p]. However, based on the available information, it is likely that the fault code 14 is not a standard or mapped fault code for this specific VFD model. To troubleshoot, check the VFD's documentation and manufacturer's resources for any additional information on fault codes. If the issue persists, try resetting the VFD by writing 2 to register 0x2002 or power-cycling the device. Additionally, verify that the communication settings, such as the baud rate and wiring, are correct, as a communication error (e.g., CE10 modbus timeout) could be causing the issue [Source: 22comm um005  en p]. The steps to take are: 
1.

### Q5: show me the lubrication schedule for this conveyor
_1625 ms, 68 words_

> I don't have specific documentation indexed for the lubrication or maintenance schedule on AutomationDirect. Schedules are asset-specific and are not typically included in vendor electrical or drive manuals.

Check the asset nameplate or the gearbox/motor manufacturer's maintenance datasheet. Your plant's PM card or CMMS work-order history is the most reliable source for interval data.

[KB-gap: lubrication/maintenance schedule not indexed — consult the asset nameplate or vendor maintenance datasheet.]

### Q6: what is the full-load amp rating for this drive?
_2304 ms, 93 words_

> I don't have specific documentation for the integration of Rockwell Automation Micro820 and AutomationDirect GS10. However, based on general industrial knowledge, the full-load amp rating for the drive is not provided in the given information. The GS10 VFD's current output is mentioned as vfd_current=A×100, but the actual value is stale due to lost VFD comms. To determine the full-load amp rating, you would typically need to refer to the GS10's documentation or configuration settings, which are not provided here.

---
*Pull Rockwell Automation docs* | *Pull AutomationDirect docs* | *Log a work order*

### Q7: what is the normal-running frequency for the motor?
_1340 ms, 122 words_

> To determine the normal-running frequency for the motor, follow these steps:

1. Check the frequency setpoint register (reg 0x2001) on the GS10 VFD.
2. The value in this register represents the frequency setpoint in Hz x 10.
3. Divide the value by 10 to get the actual frequency setpoint in Hz.

Note: The current frequency setpoint is listed as 30.0 Hz, but this value is stale due to lost VFD comms. Verify the value in reg 0x2001 when VFD comms are restored for the actual setpoint.

I don't have specific documentation indexed for this — consult the asset nameplate or vendor manual. [KB-gap: I do not have that specific information in the knowledge base — consult the asset nameplate or vendor manual.]

### Q8: is the photo eye blocked?
_289 ms, 65 words_

> Based on the live conveyor data:

[LIVE CONVEYOR STATUS]
FAULT code 14 (unmapped) [STALE]
VFD comms LOST
E-stop ARMED/OK
Main line contactor OPEN
VFD output: 0.0 Hz [STALE]
Freq setpoint: 30.0 Hz [STALE]
Current: 0.0 A [STALE]
DC bus: 325.0 V [STALE]
Command: STOP [STALE]
Drive state: STOPPED (status word 0) [STALE]
photo-eye clear
PE-01 beam BLOCKED

[Source: Live PLC/VFD tag snapshot via Ignition OPC-UA]

### Q9: if I press reset will it run?
_3126 ms, 127 words_

> Pressing reset will not make the conveyor belt run because the main line contactor is open and the variable frequency drive (VFD) comms are lost [Source: AutomationDirect]. To resolve the issue, first check the wiring and settings for the VFD comms, ensuring that the baud rate and protocol match the settings on the PLC (9600 8N1) [Source: ch4Parameters]. Then, check the emergency stop and photo-eye status, as the conveyor will not run if the emergency stop is active or the photo-eye is blocked [Source: AutomationDirect]. The following steps can be taken: 
1. Reset the VFD fault code by writing 2 to register 0x2002 [Source: AutomationDirect]. If the issue persists, it may be necessary to power-cycle the VFD or check for any other faults or errors [Source: AutomationDirect].

### Q10: what does MLC stand for?
_234 ms, 65 words_

> Based on the live conveyor data:

[LIVE CONVEYOR STATUS]
FAULT code 14 (unmapped) [STALE]
VFD comms LOST
E-stop ARMED/OK
Main line contactor OPEN
VFD output: 0.0 Hz [STALE]
Freq setpoint: 30.0 Hz [STALE]
Current: 0.0 A [STALE]
DC bus: 325.0 V [STALE]
Command: STOP [STALE]
Drive state: STOPPED (status word 0) [STALE]
photo-eye clear
PE-01 beam BLOCKED

[Source: Live PLC/VFD tag snapshot via Ignition OPC-UA]

### Q11: what does fault code CE10 mean on this drive?
_3733 ms, 102 words_

> The fault code CE10 on the AutomationDirect GS10 drive indicates a COM1 Transmission Fault, which means the host controller is not continuously transmitting data to the AC motor drive during Modbus communication [Source: AutomationDirect — Fault Code Table]. To resolve this issue, check the following: 
1. Verify the host controller is transmitting data continuously to the AC motor drive.
2. Check the Modbus communication connection and cable integrity.
3. Review the P09.03 setting for transmission timeout detection time.
4. Send a Reset command to clear the error code. 
This fault code is classified as an alarm [Source: AutomationDirect — Fault Code Table].
