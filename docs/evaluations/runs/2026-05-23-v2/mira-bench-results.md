# MIRA vs ungrounded-LLM benchmark — v2

**Run:** 20260523T194550+0000
**Started:** 2026-05-23T19:45:50+00:00
**Tenant:** `78917b56-f85f-43bb-9a08-1bb98a6cd6c3`
**Cascade:** groq → cerebras → gemini
**Retrieval limit:** 5 (overfetch 15, equipment rerank)
**Scorer:** 6 LLM dims + factual_accuracy + fabrication_penalty (max /35)

## Aggregate

| | MIRA grounded | ungrounded LLM |
|---|---|---|
| total (of 350) | **282** | **255** |
| total_raw (pre-fabrication) (of 350) | 287 | 262 |
| LLM-only sum (of 300, v1-comparable) | 259 | 240 |
| fabrication penalty (sum) | 5 | 7 |
| avg per question (of 35) | **28.2** | **25.5** |

### Per-dimension average (1-5)

| dimension | MIRA grounded | ungrounded LLM | delta |
|---|---|---|---|
| correctness | 4.10 | 3.30 | +0.80 |
| citation_quality | 4.60 | 2.40 | +2.20 |
| completeness | 3.70 | 4.30 | -0.60 |
| safety | 5.00 | 4.80 | +0.20 |
| hallucination_resistance | 4.90 | 4.90 | +0.00 |
| usefulness | 3.60 | 4.30 | -0.70 |
| factual_accuracy | 2.80 | 2.20 | +0.60 |

### Retrieval quality

- avg chunks/question: **5.0**
- avg relevance: **0.64**
- avg coverage: **0.85**
- avg citation-ready: **1.00**
- empty-retrieval questions: **0 / 10**
- equipment-rerank: 194 chunks with positive equipment hits, 249 dropped to overfetch tail

## Per-question detail

### Q01 · modbus · hard

**Q:** How do I read a parameter from a GS11 drive using a Micro820 over Modbus RTU?

**Retrieval:** 5 chunks · relevance 0.6 · coverage 1.0 · citation-ready 1.0 · embedding_ok=True
**Rerank:** equipment=['GS11', 'Micro820'] · pos_hits=20 · neg_hits=2 · bm25_in=15 · sql_fallback_in=15 · candidates_in=30 · dropped=25

Sources retrieved:
- Rockwell Automation / 2080-LC20-20QBB / p.69 (manual)
- Rockwell Automation / 2080-LC20-20QBB / p.71 (manual)
- Rockwell Automation / 2080-LC20-20QBB / p.66 (manual)
- Rockwell Automation / 2080-LC20-20QBB / p.67 (manual)
- Rockwell Automation / 2080-LC20-20QBB / p.70 (manual)

**Scores (1-5 each, total /35 after fabrication penalty):**

| dimension | MIRA grounded | ungrounded LLM |
|---|---|---|
| correctness | 4 | 4 |
| citation_quality | 5 | 2 |
| completeness | 3 | 5 |
| safety | 5 | 5 |
| hallucination_resistance | 5 | 4 |
| usefulness | 2 | 5 |
| factual_accuracy | 2 | 2 |
| _LLM 6-dim sum_ | 24 | 25 |
| _factual_accuracy ratio_ | 0.167 | 0.333 |
| _fabrication penalty_ | -0 | -1 |
| **total** | **26** | **26** |

_Baseline fabrications flagged:_ hex_param=0x1000

_Grounded missing components:_ function code 03, holding register, MSG_MODBUS, 0x2000, 9600 baud

_Baseline missing components:_ function code 03, holding register, MSG_MODBUS, 0x2000

_Judge on grounded:_ The candidate answer demonstrates a strong understanding of the need for proper documentation and safety procedures, but lacks specific technical details about the Modbus RTU protocol implementation and register numbers.

_Judge on baseline:_ The candidate answer is mostly correct, but lacks specific citations to device manuals and uses generic register addresses instead of the expected 0x2000. However, it provides a clear and complete step-by-step guide to reading a parameter from a GS11 drive using a Micro820 over Modbus RTU.

<details><summary>MIRA grounded answer</summary>

```
The KB does not contain enough information to answer confidently. 

To read a parameter from a GS11 drive using a Micro820 over Modbus RTU, we would need documentation on the Modbus RTU protocol implementation for the Micro820 and GS11 drive, including register numbers and parameter names. 

Additional documents needed would be the GS11 drive manual, Micro820 Modbus RTU protocol guide, and any relevant application notes or technical notes from Rockwell Automation, such as those found on their website http://support.rockwellautomation.com [#5]. 

Before attempting any configuration or troubleshooting, ensure the system is de-energized and follow proper Lockout/Tagout (LOTO) procedures to ensure safety. Verify zero voltage on all power wires before starting work.
```

</details>

<details><summary>ungrounded LLM answer</summary>

