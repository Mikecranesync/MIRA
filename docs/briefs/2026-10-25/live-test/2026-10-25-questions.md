# MIRA live test: 5 real forum questions (2026-10-25)

**For the Notebook Prover live test on the real path only:** mira-mobile → Hub `/api/equipment-notebooks/{id}/chat/` → `retrieveNodeChunks` (manual-rag) → citation SSE.
Don't use pipeline bots, ask_api-as-engine, Open WebUI, or the #3584/#3589 bots path.
**Grading:** PASS or FAIL against the cited manual page. An answer with no citation, or one citing a page that doesn't support the claim, is a FAIL, even if the advice matches the forum.
Each forum answer below is the real-world reference. The manual page decides the grade.
Compiled read-only by curl from public PLCtalk pages. Nothing was posted and no login was used. MIRA was not run.
Excluded on purpose: safety, factory, and fault-reset topics, light curtains, safety PLCs, and grounding. Times are as posted (ET).

---

## Q1 — Rockwell PowerFlex 525: F012 HW Overcurrent
- **URL:** https://www.plctalk.net/forums/threads/powerflex-525-fault.129023/
- **Thread:** "Powerflex 525 Fault". Posted by **fredjohns822**, 2021-04-14 12:59 ET (post 883139)
- **Original post (verbatim):**
  > We have a powerflex 525 VFD and today got a F012 Fault on it which is HW over current. I am not really sure what a Hardware Overcurrent fault is or what do do to correct it. The drive is set correctly for the motor it is connected to. Can anyone explain to me what exactly a hardware fault is and what i can do to correct it. Thanks
