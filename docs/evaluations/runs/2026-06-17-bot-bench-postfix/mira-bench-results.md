# MIRA vs ungrounded-LLM benchmark — v2

**Run:** 20260617T110038+0000
**Started:** 2026-06-17T11:00:38+00:00
**Tenant:** `78917b56-f85f-43bb-9a08-1bb98a6cd6c3`
**Cascade:** groq → cerebras → gemini
**Retrieval limit:** 5 (overfetch 15, equipment rerank)
**Scorer:** 6 LLM dims + factual_accuracy + fabrication_penalty (max /35)

## Aggregate

| | MIRA grounded | ungrounded LLM |
|---|---|---|
| total (of 350) | **286** | **266** |
| total_raw (pre-fabrication) (of 350) | 289 | 273 |
| LLM-only sum (of 300, v1-comparable) | 263 | 248 |
| fabrication penalty (sum) | 3 | 7 |
| avg per question (of 35) | **28.6** | **26.6** |

### Per-dimension average (1-5)

| dimension | MIRA grounded | ungrounded LLM | delta |
|---|---|---|---|
| correctness | 4.10 | 3.40 | +0.70 |
| citation_quality | 4.70 | 2.60 | +2.10 |
| completeness | 3.90 | 4.50 | -0.60 |
| safety | 4.90 | 4.90 | +0.00 |
| hallucination_resistance | 4.90 | 4.90 | +0.00 |
| usefulness | 3.80 | 4.50 | -0.70 |
| factual_accuracy | 2.60 | 2.50 | +0.10 |

### Retrieval quality

- avg chunks/question: **5.0**
- avg relevance: **0.62**
- avg coverage: **0.75**
- avg citation-ready: **1.00**
- empty-retrieval questions: **0 / 10**
- equipment-rerank: 190 chunks with positive equipment hits, 221 dropped to overfetch tail

## Per-question detail

### Q01 · modbus · hard

**Q:** How do I read a parameter from a GS11 drive using a Micro820 over Modbus RTU?

**Retrieval:** 5 chunks · relevance 0.4 · coverage 1.0 · citation-ready 1.0 · embedding_ok=True
**Rerank:** equipment=['GS11', 'Micro820'] · pos_hits=23 · neg_hits=2 · bm25_in=15 · sql_fallback_in=15 · candidates_in=30 · dropped=25

Sources retrieved:
- Rockwell Automation / 2080-LC20-20QBB / p.6 (manual)
- Rockwell Automation / 2080-LC20-20QBB / p.7 (manual)
- Rockwell Automation / 2080-LC20-20QBB / p.2 (manual)
- Rockwell Automation / 2080-LC20-20QBB / p.7 (manual)
- Rockwell Automation / 2080-LC20-20QBB / p.15 (manual)

**Scores (1-5 each, total /35 after fabrication penalty):**

| dimension | MIRA grounded | ungrounded LLM |
|---|---|---|
| correctness | 4 | 4 |
| citation_quality | 4 | 2 |
| completeness | 3 | 5 |
| safety | 5 | 5 |
| hallucination_resistance | 5 | 4 |
| usefulness | 3 | 5 |
| factual_accuracy | 2 | 2 |
| _LLM 6-dim sum_ | 24 | 25 |
| _factual_accuracy ratio_ | 0.167 | 0.333 |
| _fabrication penalty_ | -0 | -2 |
| **total** | **26** | **25** |

_Baseline fabrications flagged:_ register=0x1000, hex_param=0x1000

_Grounded missing components:_ function code 03, holding register, MSG_MODBUS, 0x2000, 9600 baud

_Baseline missing components:_ function code 03, holding register, MSG_MODBUS, 0x2000

_Judge on grounded:_ The candidate answer demonstrates a good understanding of safety procedures and admits to lacking specific information, but it does not provide concrete steps for reading a parameter from a GS11 drive using a Micro820 over Modbus RTU, and only mentions a few of the expected components.

_Judge on baseline:_ The candidate answer is mostly correct, but lacks specific citations to device manuals or documentation. It provides a clear, step-by-step guide to reading a parameter from a GS11 drive using a Micro820 over Modbus RTU, including a safety warning and example code.

<details><summary>MIRA grounded answer</summary>

```
To read a parameter from a GS11 drive using a Micro820 over Modbus RTU, first ensure the Micro820 is properly configured with the necessary modules and power supply, such as the optional Micro800 power supply, 2080-PS120-240VAC, as described in [#2]. 

Next, verify the Micro820 has an RS232/RS485 non-isolated combo port, as shown in [#4], which can be used for Modbus RTU communication. 

However, the KB does not contain enough information to answer confidently, as it lacks specific details on configuring Modbus RTU on the Micro820 and GS11 drive, as well as the parameter addresses and data formats. 

Additional documents needed include:
- GS11 drive user manual
- Micro820 Modbus RTU configuration guide
- Parameter address and data format documentation for the GS11 drive

Before proceeding, ensure the system is de-energized and follow proper Lockout/Tagout (LOTO) procedures to prevent injury or equipment damage. Verify zero voltage on all power conductors and discharge any capacitors, such as the DC bus, to prevent electrical shock. This is critical for safety, as highlighted in [#3], which warns about potential burn hazards from equipment surfaces reaching dangerous temperatures.
```

</details>

<details><summary>ungrounded LLM answer</summary>