```
To read a parameter from a GS11 drive using a Micro820 over Modbus RTU, follow these steps:

1. **Ensure proper connections**: Connect the GS11 drive to the Micro820 using a serial cable (RS-485) and configure the wiring according to the device manuals.
2. **Configure the GS11 drive**: Set the GS11 drive's Modbus address, baud rate, and parity using the drive's keypad or software. Typically, the default Modbus address is 1, baud rate is 9600, and parity is None.
3. **Configure the Micro820**: Set up the Micro820's Modbus RTU master configuration:
	* Set the Modbus protocol to RTU.
	* Set the baud rate, parity, and stop bits to match the GS11 drive's settings (e.g., 9600, None, 1).
	* Set the Modbus address to match the GS11 drive's address (e.g., 1).
4. **Determine the parameter address**: Consult the GS11 drive's manual to find the Modbus address of the parameter you want to read. GS11 drives use a specific register mapping, so ensure you have the correct address.
5. **Create a Modbus read instruction**: In the Micro820's programming software (e.g., Connected Components Workbench), create a Modbus read instruction using the `MODBUS_READ` function block. Specify the:
	* Modbus address (e.g., 1).
	* Register address (e.g., 0x1000 for a specific parameter).
	* Data type (e.g., INT16, UINT16, etc.).
6. **Execute the read instruction**: Run the program and execute the Modbus read instruction. The Micro820 will send a Modbus request to the GS11 drive, and the drive will respond with the parameter value.
7. **Verify the response**: Check the response from the GS11 drive to ensure it matches the expected value.

**Safety warning:** When working with industrial equipment, ensure you follow proper safety procedures to avoid injury or damage. Verify that the equipment is properly grounded, and use personal protective equipment (PPE) as required. Additionally, ensure that the Micro820 and GS11 drive are properly configured and tested before putting them into operation.
```

</details>

---

### Q02 · modbus · easy

**Q:** What is the default baud rate and parity for the GS10 serial port?

**Retrieval:** 5 chunks · relevance 1.0 · coverage 1.0 · citation-ready 1.0 · embedding_ok=True
**Rerank:** equipment=['GS10'] · pos_hits=20 · neg_hits=3 · bm25_in=15 · sql_fallback_in=15 · candidates_in=30 · dropped=25

Sources retrieved:
- AutomationDirect / GS10 / p.6 (integration_guide)
- AutomationDirect / GS10 / p.4 (integration_guide)
- AutomationDirect / GS10 / p.2 (integration_guide)
- AutomationDirect / GS10 / p.5 (integration_guide)
- AutomationDirect / GS10 / p.? (component_template)

**Scores (1-5 each, total /35 after fabrication penalty):**

| dimension | MIRA grounded | ungrounded LLM |
|---|---|---|
| correctness | 4 | 1 |
| citation_quality | 5 | 2 |
| completeness | 5 | 2 |
| safety | 5 | 4 |
| hallucination_resistance | 5 | 5 |
| usefulness | 5 | 3 |
| factual_accuracy | 4 | 2 |
| _LLM 6-dim sum_ | 29 | 17 |
| _factual_accuracy ratio_ | 0.8 | 0.2 |
| _fabrication penalty_ | -0 | -0 |
| **total** | **33** | **19** |

_Grounded missing components:_ no parity

_Baseline missing components:_ 19200 baud, 8 data bits, 1 stop bit, RS-485

_Judge on grounded:_ The candidate answer is mostly correct, but incorrectly states the default parity as Even, when it should be no parity. The answer provides specific citations and covers all necessary aspects, including safety warnings and configuration settings.

_Judge on baseline:_ The candidate provides general information but does not accurately answer the question about the GS10's default baud rate and parity, instead suggesting typical values for other devices. They demonstrate a good safety awareness and resistance to providing incorrect information by recommending to check the device's manual.

<details><summary>MIRA grounded answer</summary>

```
The default baud rate for the GS10 is 19200 bps, as indicated by the setting P09.01 = 2 [#5]. The default parity is Even, with 8 data bits and 1 stop bit, as specified by the setting P09.04 = 4, which corresponds to RTU 8-E-1 [#5]. 

To confirm, the GS10 must be configured to use RS-485 (Modbus RTU) for frequency command and run command sources, by setting P00.20 = 5 and P00.21 = 5 [#5]. 

Before attempting to communicate with the GS10, ensure the Micro820 is configured to match these settings, with a baud rate of 19200, 8 data bits, Even parity, and 1 stop bit, and that the RS-485 wiring is properly connected and terminated [#2]. 

Safety warning: When working with the GS10 and Micro820, ensure the power is cycled after changing any configuration settings, and verify that the RS-485 cable is run in a dedicated conduit, separated from VFD output and DC bus wiring by ≥ 300 mm (12") of air or in a separate metallic conduit [#2].
```

</details>

<details><summary>ungrounded LLM answer</summary>

```
The GS10 series, I believe you're referring to a specific device, possibly a PLC or controller. However, without the exact model or manufacturer, I'll provide general information.

Typically, for many industrial devices, including some PLCs, the default baud rate is 9600 and the parity is usually set to None or Even. 

To confirm the exact default settings for your GS10 device, I recommend checking the device's manual or manufacturer's documentation. It's also a good practice to verify the settings before attempting to communicate with the device to avoid any potential issues.

**Safety Warning:** Before working with any industrial device, ensure you follow proper safety procedures and protocols to avoid injury or damage to equipment.
```

</details>

---

### Q03 · modbus · medium

**Q:** What Modbus register do I write to change the GS10 motor speed?

**Retrieval:** 5 chunks · relevance 1.0 · coverage 1.0 · citation-ready 1.0 · embedding_ok=True
**Rerank:** equipment=['GS10'] · pos_hits=20 · neg_hits=9 · bm25_in=15 · sql_fallback_in=15 · candidates_in=30 · dropped=25

