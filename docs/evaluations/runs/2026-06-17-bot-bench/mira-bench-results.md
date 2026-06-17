# MIRA vs ungrounded-LLM benchmark — v2

**Run:** 20260617T051938+0000
**Started:** 2026-06-17T05:19:38+00:00
**Tenant:** `78917b56-f85f-43bb-9a08-1bb98a6cd6c3`
**Cascade:** groq → cerebras → gemini
**Retrieval limit:** 5 (overfetch 15, equipment rerank)
**Scorer:** 6 LLM dims + factual_accuracy + fabrication_penalty (max /35)

## Aggregate

| | MIRA grounded | ungrounded LLM |
|---|---|---|
| total (of 350) | **261** | **266** |
| total_raw (pre-fabrication) (of 350) | 263 | 273 |
| LLM-only sum (of 300, v1-comparable) | 239 | 248 |
| fabrication penalty (sum) | 2 | 7 |
| avg per question (of 35) | **26.1** | **26.6** |

### Per-dimension average (1-5)

| dimension | MIRA grounded | ungrounded LLM | delta |
|---|---|---|---|
| correctness | 4.00 | 3.40 | +0.60 |
| citation_quality | 3.60 | 2.50 | +1.10 |
| completeness | 3.50 | 4.50 | -1.00 |
| safety | 4.50 | 5.00 | -0.50 |
| hallucination_resistance | 5.00 | 4.90 | +0.10 |
| usefulness | 3.30 | 4.50 | -1.20 |
| factual_accuracy | 2.40 | 2.50 | -0.10 |

### Retrieval quality

- avg chunks/question: **5.0**
- avg relevance: **0.66**
- avg coverage: **0.75**
- avg citation-ready: **1.00**
- empty-retrieval questions: **0 / 10**
- equipment-rerank: 186 chunks with positive equipment hits, 245 dropped to overfetch tail

## Per-question detail

### Q01 · modbus · hard

**Q:** How do I read a parameter from a GS11 drive using a Micro820 over Modbus RTU?

**Retrieval:** 5 chunks · relevance 0.0 · coverage 0.0 · citation-ready 1.0 · embedding_ok=True
**Rerank:** equipment=['GS11', 'Micro820'] · pos_hits=20 · neg_hits=2 · bm25_in=15 · sql_fallback_in=15 · candidates_in=30 · dropped=25

Sources retrieved:
- Rockwell Automation / 2080-LC20-20QBB / p.67 (manual)
- Rockwell Automation / 2080-LC20-20QBB / p.66 (manual)
- Rockwell Automation / 2080-LC20-20QBB / p.68 (manual)
- Rockwell Automation / 2080-LC20-20QBB / p.15 (manual)
- Rockwell Automation / 2080-LC20-20QBB / p.1 (manual)

**Scores (1-5 each, total /35 after fabrication penalty):**

| dimension | MIRA grounded | ungrounded LLM |
|---|---|---|
| correctness | 3 | 4 |
| citation_quality | 2 | 2 |
| completeness | 2 | 5 |
| safety | 1 | 5 |
| hallucination_resistance | 5 | 5 |
| usefulness | 1 | 5 |
| factual_accuracy | 2 | 2 |
| _LLM 6-dim sum_ | 14 | 26 |
| _factual_accuracy ratio_ | 0.167 | 0.333 |
| _fabrication penalty_ | -0 | -2 |
| **total** | **16** | **26** |

_Baseline fabrications flagged:_ register=0x1000, hex_param=0x1000

_Grounded missing components:_ function code 03, holding register, MSG_MODBUS, 0x2000, 9600 baud

_Baseline missing components:_ function code 03, holding register, MSG_MODBUS, 0x2000

_Judge on grounded:_ The candidate answer does not provide a solution but admits the lack of information, showing high hallucination resistance. However, it lacks specific technical details, safety warnings, and concrete steps, resulting in lower scores for other dimensions.

_Judge on baseline:_ The candidate answer is mostly correct, but lacks specific citations to manuals or documentation, and does not explicitly mention function code 03, holding register, MSG_MODBUS, or 0x2000. However, it provides a clear and safe procedure for reading a parameter from a GS11 drive using a Micro820 over Modbus RTU.

<details><summary>MIRA grounded answer</summary>

```
The KB does not contain enough information to answer confidently. 

To read a parameter from a GS11 drive using a Micro820 over Modbus RTU, we would need additional documents such as the GS11 drive manual, Micro820 manual, and Modbus RTU protocol documentation. 

The provided chunks [#1] to [#5] appear to be related to product certifications, electromagnetic compatibility, and wiring specifications, but do not provide information on how to read parameters from a GS11 drive using a Micro820 over Modbus RTU. 

Additional documents needed would include:
- GS11 drive user manual
- Micro820 user manual
- Modbus RTU protocol documentation
- Any relevant application notes or technical guides for communicating between the Micro820 and GS11 drive over Modbus RTU.
```

</details>

<details><summary>ungrounded LLM answer</summary>

