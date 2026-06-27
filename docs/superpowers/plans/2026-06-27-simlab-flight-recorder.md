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
- Modify: `simlab/api.py`
- Test: `tests/simlab/test_flight_recorder.py`
- Modify: `docs/simlab/README.md`

**Interfaces:**
- Consumes: `InMemoryFlightRecorder.events()`.
- Produces: `GET /simlab/flight-recorder/export.ndjson`.
- Produces: `run_id`, `seed`, `line_id`, and `scenario_id` metadata in event payloads.

- [ ] **Step 1: Write failing export tests**
- [ ] **Step 2: Verify red**
- [ ] **Step 3: Add NDJSON export without changing event schema**
- [ ] **Step 4: Verify green**
- [ ] **Step 5: Commit with `feat(simlab): export flight recorder events`**

### Task 3: Evidence Snapshots at Diagnosis Boundaries

**Files:**
- Modify: `simlab/api.py`
- Modify: `simlab/flight_recorder.py`
- Test: `tests/simlab/test_flight_recorder.py`
- Test: `tests/simlab/test_juice_bottling.py`

**Interfaces:**
- Consumes: `assemble_evidence(engine, scenario)`.
- Produces: `evidence_requested` recorder events when `/simlab/evidence/{scenario_id}` is called.

- [ ] **Step 1: Write failing test for evidence-request recording**
- [ ] **Step 2: Verify red**
- [ ] **Step 3: Record compact evidence event with abnormal tag count and paths**
- [ ] **Step 4: Verify green and regression**
- [ ] **Step 5: Commit with `feat(simlab): record evidence snapshots`**

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