Sources retrieved:
- AutomationDirect / GS10 / p.6 (integration_guide)
- AutomationDirect / GS10 / p.4 (integration_guide)
- AutomationDirect / GS10 / p.2 (integration_guide)
- AutomationDirect / GS10 / p.5 (integration_guide)
- AutomationDirect / GS10 / p.? (component_template)

**Scores (1-5 each, total /35 after fabrication penalty):**

| dimension | MIRA grounded | ungrounded LLM |
|---|---|---|
| correctness | 4 | 2 |
| citation_quality | 5 | 1 |
| completeness | 5 | 4 |
| safety | 5 | 5 |
| hallucination_resistance | 5 | 5 |
| usefulness | 5 | 3 |
| factual_accuracy | 3 | 2 |
| _LLM 6-dim sum_ | 29 | 20 |
| _factual_accuracy ratio_ | 0.4 | 0.2 |
| _fabrication penalty_ | -2 | -0 |
| **total** | **30** | **22** |

_Grounded fabrications flagged:_ register=8193, hex_param=0x2001

_Grounded missing components:_ 0x2000, 0.01 Hz, holding register

_Baseline missing components:_ 0x2000, frequency, 0.01 Hz, function code 06

_Judge on grounded:_ The candidate answer is mostly correct, but the register address is given as 0x2001 instead of 0x2000, and the resolution is implied to be 0.01 Hz but not explicitly stated. The answer provides detailed steps and cites specific references, making it very useful and complete.

_Judge on baseline:_ The candidate answer does not provide specific information about the GS10 motor speed register, but it provides a general approach and emphasizes the importance of consulting documentation and following safety precautions, demonstrating a cautious and responsible attitude.

<details><summary>MIRA grounded answer</summary>

```
To change the GS10 motor speed, you need to write to the Frequency reference register, which is decimal 8193 or hex 0x2001 [#1]. The value to write is the desired frequency in Hz, multiplied by 100 (e.g., 30 Hz = 3000, 60 Hz = 6000) [#1, #4]. 

Before writing, ensure the GS10 is configured to accept Modbus commands: P00.20 = 5 (Frequency command source) and P00.21 = 5 (Run command source) [#5]. Also, verify the Modbus communication parameters are set correctly, including the baud rate, parity, and slave ID [#5]. 

To write to the register, use the Preset Single Register function (code 06) with the decimal register address 8193 and the desired frequency value [#1, #4]. 

Remember to follow safety guidelines when working with the GS10 and Micro820, including ensuring the system is de-energized and using proper lockout/tagout procedures when necessary.
```

</details>

<details><summary>ungrounded LLM answer</summary>

```
To provide a specific answer, I would need to know the device model and manufacturer of your GS10 motor and its associated control system. However, I can give you a general idea of how to approach this.

Typically, to change the motor speed via Modbus, you would write to a register that controls the setpoint or target speed. This is often a holding register (function code 10) in the range of 40001 to 40020, but it can vary depending on the device.

**Before attempting to write to any Modbus register:**

1. **Ensure you have the correct documentation**: Consult the device manual or datasheet to determine the correct register address and data format.
2. **Verify the device is configured for Modbus**: Make sure the device is set up to communicate via Modbus and that the baud rate, parity, and other settings match your master device.
3. **Use proper safety precautions**: Be aware of any potential hazards when working with electrical systems, and ensure you have the necessary training and personal protective equipment.

Once you have the correct information, you can use a Modbus master device or software to write to the specified register. Be cautious when writing to registers, as incorrect values can cause equipment damage or safety issues.

If you provide more information about your specific device and setup, I can try to give you a more detailed answer.
```

</details>

---

### Q04 · wiring · medium

**Q:** How do I wire RS-485 between a Micro820 and a GS10 VFD?

**Retrieval:** 5 chunks · relevance 0.4 · coverage 1.0 · citation-ready 1.0 · embedding_ok=True
**Rerank:** equipment=['GS10', 'Micro820', 'RS-485'] · pos_hits=26 · neg_hits=0 · bm25_in=15 · sql_fallback_in=15 · candidates_in=30 · dropped=25

Sources retrieved:
- Rockwell Automation / 2080-LC20-20QBB / p.6 (manual)
- Rockwell Automation / 2080-LC20-20QBB / p.2 (manual)
- Rockwell Automation / 2080-LC20-20QBB / p.6 (manual)
- Rockwell Automation / 2080-LC20-20QBB / p.1 (manual)
- Rockwell Automation / 2080-LC20-20QBB / p.4 (manual)

**Scores (1-5 each, total /35 after fabrication penalty):**

| dimension | MIRA grounded | ungrounded LLM |
|---|---|---|
| correctness | 2 | 5 |
| citation_quality | 5 | 3 |
| completeness | 2 | 5 |
| safety | 5 | 5 |
| hallucination_resistance | 5 | 5 |
| usefulness | 2 | 5 |
| factual_accuracy | 1 | 3 |
| _LLM 6-dim sum_ | 21 | 28 |
| _factual_accuracy ratio_ | 0.0 | 0.6 |
| _fabrication penalty_ | -0 | -0 |
| **total** | **22** | **31** |

_Grounded missing components:_ twisted pair, D+ / D-, signal ground, 120 ohm, shield grounded

