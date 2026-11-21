# Safety-policy research for MIRA: hazardous energy, electrical, machinery, VFD and AI-governance requirements

Research date: 2026-10-29. This is read-only web research. Every claim carries a source tag:

- **[P]**: primary text I read myself (eCFR regulation text, a manufacturer manual, EUR-Lex/EC, NIST, an ISO/IEC abstract page).
- **[A]**: abstract or scope only. The normative clauses are paywalled.
- **[S]**: secondary source (trade press, training vendor, aggregator). Not verified against the standard.
- **[ANALYSIS]**: my own inference. No source states it.

> **Edition warning (NFPA 70E).** NFPA 70E-**2027** is published and is the current edition. NFPA's product page for the 2027 edition exists, and NFPA's own community post announces the new "additional person" requirement for justified energized work. The task asks for 2024 numbering, so the invariants below are keyed to **70E-2024**. Each NFPA citation also carries a `[2027: …]` note where a secondary source reports a renumbering. All 2027 numbering is **[S]/unverified**. One secondary claim, that the capacitor and battery articles swap between 360 and 320, looks odd and may be wrong. Re-verify every NFPA clause ID against an NFPA LiNK read-only view before shipping.

---

## 1. OSHA 29 CFR 1910.147: Control of Hazardous Energy (LOTO)

Source [P]: eCFR renderer text of 29 CFR 1910.147, pulled 2026-10-29: https://www.ecfr.gov/current/title-29/subtitle-B/chapter-XVII/part-1910/subpart-J/section-1910.147. osha.gov returned 403 to automated fetch; the same text is at https://www.osha.gov/laws-regs/regulations/standardnumber/1910/1910.147.

### 1.1 Scope and the minor-servicing exception
- **(a)(1)(i)**: The standard covers servicing and maintenance where "unexpected energization or start up … or release of stored energy could cause injury."
- **(a)(2)(ii)**: Normal production operations are not covered; they fall under Subpart O. Servicing during normal production *is* covered if either of these applies:
  - (A) an employee must remove or bypass a guard or other safety device; or
  - (B) an employee must place any part of the body into the point of operation, or into a danger zone that exists during a machine operating cycle.
- **Note to (a)(2)(ii), the minor-servicing exception.** "Minor tool changes and adjustments, and other minor servicing activities, which take place during normal production operations, are not covered … if they are **routine, repetitive, and integral** to the use of the equipment for production, **provided that** the work is performed using **alternative measures which provide effective protection** (See subpart O)."
  - **Policy consequence:** an answer cannot invoke this exception on its own. All three conditions plus "effective alternative protection" are site- and task-specific facts.
- **(a)(2)(iii)(A)**: Cord-and-plug equipment is excluded only when unplugging controls the hazard and the plug stays under the **exclusive control** of the employee doing the work.
- **Definitions, (b).** These are [P]:
  - "Energy isolating device … **Push buttons, selector switches and other control circuit type devices are not energy isolating devices.**"
  - "Servicing and/or maintenance" explicitly includes "lubrication, cleaning or **unjamming** … making adjustments or tool changes."
  - An "Authorized employee" is the person who locks out or tags out.
- **(c)(4)(i)–(ii)**: Energy control procedures must be developed, documented and used. They must include specific steps for shutting down, isolating, blocking and securing, and for placing and removing devices. They must also include requirements for **testing** the machine to verify that the energy control measures work.

### 1.2 Required sequence, (d)(1)–(d)(6)
The (d) intro is [P]: the procedures "shall cover the following elements and actions and **shall be done in the following sequence**":

| Step | Clause | Requirement (verbatim excerpts) |
|---|---|---|
| 1 Preparation | (d)(1) | Before shutdown, the authorized employee "shall have knowledge of the type and magnitude of the energy, the hazards … and the method or means to control the energy." |
| 2 Shutdown | (d)(2) | Shut down "using the procedures established for the machine"; "an orderly shutdown must be utilized to avoid any additional or increased hazard(s)". |
| 3 Isolation | (d)(3) | "All energy isolating devices … shall be physically located and operated" to isolate the machine from the energy source(s). |
| 4 LOTO device application | (d)(4)(i)–(iii) | Devices are affixed to **each** energy isolating device by authorized employees and hold it in "safe"/"off". |
| 5 Stored energy | (d)(5)(i) | "Following the application of lockout or tagout devices … all potentially hazardous **stored or residual energy shall be relieved, disconnected, restrained, and otherwise rendered safe**." |
| | (d)(5)(ii) | "If there is a possibility of **reaccumulation** of stored energy to a hazardous level, verification of isolation **shall be continued** until the servicing or maintenance is completed, or until the possibility … no longer exists." |
| 6 Verification | (d)(6) | "**Prior to starting work** … the authorized employee shall **verify that isolation and deenergization** … have been accomplished." |

Appendix A (typical minimal lockout procedure) is [P] but **non-mandatory**. Its step 7 verifies isolation "by operating the push button or other normal operating control(s) or by testing to make certain the equipment will not operate." It then cautions: "**Return operating control(s) to neutral or 'off' position after verifying.**" Its step 6 lists stored energy as "capacitors, springs, elevated machine members, rotating flywheels, hydraulic systems, and air, gas, steam, or water pressure", to be handled by "grounding, repositioning, blocking, bleeding down". Treat Appendix A as good practice, not a mandatory clause.

