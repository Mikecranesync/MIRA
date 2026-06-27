# Task 3 Report: Evidence Snapshots at Diagnosis Boundaries

## Status

Implemented `evidence_requested` flight-recorder events for `/simlab/evidence/{scenario_id}`.

## TDD Evidence

1. RED test added first:
   - `tests/simlab/test_flight_recorder.py::test_api_records_evidence_requested_events_in_order`
   - Command: `python -m pytest tests/simlab/test_flight_recorder.py -q`
   - Result: FAIL, 1 failed / 11 passed.
   - Expected failure: evidence endpoint returned evidence but did not append an `evidence_requested` event to the recorder.

2. GREEN focused run:
   - Command: `python -m pytest tests/simlab/test_flight_recorder.py -q`
   - Result: PASS, 12 passed.

3. Regression run:
   - Command: `python -m pytest tests/simlab/test_juice_bottling.py tests/simlab/test_dashboard.py tests/simlab/test_publishers.py -q`
   - Result: PASS, 27 passed.

## Behavior Implemented

- `/simlab/evidence/{scenario_id}` now records one `evidence_requested` event after `assemble_evidence(engine, scenario)` completes.
- Event metadata remains deterministic: `run_id`, `seed`, `line_id`, `tick`, `ts`, and `scenario_id`.
- Evidence details are compact and JSON-serializable:
  - `abnormal_tag_count`
  - sorted `abnormal_paths`
  - `active_alarm_count`
  - `candidate_docs`
  - `uns_subtree`
- NDJSON export preserves the event order.
- Repeated evidence calls append repeated immutable events instead of mutating prior events.

## Guardrails

- No wall-clock timestamps, UUIDs, network calls, MQTT, relay, Hub DB, or hardware paths were added.
- Evidence events do not record expected root cause, expected answer, expected citations, expected actions, or rubric truth.

## Files Changed

- `simlab/flight_recorder.py`
- `simlab/api.py`
- `tests/simlab/test_flight_recorder.py`
- `docs/simlab/README.md`
- `docs/superpowers/plans/2026-06-27-simlab-flight-recorder.md`
- `.superpowers/sdd/task-3-report.md`