_Baseline missing components:_ D+ / D-, shield grounded

_Judge on grounded:_ The candidate admits lack of information and cites specific missing documents, demonstrating high citation quality and hallucination resistance. However, the answer lacks technical details on RS-485 wiring, reducing correctness, completeness, and usefulness.

_Judge on baseline:_ The candidate answer provides a clear and step-by-step guide to wiring RS-485 between a Micro820 and a GS10 VFD, including important safety warnings and configuration considerations. While it could benefit from more specific citations to device manuals, the answer demonstrates a strong understanding of the technical requirements and best practices for RS-485 wiring.

<details><summary>MIRA grounded answer</summary>

```
The KB does not contain enough information to answer confidently. 

To wire RS-485 between a Micro820 and a GS10 VFD, we would need additional documents, such as the GS10 VFD manual and the Micro820 communication protocol manual, which are not provided in the given KB chunks. The provided chunks mainly discuss safety precautions, equipment installation, and hazardous location usage, but do not provide specific information on RS-485 wiring between the Micro820 and the GS10 VFD [#1, #2, #3, #4, #5]. 

Before attempting any wiring, ensure the equipment is de-energized and follow proper Lockout/Tagout (LOTO) procedures to prevent electrical shock or injury. Verify zero voltage on all wires before starting work.
```

</details>

<details><summary>ungrounded LLM answer</summary>

```
To wire RS-485 between a Micro820 PLC and a GS10 VFD, follow these steps:

**Safety Warning: Ensure the power is off to both devices before starting the wiring process.**

1. **Identify the RS-485 ports**: Locate the RS-485 port on the Micro820 (typically labeled as "RS-485" or "COM") and the GS10 VFD (usually labeled as "RS-485" or "Communication").
2. **Gather required materials**:
	* 2-wire (or 4-wire, depending on the device requirements) shielded twisted-pair cable (e.g., Belden 9842)
	* RS-485 termination resistors (if required)
3. **Connect the wires**:
	* Connect the positive (A) wire of the RS-485 cable to the Micro820's RS-485+ terminal.
	* Connect the negative (B) wire of the RS-485 cable to the Micro820's RS-485- terminal.
	* Connect the other end of the cable to the GS10 VFD's RS-485+ and RS-485- terminals, respectively.
4. **Termination resistors**: If required, install a 120-ohm termination resistor at each end of the RS-485 cable to prevent signal reflections.
5. **Grounding**: Ensure the shield of the cable is connected to the ground terminal on both devices to prevent noise and interference.
6. **Configuration**: Configure the Micro820 and GS10 VFD to use the same RS-485 settings, such as baud rate, parity, and data bits.

**Important**: Consult the device manuals for specific wiring and configuration requirements, as they may vary. Additionally, ensure the cable length does not exceed the recommended maximum length for RS-485 (typically 1.2 km or 4000 ft).
```

</details>

---

### Q05 · troubleshooting · medium

**Q:** What Modbus register on the GS10 holds the current fault code?

**Retrieval:** 5 chunks · relevance 1.0 · coverage 1.0 · citation-ready 1.0 · embedding_ok=True
**Rerank:** equipment=['GS10'] · pos_hits=20 · neg_hits=5 · bm25_in=15 · sql_fallback_in=15 · candidates_in=30 · dropped=25

Sources retrieved:
- AutomationDirect / GS10 / p.6 (integration_guide)
- AutomationDirect / GS10 / p.4 (integration_guide)
- AutomationDirect / GS10 / p.2 (integration_guide)
- AutomationDirect / GS10 / p.5 (integration_guide)
- AutomationDirect / GS10 / p.? (component_template)

**Scores (1-5 each, total /35 after fabrication penalty):**

| dimension | MIRA grounded | ungrounded LLM |
|---|---|---|
| correctness | 2 | 2 |
| citation_quality | 5 | 3 |
| completeness | 4 | 4 |
| safety | 5 | 5 |
| hallucination_resistance | 4 | 5 |
| usefulness | 4 | 4 |
| factual_accuracy | 4 | 2 |
| _LLM 6-dim sum_ | 24 | 23 |
| _factual_accuracy ratio_ | 0.75 | 0.25 |
| _fabrication penalty_ | -2 | -2 |
| **total** | **26** | **23** |

_Grounded fabrications flagged:_ register=8449, hex_param=0x2101

_Baseline fabrications flagged:_ register=0x0301, hex_param=0x0301

_Grounded missing components:_ 0x2200

_Baseline missing components:_ 0x2200, function code 03, holding register

_Judge on grounded:_ The candidate incorrectly states the Modbus register as 8449 (0x2101), when the expected answer is 0x2200, but provides excellent citation quality, completeness, safety warnings, and usefulness, with some resistance to hallucination by referencing specific settings and guidelines.

_Judge on baseline:_ The candidate provides some correct information, but incorrectly identifies the register address as 0x0301 instead of 0x2200, and does not mention function code 03 or holding register. However, they demonstrate good safety awareness and caution regarding register access and drive configuration.

<details><summary>MIRA grounded answer</summary>