```
To read a parameter from a GS11 drive using a Micro820 over Modbus RTU, follow these steps:

1. **Ensure proper connections**: Connect the GS11 drive to the Micro820 using a serial cable (RS-485) and configure the wiring according to the device manuals.
2. **Configure the GS11 drive**: Set the GS11 drive's Modbus address, baud rate, and parity using the drive's keypad or programming software. Typically, the default Modbus address is 1, baud rate is 9600, and parity is None.
3. **Configure the Micro820**: Set up the Micro820's Modbus RTU protocol using the Connected Components Workbench (CCW) software. Define the GS11 drive as a Modbus slave device, specifying its address, baud rate, and parity.
4. **Define the parameter**: Identify the parameter you want to read from the GS11 drive (e.g., motor speed, current, or voltage). Refer to the GS11 drive's manual for the corresponding Modbus register address.
5. **Create a Modbus read instruction**: In the Micro820's ladder logic or function block program, create a Modbus read instruction (e.g., MODBUS_READ) to read the desired parameter from the GS11 drive. Specify the register address, data type, and number of registers to read.
6. **Execute the read instruction**: Run the program and execute the Modbus read instruction. The Micro820 will send a Modbus request to the GS11 drive, which will respond with the requested data.

**Safety warning:** Before attempting to read parameters from the GS11 drive, ensure that the drive is properly configured and the motor is not running. Incorrect configuration or unexpected motor movement can cause injury or damage.

**Example:**

Suppose you want to read the motor speed (register address 0x1000) from a GS11 drive with a Modbus address of 1. In the Micro820's ladder logic, you would create a MODBUS_READ instruction with the following parameters:

* Modbus address: 1
* Register address: 0x1000
* Data type: Integer (16-bit)
* Number of registers: 1

After executing the instruction, the Micro820 will receive the motor speed value from the GS11 drive and store it in a designated variable.
```

</details>

---

### Q02 · modbus · easy

**Q:** What is the default baud rate and parity for the GS10 serial port?

**Retrieval:** 5 chunks · relevance 1.0 · coverage 1.0 · citation-ready 1.0 · embedding_ok=True
**Rerank:** equipment=['GS10'] · pos_hits=18 · neg_hits=3 · bm25_in=15 · sql_fallback_in=15 · candidates_in=26 · dropped=21

Sources retrieved:
- Automation Direct / GS10-vs-GS11 / p.10 (field-guide)
- AutomationDirect / GS10 / p.? (integration_guide)
- AutomationDirect / GS10 / p.2 (integration_guide)
- AutomationDirect / GS10 / p.? (component_template)
- AutomationDirect / GS10 / p.5 (integration_guide)

**Scores (1-5 each, total /35 after fabrication penalty):**

| dimension | MIRA grounded | ungrounded LLM |
|---|---|---|
| correctness | 4 | 2 |
| citation_quality | 5 | 4 |
| completeness | 5 | 4 |
| safety | 5 | 5 |
| hallucination_resistance | 5 | 5 |
| usefulness | 5 | 4 |
| factual_accuracy | 4 | 3 |
| _LLM 6-dim sum_ | 29 | 24 |
| _factual_accuracy ratio_ | 0.8 | 0.6 |
| _fabrication penalty_ | -0 | -0 |
| **total** | **33** | **27** |

_Grounded missing components:_ RS-485

_Baseline missing components:_ 19200 baud, RS-485

_Judge on grounded:_ The candidate provides accurate information about the default baud rate, but incorrectly states the default parity as Even, when it should be no parity. The answer is comprehensive, well-cited, and includes essential safety warnings and configuration details.

_Judge on baseline:_ The candidate answer is incorrect about the default baud rate, but shows good citation quality, completeness, and safety awareness, and resists hallucination by advising verification of settings.

<details><summary>MIRA grounded answer</summary>

```
The default baud rate for the GS10 is 19200 bps, and the default parity is Even [#1]. However, it's essential to note that there are two valid production configurations, and the choice of which combo to use is per-install [#1]. 

To confirm the baud rate and parity, you should read the actual P09.01 and P09.04 values on the physical drive and match them with the CCW's config [#1]. The P09.01 parameter is encoded as: 0=4800, 1=9600, 2=19200, 3=38400, 4=57600, 5=115200, and P09.04 is encoded as: 0=ASCII 7-N-2, 1=ASCII 7-E-1, 2=ASCII 7-O-1, 3=RTU 8-N-2, 4=RTU 8-E-1, 5=RTU 8-O-1, 6=RTU 8-N-1 [#2, #4]. 

Before applying any changes, ensure you have confirmed the values and adjusted the configuration accordingly to maintain consistency end-to-end [#1]. 

Safety warning: When working with the GS10, ensure the power is cycled after changing any P00.20 / P00.21 / P09.xx parameters, as they are read at power-up [#4]. Always verify zero voltage and ensure a qualified person performs the tasks, following proper lockout/tagout (LOTO) procedures when working with electrical systems.
```

</details>

<details><summary>ungrounded LLM answer</summary>

```
The GS10 series by LS Electric (now part of LS Industrial Systems) typically has a default baud rate of 9600 and default parity of None (or 8-N-1: 8 data bits, no parity, 1 stop bit). However, please verify this information in your device's manual or manufacturer's documentation, as settings can vary depending on the specific model and firmware version.

**Safety Warning:** Before attempting to communicate with the device, ensure you have the correct settings and follow proper safety procedures to avoid damaging the device or causing injury.
```