```
To read a parameter from a GS11 drive using a Micro820 over Modbus RTU, follow these steps:

1. **Ensure proper connections**: Connect the GS11 drive to the Micro820 using a serial cable (RS-485) and configure the wiring according to the GS11 drive's manual.
2. **Configure the GS11 drive**: Set the GS11 drive's Modbus address, baud rate, and parity using the drive's keypad or software. Typically, the default Modbus address is 1, baud rate is 9600, and parity is None.
3. **Configure the Micro820**: Set up the Micro820's Modbus RTU protocol using the Connected Components Workbench (CCW) software. Configure the Modbus settings to match the GS11 drive's settings (address, baud rate, parity, etc.).
4. **Define the parameter**: Identify the parameter you want to read from the GS11 drive (e.g., motor speed, current, etc.). Refer to the GS11 drive's manual for the parameter's address and data type.
5. **Create a Modbus read instruction**: In the Micro820's ladder logic or function block, create a Modbus read instruction using the `MODBUS_READ` function. Specify the GS11 drive's Modbus address, parameter address, and data type.
6. **Execute the read instruction**: Run the Micro820's program, and the `MODBUS_READ` instruction will retrieve the parameter value from the GS11 drive.

**Example**:
Suppose you want to read the motor speed (parameter address 0x1000) from a GS11 drive with a Modbus address of 1. In the Micro820's ladder logic, you would create a `MODBUS_READ` instruction with the following settings:
- Modbus address: 1
- Parameter address: 0x1000
- Data type: Integer (16-bit)
- Number of registers: 1

**Safety warning**: Before attempting to read or write parameters to the GS11 drive, ensure that the drive is in a safe state (e.g., stopped, disabled) to prevent accidental motor starts or other hazardous situations. Always follow proper lockout/tagout procedures when working with industrial equipment.
```

</details>

---

### Q02 · modbus · easy

**Q:** What is the default baud rate and parity for the GS10 serial port?

**Retrieval:** 5 chunks · relevance 1.0 · coverage 1.0 · citation-ready 1.0 · embedding_ok=True
**Rerank:** equipment=['GS10'] · pos_hits=20 · neg_hits=3 · bm25_in=15 · sql_fallback_in=15 · candidates_in=30 · dropped=25

Sources retrieved:
- AutomationDirect / GS10 / p.2 (integration_guide)
- AutomationDirect / GS10 / p.6 (integration_guide)
- Automation Direct / GS10-vs-GS11 / p.10 (field-guide)
- AutomationDirect / GS10 / p.5 (integration_guide)
- AutomationDirect / GS10 / p.? (integration_guide)

**Scores (1-5 each, total /35 after fabrication penalty):**

| dimension | MIRA grounded | ungrounded LLM |
|---|---|---|
| correctness | 2 | 2 |
| citation_quality | 5 | 4 |
| completeness | 5 | 4 |
| safety | 5 | 5 |
| hallucination_resistance | 5 | 5 |
| usefulness | 5 | 4 |
| factual_accuracy | 3 | 3 |
| _LLM 6-dim sum_ | 27 | 24 |
| _factual_accuracy ratio_ | 0.6 | 0.6 |
| _fabrication penalty_ | -0 | -0 |
| **total** | **30** | **27** |

_Grounded missing components:_ no parity, RS-485

_Baseline missing components:_ 19200 baud, RS-485

_Judge on grounded:_ The candidate incorrectly states the default parity as Even, when it should be no parity. However, they provide detailed citations, comprehensive information, and thorough safety warnings, making the answer useful despite the error.

_Judge on baseline:_ The candidate answer is incorrect about the default baud rate, but shows good citation quality, completeness, and safety awareness, and resists hallucination by advising verification of settings.

<details><summary>MIRA grounded answer</summary>

```
The default baud rate for the GS10 is 19200 bps, as indicated by the parameter P09.01 = 2 [#5]. The default parity is Even, with 8 data bits and 1 stop bit, as specified by the Modbus mode/frame parameter P09.04 = 4, which corresponds to RTU 8-E-1 [#5]. 

To confirm, ensure the GS10 is set to match the Micro820 configuration, with P09.01 = 2 (19200 bps) and P09.04 = 4 (RTU 8-E-1) [#3]. 

Before applying any changes, read the actual P09.01 and P09.04 values on the physical drive and confirm they match the Micro820 configuration [#3]. 

Safety warning: When working with the GS10 and Micro820, ensure the power is de-energized and verify zero voltage before making any changes to the configuration or wiring. Lockout/Tagout (LOTO) procedures should be followed, and only a qualified person should perform these tasks. Additionally, ensure the DC bus is discharged before starting work.
```

</details>

<details><summary>ungrounded LLM answer</summary>

```
The GS10 series by LS Electric (now part of LS Industrial Systems) typically has a default baud rate of 9600 and default parity of None (or 8-N-1: 8 data bits, no parity, 1 stop bit). However, please verify this information in your device's manual or manufacturer's documentation, as settings may vary depending on the specific model and firmware version.

**Safety Warning:** Before attempting to communicate with the device, ensure you have the correct settings and follow proper safety procedures to avoid damaging the equipment or causing injury.
```

</details>

---

### Q03 · modbus · medium