```
The current fault code on the GS10 is held in Modbus register 8449, which is also represented as 0x2101 in hex [#1]. This register is readable using function code 03 (Read holding registers) [#1]. To access this information, ensure the GS10 is properly configured for Modbus RTU communication, including settings such as P00.20 = 5 and P00.21 = 5 for frequency and run command sources, respectively, and appropriate baud rate, parity, and stop bits as outlined in the integration guide [#5]. Always verify the GS10's configuration and the Micro820's settings match for successful communication [#3]. Before attempting to read or write to the GS10, ensure the device is properly powered and configured, and follow safety guidelines to avoid electrical hazards, including de-energizing the system when necessary and using proper lockout/tagout procedures [#2].
```

</details>

<details><summary>ungrounded LLM answer</summary>

```
The GS10 drive uses Modbus protocol for communication. According to the GS10 manual, the current fault code is typically stored in register 0x0301 (or 769 in decimal). However, please note that register addresses may vary depending on the specific drive configuration and firmware version.

Before attempting to access the register, ensure you have the correct documentation for your specific GS10 drive model and firmware version. Additionally, always follow proper safety procedures when working with electrical equipment, and never attempt to access or modify registers while the drive is in operation.
```

</details>

---

### Q06 · plc-programming · medium

**Q:** How do I configure Modbus communication on the Micro820 in CCW?

**Retrieval:** 5 chunks · relevance 0.0 · coverage 0.0 · citation-ready 1.0 · embedding_ok=True
**Rerank:** equipment=['Micro820', 'CCW'] · pos_hits=15 · neg_hits=3 · bm25_in=15 · sql_fallback_in=15 · candidates_in=30 · dropped=25

Sources retrieved:
- Rockwell Automation / 2080-LC20-20QBB / p.1 (manual)
- Rockwell Automation / 2080-LC20-20QBB / p.4 (manual)
- Rockwell Automation / 2080-LC20-20QBB / p.1 (manual)
- Rockwell Automation / 2080-LC20-20QBB / p.2 (manual)
- Rockwell Automation / 2080-LC20-20QBB / p.4 (manual)

**Scores (1-5 each, total /35 after fabrication penalty):**

| dimension | MIRA grounded | ungrounded LLM |
|---|---|---|
| correctness | 5 | 4 |
| citation_quality | 5 | 4 |
| completeness | 2 | 5 |
| safety | 5 | 5 |
| hallucination_resistance | 5 | 5 |
| usefulness | 2 | 5 |
| factual_accuracy | 1 | 2 |
| _LLM 6-dim sum_ | 24 | 28 |
| _factual_accuracy ratio_ | 0.0 | 0.167 |
| _fabrication penalty_ | -0 | -0 |
| **total** | **25** | **30** |

_Grounded missing components:_ Serial Port, Modbus RTU Master, 9600, Driver, Parity, 8 data bits

_Baseline missing components:_ Serial Port, Modbus RTU Master, 9600, Driver, 8 data bits

_Judge on grounded:_ The candidate answer does not provide specific configuration steps, but it correctly identifies the need for additional documentation and prioritizes safety, while also demonstrating a strong resistance to hallucination by not providing incorrect information.

_Judge on baseline:_ The candidate answer provides a clear and step-by-step guide to configuring Modbus communication on the Micro820 in CCW, including safety precautions and references to additional resources. However, it does not explicitly mention the required baud rate of 9600, data bits, or the specific Modbus RTU Master configuration, which prevents a perfect correctness score.

<details><summary>MIRA grounded answer</summary>

```
The KB does not contain enough information to answer confidently. 

To configure Modbus communication on the Micro820 in CCW, additional documents such as the Micro820 user manual, CCW software guide, or Modbus protocol documentation would be needed. The provided chunks primarily focus on safety warnings, product information, and hazardous location approvals, but do not provide specific instructions for configuring Modbus communication [#1, #2, #3, #4, #5]. 

Before attempting any configuration, ensure the area is nonhazardous and power has been removed or the equipment is properly secured [#2].
```

</details>

<details><summary>ungrounded LLM answer</summary>

```
To configure Modbus communication on the Micro820 in CCW (Connected Components Workbench), follow these steps:

1. **Ensure safety**: Before starting, make sure the Micro820 is powered down and all safety precautions are taken to avoid electrical shock or injury.
2. **Open CCW**: Launch CCW and open your project or create a new one.
3. **Select the Micro820**: In the Project Explorer, select the Micro820 device.
4. **Configure Modbus**: In the Device Configuration section, navigate to **Communication** > **Modbus**.
5. **Set Modbus parameters**: Configure the Modbus settings as required, including:
	* Modbus protocol (RTU or ASCII)
	* Baud rate
	* Parity
	* Stop bits
	* Slave ID
6. **Define Modbus mapping**: In the **Modbus Mapping** section, define the Modbus registers and coils that will be used for communication.
7. **Download to device**: Once configured, download the changes to the Micro820 device.

**Important safety note**: Before applying power to the Micro820, verify that all connections are secure and meet the manufacturer's recommendations to avoid electrical shock or injury.

**Additional resources**: For detailed instructions and specific configuration options, refer to the Micro820 user manual and the CCW help documentation.
```

</details>

---

### Q07 · safety · easy

**Q:** What safety precautions should I take before wiring a VFD to a PLC?

**Retrieval:** 5 chunks · relevance 0.2 · coverage 1.0 · citation-ready 1.0 · embedding_ok=True
**Rerank:** equipment=['VFD'] · pos_hits=20 · neg_hits=2 · bm25_in=15 · sql_fallback_in=15 · candidates_in=30 · dropped=25

