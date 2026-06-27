# SimLab Flight Recorder Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a deterministic SimLab flight recorder that captures scenario/tick evidence first, then expands toward replay/export and Hub/live-signal integration.

**Architecture:** Phase 1 is local and headless: `SimEngine` emits compact recorder events to an injected recorder, and the FastAPI app exposes events for tests and demos. Later phases reuse the Hub `live_signal_events`/`live_signal_cache` recorder and relay ingest path instead of inventing a second production event store.

**Tech Stack:** Python 3.12, dataclasses, FastAPI TestClient, pytest, existing SimLab engine/publisher/evidence APIs, later TypeScript/Postgres Hub recorder reuse.

## Global Constraints

- Work happens on feature branch `codex/flight-recorder-phased` in `C:\Users\hharp\.codex\worktrees\flight-recorder\MIRA`.
- Preserve SimLab determinism: no `datetime.now()`, `time.time()`, random UUIDs, broker/network calls, or wall-clock timestamps in headless tests.
- Keep live hardware and external transports disabled by default.
- Use TDD: write failing tests before production code for every phase.
- Reuse existing SimLab and Hub recorder patterns; do not build a new broad transport layer in Phase 1.
- Do not touch unrelated PLC/garage-conveyor work in `C:\Users\hharp\.codex\worktrees\8491\MIRA`.

---

### Task 1: Local Deterministic Recorder Contract

**Files:**
- Create: `simlab/flight_recorder.py`
- Modify: `simlab/engine.py`
- Modify: `simlab/api.py`
- Test: `tests/simlab/test_flight_recorder.py`
- Modify: `docs/simlab/README.md`

**Interfaces:**
- Produces: `FlightEvent`, `InMemoryFlightRecorder`, `NoopFlightRecorder`.
- Produces: `SimEngine.add_flight_recorder(recorder: Any) -> None`.
- Produces: `GET /simlab/flight-recorder/events` and `POST /simlab/flight-recorder/clear`.

- [x] **Step 1: Write failing tests**

Add tests asserting:
- recorder events are empty until a recorder is attached;
- `load_scenario()` records one `scenario_loaded` event at tick `0`;
- `advance(2)` records two `tick` events at ticks `1` and `2`;
- tick events include deterministic timestamp, scenario id, reading count, active alarms, and `changed_paths`;
- API start/tick endpoints expose the recorder through `/simlab/flight-recorder/events`;
- API clear empties the recorder.

- [x] **Step 2: Run red tests**

Run: `python -m pytest tests/simlab/test_flight_recorder.py -q`

Expected: FAIL because `simlab.flight_recorder` and API endpoints do not exist.

- [x] **Step 3: Implement minimal recorder**

Create `simlab.flight_recorder` with deterministic event serialization only. Keep storage in memory and bounded only by process lifetime for Phase 1.

- [x] **Step 4: Wire engine and API**

Add recorder hooks after scenario load and after each recorded tick. Attach an `InMemoryFlightRecorder` inside `build_app()` unless one is injected.

- [x] **Step 5: Run focused tests**

Run: `python -m pytest tests/simlab/test_flight_recorder.py -q`

Expected: PASS.

- [x] **Step 6: Run SimLab regression**

Run: `python -m pytest tests/simlab/test_juice_bottling.py tests/simlab/test_dashboard.py tests/simlab/test_publishers.py -q`

Expected: PASS.

- [x] **Step 7: Commit**

```bash
git add simlab/flight_recorder.py simlab/engine.py simlab/api.py tests/simlab/test_flight_recorder.py docs/simlab/README.md docs/superpowers/plans/2026-06-27-simlab-flight-recorder.md
git commit -m "feat(simlab): add deterministic flight recorder"
```

### Task 2: Recorder Export and Replay Metadata

**Files:**
- Modify: `simlab/flight_recorder.py`
- Modify: `simlab/engine.py`
- Modify: `simlab/api.py`
- Test: `tests/simlab/test_flight_recorder.py`
- Modify: `docs/simlab/README.md`

**Interfaces:**
- Consumes: `InMemoryFlightRecorder.events()`.
- Produces: `GET /simlab/flight-recorder/export.ndjson`.
- Produces: `run_id`, `seed`, `line_id`, and `scenario_id` metadata in every event payload.
- Produces: deterministic default run IDs. Do not use UUIDs or wall-clock time; default to a stable caller-provided value or `"simlab-local-run"`.

- [x] **Step 1: Write failing metadata and export tests**

Extend `tests/simlab/test_flight_recorder.py` with tests asserting:
- `InMemoryFlightRecorder(run_id="demo-run-01")` causes every event dict to include `"run_id": "demo-run-01"`;
- direct engine events include `"seed": 42` and `"line_id": "line01"`;
- API events include default `"run_id": "simlab-local-run"` unless a recorder was injected with a different run id;
- `GET /simlab/flight-recorder/export.ndjson` returns one JSON object per event, separated by newlines, in the same order as `/events`;
- exported lines parse with `json.loads`, contain no wrapper object, and are byte-identical across two fresh same-seed runs.

- [x] **Step 2: Run red tests**

Run: `python -m pytest tests/simlab/test_flight_recorder.py -q`

Expected: FAIL because metadata fields and the export endpoint are missing.

- [x] **Step 3: Add event metadata**

Update the recorder/engine contract so `recorder.record(...)` receives and serializes `run_id`, `seed`, and `line_id` without changing the deterministic tick timestamp behavior.