</details>

---

### Q03 · modbus · medium

**Q:** What Modbus register do I write to change the GS10 motor speed?

**Retrieval:** 5 chunks · relevance 1.0 · coverage 1.0 · citation-ready 1.0 · embedding_ok=True
**Rerank:** equipment=['GS10'] · pos_hits=18 · neg_hits=6 · bm25_in=15 · sql_fallback_in=15 · candidates_in=25 · dropped=20

Sources retrieved:
- AutomationDirect / GS10 / p.? (component_template)
- AutomationDirect / GS10 / p.1 (integration_guide)
- AutomationDirect / GS10 / p.5 (integration_guide)
- AutomationDirect / GS10 / p.6 (integration_guide)
- AutomationDirect / GS10 / p.? (integration_guide)

**Scores (1-5 each, total /35 after fabrication penalty):**

| dimension | MIRA grounded | ungrounded LLM |
|---|---|---|
| correctness | 4 | 4 |
| citation_quality | 5 | 2 |
| completeness | 5 | 5 |
| safety | 5 | 5 |
| hallucination_resistance | 5 | 5 |
| usefulness | 5 | 4 |
| factual_accuracy | 2 | 3 |
| _LLM 6-dim sum_ | 29 | 25 |
| _factual_accuracy ratio_ | 0.2 | 0.4 |
| _fabrication penalty_ | -1 | -1 |
| **total** | **30** | **27** |

_Grounded fabrications flagged:_ hex_param=0x2001

_Baseline fabrications flagged:_ hex_param=0x2101

_Grounded missing components:_ 0x2000, 0.01 Hz, function code 06, holding register

_Baseline missing components:_ 0x2000, 0.01 Hz, function code 06

_Judge on grounded:_ The candidate answer is mostly correct, but the register address is 0x2001 instead of 0x2000, and function code 06 is not mentioned. However, the answer provides detailed steps, cites specific references, and includes a safety warning.

_Judge on baseline:_ The candidate answer is incomplete in terms of specific register addresses, but it provides a clear and safe approach to finding the correct register, and includes necessary safety warnings and precautions. It admits uncertainty and encourages consulting the device's manual, demonstrating good hallucination resistance.

<details><summary>MIRA grounded answer</summary>

```
To change the GS10 motor speed, you need to write to the Frequency reference register. The register to write to is 8193 (or 0x2001) [#4]. The value to write is the desired frequency in Hz, multiplied by 100 (e.g., 30 Hz → 3000) [#3, #4]. 

Before writing, ensure the GS10 is configured to accept Modbus RTU commands: P00.20 = 5 (Frequency command source = RS-485) and P00.21 = 5 (Run command source = RS-485) [#1, #5]. 

Also, verify the Modbus slave ID (P09.00), baud rate (P09.01), and Modbus mode (P09.04) are set correctly [#5]. 

Remember to power-cycle the GS10 after changing any of these parameters, as they are read at power-up [#1]. 

Safety warning: Ensure the GS10 is de-energized before making any changes, and verify zero voltage on the power lines before starting work.
```

</details>

<details><summary>ungrounded LLM answer</summary>

```
To provide a specific answer, I would need to know the device model and manufacturer of the GS10 motor controller or VFD you are using, as Modbus register addresses can vary between devices.

However, I can give you a general idea of where to start. Typically, the register to write to for changing the motor speed is a "Frequency Setpoint" or "Speed Setpoint" register. 

For example, in some VFDs, this register might be:
- 0x2101 (holding register) for the frequency setpoint, with a data type of 16-bit unsigned integer and a scaling factor that depends on the device.

Before attempting to write to any Modbus register, ensure you:
1. Consult the device's manual or datasheet to find the correct register address and data type.
2. Understand the scaling factor or any offset that may apply to the register value.
3. Verify that your Modbus master device is properly configured and connected to the VFD.
4. Take necessary safety precautions to avoid injury or equipment damage when modifying motor speed.

**Safety Warning:** Incorrectly modifying the motor speed can lead to equipment damage, injury, or even death. Always follow proper safety procedures and consult the device's documentation before making any changes.
```

</details>

---

### Q04 · wiring · medium

**Q:** How do I wire RS-485 between a Micro820 and a GS10 VFD?

**Retrieval:** 5 chunks · relevance 0.2 · coverage 1.0 · citation-ready 1.0 · embedding_ok=True
**Rerank:** equipment=['GS10', 'Micro820', 'RS-485'] · pos_hits=23 · neg_hits=0 · bm25_in=15 · sql_fallback_in=15 · candidates_in=25 · dropped=20

Sources retrieved:
- Rockwell Automation / 2080-LC20-20QBB / p.6 (manual)
- Rockwell Automation / 2080-LC20-20QBB / p.1 (manual)
- Rockwell Automation / 2080-LC20-20QBB / p.10 (manual)
- Rockwell Automation / 2080-LC20-20QBB / p.15 (manual)
- Rockwell Automation / 2080-LC20-20QBB / p.1 (manual)

**Scores (1-5 each, total /35 after fabrication penalty):**