### 1.3 Release from lockout, (e) [P]
The intro reads "Before lockout or tagout devices are removed and energy is restored", and the following must be ensured:
- **(e)(1)**: Work area inspected, nonessential items removed, components "operationally intact".
- **(e)(2)(i)**: All employees safely positioned or removed. **(e)(2)(ii)**: Affected employees notified **after removal and before start**.
- **(e)(3)**: Each device is removed **by the employee who applied it**. The exception is employer-directed removal under a documented procedure: verify the applier is not at the facility, make all reasonable efforts to contact them, and ensure they know before resuming work.

### 1.4 Testing or positioning, (f)(1) [P]
"In situations in which lockout or tagout devices must be temporarily removed … and the machine or equipment energized to test or position", the following sequence "**shall be followed**":
1. (i) Clear tools and materials per (e)(1).
2. (ii) Remove employees per (e)(2).
3. (iii) Remove LOTO devices per (e)(3).
4. (iv) Energize and proceed with testing or positioning.
5. (v) "**Deenergize all systems and reapply energy control measures in accordance with paragraph (d)** to continue the servicing and/or maintenance."

Other [P] items: (f)(2) covers outside contractors, (f)(3) group lockout, and (f)(4) shift changes. OSHA's enforcement directive is CPL 02-00-147 (https://www.osha.gov/enforcement/directives/cpl-02-00-147). It treats safeguarding per ANSI B11.19 as acceptable "alternative measures" for minor servicing when the devices are under the exclusive control of the employee. That is [S], via ilockitout.com; the directive itself was not fetched.