- [x] **Step 4: Add NDJSON export**

Add an `export_ndjson()` method or equivalent on `InMemoryFlightRecorder` and expose `GET /simlab/flight-recorder/export.ndjson` as a read-only API route. The route must not clear events.

- [x] **Step 5: Run focused and regression tests**

Run:
```bash
python -m pytest tests/simlab/test_flight_recorder.py -q
python -m pytest tests/simlab/test_juice_bottling.py tests/simlab/test_dashboard.py tests/simlab/test_publishers.py -q
```

Expected: PASS.

- [x] **Step 6: Commit**

```bash
git add simlab/flight_recorder.py simlab/engine.py simlab/api.py tests/simlab/test_flight_recorder.py docs/simlab/README.md docs/superpowers/plans/2026-06-27-simlab-flight-recorder.md
git commit -m "feat(simlab): export flight recorder events"
```

### Task 3: Evidence Snapshots at Diagnosis Boundaries

**Files:**
- Modify: `simlab/api.py`
- Modify: `simlab/flight_recorder.py`
- Test: `tests/simlab/test_flight_recorder.py`
- Test: `tests/simlab/test_juice_bottling.py`
- Modify: `docs/simlab/README.md`

**Interfaces:**
- Consumes: `assemble_evidence(engine, scenario)`.
- Produces: `evidence_requested` recorder events when `/simlab/evidence/{scenario_id}` is called.
- Produces: evidence event payload fields `abnormal_tag_count`, `abnormal_paths`, `active_alarm_count`, `candidate_docs`, and `uns_subtree`.

- [x] **Step 1: Write failing evidence-request tests**

Extend `tests/simlab/test_flight_recorder.py` with tests asserting:
- after starting and advancing `filler_underfill_low_bowl_pressure`, calling `/simlab/evidence/filler_underfill_low_bowl_pressure` appends exactly one `evidence_requested` event after the prior scenario/tick events;
- the event includes the same deterministic `run_id`, `seed`, `line_id`, tick, timestamp, and scenario id as other events;
- the event includes compact evidence fields: abnormal tag count, sorted abnormal paths, active alarm count, candidate docs, and UNS subtree;
- evidence export NDJSON includes the evidence event in order;
- repeated evidence calls append repeated evidence-request events instead of mutating prior events.

- [x] **Step 2: Run red tests**

Run: `python -m pytest tests/simlab/test_flight_recorder.py -q`

Expected: FAIL because evidence events are not recorded yet.

- [x] **Step 3: Extend recorder event payloads**

Add an optional `details` or explicit evidence field block to `FlightEvent` without breaking existing event fields. Keep field ordering deterministic and JSON-serializable.

- [x] **Step 4: Record evidence events in API route**

In `/simlab/evidence/{scenario_id}`, after `assemble_evidence(engine, s)`, record a compact `evidence_requested` event. Do not include root cause or expected answer data; evidence remains diagnostic context only.

- [x] **Step 5: Run focused and regression tests**

Run:
```bash
python -m pytest tests/simlab/test_flight_recorder.py -q
python -m pytest tests/simlab/test_juice_bottling.py tests/simlab/test_dashboard.py tests/simlab/test_publishers.py -q
```

Expected: PASS.

- [x] **Step 6: Commit**

```bash
git add simlab/flight_recorder.py simlab/api.py tests/simlab/test_flight_recorder.py tests/simlab/test_juice_bottling.py docs/simlab/README.md docs/superpowers/plans/2026-06-27-simlab-flight-recorder.md
git commit -m "feat(simlab): record evidence snapshots"
```

### Task 4: Hub/Relay Reuse Boundary

**Files:**
- Modify: `docs/simlab/README.md`
- Create: `docs/simlab/flight-recorder-hub-integration.md`
- Test or modify only if an existing Hub integration test can be reused without database secrets.

**Interfaces:**
- Consumes: `mira-hub/src/lib/signal-recorder.ts`.
- Consumes: `mira-relay/ingest_contract.py` and `RelayIngestPublisher`.
- Produces: documented mapping from SimLab flight events to Hub immutable event history.

- [ ] **Step 1: Write/read-only docs tests if an existing docs lint exists**
- [ ] **Step 2: Document why Hub signal recorder is the durable event store**
- [ ] **Step 3: Document the env-gated path from SimLab events to relay/Hub**
- [ ] **Step 4: Commit with `docs(simlab): map flight recorder to hub events`**

### Task 5: Final Review and Branch Finish

**Files:**
- `.superpowers/sdd/progress.md`
- GitHub PR metadata

**Interfaces:**
- Consumes: all task commits.
- Produces: clean branch ready for PR.

- [ ] **Step 1: Run full relevant test suite**
- [ ] **Step 2: Run final code review**
- [ ] **Step 3: Fix findings**
- [ ] **Step 4: Push branch**
- [ ] **Step 5: Open draft PR**

## Self-Review

Spec coverage: the plan starts with a feature branch/worktree, uses subagent-driven task boundaries, keeps Phase 1 deterministic/headless, and defers Hub/live integration until a reusable boundary is documented.

Placeholder scan: no task contains TBD or a knowingly vague implementation step for Phase 1. Later phases define deliverables and commands but should be expanded with exact code once Task 1 establishes the schema.

Type consistency: `FlightEvent`, `InMemoryFlightRecorder`, and `SimEngine.add_flight_recorder()` are introduced in Task 1 and consumed by later tasks.