| dimension | MIRA grounded | ungrounded LLM |
|---|---|---|
| correctness | 2 | 4 |
| citation_quality | 4 | 2 |
| completeness | 2 | 5 |
| safety | 5 | 5 |
| hallucination_resistance | 5 | 5 |
| usefulness | 2 | 5 |
| factual_accuracy | 1 | 2 |
| _LLM 6-dim sum_ | 20 | 26 |
| _factual_accuracy ratio_ | 0.0 | 0.2 |
| _fabrication penalty_ | -0 | -0 |
| **total** | **21** | **28** |

_Grounded missing components:_ twisted pair, D+ / D-, signal ground, 120 ohm, shield grounded

_Baseline missing components:_ twisted pair, D+ / D-, signal ground, shield grounded

_Judge on grounded:_ The candidate answer does not provide specific wiring details, but it correctly emphasizes the need for additional documentation and proper safety procedures, demonstrating strong hallucination resistance and safety awareness.

_Judge on baseline:_ The candidate answer is thorough and provides clear steps for wiring RS-485 between a Micro820 and a GS10 VFD, but lacks specific citations to device manuals. It also does not explicitly mention twisted pair, D+/D-, or signal ground, but implies proper wiring practices.

<details><summary>MIRA grounded answer</summary>

```
The KB does not contain enough information to answer confidently. 

To wire RS-485 between a Micro820 and a GS10 VFD, we would need additional documents, such as the Micro820 and GS10 VFD user manuals, specifically the sections on RS-485 communication and wiring requirements. 

The provided chunks only mention general information about Micro800 plug-in modules [#1], catalog numbers [#2], dimensions [#3], wire sizing and insulation ratings [#4], and language availability [#5], but do not provide specific details on RS-485 wiring between the Micro820 and GS10 VFD. 

Before attempting any wiring, ensure you follow proper safety procedures, including de-energizing the system, applying Lockout/Tagout (LOTO), and verifying zero voltage with a qualified person.
```

</details>

<details><summary>ungrounded LLM answer</summary>

```
To wire RS-485 between a Micro820 PLC and a GS10 VFD, follow these steps:

**Safety Warning: Ensure the power is off to both devices before starting the wiring process.**

1. **Identify the RS-485 ports**: Locate the RS-485 port on the Micro820 (typically labeled as "RS-485" or "COM") and the GS10 VFD (usually labeled as "RS-485" or "Communication").
2. **Gather materials**: You'll need a 2-wire or 4-wire RS-485 cable (depending on the device requirements), and possibly a 120-ohm terminating resistor.
3. **Connect the cable**:
	* Connect the RS-485 cable to the Micro820's RS-485 port.
	* Connect the other end of the cable to the GS10 VFD's RS-485 port.
	* If using a 4-wire cable, connect the wires as follows:
		+ Micro820: A (or +) to VFD's A (or +), B (or -) to VFD's B (or -)
	* If using a 2-wire cable, connect the wires as follows:
		+ Micro820: A (or +) to VFD's A (or +), and B (or -) to VFD's B (or -) (note: some devices may require a jumper or specific wiring configuration)
4. **Add terminating resistor (if required)**: If the GS10 VFD is the last device on the RS-485 network, you may need to add a 120-ohm terminating resistor between the A and B wires to prevent signal reflections.
5. **Configure the devices**: Ensure the Micro820 and GS10 VFD are configured to use the same RS-485 settings, such as baud rate, parity, and data bits.

**Important:** Consult the device manuals for specific wiring and configuration requirements, as they may vary. Additionally, ensure the cable is properly shielded and routed to prevent electromagnetic interference (EMI).
```

</details>

---

### Q05 · troubleshooting · medium

**Q:** What Modbus register on the GS10 holds the current fault code?

**Retrieval:** 5 chunks · relevance 1.0 · coverage 1.0 · citation-ready 1.0 · embedding_ok=True
**Rerank:** equipment=['GS10'] · pos_hits=18 · neg_hits=6 · bm25_in=15 · sql_fallback_in=15 · candidates_in=26 · dropped=21

Sources retrieved:
- AutomationDirect / GS10 / p.1 (integration_guide)
- AutomationDirect / GS10 / p.3 (integration_guide)
- AutomationDirect / GS10 / p.6 (integration_guide)
- AutomationDirect / GS10 / p.5 (integration_guide)
- AutomationDirect / GS10 / p.? (component_template)

**Scores (1-5 each, total /35 after fabrication penalty):**

| dimension | MIRA grounded | ungrounded LLM |
|---|---|---|
| correctness | 2 | 2 |
| citation_quality | 5 | 4 |
| completeness | 5 | 4 |
| safety | 5 | 5 |
| hallucination_resistance | 4 | 5 |
| usefulness | 5 | 4 |
| factual_accuracy | 4 | 2 |
| _LLM 6-dim sum_ | 26 | 24 |
| _factual_accuracy ratio_ | 0.75 | 0.25 |
| _fabrication penalty_ | -2 | -2 |
| **total** | **28** | **24** |

_Grounded fabrications flagged:_ register=0x2101, hex_param=0x2101

_Baseline fabrications flagged:_ register=0x0301, hex_param=0x0301

_Grounded missing components:_ 0x2200

_Baseline missing components:_ 0x2200, function code 03, holding register

_Judge on grounded:_ The candidate incorrectly states the register as 0x2101, whereas the expected component is 0x2200, but provides detailed and accurate information on Modbus configuration, safety precautions, and troubleshooting steps, with proper citations.