### 1.5 1910.333: Electrical safety-related work practices [P]
Source: eCFR 1910.333 (https://www.ecfr.gov/current/title-29/subtitle-B/chapter-XVII/part-1910/subpart-S/section-1910.333).
- **(a)(1)**: "Live parts … **shall be deenergized** before the employee works on or near them, **unless** the employer can demonstrate that deenergizing introduces additional or increased hazards or is infeasible due to equipment design or operational limitations." Parts under 50 V to ground need not be deenergized if there is no increased exposure to burns or arc explosion.
  - Note 2 explicitly cites "testing of electric circuits that can only be performed with the circuit energized" as infeasibility. **Live troubleshooting measurement is therefore a recognized case, but it is energized work and falls under (c).**
- **(b)(1)**: Parts deenergized but not locked or tagged "**shall be treated as energized parts**".
- **(b)(2)**: Steps "shall be followed **in the order** in which they are presented". Note 2 says 1910.147 procedures comply if they also include (b)(2)(iii)(D) and (b)(2)(iv)(B).
- **(b)(2)(ii)(B)**: "Control circuit devices, such as push buttons, selector switches, and interlocks, **may not be used as the sole means** for deenergizing … Interlocks … may not be used as a substitute for lockout and tagging."
- **(b)(2)(ii)(C)**: "Stored electric energy which might endanger personnel shall be released. **Capacitors shall be discharged** and high capacitance elements shall be short-circuited and grounded." Note: "If the capacitors … are handled in meeting this requirement, they shall be **treated as energized**."
- **(b)(2)(ii)(D)**: Stored non-electrical energy that could re-energize circuit parts must be blocked or relieved.
- **(b)(2)(iv)**: "The requirements of this paragraph shall be met **before any circuits or equipment can be considered and worked as deenergized**."
  - **(A)**: A qualified person operates the controls or otherwise verifies the equipment cannot be restarted.
  - **(B)**: "A **qualified person shall use test equipment** to test the circuit elements and electrical parts … and shall verify that [they] are deenergized." The test must also detect induced voltage and backfeed. "**If the circuit to be tested is over 600 volts**, nominal, the test equipment shall be checked for proper operation immediately before and immediately after this test."
  - **The OSHA live-dead-live requirement is limited to over 600 V. The always-required version comes from NFPA 70E-2024 120.6(7).**
- **(b)(2)(v)(A)–(D)**: Before re-energizing, "even temporarily", in order:
  - (A) remove jumpers, shorts and grounds;
  - (B) warn exposed employees;
  - (C) the applier removes each lock and tag;
  - (D) visually confirm all employees are clear.
- **(c)(2)**: "**Only qualified persons** may work on electric circuit parts or equipment that have not been deenergized." They must be familiar with PPE, insulating and shielding materials, and insulated tools.
- **(c)(10)**: "Only a qualified person following the requirements of paragraph (c) **may defeat an electrical safety interlock, and then only temporarily** while he or she is working on the equipment. The interlock system shall be returned to its operable condition when this work is completed." **OSHA permits qualified, temporary defeat. A MIRA refusal to instruct interlock defeat is therefore *policy, stricter than OSHA*.**

### 1.6 1910.269 [P, scope only]
- Covers electric power generation, transmission and distribution installations (**(a)(1)(i)**).
- Its LOTO paragraph **(d)** applies to power-generation installations.
- Generation installations "not an integral part of … power generation processes" fall under 1910.147 and Subpart S (Note to (d)(1)).
- **Not applicable** to typical plant VFDs, conveyors and PLC panels. Relevant only for utility-side work.
- NFPA 70E-2024 approach-boundary tables were realigned to 1910.269 minimum approach distances [S].

### 1.7 Machine guarding, Subpart O / 1910.212 [P]
- **(a)(1)**: Guarding protects against "point of operation, ingoing nip points, rotating parts, flying chips and sparks".
- **(a)(3)(ii)**: Point-of-operation guarding must "**prevent the operator from having any part of his body in the danger zone during the operating cycle**."
- **(a)(3)(iii)**: Special hand tools "**shall not be in lieu of other guarding** … can only be used to supplement protection".
- **(a)(4)**: Revolving drums must be interlocked so they "cannot revolve unless the guard enclosure is in place".
- The combined stance of 1910.147(a)(2)(ii)(A)/(B) and 1910.212 is the following [ANALYSIS, directly grounded in the text above]:
  - Any instruction to reach into a point of operation or danger zone, or to remove or bypass a guard, during operation takes the task out of "normal production". That puts it under LOTO, unless the narrow minor-servicing exception with effective alternative protection applies.

---

## 2. NFPA 70E-2024: Standard for Electrical Safety in the Workplace

**Access:** paywalled. NFPA offers a free read-only view on NFPA LiNK / nfpa.org free access (login required): https://www.nfpa.org/product/nfpa-70e-standard-for-electrical-safety-in-the-workplace/p0070ecode. Nothing below was read from the standard itself, so all of it is **[S]**. I deliberately did not use an unauthorized PDF copy that appeared in search results.

| Topic | 70E-2024 clause | Content | Sources |
|---|---|---|---|
| Electrically safe work condition (ESWC) policy | **110.2** | Consolidates the former 110.3/110.4. "Priority" became "Policy". The normal-operation exception lists 7 conditions; "equipment rated for available fault current" was added. Exception 2 covers energizing a disconnect to achieve ESWC after a risk assessment. | brainfiller [S]; e-hazard [S]; ecmag [S] |
| Electrical safety program | **110.3** | Risk assessment procedure at **110.3(H)**: (H)(1) elements; (H)(2) human error; **(H)(3) hierarchy of risk control: (1) elimination, (2) substitution, (3) engineering controls, (4) awareness, (5) administrative controls, (6) PPE**. Job safety planning with a new emergency-response-plan requirement at **110.3(I)**. | electricallicenserenewal.com quoting 110.3(H) [S]; safearc [S] |
| Qualified person | **110.4(A)(1)** | "special" → "applicable" techniques; "can" → "shall". | brainfiller [S] |
| Stored energy in ESWC | **120.5(B)(2)** | Added: stored energy is released "to the extent that the circuit cannot be unintentionally energized". | brainfiller [S] |
| ESWC process (8 steps) | **120.6** (was 120.5) | (1) identify all sources; (2) interrupt load, open disconnects; (3) visually verify blades open / breakers withdrawn where possible; (4) release stored electrical energy; (5) block or relieve stored non-electrical energy; (6) apply LOTO; **(7) "use an adequately rated portable test instrument to test each phase conductor or circuit part *at each point of work*… phase-to-phase and phase-to-ground. Before and after each test, determine that the test instrument is operating satisfactorily through verification on any known voltage source"**. Exception 1 allows a listed permanently mounted absence-of-voltage tester (AVT) that tests at the point of work and self-verifies before and after. (8) Apply temporary protective grounding where induced or stored energy is possible. | expertce.com and panduit white paper [S]; e2g [S]; e-hazard [S] |
| Energized work justification and EEWP | **130.2** (2027: **130.3** [S]) | 130.2(A): energized work only when de-energizing creates additional or increased hazards, or is infeasible. 130.2(B): EEWP elements: circuit and location, work description, justification, safe work practices, shock risk assessment, arc-flash risk assessment, access restriction, job briefing evidence, approval signatures. **Exemptions (no permit, but PPE and safe practices still required): testing, troubleshooting, voltage measuring**; thermography or visual inspection without crossing the restricted approach boundary; access/egress; housekeeping. | tyndaleusa [S]; secure.utah.gov course objectives [S] |
| Shock risk assessment / approach boundaries | **130.4**, tables **130.4(E)(a)/(b)** | Restricted approach boundaries realigned with 1910.269. New elevation note above 3000 ft / 900 m. | brainfiller [S]; e-hazard [S] |
| Arc-flash risk assessment | **130.5** | Incident energy or PPE category method. **Table 130.5(C)** header changed to "Operating Condition". **130.5(H)** labels with a durability requirement. Closed doors don't guarantee containment. | brainfiller [S] |
| PPE | **130.7** | Tables 130.7(C)(15)(a)/(b); dc table revised (>150 V to <600 V dc). | brainfiller [S] |
| Capacitors | **Article 360** (2027: possibly **320** [S, doubtful]) | Definitions include "Discharge time: the time required to discharge a capacitor to below electrical hazard thresholds (360)", ground stick, and time constant. **360.5(B)(6)** admits ground sticks for absence-of-voltage verification of capacitors. Reported stored-energy hazard thresholds: **<100 V and >100 J; ≥100 V and >1.0 J**. One source places these under 330.3 (lasers), so the clause is uncertain. | safearc [S]; ecmag "Beware the hazards" [S]; brainfiller [S] |
| 2027 additional person | 2027 **130.2(A)(2)** [S] | An additional person must be present when a worker is at risk of injury doing justified energized work. | NFPA community post (headline) [P-headline]; missioncriticalsafety.org [S] |
| 2027 AOV | 2027 **120.5(B)(6)** [S] | "Additional testing" is required where the voltage test alone is inconclusive. | missioncriticalsafety.org [S] |

---

## 3. Machinery safety standards (abstracts are [A]; clause details are [S])

- **ISO 12100:2010**, risk assessment and risk reduction (https://www.iso.org/standard/51528.html) [A].
  - Methodology for hazard identification, risk estimation and evaluation, and "elimination of hazards or sufficient risk reduction".
  - Confirmed 2022; ISO/DIS 12100.3 revision pending.
  - **Three-step method**, in order: (1) inherently safe design, (2) safeguarding and complementary protective measures, (3) information for use. The clause is 4 / Fig. 1 per Utec / Chinniah et al. 2019 [S]; usually cited as 6.1.
  - User-side measures (safe work procedures such as hazardous energy control, PPE, training) come after the three designer steps.
  - **MIRA output is at best "information for use" or a user administrative measure**, the lowest tier [ANALYSIS].
- **ISO 13849-1:2023**, SRP/CS design incl. software, PL (https://www.iso.org/standard/73481.html) [A].
  - Applies to "safety-related parts of control systems (SRP/CS) that perform safety functions, including the design of software", in high and continuous demand mode.
  - Does not specify the required safety functions or PLr.
- **IEC 62061:2021**, functional safety of machine safety-related control systems (SCS) (https://webstore.iec.ch/en/publication/59927) [A].
  - A machinery-sector standard under IEC 61508.
  - Does **not** cover electric shock from control equipment (that is IEC 60204-1) or safeguarding.
- **IEC 61508-1:2010**, E/E/PE safety-related systems (https://webstore.iec.ch/en/publication/5515) [A].
  - Covers systems "used to carry out safety functions"; SIL.
- **Is advisory software a safety function? [ANALYSIS]**
  - The EU Machinery Regulation 2023/1230 **Art. 3(4)** [P] defines a safety function as "a function that serves to fulfil a protective measure designed to eliminate, or … reduce, a risk, which, if it fails, could result in an increase of that risk".
  - **Recital 55** [P] limits the third-party regime to "systems with fully or partially self-evolving behaviour using machine learning approaches **ensuring safety functions**".
  - MIRA does not command the equipment under control and is not in the actuation path. It is therefore not an SRP/CS / SCS and needs no PL or SIL.
  - Its outputs are, however, *information on which a human performs a protective measure*. That is the administrative-control tier: a hazard source if wrong, never a risk-reduction credit.
  - **Design consequences:**
    1. MIRA must never be presented, or claim to be, a safeguard, interlock, isolation or verification means.
    2. It must defer to the site's machine-specific energy control procedure (1910.147(c)(4)) and to the authorized employee's knowledge (1910.147(d)(1)).
    3. Hazard-critical content must be fail-safe. When unsure, it withholds and refers rather than guessing.
- **ISO 14118:2017**, prevention of unexpected start-up (https://www.iso.org/standard/66460.html) [A].
  - Designed-in means to prevent unexpected start-up "to allow safe human interventions in danger zones".
  - Covers all energy, "including stored energy due to, e.g. gravity, compressed springs", and external influences.
  - Specifies no PL or SIL.
- **ISO 14119:2024**, interlocking devices with guards (https://www.iso.org/standard/75942.html) [A].
  - "Provides guidance on measures to **minimize the possibility of defeat of interlocking devices in a reasonably foreseeable manner**"; covers trapped-key systems.
  - Specific anti-defeat clause numbers (motivation-to-defeat assessment) not verified [S].
- **ANSI/ASSP Z244.1-2024**, lockout, tagout and alternative methods [S].
  - ASSP page: https://www.assp.org/standards/standards-topics/lockout-tagout-and-alternative-methods-z244-1. ASSP tech brief: https://www.assp.org/docs/default-source/standards-documents/z2441-1_techbrief_final_v2.pdf. ANSI blog: https://blog.ansi.org/ansi/ansi-assp-z244-1-2024-hazardous-energy-lockout-tagout/.
  - The 2024 edition makes alternative methods co-equal with LOTO, but only when based on a risk assessment and the hazard control hierarchy (tech brief §9.1.2).
  - "**Lockout has to be used when no risk assessment has been completed or the tasks and/or hazards are unknown**" (ANSI blog).
  - It adds cybersecurity aspects and fault annunciation (store preview).
  - **Consequence [ANALYSIS]:** MIRA cannot know whether a site-specific alternative method exists and has been validated. Its default must be full LOTO.
- **ANSI B11.0-2023 / B11.19-2019 (R2024)** [S].
  - B11.0 requires task and hazard identification (cl. 6.3, task-based) and states "zero risk does not exist".
  - B11.19 gives performance requirements for risk-reduction measures: guards cl. 8, control functions cl. 9, devices cl. 10, administrative controls cl. 11.
  - Control reliability is required for alternative methods (ASSP PSJ "Myth of Zero Energy": https://www.assp.org/docs/default-source/psj-articles/f1taubitzcontos_0123.pdf). The same article says hitting an e-stop "is neither safe, nor will it pass the test of compliance" as energy control.

---

## 4. VFD / drive manufacturer DC-bus discharge conventions [P]

| Manufacturer / drive | Stated wait | Verification wording | Source |
|---|---|---|---|
| **AutomationDirect GS10** | Quick-start: "at least **5 minutes** for most GS10 models". Ch. 6: "**5 minutes for ≤30hp** models and **10 minutes for ≥40hp** models". Ch. 6 inspection schedule: "Wait at least **10 minutes** after all display lamps have gone out". Ch. 2: "wait **five minutes**". | Verify the CHARGE LED is off, "**then measure** to confirm that the DC bus voltage … between (+1) and (−) is **less than 25VDC** before touching any terminals". | https://cdn.automationdirect.com/static/manuals/gs10m/inserts/gs10quick.pdf ; https://cdn.automationdirect.com/static/manuals/gs10m/ch6.pdf ; https://cdn.automationdirect.com/static/manuals/gs10m/ch2.pdf |
| **Rockwell PowerFlex 525** | "wait **three minutes**" | "verify AC voltage L1, L2, L3 (line-line and line-ground) … **Measure DC voltage across DC− and DC+** … keep the meter on the terminals until the voltage discharges to zero … **Darkened display LEDs is not an indication that capacitors have discharged**." | https://literature.rockwellautomation.com/idc/groups/literature/documents/qs/520-qs001_-en-e.pdf (520-QS001) |
| **ABB ACS880-01/-07** | "wait **5 minutes** to let the intermediate circuit capacitors discharge" | Lock out and tag out; "**Measure that the installation is de-energized** … Before and after you measure, verify the operation of the voltage tester on a known voltage source". Measure L1–L3 and U, V, W to PE, then **repeat with the DC setting** (motor-cable leakage capacitance "can remain charged for a long time"), then UDC+/UDC− to PE. Install temporary grounding. "**The Safe torque off function does not remove the voltage** from the main and auxiliary circuits." PM motor: disconnect with a safety switch. | https://library.e.abb.com/public/0bac1275fc4d4228b00d195737643433/EN_ACS880-01_HW_V.pdf ; ACS880-07: https://library.e.abb.com/public/c1d0f5a5e37e4ae1a1982131c0c751c0/EN_ACS880-07_HW_K.pdf |
| **Siemens SINAMICS G120 PM240-2** | "hazardous voltage is present for **up to 5 minutes**" | "Before starting any work, **check that the system is in a voltage-free state by measuring all terminals, also to ground**." | http://public.eandm.com/Public_Docs/PM240-2_HIM_en_en-US.pdf ; Siemens asset PDF https://assets.new.siemens.com/siemens/assets/api/uuid:48fca72b-670d-40f6-aa0d-f25cef30e33c/SINAMICSG120-Manual-de-instalacao-PM240-2-EN_original.pdf |
| **Yaskawa A1000** | "wait for at least the time specified on the warning label". Example label: "Wait **5 minutes**". | "The charge indicator LED will extinguish when the DC bus voltage is **below 50 Vdc**… wait … once all indicators are OFF, **measure for unsafe voltages** to confirm". PM motor: "voltage continues to be generated at the motor terminals … while the motor coasts". | https://www.yaskawa.com/delegate/getAttachment?cmd=documents&documentId=TOEPYAIA1U01&documentName=TOEPYAIA1U01.pdf ; tech manual mirror https://www.precision-elec.com/wp-content/uploads/2020/11/A1000-High-Performance-Vector-Control-Drive-Technical-Manual.pdf |
| **Danfoss VLT FC 102/202/301/302** | A table by voltage and power: **4, 7, 15, 20, 30 or 40 minutes**, "also visible on the nameplate". The tables differ between documents, so use the nameplate value. | "High voltage can be present **even when the warning LED indicator lights are off**." Disconnect "remote DC-link power supplies, including battery back-ups, UPS, and DC-link connections to other drives". Disconnect or lock the PM motor. "use an appropriate voltage measuring device to make sure that the capacitors are fully discharged." | https://assets.danfoss.com/documents/latest/271241/AQ361181055259en-000601.pdf ; https://assets.danfoss.com/documents/275330/AN279051429263en-000201.pdf |

**Conclusions [P-grounded]:**
1. Wait times range from **3 to 40 minutes** across vendors, voltage classes and frames. Even **one vendor's manual for one product family (GS10) states 5 and 10 minutes in different chapters.** No generic "safe wait" number exists.
2. **Every** vendor requires **measurement** after the wait. The wait is a precondition, never proof.
3. Indicator LEDs and dark displays are **explicitly not** proof: PowerFlex and Danfoss say so; Yaskawa's LED goes out below 50 Vdc, which is not zero.
4. STO, drive stop and e-stop do not remove voltage (ABB; 1910.147 definitions; 1910.333(b)(2)(ii)(B)).
5. Additional sources: coasting PM motors (Yaskawa, ABB, Danfoss); common DC bus and UPS (Danfoss); motor-cable leakage capacitance (ABB).
6. Thresholds for "discharged" differ: GS10 <25 VDC; PowerFlex "zero volts"; ABB "zero".

---

## 5. AI / automated advisory systems in industrial safety

- **EU AI Act**, Reg. (EU) 2024/1689, as amended by the **Digital Omnibus on AI** [P].
  - Signed 8 Jul 2026; OJ 24 Jul 2026; in force 27 Jul 2026.
  - High-risk rules for **Annex III** apply from **2 Dec 2027**, and for **Annex I (product-embedded) from 2 Aug 2028**. Sources: https://ai-act-service-desk.ec.europa.eu/en/ai-act/timeline/timeline-implementation-eu-ai-act and https://digital-strategy.ec.europa.eu/en/policies/regulatory-framework-ai.
  - The omnibus "**removed AI-enabled machinery products from the direct applicability of the AI Act's high-risk regime**". They comply via the Machinery Regulation, and the Commission must add AI-specific EHSRs by delegated act. Source: EP Legislative Train, https://www.europarl.europa.eu/legislative-train/theme-internal-market-and-consumer-protection-imco/file-digital-omnibus-on-ai.
  - Article 50 transparency obligations (telling users they are interacting with AI) apply from 2 Aug 2026.
- **Machinery Regulation (EU) 2023/1230** [P].
  - Text: https://eur-lex.europa.eu/eli/reg/2023/1230/2023-06-29/eng.
  - Art. 3(3) defines "safety component" as a physical **or digital component, including software** … designed to fulfil a safety function. Art. 3(4) defines "safety function".
  - **Annex I Part A** lists high-risk categories needing third-party conformity assessment:
    - **pt. 5**: "Safety components with fully or partially self-evolving behaviour using machine learning approaches ensuring safety functions".
    - **pt. 6**: Machinery with such embedded systems. Source: EP OEIL summary, https://oeil.europarl.europa.eu/oeil/en/document-summary?id=1749182.
  - Recital 55 excludes software "incapable of learning or evolving".
  - **Applies from 20 Jan 2027** (Art. 54) [S: secondary aggregators mycecheck.com and complass.de quoting Art. 54].
  - The EHSRs, including 1.1.9 (protection against corruption) and 1.2.1 (safety and reliability of control systems), sit in **Annex III**, not Annex I [S: complass.de].
  - **Applicability to MIRA [ANALYSIS]:** a standalone troubleshooting assistant is not placed on the market as a machine safety component and does not ensure a safety function. It therefore falls outside Annex I pt. 5/6. Claiming a safety role would change that, which is another reason for the "MIRA is not a safeguard" invariant.
- **NIST AI RMF 1.0** (AI 100-1) and the **NIST AI 600-1 Generative AI Profile** (Jul 2024) [P] (https://nvlpubs.nist.gov/nistpubs/ai/NIST.AI.600-1.pdf).
  - §2.2 **Confabulation**: "confidently stated but erroneous or false content". This includes "confabulated logic or **citations** that purport to justify" an answer. It matters especially "in domains which require highly contextual and/or domain expertise" and "consequential decision making".
  - Risk 3 is "Dangerous … content". Risk 7 is "Human-AI Configuration … automation bias, over-reliance".
  - **Consequence:** a cited number must be checked against the cited source (provenance), not just carry a citation string.
- **ISO/IEC 23894:2023**, AI risk management guidance (https://www.iso.org/standard/77304.html) [A]. A process standard that integrates AI risk into ISO 31000-style risk management.
- **ISO/PAS 8800:2024**, road vehicles: safety and AI (https://www.iso.org/standard/83303.html) [A].
  - Out of domain. Its concepts are useful by analogy: "output insufficiencies" of AI elements, and safety assurance arguments for "absence of unreasonable risk".
- **NIOSH** [P]: NIOSH Science Bulletin, "Practical Strategies to Manage AI Hazards in the Workplace" (Jan 2026), https://www.cdc.gov/niosh/bulletin/2026/practical-strategies-to-manage-ai-hazards-in-the-workplace.html.
  - Algorithms "cannot directly create any new tangible hazards" but "alter the risk profile of physical platforms".
  - Distinguishes "**prevention through software design**" controls, which the developer must apply.
  - Also: https://www.cdc.gov/niosh/bulletin/2024/ai-risk-management.html (safety-case approach, independent audit, alignment evaluation) and https://www.cdc.gov/niosh/bulletin/2022/algorithms-fow.html (risk from "user disregard of an algorithm's limitations").
  - **OSHA:** no AI-specific standard or guidance was found. The general duty clause and existing standards apply to the *work performed*.

---

## 6. SAFETY INVARIANTS for the answer-checking policy engine

### 6.1 Vocabulary (define once)
- **Isolation state** `S` ∈ {`ENERGIZED`, `DEENERGIZED_UNVERIFIED`, `LOCKED_OUT_UNVERIFIED`, `LOCKED_OUT_VERIFIED`, `TEST_RELEASE` (temporary LOTO removal under 1910.147(f)(1))}.
- **Step tags** (classifier output per answer step):
  - Energy control: `PREPARE`, `SHUTDOWN`, `ISOLATE`, `APPLY_LOTO`, `RELEASE_STORED`, `WAIT`, `VERIFY_AOV` (meter test at point of work), `VERIFY_TRY_START` (try normal controls, then return to off), `CHECK_TESTER` (live-dead-live).
  - Contact and energy use: `CONTACT` (touch conductors/terminals or handle parts), `BODY_IN_DANGER_ZONE`, `MEASURE_LIVE`, `ENERGIZE` (run/jog/power-up/reset), `CLEAR_AREA`, `REMOVE_LOTO`, `RESTORE`.
  - Defeat: `DEFEAT_SAFEGUARD` (bypass/jumper/mute/override an interlock, e-stop, guard switch or light curtain).
- **Claim tags:** `NUM_HAZARD` (discharge time, approach boundary, arc-flash cal/cm², PPE category, voltage threshold, energized torque value, stored-pressure value) with `{value, equipment_id, source_ref}`.
- **Policy tags:** each invariant is marked **REG** (restates a regulation or standard requirement) or **POLICY** (MIRA is stricter than the cited clause; the clause is the motivation, not a mandate).

### 6.2 Hazardous energy / LOTO
| ID | Rule (machine-checkable) | Basis |
|---|---|---|
| INV-LOTO-1 | Any `CONTACT` or `BODY_IN_DANGER_ZONE` step during servicing requires `S=LOCKED_OUT_VERIFIED` earlier in the answer. Otherwise the answer must route to a qualified energized-work path (INV-EW-*). | REG 1910.147(d)(6); (a)(2)(ii)(B) |
| INV-LOTO-2 | The energy-control steps must appear in order: `SHUTDOWN` < `ISOLATE` < `APPLY_LOTO` < `RELEASE_STORED` < `VERIFY_*` < first `CONTACT`. Reordering fails. | REG 1910.147(d) intro "in the following sequence"; 1910.333(b)(2) "in the order" |
| INV-LOTO-3 | `ISOLATE` must name an energy-isolating device (disconnect, breaker, valve, block). An e-stop, stop button, selector switch, PLC output, STO, or "drive disabled/stopped" never sets `S` beyond `ENERGIZED`. | REG 1910.147(b) def. "Energy isolating device"; 1910.333(b)(2)(ii)(B); ABB ACS880 STO note |
| INV-LOTO-4 | While `S ∈ {LOCKED_OUT_*}`, any `ENERGIZE` or `MEASURE_LIVE` step is forbidden unless preceded by the full (f)(1) sequence: `CLEAR_AREA`(tools) → `CLEAR_AREA`(people) → `REMOVE_LOTO`(by applier) → `ENERGIZE` (sets `S=TEST_RELEASE`). | REG 1910.147(f)(1)(i)–(iv) |
| INV-LOTO-5 | After `TEST_RELEASE`, any later `CONTACT` requires re-entry through the full INV-LOTO-2 sequence ("deenergize all systems and reapply"). | REG 1910.147(f)(1)(v) |
| INV-LOTO-6 | `RESTORE` / `ENERGIZE` after work requires `CLEAR_AREA` (items and people) and notification of affected employees. Lock removal is by the applier only; the answer must never suggest removing another person's lock. | REG 1910.147(e)(1)–(3); 1910.333(b)(2)(v) |
| INV-LOTO-7 | The answer must not assert that the minor-servicing exception, the cord-and-plug exclusion, or a Z244.1 alternative method applies. It may mention them only as "if your site's procedure/risk assessment establishes…". Default is full LOTO. | POLICY; motivated by 1910.147(a)(2)(ii) Note, (a)(2)(iii)(A); Z244.1-2024 [S] |
| INV-LOTO-8 | Answers containing energy-control steps must defer to the site's machine-specific energy control procedure and the authorized employee (a reference phrase must be present). | REG-derived: 1910.147(c)(4), (d)(1) |
| INV-LOTO-9 | Verification by try-start (`VERIFY_TRY_START`) must be followed by an instruction to return controls to off/neutral. | Good practice: 1910.147 App. A (non-mandatory) |

### 6.3 Stored energy (electrical and mechanical)
| ID | Rule | Basis |
|---|---|---|
| INV-SE-1 | After power removal, any `CONTACT` with power-circuit parts requires `VERIFY_AOV` (meter test at the point of work, phase-phase and phase-ground; for drives, DC+ to DC− and each to PE) between the last `WAIT`/`RELEASE_STORED` and the `CONTACT`. | REG 1910.333(b)(2)(iv)(B); NFPA 70E-2024 120.6(7) [S]; all six VFD manuals [P] |
| INV-SE-2 | Every `VERIFY_AOV` must be bracketed by `CHECK_TESTER` (verify on a known source before and after). | POLICY for ≤600 V: OSHA mandates it only >600 V per 1910.333(b)(2)(iv)(B). REG under NFPA 70E-2024 120.6(7) [S]; ABB [P] |
| INV-SE-3 | A `WAIT` step can never stand in for `VERIFY_AOV`. Fail any answer where a wait or timer is the last step before `CONTACT`. | REG-derived 1910.147(d)(6); vendor manuals [P] |
| INV-SE-4 | Indicator LEDs, a dark HMI/keypad, a "charge lamp off", or a drive status of "stopped/ready/STO" must never be cited as evidence of absence of voltage. | PowerFlex 520-QS001, Danfoss, Yaskawa (<50 Vdc) [P]; ABB STO [P] |
| INV-SE-5 | For drives, `ISOLATE` must cover all sources: mains, external control voltages, common DC bus / regen / UPS links, and PM-motor back-EMF (isolate or block the motor). | REG 1910.147(d)(3); Danfoss, ABB, Yaskawa [P] |
| INV-SE-6 | Non-electrical stored energy (springs, gravity loads, pneumatic/hydraulic pressure, flywheels) must be released or blocked before `CONTACT`. If reaccumulation is possible, verification must be continuous. | REG 1910.147(d)(5)(i)–(ii); 1910.333(b)(2)(ii)(D); ISO 14118 [A] |
| INV-SE-7 | Handling or shorting capacitors is energized work (treat as live: qualified person, PPE). Use a rated ground stick or discharge tool, never an improvised screwdriver short. | REG 1910.333(b)(2)(ii)(C) Note; NFPA 70E-2024 Art. 360 / 360.5(B)(6) [S] |

### 6.4 Electrical energized work
| ID | Rule | Basis |
|---|---|---|
| INV-EW-1 | `MEASURE_LIVE` or any work on exposed live parts must be addressed to a qualified person, with shock and arc-flash risk assessment and PPE referenced. No permit is required for testing, troubleshooting or voltage measuring. | REG 1910.333(a)(1) Note 2, (c)(2); NFPA 70E-2024 130.2(B) exemptions, 130.4, 130.5, 130.7 [S] |
| INV-EW-2 | Energized *repair or modification* work (not diagnostics) requires a stated justification (infeasible or increased hazard) and an energized electrical work permit (EEWP). Otherwise the answer must route to ESWC. | REG 1910.333(a)(1); NFPA 70E-2024 110.2, 130.2(A)/(B) [S] |
| INV-EW-3 | The answer must not advise working energized for convenience, speed or uptime. Production loss is not "infeasibility". | REG 1910.333(a)(1) (only "additional or increased hazards" or "infeasible"); 70E-2024 130.2(A) [S] |
| INV-EW-4 | Parts that are de-energized but not locked or tagged must be treated as live. An answer that sets `S=DEENERGIZED_UNVERIFIED` and then allows `CONTACT` fails. | REG 1910.333(b)(1) |
| INV-EW-5 | Before re-energizing, even temporarily: remove jumpers, shorts and grounds; warn people; ensure all are clear. | REG 1910.333(b)(2)(v)(A)–(D) |
| INV-EW-6 (2027 only) | Justified energized work must mention an additional person present. Enable when the site adopts 70E-2027. | NFPA 70E-2027 130.2(A)(2) [S] |

### 6.5 Safeguarding / defeat
| ID | Rule | Basis |
|---|---|---|
| INV-SG-1 | Never instruct `DEFEAT_SAFEGUARD` (jumper or bypass an e-stop, guard interlock, light curtain or safety relay; force safety I/O; mute; tape a switch; use a spare key). | POLICY, stricter than 1910.333(c)(10), which allows temporary defeat of an electrical interlock by a qualified person. Motivated by ISO 14119:2024 [A]; 1910.147(a)(2)(ii)(A); 1910.212(a)(4) |
| INV-SG-2 | If the user asks how to bypass a safeguard, the answer must redirect to diagnosing the safeguard fault, LOTO, or the OEM / site safety function procedure. It may state that only a qualified person may temporarily defeat an interlock under site procedures and must restore it, but it may not give the method. | POLICY / REG 1910.333(c)(10) wording |
| INV-SG-3 | Any step that removes a guard during operation makes the task servicing. INV-LOTO-1 then applies. | REG 1910.147(a)(2)(ii)(A) |
| INV-SG-4 | Hand tools (sticks, hooks) must not be presented as a substitute for guarding or LOTO. | REG 1910.212(a)(3)(iii) |

### 6.6 Moving machinery
| ID | Rule | Basis |
|---|---|---|
| INV-MM-1 | No `BODY_IN_DANGER_ZONE` (reach into a point of operation, nip point, conveyor, rotating part, or clear a jam) while `S ≠ LOCKED_OUT_VERIFIED`. This includes jog or inch "to free it". | REG 1910.147(a)(2)(ii)(B), (b) def. includes "unjamming"; 1910.212(a)(3)(ii) |
| INV-MM-2 | No step may follow `ENERGIZE` with `BODY_IN_DANGER_ZONE` in the same state (e.g. "run it and watch the belt by hand"). Observation must be from outside guards. | REG 1910.212(a)(3)(ii); 1910.147(f)(1)(ii) |
| INV-MM-3 | Coast-down and gravity: before entry, wait for motion to stop and verify zero motion. Block or lower elevated members. | REG 1910.147(d)(5)(i); App. A step 6; ISO 14118 [A] |

### 6.7 Numeric hazard claims and provenance
| ID | Rule | Basis |
|---|---|---|
| INV-NUM-1 | Every `NUM_HAZARD` must carry a `source_ref` that resolves to a document applicable to the identified `equipment_id` (model or frame/hp match). Otherwise the number must be removed and replaced with "per the drive's warning label / manual, then measure". | POLICY; vendor spread 3–40 min [P]; NIST AI 600-1 §2.2 [P] |
| INV-NUM-2 | The cited value must literally occur in the cited source chunk (string or number match), not merely "a citation exists". | POLICY; NIST AI 600-1 §2.2 (confabulated citations) [P] |
| INV-NUM-3 | If the applicable source states multiple values (e.g. GS10: 5 vs 10 min by hp; "at least 10 min"), output the most conservative value with its condition, or ask for the model or hp. Never pick the shorter value. | POLICY; GS10 ch.6 vs quick-start [P] |
| INV-NUM-4 | No generic or cross-vendor discharge time (e.g. "VFDs take about 5 min"), approach boundary, arc-flash incident energy or PPE category without equipment-specific labeling or a study. Arc-flash values must come from the equipment label or the site study. | POLICY; NFPA 70E-2024 130.5, 130.5(H) labels [S] |
| INV-NUM-5 | Any `NUM_HAZARD` that implies safety (a wait time, "safe below X V") must be followed by `VERIFY_AOV`. A number never ends the safety reasoning. | REG-derived INV-SE-3 basis |

### 6.8 System-level (meta) invariants
| ID | Rule | Basis |
|---|---|---|
| INV-SYS-1 | The answer must never claim that MIRA, or any step it gives, *is* a safeguard, isolation, verification or permit. Wording such as "this is safe now", "you're good to touch it" or "confirmed de-energized" fails. | [ANALYSIS] Machinery Reg Art. 3(4), recital 55 [P]; ISO 12100 information-for-use tier [S] |
| INV-SYS-2 | When the classifier cannot determine `S` or the step tags, fail closed: block hazard steps and emit the generic ESWC/LOTO reminder plus a referral. | POLICY; Z244.1-2024 "lockout … when hazards unknown" [S]; NIOSH "prevention through software design" [P] |

---

## 7. Gaps and verification to-dos
1. **NFPA 70E clause IDs are all secondary.** Verify 110.2, 110.3(H)(3), 120.5(B)(2), 120.6(7)/(8), 130.2(A)/(B)/exemptions, 130.4, 130.5(H), Art. 360 / 360.5(B)(6) and the capacitor thresholds against the NFPA LiNK free view. Then decide whether to key to 2024 or 2027.
2. ISO 12100 three-step clause number; ISO 14119:2024 anti-defeat clauses; B11.0 cl. 6.3; B11.19 clause map. All need the purchased text.
3. OSHA CPL 02-00-147 (minor-servicing guidance) was not fetched directly.
4. The Machinery Regulation Art. 54 date (20 Jan 2027) came from secondary aggregators; EUR-Lex HTML was not retrievable by curl.
5. The Danfoss discharge tables differ between the two Danfoss documents fetched. The extraction was also partly garbled, so use the nameplate.
6. 1910.333(b)(2)(iv)(B)'s >600 V tester-check limit means INV-SE-2 is a POLICY choice for low-voltage plant VFDs. State this in the engine's rationale text.