**Q:** What Modbus register do I write to change the GS10 motor speed?

**Retrieval:** 5 chunks · relevance 1.0 · coverage 1.0 · citation-ready 1.0 · embedding_ok=True
**Rerank:** equipment=['GS10'] · pos_hits=17 · neg_hits=9 · bm25_in=15 · sql_fallback_in=15 · candidates_in=27 · dropped=22

Sources retrieved:
- AutomationDirect / GS10 / p.2 (integration_guide)
- AutomationDirect / GS10 / p.6 (integration_guide)
- Automation Direct / GS10-vs-GS11 / p.10 (field-guide)
- AutomationDirect / GS10 / p.5 (integration_guide)
- AutomationDirect / GS10 / p.? (integration_guide)

**Scores (1-5 each, total /35 after fabrication penalty):**

| dimension | MIRA grounded | ungrounded LLM |
|---|---|---|
| correctness | 4 | 4 |
| citation_quality | 5 | 1 |
| completeness | 5 | 4 |
| safety | 5 | 5 |
| hallucination_resistance | 5 | 5 |
| usefulness | 5 | 4 |
| factual_accuracy | 2 | 3 |
| _LLM 6-dim sum_ | 29 | 23 |
| _factual_accuracy ratio_ | 0.2 | 0.4 |
| _fabrication penalty_ | -2 | -0 |
| **total** | **29** | **26** |

_Grounded fabrications flagged:_ register=8193, hex_param=0x2001

_Grounded missing components:_ 0x2000, 0.01 Hz, function code 06, holding register

_Baseline missing components:_ 0x2000, 0.01 Hz, function code 06

_Judge on grounded:_ The candidate answer is mostly correct, but the register address is 0x2001 instead of 0x2000, and function code 06 is not mentioned. However, the answer provides detailed steps, proper safety procedures, and cites specific references, making it very useful and complete.

_Judge on baseline:_ The candidate answer is incomplete in terms of specific register address, but it provides general guidance and emphasizes safety, which is commendable. It also resists hallucination by not providing incorrect information and instead asks for more context.

<details><summary>MIRA grounded answer</summary>

```
To change the GS10 motor speed, you need to write to the frequency reference register. The register to write to is 8193 (or 0x2001) [#2]. The value to write is the desired frequency in Hz, multiplied by 100. For example, to set the frequency to 30 Hz, you would write 3000 to register 8193 [#2, #4]. 

Before writing to this register, ensure that the GS10 is configured to accept frequency commands from the Modbus RTU master, by setting P00.20 = 5 and P00.21 = 5 [#1, #5]. Also, verify that the Modbus parameters, such as baud rate, parity, and stop bits, match between the GS10 and the Micro820 [#3]. 

Remember to follow proper safety procedures when working with the GS10, including de-energizing the drive and verifying zero voltage before making any changes. Ensure you are a qualified person to perform these tasks.
```

</details>

<details><summary>ungrounded LLM answer</summary>

```
To provide a specific answer, I would need to know the device model and manufacturer of your GS10 motor and its associated VFD (Variable Frequency Drive) or controller. 

Typically, the register to write to for changing the motor speed would be a holding register (4xxxx) in the Modbus address space. For example, it could be 40001 or 40002, but this can vary depending on the device.

**Before attempting to write to any Modbus register:**

1. Consult the device's documentation to determine the correct register address and data format (e.g., 16-bit or 32-bit, signed or unsigned).
2. Ensure you have the necessary permissions and access to modify the device's settings.
3. Verify that the device is in a safe state to accept new settings, and that changing the motor speed will not cause any safety hazards or equipment damage.

**Safety warning:** Incorrectly modifying device settings can result in equipment damage, injury, or even death. Always follow proper safety procedures and consult the device's documentation before making any changes.
```

</details>

---

### Q04 · wiring · medium

**Q:** How do I wire RS-485 between a Micro820 and a GS10 VFD?

**Retrieval:** 5 chunks · relevance 1.0 · coverage 1.0 · citation-ready 1.0 · embedding_ok=True
**Rerank:** equipment=['GS10', 'Micro820', 'RS-485'] · pos_hits=26 · neg_hits=0 · bm25_in=15 · sql_fallback_in=15 · candidates_in=30 · dropped=25

Sources retrieved:
- Rockwell Automation / 2080-LC20-20QBB / p.6 (manual)
- Rockwell Automation / 2080-LC20-20QBB / p.11 (manual)
- Rockwell Automation / 2080-LC20-20QBB / p.69 (manual)
- Rockwell Automation / 2080-LC20-20QBB / p.73 (manual)
- Rockwell Automation / 2080-LC20-20QBB / p.8 (manual)

**Scores (1-5 each, total /35 after fabrication penalty):**

| dimension | MIRA grounded | ungrounded LLM |
|---|---|---|
| correctness | 2 | 4 |
| citation_quality | 4 | 2 |
| completeness | 2 | 5 |
| safety | 4 | 5 |
| hallucination_resistance | 5 | 5 |
| usefulness | 2 | 5 |
| factual_accuracy | 1 | 3 |
| _LLM 6-dim sum_ | 19 | 26 |
| _factual_accuracy ratio_ | 0.0 | 0.4 |
| _fabrication penalty_ | -0 | -0 |
| **total** | **20** | **29** |

