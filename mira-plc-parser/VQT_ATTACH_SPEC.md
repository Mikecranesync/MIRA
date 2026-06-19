# Spec — Live VQT attachment, thin slice (issue #2102)

Status: **IMPLEMENTED** (this slice — `mira_plc_parser/vqt_attach.py` + `attach` CLI). Scopes the
smallest end-to-end slice of "bind live values to the compiled asset graph," offline, no PLC, no new
deps. The remaining follow-ups (live polling, real-CSV adapter, scaling, relay push) stay open in
issue #2102.

## The slice

> Take a compiled `asset_graph.json` + a **values snapshot** (address → value readings) and produce
> `asset_graph.live.json` where every Signal that `MAPPED_TO` a register present in the snapshot has
> its **VQT** (Value / Quality / Timestamp) populated, with quality + freshness, plus an attachment
> summary. Deterministic, offline, read-only.

This exercises the exact binding seam a real Modbus poll feeds — `register address → value` over the
`MAPPED_TO` edge — without hardware. It is the smallest thing that turns the static "what the program
*is*" graph into "what the machine *is doing*." Live polling and the historian/relay path reuse the
same `attach_values()` later, swapping the snapshot source.

## Goal

- One new offline step: `attach_values(graph, snapshot, as_of=None) -> graph` + a CLI `attach`.
- Bind by **Modbus address** against the graph's `Register` nodes / `MAPPED_TO` edges (primary);
  optional bind-by-signal-name fallback.
- Populate each matched Signal node with `vqt = {value, quality, timestamp}` + `freshness`.
- Emit `asset_graph.live.json` (sibling — never overwrites the offline `asset_graph.json`) and a
  `live_summary` (attached / unmatched-readings / still-unsampled).

## Non-goals (explicitly deferred — remainder of #2102)

- **No live polling.** No Modbus/Ethernet I/O here. (`mira-connect/drivers/modbus_driver.py` does that
  later; it will feed the same `attach_values()`.)
- **No real-`live_logger`-CSV adapter.** The captured `plc/conv_simple_anomaly/logs/*.csv` use friendly
  column names + scale/offset (`HR_SPECS`); converting those → a canonical address-keyed snapshot is a
  separate follow-up adapter.
- **No writes** to PLC or to `live_signal_cache` / NeonDB. Read-only, file-in/file-out.
- **No time series.** One snapshot = one sample per address (latest value), not a history window.
- **No engineering-unit scaling.** Values are attached raw; scaling (e.g. Hz×100) is a follow-up.

## Inputs

1. **`asset_graph.json`** — output of `compile`/`correlate` (has `Signal` + `Register` nodes,
   `MAPPED_TO` edges; signals carry `attributes.address`).
2. **Values snapshot** — one of:
   - CSV: header `address,value[,quality][,timestamp]` (one row per reading). Example:
     ```
     address,value,quality,timestamp
     400107,151,good,2026-06-12T17:11:03Z
     000006,1,good,2026-06-12T17:11:03Z
     ```
   - JSON: `[{"address": "400107", "value": 151, "quality": "good", "timestamp": "..."}]`
   - `--by name` flag switches the key column from `address` to `signal` (binds by signal name).

## Output

`asset_graph.live.json` = the input graph with, on each `Signal` node:

```jsonc
"vqt": { "value": 151, "quality": "good", "timestamp": "2026-06-12T17:11:03Z" },
"freshness": "current"   // current | stale | unknown
```

Unmatched signals get `vqt: {value: null, quality: "unknown", timestamp: null}`, `freshness:
"unknown"`. Plus a top-level `live_summary`:

```jsonc
"live_summary": {
  "as_of": "...", "readings": 27, "signals_attached": 27, "signals_unsampled": 15,
  "unmatched_readings": [ {"address": "499999", "reason": "no register/signal for address"} ],
  "quality": {"good": 25, "uncertain": 2}, "freshness": {"current": 27}
}
```

## Binding algorithm (deterministic)

1. Index the graph: `address -> [signal_id]` via `MAPPED_TO` edges (signal → register, register name =
   address); and `signal_name -> signal_id`.
2. For each snapshot reading: resolve target signal(s) by address (or name if `--by name`).
   - matched → set `vqt` (value, normalized quality, timestamp) + compute freshness.
   - no match → record in `unmatched_readings`.
