# SimLab Juice Bottling Line — Build Task (delegation spec)

**Branch:** `feat/simlab-juice-bottling` (worktree `/Users/charlienode/mira-simlab-wt`)
**Why this exists:** Add SimLab's next major direction — a ProveIt-style, deterministic,
headless simulated **juice bottling line** that MIRA monitors, reasons over (PLC-style tags),
maps into a UNS, diagnoses, cites docs against, and gates with train-before-deploy approval.
**Cluster Law 4 (Task.md protocol):** this file is the full context + acceptance criteria the
sub-agents build against. Do not deviate from the locked interfaces below.

---

## Locked foundation (ALREADY WRITTEN — import, do not modify)

- `simlab/packml.py` — `PackMLState` enum (10 states), `can_transition`, `is_active`,
  `is_running`, `is_faulted`, `run_state_label`.
- `simlab/models.py` — `TagCategory`, `ValueType`, `Severity`, `TagDef`, `FaultCode`,
  `AlarmDef`, `AssetModel`, `LineModel`, `PlantModel`, `FactoryModel`, `Reading`.
- `simlab/uns.py` — canonical ltree paths (`tag_path(asset_id, category, tag)`,
  `asset_path`, `line_path`) + `to_mqtt_topic` / `from_mqtt_topic` projections.

### NON-NEGOTIABLE invariants

1. **UNS = canonical lowercase dot-delimited ltree rooted at `enterprise`.** Use
   `simlab.uns.tag_path(...)` for every path. The `FactoryLM/FloridaNaturalDemo/...`
   slash form is ONLY produced by `to_mqtt_topic` for MQTT/display. Never store the slash form.
2. **`diagnostic.py` is an evidence-packet assembler + rubric grader — NOT an answer engine.**
   It must NOT generate the diagnosis and then grade itself. The honest "MIRA answers" test runs
   the **real Supervisor** via the existing `tests/simlab/runner.py` direct-connection pre-seed.
3. **Deterministic + seeded.** No `Date.now()`/wallclock in tick logic; the engine takes a
   `seed` and a `tick` counter. Scenario drift is a pure function `f(tick) -> value`. Replaying
   the same scenario from the same seed yields byte-identical snapshots.
4. **Every reading is `simulated=True`, `source_system="simulator"`.** Mirrors
   `mira-relay/tag_ingest.py` provenance. A simulated reading must never claim to be live.
5. **Additive only.** Do NOT fork or break `tests/simlab/runner.py`, `checkpoints.py`, or the
   5 existing scenarios. Extend `tests/simlab/schema.py` `SimLabScenario` with OPTIONAL fields only.
6. **No new DB migration.** `simlab/approval.py` is a self-contained local store (SQLite WAL).
   Reuse `mira_bots.shared.asset_agent_transition` for the lifecycle graph (import it).
7. **Python 3.12, ruff, `Optional[X]`, stdlib `logging`, `yaml.safe_load`.** Optional heavy deps
   (`aiomqtt`, `fastapi`, `httpx`) behind lazy/guarded imports so the sim core loads bare.

---

## Line spec — juice bottling (Florida Natural Demo)

Canonical line: `enterprise.florida_natural_demo.plant1.juice_bottling.line01`
Display: `FactoryLM/FloridaNaturalDemo/Plant1/JuiceBottling/Line01`

Process flow (order matters — accumulation/backup propagates downstream→upstream):
`Depalletizer01 → ConveyorZone01 → ConveyorZone02 → Rinser01 → Filler01 → Capper01
 → Labeler01 → CasePacker01 → Palletizer01`  + Utilities: `AirSystem01`, `CIPSkid01`.

### Asset tag models (EXACT tag names — these are the contract)

Build each asset's `tags` dict with these tag names. Pick sensible `TagCategory`,
`ValueType`, `unit`, `default`, `description`. `run_state` is `STATUS/ENUM` (PackML
`run_state_label`). `fault_code` is `FAULTS/STRING`. Counts are `PRODUCTION/INT`.
`*_reject*` are `QUALITY/INT`. Motor amps / vfd / pressure / torque / temp are `PROCESS`
or `MOTOR` as appropriate.

- **Depalletizer01** (`pick_place_depalletizer`): run_state, pallet_present, layer_count,
  bottle_outfeed_rate, vacuum_pressure, jam_detected, fault_code
- **ConveyorZone01 / ConveyorZone02** (`belt_conveyor`): run_state, motor_current_amps,
  speed_fpm, photoeye_blocked, blocked, starved, accumulation_percent, fault_code
