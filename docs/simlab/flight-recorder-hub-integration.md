# SimLab Flight Recorder Hub Integration Boundary

## Status

The Phase 1 SimLab flight recorder is local, deterministic, and process-bound.
It records scenario, tick, and evidence-request events from the headless
simulator so tests and demos can replay what happened without a broker, database,
wall-clock timestamp, UUID, PLC, Ignition gateway, or live hardware path.

Current local endpoints:

```bash
curl http://localhost:8099/simlab/flight-recorder/events
curl http://localhost:8099/simlab/flight-recorder/export.ndjson
curl -X POST http://localhost:8099/simlab/flight-recorder/clear
```

The JSON event contract is intentionally compact:

```json
{
  "event_type": "tick",
  "run_id": "simlab-local-run",
  "seed": 42,
  "line_id": "line01",
  "tick": 30,
  "ts": "2026-01-01T00:00:30Z",
  "scenario_id": "filler_underfill_low_bowl_pressure",
  "reading_count": 58,
  "active_alarms": [],
  "changed_paths": [
    "enterprise.florida_natural_demo.plant1.juice_bottling.line01.filler01.process.filler_bowl_pressure"
  ],
  "details": {}
}
```

`evidence_requested` events use the same top-level fields and place compact
diagnostic context in `details`: abnormal tag count, sorted abnormal paths,
active alarm count, candidate docs, and the UNS subtree.

## Production Boundary

Do not make `live_signal_events` the durable production flight-recorder store.
That table is the Hub demo-signal stream: it is component-bound, demo-coupled,
and has simulator-first defaults that are useful for tablet/demo flows but wrong
for customer telemetry history.

The durable production path should reuse the existing relay and Hub telemetry
store:

```text
SimLab or live source
  -> relay ingest contract / mira-relay/tag_ingest.py
  -> Hub tag_events          (append-only raw event history)
  -> Hub live_signal_cache   (latest value cache)
```

`tag_events` is the production append-only raw stream. It carries source system,
source connection, simulated flag, event timestamp, ingest timestamp, UNS path,
quality, typed value, and metadata. Future production flight-recorder work should
project local recorder semantics into this relay/tag-event shape instead of
creating a second store or extending the demo-only event table.

## Mapping

| Local recorder field | Event type(s) | Eventual relay / `tag_events` mapping |
| --- | --- | --- |
| `run_id` | all | `metadata.run_id`; groups one deterministic replay or production capture window. |
| `seed` | all | `metadata.sim_seed` for simulator-origin captures only. |
| `line_id` | all | `metadata.line_id`; also implied by `uns_path` when resolved. |
| `tick` | all | `metadata.sim_tick` for simulator-origin captures; not a production clock. |
| `ts` | all | `event_timestamp` when it is the source observation time. Preserve deterministic SimLab timestamps for replay exports. |
| `scenario_id` | scenario / tick / evidence | `metadata.scenario_id`; simulator-only provenance, not a customer equipment label. |
| `event_type` | all | `metadata.flight_event_type` such as `scenario_loaded`, `tick`, or `evidence_requested`. |
| `reading_count` | all | `metadata.reading_count`; useful for batch completeness checks. |
| `changed_paths[]` | tick | One candidate source for per-reading `uns_path` / `tag_path` rows when paired with the reading values. |
| `active_alarms[]` | tick / evidence | `metadata.active_alarms` or downstream alarm/event projection; do not collapse alarm context into a raw tag value. |
| `details.abnormal_paths[]` | evidence | `metadata.abnormal_paths`; diagnostic context for a request boundary, not raw telemetry. |
| `details.candidate_docs[]` | evidence | `metadata.candidate_docs`; evidence provenance for answer reconstruction. |
| `details.uns_subtree` | evidence | `metadata.uns_subtree`; bounds the diagnostic query window. |

When actual tag readings are exported through relay ingest, each accepted
reading should still become its own `tag_events` row with canonical `tag_path`,
optional resolved `uns_path`, typed `value`, `quality`, `source_system`, and
`simulated`. Recorder-level fields belong in `metadata` unless they are already
first-class `tag_events` columns.

## Safety

The local recorder remains read-only and headless by default. It records what the
deterministic simulator already emitted; it does not write PLCs, start live
hardware, require Ignition, publish MQTT, call NeonDB, or overwrite production
latest-value state. Any future Hub/relay integration must stay opt-in, preserve
the relay allowlist/fail-closed path, and keep simulated telemetry marked as
simulated so it cannot masquerade as live plant data.