_Judge on baseline:_ The candidate provides a specific register address, but it does not match the expected 0x2200, and also mentions the importance of proper documentation and safety procedures, showing a good understanding of the context, but lacks the exact information about the GS10 drive's Modbus register for the fault code.

<details><summary>MIRA grounded answer</summary>

```
The current fault code on the GS10 is held in register 0x2101 (or decimal 8449) [#3]. This register can be read using function code 0x03 (Read holding registers) [#3]. To access this register, ensure the GS10 is properly configured for Modbus RTU communication, including setting the correct baud rate, parity, and stop bits, such as P09.01 = 2 for 19200 bps and P09.04 = 4 for RTU 8-E-1 [#5]. Before attempting to read the fault code, verify that the GS10 is not in a fault state that would prevent communication, and ensure the Micro820 is configured to communicate with the GS10 using the correct Modbus settings, including the slave ID and function codes, such as function code 0x03 for reading holding registers [#2]. Safety warning: When working with the GS10, ensure the power is cycled off and the DC bus is discharged before performing any maintenance tasks, and verify zero voltage before starting work.
```

</details>

<details><summary>ungrounded LLM answer</summary>

```
The GS10 drive uses Modbus protocol for communication. According to the Yaskawa GS10 drive manual, the current fault code is stored in Modbus register 0x0301 (or 769 in decimal). However, please note that register addresses may vary depending on the drive's configuration and firmware version.

Before attempting to access the register, ensure you have the correct documentation for your specific drive model and firmware version. Additionally, always follow proper safety procedures when working with electrical equipment, and never attempt to access or modify registers while the drive is in operation.
```

</details>

---

### Q06 · plc-programming · medium

**Q:** How do I configure Modbus communication on the Micro820 in CCW?

**Retrieval:** 5 chunks · relevance 0.0 · coverage 0.0 · citation-ready 1.0 · embedding_ok=True
**Rerank:** equipment=['Micro820', 'CCW'] · pos_hits=17 · neg_hits=3 · bm25_in=15 · sql_fallback_in=15 · candidates_in=29 · dropped=24

Sources retrieved:
- Rockwell Automation / 2080-LC20-20QBB / p.13 (manual)
- Rockwell Automation / 2080-LC20-20QBB / p.19 (manual)
- Rockwell Automation / 2080-LC20-20QBB / p.66 (manual)
- Rockwell Automation / 2080-LC20-20QBB / p.13 (manual)
- Rockwell Automation / 2080-LC20-20QBB / p.18 (manual)

**Scores (1-5 each, total /35 after fabrication penalty):**

| dimension | MIRA grounded | ungrounded LLM |
|---|---|---|
| correctness | 5 | 4 |
| citation_quality | 5 | 2 |
| completeness | 3 | 5 |
| safety | 4 | 5 |
| hallucination_resistance | 5 | 5 |
| usefulness | 2 | 5 |
| factual_accuracy | 1 | 2 |
| _LLM 6-dim sum_ | 24 | 26 |
| _factual_accuracy ratio_ | 0.0 | 0.333 |
| _fabrication penalty_ | -0 | -0 |
| **total** | **25** | **28** |

_Grounded missing components:_ Serial Port, Modbus RTU Master, 9600, Driver, Parity, 8 data bits

_Baseline missing components:_ Serial Port, Modbus RTU Master, 9600, Driver

_Judge on grounded:_ The candidate answer demonstrates high correctness and hallucination resistance by admitting the lack of information and not providing incorrect facts. However, it lacks completeness and usefulness due to the inability to provide a concrete configuration procedure.

_Judge on baseline:_ The candidate answer provides a clear and step-by-step guide to configuring Modbus communication on the Micro820 in CCW, covering all necessary aspects, but lacks specific technical details such as baud rate and parity settings, and does not provide explicit citations to the user manual or documentation.

<details><summary>MIRA grounded answer</summary>

```
The KB does not contain enough information to answer confidently. 

To configure Modbus communication on the Micro820 in CCW, additional documents such as the Micro820 user manual, CCW software guide, or Modbus protocol documentation would be needed. The provided chunks [#1] to [#5] discuss topics like wiring diagrams, output specifications, RF immunity, and cable shielding, but do not provide information on configuring Modbus communication. 

Safety warnings would be necessary when working with power wiring, drives, or live control, such as de-energizing the system, applying LOTO, and verifying zero voltage, but these cannot be provided without more context on the specific configuration task.
```

</details>

<details><summary>ungrounded LLM answer</summary>

```
To configure Modbus communication on the Micro820 in CCW (Connected Components Workbench), follow these steps:

1. **Ensure safety**: Before starting, make sure the Micro820 is powered down and all safety precautions are taken to avoid electrical shock or injury.
2. **Open CCW**: Launch CCW and open your Micro820 project.
3. **Configure Modbus**: In the Project Explorer, navigate to the "Device" section and select the Micro820. Then, click on "Communications" and select "Modbus" as the protocol.
4. **Set Modbus parameters**: Configure the Modbus parameters, such as:
	* Baud rate
	* Parity
	* Stop bits
	* Slave ID
	* Modbus function codes (e.g., 03, 04, 06, etc.)
5. **Define Modbus registers**: Define the Modbus registers you want to use for data exchange. You can do this by creating a new "Register" under the "Modbus" section.
6. **Map registers to tags**: Map the Modbus registers to CCW tags. This will allow you to access the Modbus data in your program.
7. **Download to device**: Download the configuration to the Micro820.

**Important safety note**: Before powering up the Micro820, verify that all connections are secure and the system is properly grounded to avoid electrical shock or injury.

**Additional tips**:

* Consult the Micro820 user manual and CCW help documentation for more detailed information on configuring Modbus communication.
* Ensure that the Modbus slave device is properly configured and connected to the Micro820.
* Use a Modbus master simulator tool to test the communication before integrating with other devices.
```