3. Signals never matched → empty VQT, `freshness: "unknown"`, counted as `signals_unsampled`.
4. Conflicting readings for one address (two rows) → last write wins + a `live_summary` note (rare).

## Quality + freshness rules (reuse existing semantics)

- **Quality** — accept `{good, bad, stale, uncertain}` (from `mira-relay` `VALID_QUALITY`); unknown
  code → `uncertain`; a row with no/empty value → `bad`; no `quality` column → `good` if value
  present.
- **Freshness** — needs `as_of` (CLI `--as-of <ISO>`, else max timestamp in the snapshot, else none)
  and `--max-age <seconds>` (default 30):
  - timestamp within `max_age` of `as_of` → `current`
  - older → `stale` (and quality downgraded to `stale` if it was `good`)
  - no timestamp → `unknown`

## API

`mira_plc_parser/vqt_attach.py` (offline; distinct from the live `mira-connect`/`mira-relay` layer):

```python
def load_snapshot(text: str, by: str = "address") -> list[Reading]   # parse CSV or JSON
def attach_values(graph: dict, readings: list[Reading],
                  as_of: str | None = None, max_age: float = 30.0, by: str = "address") -> dict
```

`attach_values` returns a NEW graph dict (input not mutated). Reuses the VQT triple shape
(`value/quality/timestamp`) and the `VALID_QUALITY` vocabulary (copied as a 4-value constant — no
import from mira-relay, this subproject stays dependency-free).

## CLI

```bash
mira-plc-parser attach <asset_graph.json> <snapshot.csv|.json> --out ./out [--by address|name]
                       [--as-of <ISO8601>] [--max-age 30]
# writes out/asset_graph.live.json ; prints attached / unsampled / unmatched counts
```

## Module placement & reuse

- **New:** `vqt_attach.py` + `attach` CLI subcommand + a snapshot fixture. ~120–150 LOC.
- **Reuse:** the compiled graph's `MAPPED_TO`/`Register` structure; the VQT triple shape; the quality
  vocabulary; the existing CLI scaffolding.
- **Keep separate (do NOT couple):** `mira-connect/drivers/modbus_driver.py` (live poll) and
  `mira-relay/tag_ingest.py` (`live_signal_cache`). They are the LIVE producers; this slice consumes a
  static snapshot. The seam (`attach_values`) is shared; the I/O is not.

## Tests

- snapshot CSV + JSON parse to identical readings.
- address-bind: a reading on `400107` lights up the `vfd_frequency` signal's VQT.
- name-bind (`--by name`) path.
- unmatched reading (address not in graph) → `unmatched_readings`, no crash.
- unsampled signal → empty VQT, `freshness: unknown`.
- quality: unknown code → `uncertain`; missing value → `bad`.
- freshness: fresh timestamp → `current`; old → `stale` (+ quality downgrade); none → `unknown`.
- end-to-end: compile a fixture folder → attach a snapshot → `asset_graph.live.json` has N signals
  with populated VQT and a correct `live_summary`; offline `asset_graph.json` is untouched.
- read-only: input graph + snapshot files are not modified.

## Acceptance criteria

- `mira-plc-parser attach graph.json snapshot.csv --out o` writes `o/asset_graph.live.json` with VQT
  populated on every signal whose `MAPPED_TO` address is in the snapshot.
- Deterministic, offline, no new runtime deps; honors `.claude/rules/fieldbus-readonly.md` (no I/O).
- Frozen exe runs `attach` from a clean dir. ruff clean; `report@1`/`i3x@1` goldens unchanged.

## Effort & risk

- **Effort:** ~half a day. One module, one CLI command, ~9 tests, one fixture.
- **Risk:** low — pure data transform over an existing graph; no I/O, no deps. Main design choice is
  the canonical snapshot schema (address-keyed), chosen to match what a live poll returns so the live
  path slots in unchanged.

## Follow-ups (rest of #2102, after this slice)

1. `live_logger`-CSV → canonical-snapshot adapter (friendly-name + `HR_SPECS` scale/offset → address).
2. Live Modbus polling via `mira-connect` feeding `attach_values()` (bench-only, read-only).
3. Engineering-unit scaling + per-signal `unit`.
4. Push attached VQT to `mira-relay` `live_signal_cache` (the production live layer).
5. Time-series / freshness-over-window instead of a single latest sample.
