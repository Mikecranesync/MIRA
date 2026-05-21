# FactoryLM ProveIt Simulator — Build Plan

> Companion to [`mira_uns_dataset_and_simulator_research.md`](./mira_uns_dataset_and_simulator_research.md). That doc covers the *what* (sources, standards, architecture). This doc covers the *how to build it* — first datasets to pull, local layout, milestones, scorecard, demo scenarios, next coding tasks.
>
> **One-line goal:** A docker-composable synthetic plant that emits ISA-95 / Sparkplug B / OPC UA + AAS shells + manuals + work orders, with a hand-labeled answer key, so we can score MIRA's contextualization layer per PR.

---

## 1. First datasets to pull (Week 1)

A focused minimum so we can demo Tier-S in two weeks. All free, no access gate.

| # | Source | Pull command | Why |
|---|---|---|---|
| 1 | **PackML-MQTT-Simulator** | `docker pull libremfg/packml-mqtt-simulator:latest` | Tier-S line traffic |
| 2 | **Azure OPC PLC** | `docker pull mcr.microsoft.com/iotedge/opc-plc:latest` | OPC UA companion-spec loader |
| 3 | **OPC Foundation UA-Nodeset** | `git clone https://github.com/OPCFoundation/UA-Nodeset` | PackML, Pumps, MachineTool, IO-Link, PLCopen NodeSet2 XMLs |
| 4 | **Tennessee Eastman (Python reimpl)** | `pip install tennessee-eastman-dataset` (or `git clone mv-per/tennessee-eastman-dataset`) | Tier-M process loop + 21 labeled faults |
| 5 | **CWRU Bearing Dataset** | Mirror at `https://zenodo.org/records/10987113` (MATLAB / NPZ) | Component-level vibration replay for the conveyor motor |
| 6 | **AI4I 2020 Predictive Maintenance** | `https://archive.ics.uci.edu/dataset/601` (CSV, 10K rows) | Fastest CSV → MQTT smoke test (5 labeled fault classes) |
| 7 | **IBM AssetOpsBench** | `git clone https://github.com/IBM/AssetOpsBench`; `datasets` from HuggingFace `ibm-research/AssetOpsBench` | 4,200 work orders + manual refs + ISO-coded FMs |
| 8 | **IBM FailureSensorIQ** | `git clone https://github.com/IBM/FailureSensorIQ` | 8,296 sensor↔failure-mode pairs → seed `kg_relationships` |
| 9 | **IDTA Nameplate submodel (02006-3-0)** | `https://industrialdigitaltwin.org/en/content-hub/downloads` | AAS shell template |
| 10 | **Eclipse Tahu (Python)** | `pip install pyspark plug` → use `tahu` Python lib (clone from `eclipse-tahu/tahu`) | Reference SpB encoder |

**Deferred to Week 4+ (after Tier-S green):** SWaT (institutional request), Petrobras 3W (Phase-2 O&G scenario), MTConnect cppagent (CNC scenario), Open-Industry-Project (3D visual validation), Paderborn KAt (NC-licensed; only if needed for fault diversity).

---

## 2. Local architecture

Single repo subdirectory `tools/proveit/`. Three logical sub-systems:

```
tools/proveit/
├── README.md
├── docker-compose.benchmark.yml      # 8-container stack
├── factory_yaml/                     # declarative plant fixtures
│   ├── conveyor_plant.yaml           # Tier-S
│   ├── process_plant.yaml            # Tier-M
│   └── steel_works.yaml              # Tier-L (procedural template)
├── generators/                       # all build-time generators
│   ├── hierarchy_gen.py              # factory.yaml → manifest + answer_key
│   ├── doc_pack_gen.py               # manuals + datasheets + wiring + parts list
│   ├── aas_shell_gen.py              # IDTA 02006/02003/02008 shells
│   ├── work_order_gen.py             # synthetic WO history (per AssetOpsBench template)
│   └── event_gen.py                  # join dataset fault timelines with PackML transitions
├── runtime/                          # runtime services (Docker)
│   ├── csv_replay/                   # CSV → SpB DDATA streamer
│   ├── noise_injector/               # typo / drift / zombie / dup-asset publisher
│   ├── opc_ua_custom/                # asyncua server loading UA-Nodeset XMLs
│   └── benthos_umh_config/           # OPC UA → SpB bridge config per instance
├── datasets/                         # symlinked into containers
│   ├── tep/                          # Tennessee Eastman CSV
│   ├── cwru/                         # CWRU bearing MATLAB / NPZ
│   ├── ai4i/                         # AI4I CSV
│   ├── pump_sensor/                  # Kaggle pump CSV
│   └── assetopsbench/                # WOs + manuals
├── seeds/                            # KG / DB seed material
│   ├── failuresensoriq.jsonl         # FM↔sensor verified rels
│   ├── ua_nodeset/                   # OPC Foundation NodeSet2 XMLs (curated)
│   └── iso14224_vocab.yaml           # open-derived FM/cause vocabulary
├── answer_keys/                      # ground truth per fixture (generated)
│   ├── conveyor_plant.json
│   ├── process_plant.json
│   └── steel_works.json
└── harness/                          # scoring + CI integration
    ├── run_benchmark.py              # orchestrator: up → seed → ask Qs → score
    ├── golden_questions.yaml         # per-fixture technician questions
    ├── scorecard.py                  # precision/recall/F1 vs answer_key
    └── publish_results.py            # write to wiki/benchmark/YYYY-MM-DD.md
```

### Where it plugs into MIRA

- **`/MiraDrop/`** — doc-pack generator drops manuals + AAS shells here; existing wiki-sync watcher picks them up → `mira-crawler/ingest/` runs end-to-end.
- **`mosquitto` broker** — `mira-relay` consumes the SpB stream as if from a real Ignition gateway.
- **NeonDB staging branch** — seed `kg_relationships` from FailureSensorIQ before each run; assert MIRA's proposals against `answer_key.json`.
- **Slack bot (staging)** — harness drives questions via Slack staging workspace (separate token, never prod).
- **`tests/eval/`** — extend the existing 5-regime suite with regime8 = ProveIt benchmark.

---

## 3. Folder + module split

| Module | Owner | Lines (est) | Notes |
|---|---|---|---|
| `tools/proveit/generators/hierarchy_gen.py` | new | 600 | YAML → publishers + answer_key |
| `tools/proveit/generators/doc_pack_gen.py` | new | 800 | Jinja PDFs + LLM templating via cascade |
| `tools/proveit/generators/aas_shell_gen.py` | new | 300 | IDTA submodel emitter |
| `tools/proveit/generators/work_order_gen.py` | new | 200 | sampled from AssetOpsBench |
| `tools/proveit/generators/event_gen.py` | new | 400 | dataset fault timeline → PackML transitions |
| `tools/proveit/runtime/csv_replay/` | new | 500 | Python service, SpB encoding via Tahu |
| `tools/proveit/runtime/noise_injector/` | new | 300 | wraps DamascenoRafael/mqtt-simulator config |
| `tools/proveit/runtime/opc_ua_custom/` | new | 400 | asyncua server w/ NodeSet loader |
| `tools/proveit/harness/run_benchmark.py` | new | 400 | orchestrator |
| `tools/proveit/harness/scorecard.py` | new | 500 | precision/recall/F1 |
| `mira-crawler/ingest/aas_parser.py` | new | 200 | IDTA Nameplate → component_template |
| `tests/eval/regime8_proveit/` | new | 600 | regime + golden Qs |
| **Total** | | **~5,200** | one engineer, ~7 weeks; two engineers, ~4 weeks |

---

## 4. Milestones (with explicit gates)