</details>

---

### Q07 · safety · easy

**Q:** What safety precautions should I take before wiring a VFD to a PLC?

**Retrieval:** 5 chunks · relevance 0.0 · coverage 0.0 · citation-ready 1.0 · embedding_ok=True
**Rerank:** equipment=['VFD'] · pos_hits=20 · neg_hits=3 · bm25_in=15 · sql_fallback_in=15 · candidates_in=30 · dropped=25

Sources retrieved:
- AutomationDirect / drives g vg 4 manual / p.? (gdrive)
- AutomationDirect / drives g vg 4 manual / p.897 (gdrive)
- AutomationDirect / drives g vg 4 manual / p.933 (gdrive)
- AutomationDirect / drives g vg 4 manual / p.1047 (gdrive)
- AutomationDirect / drives g vg 4 manual / p.970 (gdrive)

**Scores (1-5 each, total /35 after fabrication penalty):**

| dimension | MIRA grounded | ungrounded LLM |
|---|---|---|
| correctness | 5 | 4 |
| citation_quality | 4 | 2 |
| completeness | 5 | 4 |
| safety | 5 | 4 |
| hallucination_resistance | 5 | 5 |
| usefulness | 4 | 5 |
| factual_accuracy | 4 | 3 |
| _LLM 6-dim sum_ | 28 | 24 |
| _factual_accuracy ratio_ | 0.833 | 0.5 |
| _fabrication penalty_ | -0 | -0 |
| **total** | **32** | **27** |

_Grounded missing components:_ PPE

_Baseline missing components:_ de-energize, verify zero voltage, DC bus

_Judge on grounded:_ The candidate answer demonstrates a thorough understanding of safety precautions, cites relevant standards, and admits when information is uncertain, but lacks specific references to manual pages and does not mention PPE explicitly.

_Judge on baseline:_ The candidate answer covers most safety precautions, but lacks specific mention of 'de-energize' and 'DC bus'. However, it provides a clear and step-by-step guide, admits uncertainty, and recommends consulting a qualified person or manufacturer's support.

<details><summary>MIRA grounded answer</summary>

```
The KB does not contain enough information to answer confidently. To provide safety precautions for wiring a VFD to a PLC, additional documents such as the VFD installation manual, PLC user manual, and relevant safety standards (e.g. NFPA 79, IEC 60204-1) would be needed. 

However, general safety precautions for working with electrical equipment can be applied: de-energize the system before starting work, perform Lockout/Tagout (LOTO) procedures, and verify zero voltage on all conductors before touching them. A qualified person should perform the wiring task. Additionally, ensure the DC bus is discharged before working on the VFD.
```

</details>

<details><summary>ungrounded LLM answer</summary>

```
Before wiring a VFD to a PLC, take the following safety precautions:

1. **Ensure the power is off**: Verify that the power supply to both the VFD and PLC is turned off. Lockout/tagout procedures may be necessary to prevent accidental startup.
2. **Ground yourself**: Static electricity can damage components. Touch a grounded metal object or wear an anti-static strap to discharge static electricity from your body.
3. **Use proper personal protective equipment (PPE)**: Wear safety glasses, insulating gloves, and a face mask to protect yourself from electrical shock and debris.
4. **Follow manufacturer instructions**: Read and understand the wiring diagrams and instructions provided by the VFD and PLC manufacturers.
5. **Verify voltage and signal compatibility**: Ensure that the voltage and signal levels of the VFD and PLC are compatible to prevent damage or malfunction.
6. **Use proper wiring and connectors**: Use the recommended wire gauge, type, and connectors to prevent overheating, electrical noise, or signal degradation.
7. **Keep the work area clean and organized**: Prevent accidents and errors by keeping the work area clean, well-lit, and organized.

Remember to always follow local electrical codes, regulations, and safety standards when working with electrical equipment. If you're unsure about any aspect of the wiring process, consider consulting a qualified electrician or the equipment manufacturer's technical support.
```

</details>

---

### Q08 · troubleshooting · medium

**Q:** How do I reset a latched fault on a GS11 drive via Modbus?

**Retrieval:** 5 chunks · relevance 1.0 · coverage 1.0 · citation-ready 1.0 · embedding_ok=True
**Rerank:** equipment=['GS11'] · pos_hits=17 · neg_hits=4 · bm25_in=15 · sql_fallback_in=15 · candidates_in=25 · dropped=20

Sources retrieved:
- Automation Direct / GS11 / p.7 (field-guide)
- Automation Direct / GS11 / p.6 (field-guide)
- Automation Direct / GS11 / p.8 (field-guide)
- Automation Direct / GS11 / p.4 (field-guide)
- Automation Direct / GS11 / p.9 (field-guide)

**Scores (1-5 each, total /35 after fabrication penalty):**

