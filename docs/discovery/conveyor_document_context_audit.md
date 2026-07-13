# Conveyor Document & Context Audit

**Asset under audit:** CV-101 — garage demo discharge conveyor (Allen-Bradley Micro820 `2080-LC20-20QBB` + AutomationDirect GS10 DURApulse VFD).
**Date:** 2026-07-02. **Type:** read-only discovery/audit. No features built, no documents invented, no code modified, no commit.
**Method:** three-agent evidence sweep of the repo; every claim below cites a file path. Proven evidence is separated from demo fixtures throughout.

> **Scope note — CV-101 ≠ CV-200.** CV-101 is the garage/bench conveyor audited here. **CV-200** is a *different* seeded asset (`enterprise.northwind.bottling.line1.cv_200`, `tools/seeds/…`) and is *also* used as a branded display alias over the SimLab `filler01` asset in the difference-engine demo (`demo/factory_difference_engine/pipeline.py`). Do not conflate them. This audit is about **CV-101 only**.

---

## 1. Executive verdict

**⚠️ Enough for narrow demo, not enough for broad maintenance support.**

For the specific, curated CV-101 fault set the coverage is genuinely strong and safe (near-✅ for the video). For open-ended maintenance support of a real machine it is not yet sufficient — the physical-asset evidence (motor nameplate, graphical wiring, sensor part numbers, maintenance/fault history) is absent.

| Question | Answer | Basis |
|---|---|---|
| Enough context to explain **basic conveyor state**? | **✅ Yes** | 11 approved signals with addresses + scaling + decode (`plc/conv_simple_anomaly/context_model.cv101.json`); real idle baseline snapshot (`replay/cv101_idle_healthy.json`, DC bus 321.5 V). |
| Enough to **diagnose likely causes**? | **⚠️ Partial** | 11 grounded rules A0–A12 with recommended checks (`plc/conv_simple_anomaly/rules_core.py`), GS10 fault-code decode from a real manual. **But** A8 overcurrent uses a *placeholder* FLA (5.0 A, marked CONFIRM) and A12 photo-eye jam **cannot fire** (signal unmapped). |
| Enough to **recommend next checks**? | **✅ Yes** (for covered faults) | Every rule carries a "recommended check" string (`rules_core.py`). Not a general maintenance checklist. |
| Enough to answer **safely without hallucinating**? | **✅ Yes** — this is the strongest area | Trust-gate suppresses stale VFD rules when comms drop; unmapped signals are *explicitly refused*, not silently omitted; refusals are test-enforced (`plc/litmus/test_demo_context_model.py`). |
| **Biggest missing evidence gap** | **Motor nameplate** (FLA/HP/RPM/V) | It leaves A8's overcurrent threshold a guess, blocks any FLA/HP/spare-part answer, and is the #1 thing a real customer would supply at onboarding. Second: graphical wiring + photo-eye part number. |

---

## 2. What documents / context exist today

Legend: **EVIDENCE** = approved real-world fact · **FIXTURE** = synthetic/demo data · **CODE** · **OUTPUT** = generated · **DOC**.