| Week | Milestone | Exit gate |
|---|---|---|
| **1** | Compose scaffold + Mosquitto + PackML-MQTT-Simulator x1 instance live | `mosquitto_sub -t '#'` shows NBIRTH within 30s |
| **2** | Conveyor Plant YAML + hierarchy_gen emits manifest + answer_key (50 assets) | `expected_uns_paths.json` resolves all `enterprise.factorylm.lake_wales_garage.assembly.sorter_line_1.*` |
| **3** | Doc-pack generator + AAS shells + 10 manuals into `/MiraDrop/` | `mira-crawler` ingests, KG writes `proposed` relationships |
| **4** | CSV-replay engine + TEP fault 6 injection | MIRA reply to "Why did reactor temperature spike?" cites correct TEP unit within 30s |
| **5** | Noise injector active (15% typos / 10% drift) + UNS-resolver scorecard | F1 ≥0.85 on `expected_uns_paths.json` despite mess |
| **6** | Tier-M Process Plant (500 assets, 30K tags) | nightly run <10 min, scorecard precision ≥0.70 on rel-proposal |
| **7** | UNS-gate compliance probe + groundedness scoring | ≥0.95 gate compliance, ≥4.0 mean groundedness across 20 Qs |
| **8** | Tier-L Steel Works (procedural 5K assets) | weekly run completes <30 min, scorecard converges |
| **9** | GH Actions: Tier-S on PRs, Tier-M nightly, Tier-L weekly + wiki publisher | scorecard delta shows on PR comments |
| **10** | Spec doc + demo video for sales | `docs/specs/proveit-simulator-spec.md` merged, video lives in `docs/promo-screenshots/` |

---

## 5. Evaluation scorecard (template)

Generated per run as `wiki/benchmark/YYYY-MM-DD-<fixture>.md`:

```markdown
# ProveIt Run — 2026-XX-XX — process_plant

## Headline
- Relationship-proposal F1: 0.74 (target ≥0.70) ✅
- UNS-gate compliance: 0.97 (target ≥0.95) ✅
- Groundedness mean: 4.1 (target ≥4.0) ✅
- Hallucination rate: 0.03 (target ≤0.05) ✅

## Per-layer
| Layer | Metric | Value | Target | Pass |
|---|---|---|---|---|
| UNS path resolution | F1 | 0.88 | ≥0.85 | ✅ |
| Nameplate extraction | exact-match | 0.91 | ≥0.90 | ✅ |
| Fault classification | weighted F1 | 0.72 | ≥0.70 | ✅ |
| Tag → component | precision @ Medium+ | 0.83 | ≥0.80 | ✅ |
| Citation correctness | hit-rate | 0.92 | ≥0.90 | ✅ |
| Reply latency p50 / p95 | seconds | 4.8 / 12.1 | ≤6 / ≤15 | ✅ |

## Regressions vs prior run
- (auto-diff against last green)

## Worst 10 questions (for triage)
- (golden Q + reply + groundedness + citation gap)
```

---

## 6. Demo scenarios (sales-ready)

Each scenario is a 90-second technician-bot interaction over Slack staging.

| # | Scenario | Fixture | Why it sells |
|---|---|---|---|
| 1 | **"Why did the conveyor stop?"** | Conveyor Plant; trigger CWRU bearing fault on Conveyor C-103 motor | Shows UNS gate (confirms `sorter_line_1.C-103`), cites real PowerFlex 525 manual page, proposes WO with ISO 14224 `bearing_failure` |
| 2 | **"What's the spare for the PowerFlex 525 on conveyor 3?"** | Conveyor Plant | Shows AAS Nameplate extraction + parts list lookup + KG `component → spare_part` edge |
| 3 | **"We just had a high level in the reactor — what should I check?"** | Process Plant; trigger TEP IDV1 (A/C feed ratio) | Shows multi-unit reasoning (reactor → condenser → separator), cites Downs & Vogel narrative |
| 4 | **"Pump P-201 is vibrating — is it the bearing or the seal?"** | Process Plant; replay CWRU vibration into P-201 with seal-leak event from event_gen | Shows component-level disambiguation + ISO 14224 differential |
| 5 | **"What's the PM schedule on Conveyor C-103?"** | Conveyor Plant | Shows PM checklist extraction + last-WO history |
| 6 | **"I'm in front of the mill #5 motor — what's the nameplate?"** | Steel Works | Shows scale: 500 motors, correct one resolved by area + position |