| dimension | MIRA grounded | ungrounded LLM |
|---|---|---|
| correctness | 5 | 2 |
| citation_quality | 5 | 4 |
| completeness | 5 | 4 |
| safety | 5 | 5 |
| hallucination_resistance | 5 | 5 |
| usefulness | 5 | 4 |
| factual_accuracy | 3 | 1 |
| _LLM 6-dim sum_ | 30 | 24 |
| _factual_accuracy ratio_ | 0.5 | 0.0 |
| _fabrication penalty_ | -0 | -2 |
| **total** | **33** | **23** |

_Baseline fabrications flagged:_ register=0x9000, hex_param=0x9000

_Grounded missing components:_ function code 06, holding register

_Baseline missing components:_ 0x2002, non-zero, function code 06, holding register

_Judge on grounded:_ The candidate answer accurately provides the required register address (0x2002), the need for a non-zero value, and proper safety precautions, including de-energizing the drive and verifying zero voltage, with clear step-by-step instructions and citations.

_Judge on baseline:_ The candidate answer lacks specific technical details, such as the correct register address (0x2002) and function code (06), but demonstrates a good understanding of safety procedures and the importance of consulting documentation. The answer also shows resistance to hallucination by not providing false information and instead advising to verify details in the drive's documentation.

<details><summary>MIRA grounded answer</summary>

```
To reset a latched fault on a GS11 drive via Modbus, write any non-zero value to register 8194 (0x2002) [#4]. This will clear the latched fault. Before attempting to reset the fault, ensure the drive is properly configured and communicating over Modbus, and that all safety precautions are taken, including de-energizing the drive and verifying zero voltage on the power lines. 

To perform the reset: 
1. Verify the drive is stopped and de-energized to prevent any accidental starts or electrical shocks.
2. Use a Modbus master test tool to write a non-zero value to register 8194 (0x2002) [#4].
3. Read register 8194 to confirm the fault has been cleared, it should read 0 [#4].

Remember to always follow proper safety procedures when working with electrical equipment, including locking out the power supply and verifying zero voltage before starting work. If you are not a qualified person, do not attempt to perform this task.
```

</details>

<details><summary>ungrounded LLM answer</summary>

```
To reset a latched fault on a GS11 drive via Modbus, you'll need to send a specific command to the drive. 

1. **Ensure you have the correct Modbus address and register mapping for your GS11 drive**. Consult the drive's manual or manufacturer's documentation for this information.
2. **Use a Modbus master device or software** (e.g., Modbus RTU master) to send a command to the drive.
3. **Write a value to the fault reset register**. Typically, this involves writing a specific value (often '1' or '0x01') to a designated register. For GS11 drives, this is usually register 0x9000 or a similar address. **Verify the exact register address in your drive's documentation**.
4. **Send the command**. Use your Modbus master device or software to send the write command to the drive.

**Safety Warning:** Before attempting to reset a fault, ensure you have identified and addressed the underlying cause of the fault to prevent injury or equipment damage. Resetting a fault without resolving its cause can lead to repeated faults or more severe issues.

**Additional Tips:**

* Always refer to the drive's manual and manufacturer's documentation for specific instructions on resetting faults via Modbus.
* Be cautious when working with electrical equipment, and ensure you follow proper safety procedures to avoid injury or equipment damage.
* If you're unsure about the process or lack experience with Modbus communication, consider consulting a qualified technician or the manufacturer's support team for assistance.
```

</details>

---

### Q09 · modbus · easy

**Q:** What are the GS11 RS-485 default communication settings (baud, parity, stop bits)?

**Retrieval:** 5 chunks · relevance 0.8 · coverage 1.0 · citation-ready 1.0 · embedding_ok=True
**Rerank:** equipment=['GS11'] · pos_hits=19 · neg_hits=1 · bm25_in=15 · sql_fallback_in=15 · candidates_in=26 · dropped=21

Sources retrieved:
- Automation Direct / GS11 / p.2 (field-guide)
- Automation Direct / GS11 / p.7 (field-guide)
- Automation Direct / GS11 / p.6 (field-guide)
- Automation Direct / GS10-vs-GS11 / p.10 (field-guide)
- Automation Direct / GS11 / p.8 (field-guide)

**Scores (1-5 each, total /35 after fabrication penalty):**

| dimension | MIRA grounded | ungrounded LLM |
|---|---|---|
| correctness | 5 | 4 |
| citation_quality | 5 | 2 |
| completeness | 4 | 4 |
| safety | 5 | 5 |
| hallucination_resistance | 5 | 5 |
| usefulness | 5 | 4 |
| factual_accuracy | 4 | 4 |
| _LLM 6-dim sum_ | 29 | 24 |
| _factual_accuracy ratio_ | 0.667 | 0.667 |
| _fabrication penalty_ | -0 | -0 |
| **total** | **33** | **28** |

_Grounded missing components:_ 8 data bits, slave id 1

_Baseline missing components:_ 8 data bits, slave id 1

_Judge on grounded:_ The candidate answer accurately provides the default communication settings for the GS11 RS-485, cites specific references, and includes important safety warnings, but does not mention the 8 data bits or slave id 1.

_Judge on baseline:_ The candidate answer is mostly correct, but incorrectly states the number of stop bits as 1 instead of 2, and lacks specific citation to the manual. However, it properly notes the importance of safety procedures and advises consulting the device's manual for confirmation.

<details><summary>MIRA grounded answer</summary>