| File | Contains | Class | MIRA may rely on? | Staleness / conflict |
|---|---|---|---|---|
| `plc/conv_simple_anomaly/context_model.cv101.json` | Approved context packet: asset/PLC/VFD identity, 5 components, 11 signals (addr+scale+evidence+approval), 2 unmapped signals w/ refusal text. `approval.status="approved"`, by `mike`, 2026-07-01. | **EVIDENCE** | **Yes** — human-approved | ⚠️ UNS path here is `enterprise.garage.demo_cell.bottling_demo.cv_101`; the seed KG (below) uses a **different** path. See risk R1. |
| `plc/conv_simple_anomaly/replay/cv101_idle_healthy.json` | Real raw register snapshot captured from the bench Micro820 while idle (2026-07-01). | **EVIDENCE** (real capture used as a fixture) | Yes, as a baseline | Single instant; not a full golden-run trend. |
| `plc/conv_simple_anomaly/replay/cv101_comm_down.json` | Synthetic comm-down scenario (coil 3 forced false → trips A1). | **FIXTURE** | Demo only — **not** live evidence | Explicitly labeled "Synthetic fault scenario". |
| `plc/conv_simple_anomaly/rules_core.py` | A0–A12 anomaly rules: fire conditions, severities, recommended checks, GS10 fault-code map, trust-gate. | **CODE** | Yes (logic) | A6/A7/A10 time-based → dormant in stateless path; A12 unmapped. |
| `ignition/webdev/FactoryLM/api/diagnose/diagnose_core.py` | Same A0–A12 logic, dual Py2.7/3.12 (single source of truth, not a fork). | **CODE** | Yes | Kept in parity with `rules_core.py`. |
| `plc/GS10_Integration_Guide.md` | First-party GS10 guide: P09.xx params, Modbus register map 0x2000–0x210F, fault codes, wiring pinouts, commissioning. | **EVIDENCE** (first-party) | Yes | Not the OEM PDF; a reconstructed guide. |
| `tools/seeds/gs10-vfd-knowledge.sql`, `tools/seeds/oem-manuals/chunks.jsonl` | GS10 / Micro800 OEM manual excerpts, vector-embedded into KB (fault codes, Modbus RTU). | **EVIDENCE** (ingested text) | Yes (retrieval) | Text chunks only; source PDFs not stored in repo. |
| `plc/Micro820_v4.1.9_Program.st` | Full Structured-Text PLC program (Conv_Simple lineage). | **EVIDENCE** | Yes | Bench program; real. |
| `plc/vars_ConvSimple_v1.9.csv` | 57-tag export with types/comments. | **EVIDENCE** | Yes | Real export. |
| `plc/Modbus_ConvSimple_v1.9.ccwmod` | CCW Modbus config (coils + HRs). | **EVIDENCE** | Yes (register map) | Config, not a live parameter dump. |
| `plc/conv_simple_anomaly/config.yaml` | Rule thresholds incl. `motor_fla_a: 5.0` (placeholder, CONFIRM). | **CODE** (template) | Thresholds only | ⚠️ FLA is a guess, not nameplate. See risk R2. |
| `plc/conv_simple_anomaly/ANOMALY_CATALOG.md` | Human catalog of A-rules incl. dual-channel e-stop logic. | **DOC** | Yes (reference) | — |
| `tools/seeds/factorylm-garage-conveyor.sql` | KG: 6 `verified` entities (site/area/asset + 3 components) + 12+ `proposed` relationship edges. | **EVIDENCE** (entities) / proposed (edges) | Entities yes; edges pending review | ⚠️ Path `enterprise.home_garage.conveyor_lab.conveyor_1` — conflicts w/ context model. R1. |
| `tools/seeds/approved_tags_conveyor.sql` | 49 `approved_tags` rows (Ignition tag → UNS), `enabled=true`, seeded 2026-06-07. | **EVIDENCE** | Yes (allowlist) | Under the `conveyor_1` path. |
| `ignition/project/approved_tags.json` | 52-tag read allowlist for MIRA (WebDev + gateway). | **CODE** (allowlist) | Yes | — |
| `tools/seeds/conveyor/chunks.jsonl` + `tests/golden/garage_conveyor_golden_path.py` | 3 approved evidence chunks + 1 held-back unreviewed; proves approval-gated retrieval (commit `0518155b`). | **EVIDENCE** + **CODE** | Yes | Golden-path test, self-cleaning. |
| `ignition/.../views/ConveyorStatus/resource.json` | Perspective display view (11 fields), display-only, no rules. | **FIXTURE** (display) | Display only | — |
| `docs/demo/garage_conveyor_context_model_demo.md` | 5-min demo runbook. | **DOC** | Reference | — |
| `docs/discovery/litmus_mira_demo_decision.md`, `…_context_model_build.md` | Why `--source plc` (not `:8094`); build recorder (10/10 tests). | **DOC** | Reference | — |
| `plc/litmus/mira_on_litmus.py`, `demo_context_model.py` | LITMUS_TAG_MAP (11 tags) + demo driver writing 4 artifacts. | **CODE** | `--source plc` yes; `--source litmus` **blocked** | See §5 Q-control. |
| `dashboard_contract.json` | — | — | **NOT FOUND** | Searched; does not exist. |
| Motor nameplate / wiring schematic / sensor datasheet / LOTO / fault history / BOM | — | — | **NOT FOUND** | See §6. |

---

## 3. Conveyor knowledge coverage