Sources retrieved:
- AutomationDirect / drives g vg 4 manual / p.855 (gdrive)
- AutomationDirect / drives g vg 4 manual / p.1156 (gdrive)
- AutomationDirect / drives g vg 4 manual / p.181 (gdrive)
- AutomationDirect / drives g mini manual / p.237 (gdrive)
- AutomationDirect / drives g mini manual / p.307 (gdrive)

**Scores (1-5 each, total /35 after fabrication penalty):**

| dimension | MIRA grounded | ungrounded LLM |
|---|---|---|
| correctness | 5 | 5 |
| citation_quality | 5 | 2 |
| completeness | 4 | 5 |
| safety | 5 | 5 |
| hallucination_resistance | 5 | 5 |
| usefulness | 4 | 5 |
| factual_accuracy | 4 | 2 |
| _LLM 6-dim sum_ | 28 | 27 |
| _factual_accuracy ratio_ | 0.667 | 0.167 |
| _fabrication penalty_ | -0 | -0 |
| **total** | **32** | **29** |

_Grounded missing components:_ DC bus, PPE

_Baseline missing components:_ de-energize, lockout, verify zero voltage, DC bus, qualified person

_Judge on grounded:_ The candidate provides accurate safety precautions, cites specific components, and admits to missing information, but lacks specific wiring procedures and PPE mention.

_Judge on baseline:_ The candidate provides a comprehensive and accurate list of safety precautions, including de-energizing, lockout, and use of PPE, but lacks specific citations to manuals or regulations. The answer is highly useful and resistant to hallucination, providing concrete steps and warnings.

<details><summary>MIRA grounded answer</summary>

```
Before wiring a VFD to a PLC, ensure the VFD is de-energized to prevent electrical shock or injury [#1]. Verify zero voltage on the VFD terminals, including the Input Rectifier Bridge, VFD Terminal.Positive Lead = L2 and VFD Terminal.Negative Lead [#2]. Lockout/Tagout (LOTO) the VFD to prevent accidental startup. This task should only be performed by a qualified person. 

The KB does not contain enough information to answer confidently about specific wiring precautions or procedures for connecting the VFD to the PLC. Additional documents needed include:
- VFD installation manual
- PLC installation manual
- Wiring diagrams for the specific VFD and PLC models
- Electrical safety standards and guidelines for the facility.
```

</details>

<details><summary>ungrounded LLM answer</summary>

```
Before wiring a VFD to a PLC, take the following safety precautions:

1. **Ensure the power is off**: Verify that the power supply to both the VFD and PLC is turned off. Lock out and tag out the power sources to prevent accidental start-up.
2. **Check the manuals**: Review the VFD and PLC manuals to understand the wiring requirements and any specific safety recommendations.
3. **Use proper personal protective equipment (PPE)**: Wear insulating gloves, safety glasses, and a face shield to protect against electrical shock and arc flash.
4. **Verify voltage and signal compatibility**: Ensure the VFD and PLC are compatible in terms of voltage and signal levels to prevent damage or malfunction.
5. **Grounding and bonding**: Verify that the VFD and PLC are properly grounded and bonded to prevent electrical shock and ensure reliable operation.
6. **Follow local electrical codes and regulations**: Comply with local electrical codes, such as NFPA 70 (NEC), and regulations, such as those related to arc flash and electrical safety.

When working with electrical systems, always remember to:

* Never touch electrical components with your bare hands.
* Avoid wearing loose clothing or jewelry that could get caught in equipment.
* Keep the work area clean and clear of debris.
* Have a fire extinguisher nearby.

By following these safety precautions, you can minimize the risk of electrical shock, injury, or equipment damage when wiring a VFD to a PLC.
```

</details>

---

### Q08 · troubleshooting · medium

**Q:** How do I reset a latched fault on a GS11 drive via Modbus?

**Retrieval:** 5 chunks · relevance 1.0 · coverage 1.0 · citation-ready 1.0 · embedding_ok=True
**Rerank:** equipment=['GS11'] · pos_hits=20 · neg_hits=4 · bm25_in=15 · sql_fallback_in=15 · candidates_in=30 · dropped=25

Sources retrieved:
- Automation Direct / GS11 / p.1 (field-guide)
- Automation Direct / GS11 / p.4 (field-guide)
- Automation Direct / GS11 / p.2 (field-guide)
- Automation Direct / GS11 / p.6 (field-guide)
- Automation Direct / GS11 / p.7 (field-guide)

**Scores (1-5 each, total /35 after fabrication penalty):**

| dimension | MIRA grounded | ungrounded LLM |
|---|---|---|
| correctness | 5 | 2 |
| citation_quality | 4 | 4 |
| completeness | 5 | 4 |
| safety | 5 | 5 |
| hallucination_resistance | 5 | 5 |
| usefulness | 5 | 4 |
| factual_accuracy | 4 | 1 |
| _LLM 6-dim sum_ | 29 | 24 |
| _factual_accuracy ratio_ | 0.75 | 0.0 |
| _fabrication penalty_ | -0 | -4 |
| **total** | **33** | **21** |

_Baseline fabrications flagged:_ register=0x901f, hex_param=0x901f, hex_param=0x140f, hex_param=0x0001

_Grounded missing components:_ function code 06

_Baseline missing components:_ 0x2002, non-zero, function code 06, holding register