All 6 should pass with citations and groundedness ≥4.0 by Week 7. **Tape them once with screen-capture for sales-enablement.**

---

## 7. Next coding tasks (sprint-1, week-1)

In dependency order. Each ticket has a clean exit signal.

1. **`infra: tools/proveit/docker-compose.benchmark.yml + Mosquitto + HiveMQ Sparkplug-aware extension`** — 3d. Exit: `docker compose -f tools/proveit/docker-compose.benchmark.yml up -d` brings 3 containers green, `mosquitto_sub -t '$sparkplug/certificates/#'` returns birth certs.
2. **`infra: tools/proveit/runtime/packml-sim — wrap libremfg/PackML-MQTT-Simulator with env templating for SITE/AREA/LINE`** — 1d. Exit: container emits canonical `SITE/AREA/LINE/Status/*` topics on connect.
3. **`tools/proveit: factory_yaml/conveyor_plant.yaml + generators/hierarchy_gen.py`** — 5d. Exit: `python hierarchy_gen.py factory_yaml/conveyor_plant.yaml` produces `manifest.yaml` + `answer_keys/conveyor_plant.json` + per-publisher env files. 50 assets, ~5K tags.
4. **`tools/proveit: generators/aas_shell_gen.py + IDTA 02006 Nameplate template`** — 3d. Exit: per asset in manifest, valid AASX file in `/MiraDrop/aas/` that opens in AASX Package Explorer.
5. **`tools/proveit: generators/doc_pack_gen.py — Jinja → PDF for manual + datasheet + wiring + parts list`** — 5d. Exit: per asset, 4 PDFs + 1 CSV in `/MiraDrop/docs/<asset_tag>/`.
6. **`mira-crawler/ingest/aas_parser.py — IDTA 02006 → component_template insert (staging Neon)`** — 3d. Exit: each AAS shell becomes a `component_template` row with Nameplate fields populated.
7. **`tools/proveit: runtime/csv_replay/ — TEP CSV → SpB DDATA via Tahu Python lib`** — 4d. Exit: 1 TEP fault injected on schedule, MIRA receives `<UNS>/Alarm` SpB message.
8. **`tools/proveit: harness/run_benchmark.py + golden_questions.yaml (10 Qs for Conveyor Plant)`** — 3d. Exit: orchestrator runs end-to-end, dumps `replies.jsonl` for scoring.
9. **`tools/proveit: harness/scorecard.py — UNS-resolver F1 + UNS-gate compliance + citation correctness`** — 4d. Exit: scorecard renders to `wiki/benchmark/<date>.md`.
10. **`tools/proveit: generators/work_order_gen.py — sample AssetOpsBench WO templates per asset`** — 3d. Exit: per asset, 5–50 WOs in `/MiraDrop/work_orders/<asset_tag>/`.
11. **`tools/proveit: runtime/noise_injector/ — typo + namespace drift on 15% of messages`** — 3d. Exit: scorecard runs with noise, F1 ≥0.85 still holds.
12. **`mira-crawler: extend kg_writer.py to consume FailureSensorIQ seed as status=verified for known FM↔sensor pairs`** — 2d. Exit: 8,296 verified rels in staging Neon.
13. **`tools/proveit: runtime/opc_ua_custom/ — asyncua server loading UA-Nodeset/PackML + Pumps + MachineTool XMLs`** — 4d. Exit: UaExpert browses 4-level hierarchy on `opc.tcp://localhost:4840`.
14. **`tools/proveit: benthos-umh per OPC UA instance — bridges to SpB`** — 2d. Exit: SpB messages observable for OPC UA-sourced metrics.
15. **`docs/specs/proveit-simulator-spec.md — formalize factory.yaml schema, scoring methodology, fixture taxonomy`** — 3d. Exit: spec merged, links from `docs/THEORY_OF_OPERATIONS.md`.
16. **`.github/workflows/proveit-tier-s.yml — run Tier-S Conveyor on every PR; post scorecard delta to PR comments`** — 3d. Exit: green on this PR.