| Coverage area | Status | Evidence path | What MIRA can say | What MIRA must NOT say yet | Gap / next document |
|---|---|---|---|---|---|
| Asset identity (name/line/location) | **Built** | `context_model.cv101.json` (asset, site); `tools/seeds/factorylm-garage-conveyor.sql` | "CV-101, discharge conveyor, garage demo cell" | — (but resolve the path conflict R1) | Reconcile the two UNS paths |
| PLC identity | **Built** | `context_model.cv101.json` plc block (CIP high conf); `plc/Micro820_v4.1.9_Program.st` | "Micro820 2080-LC20-20QBB, rev 14.11, Modbus 192.168.1.100:502" | — | — |
| VFD identity + registers/scaling/fault+status words | **Built** | `context_model.cv101.json` drive+signals; `plc/GS10_Integration_Guide.md`; `rules_core.py` GS10_FAULT_CODES | GS10 model, register map, decode fault codes, scale freq/current/voltage/DC-bus | Invent fault codes not in the map | Live GS10 parameter dump (nice-to-have) |
| Motor identity (nameplate/FLA/HP/RPM/V) | **Missing** | only `config.yaml motor_fla_a:5.0` placeholder | "Drive motor M-101 exists" (register-map component) | **The FLA/HP/RPM/voltage** — no nameplate | **Motor nameplate photo/datasheet** |
| Sensor identity (photo-eye/prox/e-stop/comms) | **Partial** | e-stop + comms = approved signals; photo-eye = `proposed`, unmapped | e-stop state, comm-OK state | Photo-eye state / jam (unmapped, `proposed`) | Photo-eye part # + wiring; expose PE latch on PLC map |
| Tag mapping (register → meaning) | **Built** | `context_model.cv101.json` signals; `vars_ConvSimple_v1.9.csv`; `approved_tags*` | The 11 mapped meanings (see §4) | Meaning of tags outside the 11 | — |
| Normal state (healthy idle/running) | **Partial** | `replay/cv101_idle_healthy.json` (real idle); DC bus nominal 320±0.8 V | "Idle & healthy looks like this" (DC bus ~320 V, cmd=STOP) | A verified *running* golden baseline (only idle captured) | 30 s healthy-running capture |
| Fault states (stopped/comm/e-stop/drive/jam/blocked) | **Partial** | `rules_core.py` A0–A10; `replay/cv101_comm_down.json` (synthetic) | comm-down, VFD fault, e-stop wiring, direction, illegal-run, overcurrent*, DC-bus, drive-not-responding | **Jam / blocked photo-eye** (A12 unmapped); overcurrent* uses placeholder FLA | Photo-eye mapping; confirmed FLA |
| Rule logic (how MIRA decides cause) | **Built** | `rules_core.py` / `diagnose_core.py` (dual-env, bench-verified) | The A0–A12 reasoning + trust-gate | — | — |
| Maintenance action (next check) | **Built** (per-fault) | recommended-check strings in `rules_core.py` | The next check for each fired rule | A general PM checklist (none exists) | Maintenance checklist doc |
| Evidence citations | **Built** | every signal/component carries `evidence{source_type,source_name,confidence}` | Cite register map / GS10 manual / bench measurement | Cite a doc that isn't in the model | — |
| Refusal boundaries | **Built** (strong) | `context_model.cv101.json` unmapped block; `test_demo_context_model.py` | "Photo-eye signal unavailable; I won't assert a jam" | Anything past the approved 11 signals | — |

\* overcurrent (A8) is *logically* built but threshold-unconfirmed — see R2.

---

## 4. The 11-tag demo context

Source: `plc/conv_simple_anomaly/context_model.cv101.json` (authoritative) + `plc/litmus/mira_on_litmus.py` LITMUS_TAG_MAP. All 11 are `approval_status: "approved"`.