_Judge on grounded:_ The candidate answer accurately provides the required information, including the correct register address (0x2002), function code (06), and safety precautions, and admits the importance of consulting official documentation for the most up-to-date information.

_Judge on baseline:_ The candidate answer provides a clear procedure and safety warning, but contains incorrect or missing technical facts, such as the expected function code 06 and register 0x2002. The answer also admits uncertainty and recommends consulting the manual, demonstrating good hallucination resistance.

<details><summary>MIRA grounded answer</summary>

```
To reset a latched fault on a GS11 drive via Modbus, first ensure the drive is properly connected and configured, with the correct wiring and settings, including D+ to SG+, D- to SG-, and G to SGND, as well as the correct baud rate, frame format, and slave address, as outlined in [#1] and [#3]. 

1. **De-energize the system**: Before attempting any maintenance, ensure the system is de-energized and verify zero voltage to prevent any accidental start-ups or electrical shocks.
2. **Write to the Fault Reset register**: To clear a latched fault, write any non-zero value to register 8194 (0x2002) using the Modbus Write Single (FC06) function, as specified in [#2].
3. **Verify the fault is cleared**: After writing to the Fault Reset register, read the register back using the Modbus Read Holding (FC03) function to verify that the fault is cleared, as indicated by a value of 0, as described in [#2].

Remember to follow proper safety procedures, including lockout/tagout (LOTO) and ensuring you are a qualified person to perform these tasks. Additionally, always refer to the official documentation and follow the manufacturer's guidelines for specific instructions on resetting faults and performing maintenance on the GS11 drive. 

If issues persist, refer to the troubleshooting guide in [#5] for common symptom patterns and steps to resolve them. 

The KB does contain enough information to answer this question confidently, but always consult the official manuals and reference documents for the most up-to-date and detailed information.
```

</details>

<details><summary>ungrounded LLM answer</summary>

```
To reset a latched fault on a GS11 drive via Modbus, you'll need to send a specific command to the drive. 

1. **Ensure you have the correct Modbus address and register mapping for your GS11 drive**. Consult the drive's manual or manufacturer's documentation for this information.
2. **Use a Modbus master device or software** (such as a PLC, HMI, or Modbus scanner) to send a command to the drive.
3. **Write a value to the fault reset register**. Typically, this involves writing a specific value (often '1' or '0xFF') to a designated register, such as the "Fault Reset" or "Clear Fault" register.
4. **Verify the register address and value**. For GS11 drives, the fault reset register is often at address 0x901F (or 0x140F in decimal). You may need to write a value of '1' to this register to reset the fault.

**Example Modbus command:**
- Function Code: 0x10 (Write Multiple Registers)
- Starting Address: 0x901F (or 0x140F in decimal)
- Quantity of Registers: 1
- Value to Write: 0x0001 (or 1 in decimal)

**Safety Warning:** Before attempting to reset a fault, ensure you have identified and addressed the underlying cause of the fault to prevent further damage or safety risks. Additionally, always follow proper lockout/tagout procedures when working with electrical equipment.

Please consult the GS11 drive's manual or manufacturer's documentation for specific instructions, as the exact procedure may vary depending on the drive's firmware and configuration.
```

</details>

---

### Q09 · modbus · easy

**Q:** What are the GS11 RS-485 default communication settings (baud, parity, stop bits)?

**Retrieval:** 5 chunks · relevance 1.0 · coverage 1.0 · citation-ready 1.0 · embedding_ok=True
**Rerank:** equipment=['GS11'] · pos_hits=18 · neg_hits=2 · bm25_in=15 · sql_fallback_in=15 · candidates_in=29 · dropped=24

Sources retrieved:
- Automation Direct / GS11 / p.9 (field-guide)
- Automation Direct / GS11 / p.6 (field-guide)
- Automation Direct / GS11 / p.4 (field-guide)
- Automation Direct / GS11 / p.8 (field-guide)
- Automation Direct / GS10-vs-GS11 / p.10 (field-guide)

**Scores (1-5 each, total /35 after fabrication penalty):**

| dimension | MIRA grounded | ungrounded LLM |
|---|---|---|
| correctness | 5 | 4 |
| citation_quality | 5 | 2 |
| completeness | 5 | 4 |
| safety | 5 | 5 |
| hallucination_resistance | 5 | 5 |
| usefulness | 5 | 4 |
| factual_accuracy | 4 | 4 |
| _LLM 6-dim sum_ | 30 | 24 |
| _factual_accuracy ratio_ | 0.833 | 0.667 |
| _fabrication penalty_ | -1 | -0 |
| **total** | **33** | **28** |

_Grounded fabrications flagged:_ baud=19200

_Grounded missing components:_ slave id 1

_Baseline missing components:_ 8 data bits, slave id 1

_Judge on grounded:_ The candidate answer accurately provides the default communication settings for the GS11 RS-485, including baud rate, parity, stop bits, and data bits, with proper citations and safety warnings, making it a comprehensive and reliable response.

_Judge on baseline:_ The candidate answer is mostly correct, but incorrectly states the number of stop bits as 1 instead of 2, and lacks specific citation to the device's manual. However, it includes a proper safety note and admits uncertainty by recommending consultation of the manual.

<details><summary>MIRA grounded answer</summary>