_Grounded missing components:_ twisted pair, D+ / D-, signal ground, 120 ohm, shield grounded

_Baseline missing components:_ twisted pair, D+ / D-, shield grounded

_Judge on grounded:_ The candidate answer does not provide specific wiring details, but it admits the lack of information and cites relevant documents, demonstrating good hallucination resistance and citation quality, while also mentioning safety precautions.

_Judge on baseline:_ The candidate answer is mostly correct, but lacks specific details about twisted pair, D+/D- and signal ground. It provides a clear and safe procedure for wiring RS-485 between a Micro820 and a GS10 VFD, and admits the need for consulting device manuals when unsure.

<details><summary>MIRA grounded answer</summary>

```
The KB does not contain enough information to answer confidently. 

To wire RS-485 between a Micro820 and a GS10 VFD, we would need additional documents, such as the Micro820 communication module manual, GS10 VFD manual, or a document that specifically describes the RS-485 wiring and configuration for these devices. 

However, we can find general information on proper wiring and grounding techniques in publication 1770-4.1, as mentioned in [#1] and [#5]. It is also important to note that when working with electrical systems, safety precautions should be taken, such as ensuring the power is removed or the area is nonhazardous, as warned in [#2]. 

Additional needed documents may include:
- Micro820 RS-485 communication module manual
- GS10 VFD manual
- RS-485 wiring and configuration guide for Micro820 and GS10 VFD.
```

</details>

<details><summary>ungrounded LLM answer</summary>

```
To wire RS-485 between a Micro820 PLC and a GS10 VFD, follow these steps:

1. **Verify device settings**: Ensure both devices are set to use RS-485 communication protocol. Check the Micro820's documentation for RS-485 settings and configure the GS10 VFD to use RS-485 (typically done through its keypad or software).
2. **Gather materials**: You'll need:
	* RS-485 cable (2-wire or 4-wire, depending on the device requirements)
	* Terminating resistors (120 ohms, typically included with the devices)
3. **Connect the devices**:
	* Connect the RS-485 cable to the Micro820's RS-485 port (usually labeled as "RS-485" or "COM").
	* Connect the other end of the cable to the GS10 VFD's RS-485 port.
	* If using a 2-wire cable, connect the wires to the A and B terminals on both devices. If using a 4-wire cable, connect the wires to the A, B, and ground terminals (if required).
4. **Add terminating resistors**: Install a 120-ohm terminating resistor at each end of the RS-485 cable to prevent signal reflections. Typically, one resistor is included with the Micro820 and another with the GS10 VFD.
5. **Configure the Micro820**: Set the Micro820's RS-485 settings to match the GS10 VFD's baud rate, parity, and data bits. Consult the Micro820's documentation for specific instructions.
6. **Test the connection**: Use a serial communication tool or software to test the connection between the Micro820 and the GS10 VFD.

**Safety warnings:**

* Ensure the power is off to both devices before making any connections.
* Use proper lockout/tagout procedures to prevent accidental startup.
* Verify the cable and connections are secure and meet the device manufacturer's recommendations.
* Follow proper grounding and shielding practices to prevent electrical noise and interference.

Consult the device manuals and manufacturer's documentation for specific instructions and recommendations. If you're unsure about any part of the process, consider consulting a qualified electrician or control systems specialist.
```

</details>

---

### Q05 · troubleshooting · medium

**Q:** What Modbus register on the GS10 holds the current fault code?

**Retrieval:** 5 chunks · relevance 1.0 · coverage 1.0 · citation-ready 1.0 · embedding_ok=True
**Rerank:** equipment=['GS10'] · pos_hits=20 · neg_hits=6 · bm25_in=15 · sql_fallback_in=15 · candidates_in=30 · dropped=25

Sources retrieved:
- AutomationDirect / GS10 / p.4 (integration_guide)
- AutomationDirect / GS10 / p.1 (integration_guide)
- Automation Direct / GS10-vs-GS11 / p.10 (field-guide)
- AutomationDirect / GS10 / p.3 (integration_guide)
- AutomationDirect / GS10 / p.? (component_template)

**Scores (1-5 each, total /35 after fabrication penalty):**

| dimension | MIRA grounded | ungrounded LLM |
|---|---|---|
| correctness | 5 | 2 |
| citation_quality | 2 | 4 |
| completeness | 4 | 4 |
| safety | 5 | 5 |
| hallucination_resistance | 5 | 5 |
| usefulness | 3 | 4 |
| factual_accuracy | 2 | 2 |
| _LLM 6-dim sum_ | 24 | 24 |
| _factual_accuracy ratio_ | 0.25 | 0.25 |
| _fabrication penalty_ | -0 | -2 |
| **total** | **26** | **24** |

_Baseline fabrications flagged:_ register=0x0301, hex_param=0x0301

_Grounded missing components:_ 0x2200, function code 03, holding register

_Baseline missing components:_ 0x2200, function code 03, holding register