- **Rinser01** (`bottle_rinser`): run_state, infeed_bottle_count, outfeed_bottle_count,
  water_pressure, rinse_valve_open, reject_count, fault_code
- **Filler01** (`rotary_filler`): run_state, bottles_per_minute, fill_level_oz,
  fill_level_target_oz, fill_level_variance, tank_level_percent, product_temperature,
  filler_bowl_pressure, nozzle_fault_count, underfill_reject_count, overfill_reject_count,
  vfd_speed_hz, motor_current_amps, fault_code
- **Capper01** (`capper`): run_state, cap_present, cap_torque_inlb, cap_torque_target,
  cap_torque_variance, cap_chute_level, reject_count, jam_detected, motor_current_amps, fault_code
- **Labeler01** (`labeler`): run_state, label_roll_percent, label_web_tension,
  label_sensor_blocked, glue_temperature, registration_error_mm, reject_count, fault_code
- **CasePacker01** (`case_packer`): run_state, case_count, bottle_infeed_count,
  case_former_ready, glue_level, glue_temperature, jam_detected, reject_count, fault_code
- **Palletizer01** (`palletizer`): run_state, case_infeed_count, pallet_present, layer_count,
  robot_ready, slip_sheet_present, jam_detected, fault_code
- **AirSystem01** (`air_system`): header_pressure_psi, compressor_running, dryer_fault, low_air_alarm
- **CIPSkid01** (`cip_skid`): cip_active, cycle_step, supply_temp, return_temp, conductivity, valve_fault

Each asset also gets: a short `fault_codes` list (≥3 realistic rows incl. the one its scenario
uses) and `alarms` (declarative, predicate over a tag) and `docs` (filenames, see Docs section).

---

## Modules to BUILD (locked signatures)

### `simlab/baselines/` — reusable PLC archetypes
One module per archetype with a factory function returning the tag/fault/alarm set for that
machine class: `bottle_filler`, `conveyor_zone`, `reject_station`, `palletizer`,
`pick_place_depalletizer`, `vfd_motor`, `capper`, `labeler`, `case_packer`, `rinser`,
`air_system`, `cip_skid`, plus a shared `packml_status_tags()` helper (every asset gets
`run_state` + derived diagnostic tags). Baselines normalize the standard concepts: inputs,
outputs, internal tags, timers, counters, interlocks, alarms, fault codes, HMI tags. NOT
proprietary code — clean-room archetypes.

### `simlab/lines/juice_bottling.py`
```python
def build_line() -> LineModel: ...        # the 8 process assets + 2 utilities, wired in order
def build_factory() -> FactoryModel: ...  # FactoryModel(site_id="florida_natural_demo", ...) wrapping it
LINE_ID = "line01"
```

### `simlab/engine.py` — deterministic tick engine
```python
class SimEngine:
    def __init__(self, line: LineModel, seed: int = 42): ...
    def reset(self) -> None: ...                          # all tags → defaults, tick=0, no scenario
    def load_scenario(self, scenario: "Scenario") -> None: ...
    def advance(self, ticks: int = 1) -> None: ...        # apply scenario drift f(tick); raise alarms
    @property
    def tick(self) -> int: ...
    def snapshot(self) -> list[Reading]: ...              # every tag's current Reading (canonical uns_path)
    def snapshot_dict(self) -> dict[str, Any]: ...        # {uns_path: value} convenience
    def history(self, uns_path: str) -> list[tuple[int, Any]]: ...   # [(tick, value), ...]
    def active_alarms(self) -> list[dict]: ...            # [{asset_id, code, severity, message, since_tick}]
```
1 tick = 1 second of sim time (document it). Baseline (no scenario) holds a healthy steady
state with light deterministic ripple (seedable; use the engine seed, NOT `random.random()` at
call time — pre-roll a `random.Random(seed)` stream so replays match). History is retained per tag.