```
The GS11 RS-485 default communication settings are: 
- Baud rate: 9600 [#5], also confirmed in the master settings as 9600 [#1]
- Parity: None [#1] and [#5]
- Stop bits: 2 [#1] and [#5]

These settings are also reflected in the drive parameters, with P09.01 set to 9.6 (which corresponds to 9600 baud) [#1] and P09.04 set to 13 (which corresponds to an 8N2 frame format, or 8 data bits, no parity, and 2 stop bits) [#1]. 

Before applying these settings, ensure that the physical drive and the PLC configuration match, as there are different valid configurations, such as the earlier GS10 seed with 19200 baud, even parity, and 1 stop bit [#5]. 

Remember to follow proper safety procedures when working with electrical systems, including de-energizing the system, using lockout/tagout (LOTO), and verifying zero voltage before starting work.
```

</details>

<details><summary>ungrounded LLM answer</summary>

```
The GS11 (likely a variable frequency drive) default RS-485 communication settings are typically:

* Baud rate: 9600
* Parity: None
* Stop bits: 1

**Important Safety Note:** Before attempting to communicate with the GS11, ensure you have followed proper lockout/tagout procedures and consulted the device's manual to avoid any potential electrical shock or equipment damage.
```

</details>

---

### Q10 · plc-programming · hard

**Q:** How do I set up a Modbus read function block in CCW ladder logic for the Micro820?

**Retrieval:** 5 chunks · relevance 0.2 · coverage 0.5 · citation-ready 1.0 · embedding_ok=True
**Rerank:** equipment=['Micro820', 'CCW'] · pos_hits=15 · neg_hits=7 · bm25_in=15 · sql_fallback_in=15 · candidates_in=30 · dropped=25

Sources retrieved:
- Rockwell Automation / 2080-LC20-20QBB / p.6 (manual)
- Rockwell Automation / 2080-LC20-20QBB / p.2 (manual)
- Rockwell Automation / 2080-LC20-20QBB / p.6 (manual)
- Rockwell Automation / 2080-LC20-20QBB / p.1 (manual)
- Rockwell Automation / 2080-LC20-20QBB / p.4 (manual)

**Scores (1-5 each, total /35 after fabrication penalty):**

| dimension | MIRA grounded | ungrounded LLM |
|---|---|---|
| correctness | 5 | 4 |
| citation_quality | 2 | 1 |
| completeness | 2 | 5 |
| safety | 5 | 4 |
| hallucination_resistance | 5 | 5 |
| usefulness | 2 | 5 |
| factual_accuracy | 1 | 2 |
| _LLM 6-dim sum_ | 21 | 24 |
| _factual_accuracy ratio_ | 0.0 | 0.333 |
| _fabrication penalty_ | -0 | -0 |
| **total** | **22** | **26** |

_Grounded missing components:_ MSG_MODBUS, TargetCfg, LocalCfg, function code 03, starting address, trigger

_Baseline missing components:_ MSG_MODBUS, TargetCfg, LocalCfg, starting address

_Judge on grounded:_ The candidate answer does not provide specific information on setting up a Modbus read function block, but it admits the lack of information and provides a safety warning, demonstrating high hallucination resistance and safety awareness.

_Judge on baseline:_ The candidate answer provides a clear, step-by-step guide to setting up a Modbus read function block, but lacks specific references to the Micro820 documentation or manual pages. The answer covers all necessary aspects, includes a safety warning, and admits no uncertain information, making it a useful and reliable guide for maintenance technicians.

<details><summary>MIRA grounded answer</summary>

```
The KB does not contain enough information to answer confidently. To set up a Modbus read function block in CCW ladder logic for the Micro820, additional documents such as the Micro820 programming manual or the CCW software user manual would be needed. The provided chunks [#1-#5] discuss the Micro820 controller's user manual, safety warnings, and compliance with various directives, but do not provide specific information on setting up a Modbus read function block. 

Safety warning: Before attempting any programming or configuration, ensure the system is de-energized and properly locked out (LOTO) by a qualified person, and verify zero voltage on all power wiring and components to avoid electrical shock or injury.
```

</details>

<details><summary>ungrounded LLM answer</summary>

```
To set up a Modbus read function block in CCW ladder logic for the Micro820:

1. **Ensure proper configuration**: Verify that your Micro820 is configured for Modbus communication and the device you're reading from is properly connected and configured.
2. **Add the Modbus Read block**: In CCW, go to the "Function Blocks" tab, select "Communication" and then "Modbus". Drag and drop the "Modbus Read" block into your ladder logic program.
3. **Configure the block**:
	* Set the "Slave ID" to the address of the device you're reading from.
	* Choose the "Function Code" (e.g., 0x03 for reading holding registers).
	* Set the "Start Address" and "Quantity" of registers to read.
	* Configure the "Data Type" (e.g., INT, UINT, FLOAT) to match the data being read.
4. **Specify the data destination**: Set the "Destination" tag to store the read data. This can be a register, integer, or other data type.
5. **Trigger the read**: Use a ladder logic rung to trigger the Modbus Read block. This can be a continuous rung or a one-shot trigger.
6. **Error handling**: Consider adding error handling to your program to handle cases like communication errors or invalid data.

**Safety warning**: Ensure that your program is properly tested and validated to prevent unintended operation or damage to equipment. Always follow proper lockout/tagout procedures when working with industrial control systems.
```

</details>

---