| Human name | Register / topic | Addr | Type | Scaling | Meaning | Evidence source | MIRA use | Confidence |
|---|---|---|---|---|---|---|---|---|
| motor_running | `motor/m101/running` | C@0 (FC1) | bit | bool | Motor commanded/running | plc_register_map (coil 000001) | state + A5 | high |
| vfd_comm_ok | `vfd/vfd101/comm_ok` | C@3 (FC1) | bit | bool | PLC↔GS10 link OK (**trust gate**) | plc_register_map (coil 000004) | A1 + gates A2/A7/A8/A9 | high |
| e_stop_active | `safety/estop` | C@5 (FC1) | bit | bool | E-stop / run permissive | plc_register_map | A3/A5 | high |
| estop_wiring_fault | `safety/wiring` | C@9 (FC1) | bit | bool | E-stop wiring integrity | plc_register_map | A3 | high |
| vfd_frequency | `vfd/vfd101/freq` | H@106 (FC3) | word | ÷100 → Hz | Output frequency | live_check.py HR_SPECS | A7/A10 | high |
| vfd_current | `vfd/vfd101/current_a` | H@107 (FC3) | word | ÷100 → A | Output current | live_check.py HR_SPECS | A8 | high |
| vfd_voltage | `vfd/vfd101/voltage_v` | H@108 (FC3) | word | ÷10 → V | Output voltage | live_check.py HR_SPECS | context | high |
| vfd_dc_bus | `vfd/vfd101/dc_bus_v` | H@109 (FC3) | word | ÷10 → V (idle 320±0.8) | DC bus health | bench_measurement 2026-06 | A9 | high |
| vfd_cmd_word | `vfd/vfd101/cmd_word` | H@114 (FC3) | word | raw (1=STOP,18=FWD-RUN,34=REV-RUN) | Commanded mode | bench_verified | A6/A7/A10 | high |
| vfd_status_word | `vfd/vfd101/status_word` | H@117 (FC3) | word | raw | Drive status bits | plc_register_map | context | medium |
| vfd_fault_code | `vfd/vfd101/fault_code` | H@118 (FC3) | word | raw → GS10_FAULT_CODES | Active GS10 fault | vendor_manual (GS10) | A2 | high |

**Deliberately unmapped (refusal is correct):**

| Signal | Why unmapped | Why refusal is right |
|---|---|---|
| Photo-eye latch `safety/pe_latched` (coil offset 22) | Not exposed on the current sparse Micro820 map (pre slave-map-v2); component `photo_eye` is `proposed` | MIRA must not assert *or* rule out a jam (A12) with no signal. Guessing either way = hallucination. |
| VFD frequency setpoint `vfd/vfd101/freq_setpoint` | Commanded-Hz not in the provisioned 11 registers | Can't judge output-vs-setpoint tracking (A7). Claiming the drive is/ isn't holding speed would be unfounded. |

---

## 5. Can MIRA answer real maintenance questions?