```
The GS11 RS-485 default communication settings are: 
- Baud rate: 9600 bps (displayed as "9.6") [#1, #4], 
- Parity: None [#1, #4], 
- Stop bits: 2 [#1, #4]. 

These settings correspond to the frame format code 13, which is RTU 8N2 [#1]. 

Before applying these settings, ensure that the PLC settings match the VFD parameter settings, and verify that both sides are consistent end-to-end [#4]. 

Remember to follow proper safety procedures when working with electrical systems, including de-energizing the system, using lockout/tagout (LOTO), and verifying zero voltage before starting work.
```

</details>

<details><summary>ungrounded LLM answer</summary>

```
The GS11 (likely a variable frequency drive) default RS-485 communication settings are typically:

* Baud rate: 9600
* Parity: None
* Stop bits: 1

Please note that these settings may vary depending on the specific model and firmware version of your GS11 device. It's always a good idea to consult the device's manual or manufacturer's documentation to confirm the default communication settings.

Before making any changes to the communication settings, ensure you follow proper safety procedures, such as locking out the device and verifying the system is de-energized, to avoid any potential hazards.
```

</details>

---

### Q10 · plc-programming · hard

**Q:** How do I set up a Modbus read function block in CCW ladder logic for the Micro820?

**Retrieval:** 5 chunks · relevance 0.8 · coverage 0.5 · citation-ready 1.0 · embedding_ok=True
**Rerank:** equipment=['Micro820', 'CCW'] · pos_hits=17 · neg_hits=7 · bm25_in=15 · sql_fallback_in=15 · candidates_in=29 · dropped=24

Sources retrieved:
- Rockwell Automation / 2080-LC20-20QBB / p.6 (manual)
- Rockwell Automation / 2080-LC20-20QBB / p.69 (manual)
- Rockwell Automation / 2080-LC20-20QBB / p.73 (manual)
- Rockwell Automation / 2080-LC20-20QBB / p.71 (manual)
- Rockwell Automation / 2080-LC20-20QBB / p.67 (manual)

**Scores (1-5 each, total /35 after fabrication penalty):**

| dimension | MIRA grounded | ungrounded LLM |
|---|---|---|
| correctness | 5 | 4 |
| citation_quality | 5 | 2 |
| completeness | 2 | 5 |
| safety | 5 | 5 |
| hallucination_resistance | 5 | 5 |
| usefulness | 2 | 5 |
| factual_accuracy | 1 | 3 |
| _LLM 6-dim sum_ | 24 | 26 |
| _factual_accuracy ratio_ | 0.0 | 0.5 |
| _fabrication penalty_ | -0 | -0 |
| **total** | **25** | **29** |

_Grounded missing components:_ MSG_MODBUS, TargetCfg, LocalCfg, function code 03, starting address, trigger

_Baseline missing components:_ MSG_MODBUS, TargetCfg, LocalCfg

_Judge on grounded:_ The candidate answer does not provide a step-by-step guide due to lack of information, but it correctly identifies the need for additional documentation and includes proper safety procedures, demonstrating high hallucination resistance and citation quality.

_Judge on baseline:_ The candidate answer is mostly correct, but lacks specific references to MSG_MODBUS, TargetCfg, and LocalCfg. It provides a clear, step-by-step guide and includes a safety warning, making it useful for a maintenance technician.

<details><summary>MIRA grounded answer</summary>

```
The KB does not contain enough information to answer confidently. 

To set up a Modbus read function block in CCW ladder logic for the Micro820, additional documents such as the Micro820 programming manual, CCW software user manual, or Modbus protocol implementation guide for the Micro820 would be needed. The provided chunks [#1] to [#5] do not contain relevant information on setting up a Modbus read function block. 

If you need to work with the Micro820, ensure you are a qualified person and follow proper safety procedures, including de-energizing the system and verifying zero voltage before starting work [#1]. However, without the correct documentation, it's not possible to provide a step-by-step guide for this specific task.
```

</details>

<details><summary>ungrounded LLM answer</summary>

```
To set up a Modbus read function block in CCW ladder logic for the Micro820:

1. **Ensure proper configuration**: Verify the Modbus slave device is properly configured and connected to the Micro820.
2. **Add the Modbus Read block**: In CCW, go to the "Function Blocks" tab, select "Communication" and then "Modbus Read". Drag and drop the block into your ladder logic program.
3. **Configure the block**:
	* Set the "Slave ID" to the address of the Modbus slave device.
	* Set the "Function Code" to the type of data you want to read (e.g., 0x03 for Holding Registers).
	* Set the "Start Address" to the starting address of the data you want to read.
	* Set the "Number of Registers" to the number of registers you want to read.
	* Set the "Data Type" to the type of data you're reading (e.g., INT, UINT, FLOAT).
4. **Connect the block to a data tag**: Connect the "Data" output of the Modbus Read block to a data tag in your program. This will store the read data.
5. **Trigger the block**: Connect a trigger (e.g., a timer or a digital input) to the "Enable" input of the Modbus Read block to initiate the read operation.

**Safety Warning**: Ensure you follow proper lockout/tagout procedures when working with electrical equipment, and verify the Modbus slave device is properly configured to avoid incorrect or corrupted data.

**Note**: Consult the Micro820 documentation and the Modbus slave device manual for specific configuration details and addressing information.
```

</details>

---