Sprint-1 total: ~50 days = 10 weeks (1 engineer) or 5 weeks (2 engineers). Tier-S demo-able by Week 4.

---

## 8. Risk register

| Risk | Mitigation |
|---|---|
| LLM-rendered manuals are too uniform (model overfits to template) | Use 3 distinct Jinja templates + cascade-rotation across Groq/Cerebras/Gemini for variation |
| `answer_key.json` becomes a model artifact rather than ground truth | Mike does manual spot-check on Tier-S keys; checksum + git-tracked under `tools/proveit/answer_keys/` |
| Adversarial noise rates make scorecard noisy | Run each fixture with noise=off and noise=default; track delta separately |
| SpB Protobuf payload bugs eat days of debugging | Use Tahu reference lib; verify against `$sparkplug/certificates` cert surface every run |
| CSV-replay rate mismatches real plant cadence | Configurable speed-up; default 10×; CI uses 100× for fast loops |
| Staging Neon costs balloon under 5K-asset Tier-L | Use Neon staging branch with explicit row-cap; nightly truncate after scoring |
| Slack staging workspace token shared with prod (memory: `Slack tokens shared stg↔prd`) | Hard-coded check in harness: refuse to run if `SLACK_BOT_TOKEN` matches prod; require dedicated staging app |
| Bravo Tailscale embedding sidecar still flaky (per `project_recall_embedding_gate`) | Run benchmark against bundled BM25 fallback first; embed-gated rerun is a separate scorecard column |

---

## 9. Out of scope (deliberately deferred)

- **Real-time control / write paths.** Simulator is read-only / monitoring. No NCMD/DCMD synthesis (would muddy MIRA's safety boundary).
- **CESMII SMIP integration.** Membership-gated; reconsider only if we want CNCBaseType-Simulator live.
- **MTConnect cppagent.** Phase-2 scenario (CNC); not blocking Tier-S / Tier-M.
- **3D visualization (Open-Industry-Project).** Sales-asset-ish; defer until benchmark is green and we want a video.
- **Petrobras 3W O&G scenario.** Phase-2 vertical scenario; the architecture supports it but no current customer pull.
- **Acoustic anomaly (MIMII).** Out of MIRA's product scope (no audio in Slack flow).
- **Carbon-footprint AAS submodel (IDTA 02023).** Out of maintenance scope.
- **Full ISO 14224 taxonomy (100+ petroleum classes).** Use the open-derived subset only.

---

## 10. Cross-references

- Companion research doc: [`mira_uns_dataset_and_simulator_research.md`](./mira_uns_dataset_and_simulator_research.md)
- Theory of operations: `../THEORY_OF_OPERATIONS.md`
- Namespace builder spec: `../specs/maintenance-namespace-builder-spec.md`
- Namespace builder plan: `../plans/2026-05-15-maintenance-namespace-builder.md`
- UNS path builders + rules: `../../mira-crawler/ingest/uns.py`, `../../.claude/rules/uns-compliance.md`
- Engine groundedness: `../../mira-bots/shared/engine.py`
- Existing eval framework: `../../tests/eval/README.md`
- Environments doctrine: `../environments.md` (Tier-S = dev, Tier-M = staging, Tier-L = staging-nightly)