_Judge on grounded:_ The candidate answer does not provide a specific Modbus register but admits the lack of information and provides relevant safety warnings, demonstrating high hallucination resistance and safety awareness.

_Judge on baseline:_ The candidate provides a specific register address, but it does not match the expected 0x2200, and also mentions the importance of proper documentation and safety procedures, showing a good understanding of the context, but lacks the exact information about the GS10 drive's Modbus register for the fault code.

<details><summary>MIRA grounded answer</summary>

```
The KB does not contain enough information to answer confidently. 

To determine the Modbus register that holds the current fault code on the GS10, additional documents such as a comprehensive register map or a technical manual specific to the GS10's fault codes and Modbus implementation would be needed. The provided chunks [#1] to [#5] discuss RS-485 wiring, Modbus RTU configuration, and register maps for certain parameters, but they do not specify a register for the current fault code. 

Safety warning: Before attempting any maintenance or modifications, ensure the GS10 is de-energized, and verify zero voltage on the DC bus to prevent electrical shock or injury. Additionally, follow proper lockout/tagout (LOTO) procedures and ensure that only a qualified person performs the tasks.
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

**Retrieval:** 5 chunks · relevance 0.2 · coverage 1.0 · citation-ready 1.0 · embedding_ok=True
**Rerank:** equipment=['Micro820', 'CCW'] · pos_hits=15 · neg_hits=3 · bm25_in=15 · sql_fallback_in=15 · candidates_in=30 · dropped=25

Sources retrieved:
- Rockwell Automation / 2080-LC20-20QBB / p.20 (manual)
- Rockwell Automation / 2080-LC20-20QBB / p.18 (manual)
- Rockwell Automation / 2080-LC20-20QBB / p.68 (manual)
- Rockwell Automation / 2080-LC20-20QBB / p.13 (manual)
- Rockwell Automation / 2080-LC20-20QBB / p.16 (manual)

**Scores (1-5 each, total /35 after fabrication penalty):**

| dimension | MIRA grounded | ungrounded LLM |
|---|---|---|
| correctness | 5 | 4 |
| citation_quality | 1 | 2 |
| completeness | 2 | 5 |
| safety | 5 | 5 |
| hallucination_resistance | 5 | 5 |
| usefulness | 1 | 5 |
| factual_accuracy | 1 | 2 |
| _LLM 6-dim sum_ | 19 | 26 |
| _factual_accuracy ratio_ | 0.0 | 0.333 |
| _fabrication penalty_ | -0 | -0 |
| **total** | **20** | **28** |

_Grounded missing components:_ Serial Port, Modbus RTU Master, 9600, Driver, Parity, 8 data bits

_Baseline missing components:_ Serial Port, Modbus RTU Master, 9600, Driver

_Judge on grounded:_ The candidate answer does not provide any specific information about configuring Modbus communication, but it correctly states that the provided information is insufficient and does not introduce any incorrect facts.

_Judge on baseline:_ The candidate answer provides a clear and step-by-step guide to configuring Modbus communication on the Micro820 in CCW, including safety precautions and verification steps. However, it lacks specific technical details, such as the default baud rate and parity settings, and only vaguely references the user manual and CCW documentation.

<details><summary>MIRA grounded answer</summary>

```
The KB does not contain enough information to answer confidently. 

To configure Modbus communication on the Micro820 in CCW, we would need information about the Modbus protocol, communication settings, and configuration procedures. However, the provided chunks do not contain this information. 

Additional documents that would be needed include:
- Modbus communication protocol documentation for the Micro820
- Connected Components Workbench (CCW) user manual with configuration instructions for Modbus communication
- Micro820 controller manual with information on communication settings and protocols supported.