- **Best answer:** **jraef** ([post 883152](https://www.plctalk.net/forums/threads/powerflex-525-fault.129023/post-883152)) explains that a hardware circuit trips the output transistors when the current's rate of rise and amplitude exceed its threshold, faster than the microprocessor can react. No parameter changes this. The job is to find what caused the current spike. **BClark4** ([post 883208](https://www.plctalk.net/forums/threads/powerflex-525-fault.129023/post-883208)) agrees and lists checks:
  - Measure motor winding resistance against the motor specs.
  - Check resistance to ground (should read OL, or at least 100 kΩ+).
  - Uncouple the load and run an autotune (P040 = 2).
  - Make sure any brake isn't binding.
- **Why judged correct:** Two experienced members independently agree, and the answer matches the 520-UM001 fault table for F012 (output current exceeded the hardware limit; check programming, excess load, DC boost, DC brake volts, motor/cable short). The OP never confirmed a fix, so the grade rests on the manual.
- **Equipment:** Allen-Bradley PowerFlex 525 AC drive (25B-…)
- **Manuals:** **520-UM001** (PowerFlex 520-Series User Manual, fault code table, F012). Optional: 520-PM001.
- **Rubric:** Must say F012 means the hardware overcurrent limit was exceeded (instantaneous trip, not a setting). It must name load, short, or excess-boost/brake causes per the 520-UM001 F012 entry, and cite that page.

## Q2 — Rockwell PowerFlex 525: F080 Autotune failure, drive-specific
- **URL:** https://www.plctalk.net/forums/threads/powerflex-525-f080-autotune-failure-anomaly.126768/
- **Thread:** "Powerflex 525 F080 Autotune Failure anomaly?". Posted by **mylespetro**, 2020-10-17 16:17 ET (post 865024)
- **Original post (verbatim):**
  > Hey everyone, ran into a strange issue trying to autotune a motor using a PF525. For context, there's an enclosure with two 525s in it, controlling two motors with identical nameplate data: 575V, 60Hz, 3HP, 3.44A, 1720RPM We went to run a Static Tune on Motor A through Drive A and we got fault F080 - Autotune failure. After checking the troubleshooting section of the manual, it said either the start command was interrupted or the autotune actually failed. After double checking that we weren't losing our start input (we were jumpering +24VDC from terminal 11 directly to terminal 2 and didn't pull it off), and trying the autotune several times, we kept getting the same fault. Afterwards we ran the Static Tune on Motor B through Drive B and it went off without a hitch. After doing a resistance test of the windings in addition to meggering the motors (11 ohms on all 3 windings on both motors, 550Mohm on the megger on both motors), and thinking about how to narrow down the cause, we swapped the motor leads on the two drives so that Motor A was connected to Drive B and vice versa. We then ran the Static Tune on Motor A (which was failing the autotune) through Drive B and it completed the autotune successfully, while the Static Tune on Motor B through Drive A returned the same F080 fault again. We double checked that the parameters were all the same on both (motor NP data etc), and everything was the same across both. Anyone have any idea why one drive would fail an autotune on multiple motors that another drive were able to successfully autotune? [...]
  - *Grader note:* The OP's final two sentences were dropped from this quote and are paraphrased here. They planned to swap the power section, then the control module, and asked whether the drive could be faulty out of the box.
- **Best answer:** **alan_505** ([post 865040](https://www.plctalk.net/forums/threads/powerflex-525-f080-autotune-failure-anomaly.126768/post-865040)): since both motors tune on drive B and fail on drive A, suspect drive A and change the power or control module. The OP ([post 865053](https://www.plctalk.net/forums/threads/powerflex-525-f080-autotune-failure-anomaly.126768/post-865053)) replied: "Swapped the power module and it autotuned successfully."
- **Why judged correct:** The OP confirmed the fix, and confirmed again in 2022 (post 914765) that the power module was replaced.
- **Equipment:** Allen-Bradley PowerFlex 525, 575 V, 3 HP (two-part drive: control module plus power module)
- **Manuals:** **520-UM001** (F080 Autotune Failure entry; P040 Autotune; motor nameplate params P031–P036; the control/power module description).
- **Rubric:** Must cite the 520-UM001 F080 causes (start removed during tune, or the tune itself failed). Because the swap test isolates the fault to drive A, it must conclude drive-side hardware is suspect and recommend swapping or replacing the power module, then the control module. It must not just tell the user to recheck motor wiring.

## Q3 — Rockwell Micro820: CCW won't connect/download; fix IP via ConfigMeFirst.txt on microSD
- **URL:** https://www.plctalk.net/forums/threads/micro820-connection-problems.116756/
- **Thread:** "Micro820 Connection Problems". Posted by **APQ-Service**, 2018-07-28 08:13 ET (post 786150)
- **Original post (verbatim):**
  > Hello everyone, I'm working on a project with an Allen-Bradley Micro820 PLC and PV800 HMI. This is my first time using A-B controllers, and I'm having trouble connecting and downloading my ladder diagram. Thus far, my full program is 13 rungs, and builds successfully. I've also written a test program that's just one input triggering one output, which also builds successfully. However, I haven't been able to download either program. When I plug into my PLC with a Cat5 patch cable, my PC can see the PLC in both RSLinx Classic (using Ethernet/IP Driver) and in Connected Components Workbench. It successfully detects the PLC IP address, which changes each time I power cycle the PLC, matching the default DHCP IP setting for these PLCs. However, nothing happens when I press the "Connect" button. When I try going through Device-Download, the first time after I connect it says the build is successful, and subsequent times says the controller is up to date, but neither program appears to be working. This happens whether I configure the driver for Windows default or my laptop's Ethernet card. [software versions...] Does anyone know what I'm doing wrong that I can't connect to this PLC?
- **Best answer:** **damica1** ([post 786158](https://www.plctalk.net/forums/threads/micro820-connection-problems.116756/post-786158)) says to use CCW Setup Connection Path, browse the EtherNet/IP driver, and select the PLC, with the PC on the same subnet. To give the PLC a static IP, put a `ConfigMeFirst.txt` file on a microSD card containing `[PM] [IPA=192.168.2.101] [SNM=255.255.255.0] [GWA=192.168.2.1] [END]`, insert it, and power cycle.
- **Why judged correct:** The OP confirmed it in [post 786160](https://www.plctalk.net/forums/threads/micro820-connection-problems.116756/post-786160): "I selected the new driver and was able to connect and download my project. It looks like my program is running". A second user (RookiePLC, post 902954) also confirmed the fix.
- **Equipment:** Allen-Bradley Micro820 (2080-LC20-…), CCW v10, RSLinx Classic, PanelView 800
- **Manuals:** **2080-UM005** (Micro820 Programmable Controllers User Manual: microSD / ConfigMeFirst.txt, IP configuration, status LEDs). Fallback: 2080-UM002 (Micro830/850/870 user manual), which is the wrong family for this model.
- **Rubric:** Must say the controller comes up on DHCP by default and that the PC must be on the same subnet. It must give the ConfigMeFirst.txt microSD method with the [PM]/IPA/SNM/GWA/[END] keywords and a power cycle, citing the 2080-UM005 page. It should also mention browsing and selecting the path in CCW Connection Path.

## Q4 — Siemens TP700 Comfort + S7-1500 (TIA V18): "####" fields, "Session authentication not successful" after long power-off
- **URL:** https://www.plctalk.net/forums/threads/hmi-data-fields-showing-and-session-authentication-not-successful-after-prolonged-power-off.147550/
- **Thread:** "HMI Data Fields showing '####' and "Session authentication not successful" after prolonged power off". Posted by **Randunu**, 2025-09-02 11:53 ET (post 1017902)
- **Original post (verbatim, trimmed):**
  > PLC: Siemens S7-1500 (CPU 1512C-1 PN) HMI: TP700 Comfort Software: TIA Portal V18 Application: Bottle filling machine Problem: HMI data fields show '####' and I receive a "Session authentication not successful" error in the PLC diagnostic buffer after the machine has been powered off for an extended period (2-6 months). [...] After being off for over six months, the HMI now shows '####' in all data fields. When I press any on-screen button, the HMI displays a pop-up error: "Tag HIGH FILL VOL : value 0 could not be written to the PLC" [...] I corrected the time and date on both the PLC and the HMI. [...] I successfully pinged the PLC and HMI [...] The PLC diagnostic buffer continuously shows the error "Security event: Session authentication not successful" [...] I generated new security certificates in the PLC through TIA Portal, but this did not resolve the issue. [...] Is there a specific setting in TIA Portal V18 related to certificate expiration or security session timeouts that I'm missing?
- **Best answer:** The OP's own resolution ([post 1018157](https://www.plctalk.net/forums/threads/hmi-data-fields-showing-and-session-authentication-not-successful-after-prolonged-power-off.147550/post-1018157)): "It is all about security certification issue based on time mismatch. HMI need to sync with PLC as a slave And in the PLC side i have created new certificate." Supporting replies:
  - **mk42** (post 1017986): add a system-alarm view, because Comfort panels show system alarms for only 2 s; check the time zones.
  - **Thomas_v2** (post 1018305): issue a new certificate with a validity window that runs well into the past and future.
- **Why judged correct:** The OP confirmed the fix on the machine.
- **Equipment:** Siemens SIMATIC TP700 Comfort (6AV2124-0GC01-0AX0), S7-1500 CPU 1512C-1 PN, TIA Portal V18. Note this is S7-1500, not S7-1200; the secure-HMI-comms behaviour is shared (S7-1200 FW V4.5+ / S7-1500 FW V2.9+).
- **Manuals:** **SIMATIC HMI Comfort Panels Operating Instructions** (A5E36770603, date/time and time sync). **WinCC Comfort/Advanced V18 system manual** (HMI connection: time synchronization master/slave, system events). **S7-1500 System Manual** (A5E03461182, "Secure PG/HMI communication" and certificate management). Siemens FAQ 109803583-class docs on certificates are nice-to-have.
- **Rubric:** Must name secure PG/HMI communication with certificates as the cause. It must say the HMI clock has to fall inside the PLC certificate validity window, that the HMI should be time-synced as slave to the PLC, and that the user should regenerate or download the certificate (or extend its validity). It must cite the Siemens manual page for time sync or secure communication.

## Q5 — ABB ACS355: F0018 THERM FAIL and F0001 OVERCURRENT on a new drive with no motor connected
- **URL:** https://www.plctalk.net/forums/threads/acs355-03e-44a0-4-installation-problem.139952/
- **Thread:** "ACS355-03E-44A0-4 Installation Problem". Posted by **Meya**, 2024-04-12 08:12 ET (post 966052)
- **Original post (verbatim):**
  > Hi, I am having a challenge installing a new drive ACS355-03E-44A0-4 as it keeps on displaying Fault code F00018 even when the load is not connected. Fault Codes: The faults exhibited by the drives are F0018 and F0001. The Persistent fault is F0018 even just by powering it ON, the Fault Comes. Regards, Meya
- **Best answer:** **BryanG** ([post 966056](https://www.plctalk.net/forums/threads/acs355-03e-44a0-4-installation-problem.139952/post-966056)) quoted the manual. 0018 THERM FAIL (5210) means the internal thermistor is open or shorted, or the ambient is too low; it is a drive internal fault, so replace the drive. 0001 OVERCURRENT with no motor connected (scalar trial) is also an internal fault, so replace the drive. He followed up by pointing the user to ABB support.
- **Why judged correct:** The answer is quoted directly from the ACS355 user manual fault table. The OP did not confirm a replacement, so the manual text is the grade anchor. *Exclusion note:* BryanG's later "load a standard macro / factory reset" aside is out of scope and must not appear in the rubric.
- **Equipment:** ABB ACS355-03E-44A0-4 (400 V, 44 A)
- **Manuals:** **ACS355 User's Manual 3AUA0000066143** (Fault tracing → fault codes 0001, 0018).
- **Rubric:** Must say that per the ACS355 fault table, F0018 THERM FAIL means an internal thermistor fault (or ambient too low) and that persisting at power-up means replace or RMA the drive. It must say F0001 with no motor in scalar mode is an internal drive fault. It must cite the 3AUA0000066143 fault-tracing page and must not suggest a factory reset.

---
## Manuals that may not be loaded (check the notebook's sourceDocIds before running)
- **2080-UM005** (Micro820): the earlier Micro800 CONNECT work named 2080-UM002/UM004, not UM005.
- **Siemens TP700 Comfort / WinCC Comfort / S7-1500 system manual**: earlier freezes recorded the WinCC manual as missing (TP1200, MTP700), and S7-1500 has not been confirmed.
- **ACS355 3AUA0000066143**: ABB is "proven," but I can't confirm this ACS355 model's manual is loaded.
- **520-UM001**: likely loaded (PowerFlex proven); confirm.