| # | Question | Should MIRA… | Supporting evidence | Files/tags required | Would be hallucination | Missing doc if it can't |
|---|---|---|---|---|---|---|
| 1 | Why is CV-101 not moving? | **Answer** | cmd_word=STOP + zero freq/current + A-rules; real idle snapshot | `context_model.cv101.json`, `rules_core.py`, `cv101_idle_healthy.json` | Naming a mechanical cause with no signal | — |
| 2 | What should maintenance check next? | **Answer** (for a fired rule) | recommended-check strings per rule | `rules_core.py` | Inventing steps for an un-fired condition | General PM checklist |
| 3 | Drive fault / command / e-stop / comms? | **Answer** | A1 (comms), A2 (drive fault), A3/A5 (e-stop), cmd_word decode; trust-gate | signals 2,3,4,9,11 + `rules_core.py` | Blaming comms while comms OK | — |
| 4 | Is the VFD healthy? | **Answer** (with caveat) | DC bus vs [250,410], fault code, comms; GS10 manual | signals 5–8,11; `GS10_Integration_Guide.md` | Calling it healthy while comms stale (gate prevents) | Live parameter dump (deeper health) |
| 5 | Is the conveyor safe to run? | **Partial** | e-stop + wiring signals; A3/A5 | signals 3,4; `rules_core.py` | A blanket "safe" — **no LOTO/safety cert evidence** | **E-stop circuit + LOTO procedure** |
| 6 | Is the photo-eye blocked? | **Refuse** | photo-eye is `proposed` + unmapped | (none — unavailable) | Any jam claim (A12 can't fire) | Photo-eye mapping + part # |
| 7 | What does the DC bus value tell us? | **Answer** | ÷10 scale, 320 V nominal, A9 band, GS10 Lvd | signal 8; `rules_core.py` | A band/threshold not in the rule | — |
| 8 | Can MIRA control the conveyor? | **Refuse** | Read-only doctrine (`.claude/rules/fieldbus-readonly.md`) | (none) | Any "yes"/offer to write | — (by design) |
| 9 | What is the motor FLA? | **Refuse** | Only a placeholder `motor_fla_a:5.0` (CONFIRM) | (none — no nameplate) | Stating 5.0 A as *the* FLA | **Motor nameplate** |
| 10 | What spare part do I need? | **Refuse** | No BOM / spares list for CV-101 | (none) | Naming a part number | **Spare-parts BOM** |

---

## 6. Missing documents needed for stronger intelligence

Highest value first.

| Missing item | Why it matters | What MIRA could answer after | Video demo or later beta? | Suggested format |
|---|---|---|---|---|
| **Motor nameplate** (FLA/HP/RPM/V/SF) | Turns A8 overcurrent from a guess into a real threshold; unlocks Q9/Q10 | Real FLA, HP, overload judgment, motor-spec answers | **Later beta** (demo works without) | Photo of nameplate (legible) or datasheet PDF |
| **Photo-eye / prox model + wiring** | Promotes `photo_eye` from `proposed`→verified; enables A12 jam | Jam/blocked-infeed diagnosis (Q6) | Beta (nice for demo) | Photo + part # (Banner/SICK/etc.) + 2-line wiring |
| **Graphical wiring schematic** (motor→contactor→GS10→PLC) | Grounds "where is this wired" answers; safety context | Wiring-reference answers, isolate faults | Beta | PDF/PNG schematic |
| **E-stop circuit + LOTO procedure** | Q5 needs safety-cert evidence to ever say "safe to run" | Bounded safety statements w/ citation | Beta (safety-critical) | Circuit page + LOTO PDF |
| **Live GS10 parameter export** | Confirms accel/decel, current limit, protection settings behind the rules | Deeper drive-health, param drift | Beta | CSV/`.ccwmod` param dump |
| **Verified running baseline** (30 s healthy run) | Only *idle* is captured; running golden data anchors "normal" | "This is normal running vs abnormal" | **Both** — cheap, high value | 30 s capture via `--source plc` |
| **Maintenance checklist / fault history / BOM** | Enables next-check + spares beyond the rule strings | PM guidance, spares (Q10), recurrence | Beta | MD checklist, CMMS export, BOM CSV |
| **OEM manual PDFs** (currently only text chunks) | Auditable citations beyond embedded chunks | Page-cited manual answers | Beta | PDFs into KB ingest |

---

## 7. Evidence risk register

| Risk | Example | Impact on answer quality | Mitigation |
|---|---|---|---|
| **R1 — UNS path conflict** | Context model says `…garage.demo_cell.bottling_demo.cv_101`; KG seed says `…home_garage.conveyor_lab.conveyor_1` | Retrieval/context may key to the wrong node; "which asset" ambiguity | Reconcile to one canonical UNS path before beta; pick one, migrate the other |
| **R2 — Placeholder mistaken for evidence** | `motor_fla_a: 5.0` (marked CONFIRM) driving A8 | Overcurrent alarms/clears on a guessed threshold | Get nameplate; until then MIRA should caveat A8 as "unconfirmed FLA" |
| **R3 — Demo fixture mistaken for production truth** | `cv101_comm_down.json` is synthetic | Treating a scripted fault as a real event | Keep the FIXTURE label; never cite it as live evidence (this audit does) |
| **R4 — Missing motor nameplate** | No FLA/HP/RPM | Cannot answer motor-spec / spares questions | Collect nameplate (§9) |
| **R5 — Missing wiring diagram** | Only ASCII pinouts in the GS10 guide | No graphical wiring reference; weaker safety context | Collect schematic |
| **R6 — Unverified photo-eye** | `photo_eye` `approval_status: proposed`, unmapped | A12 jam can never fire; false "no jam" if mishandled | Refusal already enforced by tests; verify + map to promote |
| **R7 — No production Litmus read** | `--source litmus` blocked (`:8094` credential) | Live "through-Litmus" pull not proven | Demo `--source plc`; treat litmus path as blocked (per repo docs) |
| **R8 — No anomaly persistence** | A0–A12 computed then discarded (no anomaly table) | No history/trend of faults; each answer is stateless | Known gap; out of scope to fix here |
| **R9 — Sparse Modbus map** | Only HR 106–109,114,117,118 + coils 0,3,5,9 exist | Assuming an address exists can fault a batch read / imply a missing signal | Provisioned set already avoids it; don't add addresses |
| **R10 — Unapproved tags as evidence** | Treating `proposed` KG edges or non-allowlisted tags as fact | Ungrounded claims | Approval-gate proven (`tests/golden/garage_conveyor_golden_path.py`); keep gate ON for beta |

---

## 8. Recommendation

- **Enough for Mike's video?** **Yes.** Run `--source plc` with the Litmus DeviceHub UI visible, ask Q1–Q4 and Q7, and *show* the refusals on Q6/Q8/Q9 — the refusals are a feature. Optionally capture a 30 s running baseline first (cheap, strengthens "normal"). Do **not** demo the blocked `--source litmus` path.
- **Before a stranger/customer beta:** collect the physical evidence — motor nameplate, photo-eye part #/wiring, graphical schematic, e-stop/LOTO, running baseline, and a maintenance checklist/BOM. Reconcile the UNS path conflict (R1) and confirm the motor FLA (R2).
- **Add to the onboarding wizard:** explicit prompts for nameplate photo, sensor part #, wiring PDF, e-stop/LOTO, and a "capture healthy baseline" step — the exact items in §9.
- **Add to the context packet:** a verified `motor` nameplate block (FLA/HP/RPM/V), a verified `photo_eye` mapping (promote from `proposed`), and a canonical single UNS path.
- **MIRA should keep refusing until documents exist:** motor FLA/HP/spares (Q9/Q10), photo-eye jam (Q6), blanket "safe to run" (Q5), and any control/write request (Q8, permanent).

---

## 9. One-page collection checklist for Mike (garage/lab)

- [ ] Photo of the **conveyor overview** (whole machine, both ends)
- [ ] **Motor nameplate** photo (legible — FLA, HP/kW, RPM, V, SF)
- [ ] **VFD (GS10) nameplate** photo
- [ ] **Export/record GS10 parameters** (CCW param dump or `.ccwmod`)
- [ ] **Screenshot Litmus DeviceHub** tag list (conv-101, 11 tags, 0 exceptions)
- [ ] **Export PLC tags/program** (already have `.st` + `vars_*.csv` — confirm current)
- [ ] Photo of **E-stop wiring / control station** (+ note LOTO point)
- [ ] Photo of the **photo-eye / sensor** with its **part number label**
- [ ] Photo of **panel wiring** (only if safe / de-energized)
- [ ] Record **30 s of healthy running** values (`--source plc`)
- [ ] Record **stopped / e-stop / comm-down** scenarios
- [ ] Save all under a clear folder, e.g. `docs/onboarding/cv-101-evidence/` with dated filenames

---

## 10. Final verdict table

| Question | Verdict |
|---|---|
| Enough for **video demo**? | **Yes** |
| Enough for **narrow MIRA troubleshooting** (CV-101 fault set)? | **Partial** — strong on state/comms/drive/e-stop; blocked on jam + motor specs |
| Enough for **production customer onboarding**? | **No** — physical evidence + history missing |
| **Biggest missing evidence item** | **Motor nameplate** (FLA/HP/RPM/V) |
| **Next three documents to collect** | 1) Motor nameplate · 2) Photo-eye model + wiring · 3) Graphical wiring schematic (+ e-stop/LOTO) |

---

### Files / evidence I could not find (searched, absent)

- `dashboard_contract.json` — not present anywhere in the repo.
- Motor nameplate / datasheet (FLA/HP/RPM/V/SF) — only a `motor_fla_a: 5.0` placeholder in `config.yaml`.
- Graphical wiring schematic (`.dwg`/`.pdf`) — only ASCII pinouts in `plc/GS10_Integration_Guide.md`.
- Photo-eye / prox **part number** or datasheet — component is `proposed`, no vendor evidence.
- E-stop circuit diagram / LOTO procedure — only tags + anomaly rules.
- Live GS10 parameter dump — only the `.ccwmod` config, not a runtime export.
- CV-101 work-order / fault history, maintenance checklist, spare-parts BOM — none.
- OEM manual **PDFs** — only vector-embedded text chunks (`tools/seeds/`), source URLs point to external CDNs.