The provided chunks only discuss topics such as controller current, turn-on and turn-off times, PWM output duty cycle error [#1], DC input specifications [#2], compliance with radio waves act [#3], RS232 pin assignments [#4], and conductor category information [#5], which are not relevant to configuring Modbus communication.
```

</details>

<details><summary>ungrounded LLM answer</summary>

```
To configure Modbus communication on the Micro820 in Connected Components Workbench (CCW), follow these steps:

1. **Ensure safety**: Before starting, make sure the power to the Micro820 is off and the area is clear of any hazards.
2. Open CCW and create a new project or open an existing one.
3. In the Project Explorer, right-click on the Micro820 controller and select **Properties**.
4. In the Properties window, navigate to the **Communication** tab.
5. Select **Modbus** as the communication protocol.
6. Configure the Modbus settings:
	* Set the **Modbus Address** (slave ID) for the Micro820.
	* Choose the **Baud Rate**, **Data Bits**, **Parity**, and **Stop Bits** to match your Modbus network settings.
	* Select the **Modbus Mode** (e.g., RTU or ASCII).
7. Configure the Modbus protocol parameters, such as the **Timeout** and **Retry Count**.
8. Apply the changes and save the project.
9. **Verify the configuration**: Before powering on the Micro820, verify that the Modbus configuration is correct to avoid any potential issues or damage to the equipment.

Remember to consult the Micro820 user manual and CCW documentation for specific instructions and guidelines. If you're unsure about any part of the process, consider consulting a qualified technician or the manufacturer's support resources.
```

</details>

---

### Q07 · safety · easy

**Q:** What safety precautions should I take before wiring a VFD to a PLC?

**Retrieval:** 5 chunks · relevance 0.0 · coverage 0.0 · citation-ready 1.0 · embedding_ok=True
**Rerank:** equipment=['VFD'] · pos_hits=20 · neg_hits=3 · bm25_in=15 · sql_fallback_in=15 · candidates_in=30 · dropped=25

Sources retrieved:
- AutomationDirect / drives g vg 4 manual / p.297 (gdrive)
- AutomationDirect / drives g vg 4 manual / p.331 (gdrive)
- AutomationDirect / drives g vg 4 manual / p.469 (gdrive)
- AutomationDirect / drives g vg 4 manual / p.304 (gdrive)
- AutomationDirect / drives g vg 4 manual / p.452 (gdrive)

**Scores (1-5 each, total /35 after fabrication penalty):**

| dimension | MIRA grounded | ungrounded LLM |
|---|---|---|
| correctness | 5 | 4 |
| citation_quality | 5 | 3 |
| completeness | 4 | 5 |
| safety | 5 | 5 |
| hallucination_resistance | 5 | 5 |
| usefulness | 4 | 5 |
| factual_accuracy | 4 | 3 |
| _LLM 6-dim sum_ | 28 | 27 |
| _factual_accuracy ratio_ | 0.667 | 0.5 |
| _fabrication penalty_ | -0 | -0 |
| **total** | **32** | **30** |

_Grounded missing components:_ DC bus, PPE

_Baseline missing components:_ de-energize, verify zero voltage, DC bus

_Judge on grounded:_ The candidate provides accurate safety precautions, cites specific references, and admits to missing information, demonstrating a strong understanding of safety protocols and a willingness to acknowledge uncertainty.

_Judge on baseline:_ The candidate answer covers all necessary safety precautions, including de-energizing the system, using PPE, and following proper wiring standards. While it does not explicitly mention 'de-energize' or 'DC bus', it implies these concepts through 'ensure the power is off' and 'verify voltage and signal compatibility'. The answer also demonstrates a high level of usefulness and hallucination resistance by providing clear, ordered steps and recommending consultation with a qualified electrician when unsure.

<details><summary>MIRA grounded answer</summary>

```
Before wiring a VFD to a PLC, ensure the VFD is de-energized and verify zero voltage on the terminals [#1]. Lockout/Tagout (LOTO) should be performed by a qualified person to prevent accidental startup. The provided insulation barriers should be used to provide added protection between terminals, following the instructions in Figure 3-9 for proper placement [#1]. 

There is no information in the provided chunks regarding specific wiring instructions or safety precautions for wiring a VFD to a PLC. The KB does not contain enough information to answer confidently. Additional documents needed would be the VFD and PLC installation manuals, and any relevant safety guidelines or standards for the specific application.
```

</details>

<details><summary>ungrounded LLM answer</summary>

```
Before wiring a VFD to a PLC, take the following safety precautions:

1. **Ensure the power is off**: Verify that the power supply to both the VFD and PLC is turned off. Lockout/tagout procedures may be necessary.
2. **Check the manual**: Review the manuals for both the VFD and PLC to understand their specific wiring requirements and safety recommendations.
3. **Use proper personal protective equipment (PPE)**: Wear insulating gloves, safety glasses, and a face shield to protect against electrical shock and arc flash.
4. **Verify voltage and signal compatibility**: Ensure the VFD and PLC are compatible in terms of voltage, signal type (e.g., analog, digital), and communication protocol (e.g., Modbus).
5. **Grounding and bonding**: Verify that the system is properly grounded and bonded to prevent electrical shock and ensure reliable operation.
6. **Follow wiring standards**: Adhere to relevant wiring standards, such as those specified by the National Electric Code (NEC) or International Electrotechnical Commission (IEC).
7. **Isolate the area**: Prevent unauthorized access to the area where the wiring is being performed to avoid accidental start-up or electrical shock.

Remember to always follow the manufacturer's instructions and local regulations when working with electrical equipment. If you're unsure about any aspect of the wiring process, consider consulting a qualified electrician or seeking guidance from a supervisor.
```

</details>

---

### Q08 · troubleshooting · medium

**Q:** How do I reset a latched fault on a GS11 drive via Modbus?

**Retrieval:** 5 chunks · relevance 1.0 · coverage 1.0 · citation-ready 1.0 · embedding_ok=True
**Rerank:** equipment=['GS11'] · pos_hits=18 · neg_hits=5 · bm25_in=15 · sql_fallback_in=15 · candidates_in=28 · dropped=23

Sources retrieved:
- Automation Direct / GS10-vs-GS11 / p.10 (field-guide)
- Automation Direct / GS11 / p.1 (field-guide)
- Automation Direct / GS11 / p.8 (field-guide)
- Automation Direct / GS11 / p.7 (field-guide)
- Automation Direct / GS11 / p.4 (field-guide)

**Scores (1-5 each, total /35 after fabrication penalty):**

| dimension | MIRA grounded | ungrounded LLM |
|---|---|---|
| correctness | 5 | 2 |
| citation_quality | 5 | 4 |
| completeness | 5 | 4 |
| safety | 5 | 5 |
| hallucination_resistance | 5 | 4 |
| usefulness | 5 | 4 |
| factual_accuracy | 4 | 1 |
| _LLM 6-dim sum_ | 30 | 23 |
| _factual_accuracy ratio_ | 0.75 | 0.0 |
| _fabrication penalty_ | -0 | -3 |
| **total** | **34** | **21** |

_Baseline fabrications flagged:_ hex_param=0x9000, hex_param=0x1000, hex_param=0x0001

_Grounded missing components:_ holding register

_Baseline missing components:_ 0x2002, non-zero, function code 06, holding register

_Judge on grounded:_ The candidate answer accurately describes the process to reset a latched fault on a GS11 drive via Modbus, including the correct register and function code, and provides proper safety warnings and citations to relevant documentation.

_Judge on baseline:_ The candidate answer lacks specific details about the GS11 drive's Modbus implementation, such as the correct register address (0x2002) and function code (06), but provides a general outline of the process and emphasizes safety and consulting documentation.

<details><summary>MIRA grounded answer</summary>

```
To reset a latched fault on a GS11 drive via Modbus, first ensure the drive is properly connected to the Modbus network, following the wiring guidelines in [#2]. Verify that D+ is connected to SG+, D- is connected to SG-, and G (signal ground) is connected to SGND. 

Next, confirm that the Modbus settings match between the drive and the controller, including baud rate, parity, and stop bits, as described in [#1]. 

Then, use the Modbus write function (Function Code 06) to write a non-zero value to Register 8194 (0x2002), as specified in [#5]. This will clear the latched fault. 

Remember to always follow proper safety procedures when working with electrical equipment, including de-energizing the drive and verifying zero voltage before making any connections or repairs. 

Note: The provided chunks do not explicitly mention safety procedures for resetting a latched fault, but general safety practices should always be followed when working with electrical equipment.
```

</details>

<details><summary>ungrounded LLM answer</summary>

```
To reset a latched fault on a GS11 drive via Modbus, you'll need to send a specific command to the drive. 

1. **Ensure you have the correct Modbus address and register information** for your GS11 drive. Consult the drive's manual or documentation for this information.
2. **Use a Modbus master device or software** (such as a PLC, HMI, or Modbus scanner) to send the reset command to the drive.
3. **Send a write command to the fault reset register**. The register address for fault reset may vary depending on the drive's configuration, but it's often a specific register (e.g., 0x9000 or 0x1000). Consult the drive's documentation for the correct register address.
4. **Write the correct value to reset the fault**. This value is usually a binary or hexadecimal code (e.g., 0x01 or 0x0001) that indicates a fault reset. Again, consult the drive's documentation for the correct value.

**Safety Warning:** Before attempting to reset a latched fault, ensure you have identified and addressed the underlying cause of the fault to prevent further damage to the drive or connected equipment.

**Example Modbus Command:**

Using a Modbus scanner, you might send a command like this:
`Write 0x9000, 0x01` (assuming 0x9000 is the fault reset register and 0x01 is the reset value)

**Remember to always follow proper safety procedures and consult the drive's documentation** before attempting to reset a latched fault via Modbus. If you're unsure, consider consulting a qualified technician or the drive's manufacturer for assistance.
```

</details>

---

### Q09 · modbus · easy

**Q:** What are the GS11 RS-485 default communication settings (baud, parity, stop bits)?

**Retrieval:** 5 chunks · relevance 0.8 · coverage 1.0 · citation-ready 1.0 · embedding_ok=True
**Rerank:** equipment=['GS11'] · pos_hits=15 · neg_hits=2 · bm25_in=15 · sql_fallback_in=15 · candidates_in=30 · dropped=25

Sources retrieved:
- Automation Direct / GS11 / p.9 (field-guide)
- Automation Direct / GS11 / p.1 (field-guide)
- Automation Direct / GS10-vs-GS11 / p.10 (field-guide)
- Automation Direct / GS11 / p.7 (field-guide)
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
| _factual_accuracy ratio_ | 0.833 | 0.667 |
| _fabrication penalty_ | -0 | -0 |
| **total** | **33** | **28** |

_Grounded missing components:_ slave id 1

_Baseline missing components:_ 8 data bits, slave id 1

_Judge on grounded:_ The candidate answer accurately provides the default communication settings, cites specific parameters, and includes a clear safety warning. However, it does not explicitly mention the RS-485 protocol or the slave ID 1, which are part of the expected components.

_Judge on baseline:_ The candidate answer is mostly correct, but incorrectly states the stop bits as 1 instead of 2, and lacks specific citation to the manual. However, it provides a clear safety warning and admits uncertainty about specific model and firmware versions.

<details><summary>MIRA grounded answer</summary>

```
The GS11 RS-485 default communication settings are: 
- Baud rate: 9600 [#3] 
- Parity: None [#3] 
- Data bits: 8 [#1] 
- Stop bits: 2 [#1, #3]. 

These settings are also reflected in the drive parameters: 
- P09.01: 9.6 (baud rate, 9600) [#1, #3] 
- P09.04: 13 (frame format, 8N2) [#1, #3]. 

Before applying these settings, it is crucial to read the actual P09.01 and P09.04 values on the physical drive and confirm they match the PLC settings [#3]. 

Safety warning: When working with power wiring, drives, or live control, ensure to de-energize the system, apply Lockout/Tagout (LOTO), and verify zero voltage before starting work. Additionally, ensure you are a qualified person to perform the task.
```

</details>

<details><summary>ungrounded LLM answer</summary>

```
The GS11 (likely a variable frequency drive) default RS-485 communication settings are typically:

* Baud rate: 9600
* Parity: None
* Stop bits: 1

Please note that these settings may vary depending on the specific model and firmware version of your GS11 device. It's always a good idea to consult the device's manual or manufacturer's documentation to confirm the default communication settings.

**Safety warning:** Before attempting to communicate with the device, ensure you have taken necessary safety precautions, such as locking out the power supply and verifying the device is in a safe state to avoid any potential hazards.
```

</details>

---

### Q10 · plc-programming · hard

**Q:** How do I set up a Modbus read function block in CCW ladder logic for the Micro820?

**Retrieval:** 5 chunks · relevance 0.6 · coverage 0.5 · citation-ready 1.0 · embedding_ok=True
**Rerank:** equipment=['Micro820', 'CCW'] · pos_hits=15 · neg_hits=8 · bm25_in=15 · sql_fallback_in=15 · candidates_in=30 · dropped=25

Sources retrieved:
- Rockwell Automation / 2080-LC20-20QBB / p.6 (manual)
- Rockwell Automation / 2080-LC20-20QBB / p.69 (manual)
- Rockwell Automation / 2080-LC20-20QBB / p.15 (manual)
- Rockwell Automation / 2080-LC20-20QBB / p.71 (manual)
- Rockwell Automation / 2080-LC20-20QBB / p.67 (manual)

**Scores (1-5 each, total /35 after fabrication penalty):**

| dimension | MIRA grounded | ungrounded LLM |
|---|---|---|
| correctness | 4 | 4 |
| citation_quality | 2 | 1 |
| completeness | 2 | 5 |
| safety | 5 | 5 |
| hallucination_resistance | 5 | 5 |
| usefulness | 2 | 5 |
| factual_accuracy | 1 | 2 |
| _LLM 6-dim sum_ | 20 | 25 |
| _factual_accuracy ratio_ | 0.0 | 0.333 |
| _fabrication penalty_ | -0 | -0 |
| **total** | **21** | **27** |

_Grounded missing components:_ MSG_MODBUS, TargetCfg, LocalCfg, function code 03, starting address, trigger

_Baseline missing components:_ MSG_MODBUS, TargetCfg, LocalCfg, trigger

_Judge on grounded:_ The candidate admits lack of information and prioritizes safety, but does not provide specific instructions on setting up a Modbus read function block, and lacks concrete citations.

_Judge on baseline:_ The candidate answer provides a clear, step-by-step guide to setting up a Modbus read function block, including safety warnings, but lacks specific citations to the Micro820 manual or documentation. The answer does not explicitly mention MSG_MODBUS, TargetCfg, or LocalCfg, but covers the essential components of the setup process.

<details><summary>MIRA grounded answer</summary>

```
The KB does not contain enough information to answer confidently. 

To set up a Modbus read function block in CCW ladder logic for the Micro820, additional documents such as the Micro820 programming manual or the CCW software user manual would be needed. The provided chunks [#1] to [#5] contain information on installation, wiring, and certification, but do not provide specific instructions on setting up a Modbus read function block. 

Before attempting any programming or configuration, ensure the system is de-energized and properly locked out (LOTO) by a qualified person, and verify zero voltage on all power wiring to prevent electrical shock or injury.
```

</details>

<details><summary>ungrounded LLM answer</summary>

```
To set up a Modbus read function block in CCW ladder logic for the Micro820:

1. **Ensure proper configuration**: Verify the Modbus slave device is properly configured and connected to the Micro820.
2. **Add the Modbus Read block**: In CCW, go to the "Function Blocks" tab and select "Modbus Read" from the list. Drag and drop the block into your ladder logic program.
3. **Configure the block**:
	* Set the "Slave ID" to the address of the Modbus slave device.
	* Choose the "Function Code" (e.g., 0x03 for reading holding registers).
	* Specify the "Starting Address" and "Number of Registers" to read.
	* Set the "Data Type" (e.g., INT, UINT, FLOAT) according to the register type.
4. **Connect the block**: Connect the "Enable" input to a rung that controls when the read operation should occur. Connect the "Done" output to a rung that should be executed after the read operation is complete.
5. **Verify the setup**: Before downloading the program to the Micro820, verify the setup using the CCW simulator or by monitoring the Modbus traffic with a protocol analyzer.

**Safety warning**: Ensure the Micro820 and connected devices are properly grounded and powered down before making any changes to the configuration or wiring. Always follow proper lockout/tagout procedures when working with electrical systems.
```

</details>

---