### `simlab/scenarios.py` — replayable fault scenarios
```python
@dataclass
class Phase:        # one stretch of the timeline
    start_tick: int
    label: str                       # "normal" | "fault_onset" | "degraded" ...
    drift: dict[str, Any]            # {bare_tag_name_on_asset: target_or_callable(tick)->value}

@dataclass
class Scenario:
    id: str                          # "filler_underfill_low_bowl_pressure"
    title: str
    asset_id: str                    # primary affected asset
    normal_state: dict[str, Any]     # tag overrides for the healthy baseline
    timeline: list[Phase]
    alarms_at_tick: dict[int, list[str]]   # {tick: [alarm_code,...]} expected to fire
    # GROUND TRUTH (rubric) — what a correct MIRA diagnosis must contain:
    expected_root_cause: str
    expected_asset: str              # asset_id
    expected_evidence_tags: list[str]      # canonical uns_paths that prove it
    expected_actions: list[str]            # recommended technician actions
    expected_citations: list[str]          # doc filenames MIRA should cite
    question: str                    # the operator question to pose ("Why is Line 1 making bad bottles?")

SCENARIOS: dict[str, Scenario]       # all of A–F, keyed by id
def get_scenario(scenario_id: str) -> Scenario: ...
```
Build all six (A underfill / B capper torque / C label registration / D case-packer jam blocks
upstream / E palletizer unavailable backs up cases / F low plant air → multi-machine symptoms).
Scenario F must drive AirSystem01 + Depalletizer vacuum + Capper/CasePacker faults so the
rubric's `expected_root_cause` is the utility, not independent machine failures.

### `simlab/publishers.py` — publisher abstraction
```python
class Publisher(Protocol):
    def publish(self, readings: list[Reading]) -> None: ...
class InMemoryPublisher:      # records batches; .last / .batches for assertions  (TEST DEFAULT)
class FakePublisher(InMemoryPublisher): ...   # alias used by tests; no external broker
class RestSnapshotPublisher:  # holds latest {uns_path: Reading} for GET /snapshot
class MqttPublisher:          # lazy-imports aiomqtt; topic = uns.to_mqtt_topic(r.uns_path); retain=True
class RelayIngestPublisher:   # POST batch to mira-relay /api/v1/tags/ingest, source_system="simulator"
```
MQTT + RelayIngest must NOT be on the test path (no broker / no NeonDB). Tests use
`InMemoryPublisher`. Envelope for MQTT mirrors `mira-fault-sim/sim.py` `_stamp`
(`{"value","ts","source":"simulator"}`).

### `simlab/diagnostic.py` — evidence assembler + rubric (NO answer generation)
```python
@dataclass
class EvidencePacket:
    asset_id: str
    abnormal_tags: list[dict]    # [{uns_path, value, baseline, delta, why}]
    active_alarms: list[dict]
    candidate_docs: list[str]    # doc filenames relevant to the abnormal signature
    uns_subtree: str

def assemble_evidence(engine: SimEngine, scenario: Scenario) -> EvidencePacket: ...
    # Pure function of live tags+alarms+models. Surfaces WHAT is abnormal — does NOT
    # name the root cause. This is the grounding context fed to the engine.

@dataclass
class RubricResult:
    root_cause_hit: bool
    asset_hit: bool
    evidence_tags_hit: list[str]
    evidence_recall: float
    citations_hit: list[str]
    actions_hit: list[str]
    passed: bool
    detail: str

def grade(reply_text: str, scenario: Scenario) -> RubricResult: ...
    # Grade a free-text MIRA reply against the scenario's ground truth (keyword/uns
    # containment + asset name + citation filenames). Used by the engine test + approval.
```

### `simlab/approval.py` — train-before-deploy approval store
```python
class ApprovalStore:
    def __init__(self, db_path: str = "/tmp/mira_simlab_approvals.db"): ...
    # validation Q&A row — mirrors asset_validation_qa columns (migration 047)
    def record_answer(self, *, scenario_id, asset_uns_path, question, mira_answer,
                      citations: list, evidence_tags: list, groundedness: Optional[int]=None) -> str: ...  # -> qa_id
    def set_verdict(self, qa_id: str, verdict: str, reviewed_by: str) -> None: ...  # verdict ∈ good|bad|needs_review
    def get_answer(self, qa_id: str) -> dict: ...
    def list_answers(self, asset_uns_path: str) -> list[dict]: ...
    # asset-agent lifecycle — reuse mira_bots.shared.asset_agent_transition
    def agent_state(self, asset_uns_path: str) -> str: ...           # default "draft"
    def transition(self, asset_uns_path: str, target: str, actor: str = "") -> None: ...  # validate_transition()
    def gate(self, asset_uns_path: str) -> dict: ...                 # gate_decision() -> {allow, reason}
```
Verdict vocab = `good` / `bad` / `needs_review` (exactly `asset_validation_qa.reviewer_verdict`).
Lifecycle states/graph = imported from `mira_bots/shared/asset_agent_transition.py`. Document the
wiring point to migrations 046/047 + Hub `AssetValidateTab.tsx` (don't implement Neon here).

### `simlab/api.py` — FastAPI surface (deterministic, testable)
A module-level `app` + a `build_app(engine=None, approvals=None)` factory so tests inject state.
Routes (all JSON, deterministic):
- `GET  /simlab/factories` · `GET /simlab/lines` · `GET /simlab/lines/{line}/assets`
- `GET  /simlab/assets/{asset_id}/tags`
- `GET  /simlab/snapshot` (optional `?asset=`) · `GET /simlab/history?tag=<uns_path>`
- `GET  /simlab/alarms`
- `POST /simlab/scenario/{scenario_id}/start` · `POST /simlab/scenario/reset`
- `POST /simlab/scenario/tick?n=1` (advance) · `POST /simlab/scenario/{id}/replay?ticks=N` (deterministic)
- `GET  /simlab/scenario/{id}/rubric` (expected diagnosis/evidence/actions/citations)
- `GET  /simlab/assets/{asset_id}/docs` · `GET /simlab/docs/{asset_id}/{filename}` (serve fixture md)
- `GET  /simlab/evidence/{scenario_id}` (assemble_evidence packet)
- `POST /simlab/validation/answer` (record_answer) · `POST /simlab/validation/{qa_id}/verdict`
- `GET  /simlab/agent/{asset_id}/gate`
- `GET  /simlab/healthz`

### `simlab/__main__.py`
`python -m simlab` → start the FastAPI app (uvicorn) with the juice line loaded and the
underfill scenario armed but not started. Print the local URLs + sample curls.

---

## Docs fixtures — `simlab/docs/<asset_id>/`
Per asset, generate realistic-enough **markdown** maintenance docs MIRA can cite. Filenames
referenced by `AssetModel.docs` and `Scenario.expected_citations`:
`operator_quick_guide.md`, `troubleshooting.md`, `fault_code_table.md`, `pm_checklist.md`,
`plc_tag_description_sheet.md`, `spare_parts_notes.md`, `electrical_io_notes.md`.

Invest real depth ONLY in assets a scenario cites: **Filler01, Capper01, Labeler01,
CasePacker01, Palletizer01, AirSystem01**. Others get short stubs. Filler01 `troubleshooting.md`
MUST contain: low bowl pressure → underfill; check product supply tank; check pressure
regulator; inspect clogged fill nozzles; verify fill valve air supply; verify VFD speed +
motor overload. No proprietary/Florida's-Natural confidential content — synthetic only.

---

## Tests — `tests/simlab/test_juice_*.py` (deterministic, no LLM, no broker)
Prove every acceptance criterion:
1. `test_juice_determinism` — replay underfill twice from seed 42 → identical snapshots.
2. `test_juice_tags` — each asset emits exactly its spec'd tags; categories valid.
3. `test_juice_uns_stable` — every tag's `uns_path` is canonical ltree & round-trips through MQTT.
4. `test_juice_alarms_fire` — each scenario's `alarms_at_tick` fire at the expected tick.
5. `test_juice_evidence` — `assemble_evidence` surfaces each scenario's `expected_evidence_tags`.
6. `test_juice_docs` — every `expected_citation` file exists and is retrievable via the API.
7. `test_juice_approval` — record_answer → set_verdict(good) persists; lifecycle
   draft→training→validating→approved (actor required) → gate allows; bad/needs_review blocks.
8. `test_juice_publisher_fake` — InMemoryPublisher captures a full snapshot batch, no broker.
9. `test_juice_rubric` — `grade()` passes a model correct answer, fails an off-target one.
10. `test_juice_api` — FastAPI TestClient: snapshot/alarms/scenario start+tick/evidence/rubric/docs.

Also add the six scenarios as `tests/simlab/scenarios/juice_*.yaml` in the EXISTING
`SimLabScenario` schema (extended additively) so `tests/simlab/runner.py` can run them against
the real Supervisor on-demand (the honest engine test — needs Doppler/cascade, NOT in CI default).

## Acceptance criteria (from the request)
- Dev can run SimLab locally & start the Juice Bottling demo (`python -m simlab`).
- Underfill scenario start/reset/replay; Filler01 tags drift realistically.
- MIRA can answer "Why is Line 1 making bad bottles?" using tag evidence + simulated docs
  (real Supervisor via runner; deterministic evidence packet + rubric in CI).
- Answer can be marked Good/Bad/Approved.
- No proprietary PLC code or confidential data; everything synthetic, deterministic, repo-contained.
