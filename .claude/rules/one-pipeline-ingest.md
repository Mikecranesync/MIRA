# The One-Pipeline Law (canonical factory ingest contract)

Every factory data **source** — garage conveyor, MQTT devices, Sparkplug, Ignition, PLC feeds,
customer factories — enters through **one** canonical pipeline:

```
Source → ingest_contract → ingest_batch → contextualization → MIRA
```

The goal is not to accumulate integrations; it is to prove FactoryLM can ingest and contextualize
factory data through a **single** canonical path. A new transport adds a *transport*, never a second
core.

## Hard rule

**No transport/ingest module may create its own:**
- tag-path **normalizer** (the fail-closed `approved_tags` match key)
- **allowlist** logic (querying `approved_tags` itself)
- **persistence** path (its own store / `persist_batch`)
- **direct DB write** to `tag_events` / `live_signal_cache`
- rival **batch shape** (an inline `{source_system, tags}` dict that bypasses `build_ingest_batch`)
- rival **enforcement** path (its own `ingest_batch` / pipeline)

## The single allowed homes

| Primitive | The ONE place it may be defined |
|---|---|
| `normalize_tag_path`, `build_tag_entry`, `build_ingest_batch` | `mira-relay/ingest_contract.py` |
| `ingest_batch` (enforcement), `NeonTagStore.{load_allowlist, persist_batch}`, writes to `tag_events`/`live_signal_cache` | `mira-relay/tag_ingest.py` |

A transport **decodes its wire format** and then calls the contract:
`build_tag_entry(...)` → `build_ingest_batch(source_system, tags)` → `ingest_batch(payload, tenant_id, store)`.
That is the whole job. (Worked example: `simlab/publishers.py::RelayIngestPublisher`.)

## Not forbidden

- **Emitting** a producer's own data to a broker (e.g. SimLab `MqttPublisher`) — that is the producer
  side; the subscriber reads it back and routes it through `ingest_batch`.
- **Downstream analytics** over `tag_events` (e.g. `tag_diff_logger`, `flaky_detector`) — they read the
  canonical stream and write their *own* derived tables; they are not ingest inlets.
- **Plant/control writes** are a *separate* prohibition — see `.claude/rules/fieldbus-readonly.md`
  (read-only OT; no PLC writes). This rule governs the *ingest* path, not control.

## Enforcement (CI)

`tests/test_architecture.py` — Contract 5 (`test_ingest_surface_obeys_one_pipeline` +
`test_one_pipeline_checker_catches_violations`). It AST/regex-scans the ingest surface
(`mira-relay/**`, `simlab/publishers.py`) **default-deny**: any file that defines a forbidden
primitive fails, unless it is in `_ONE_PIPELINE_ALLOWLIST` (the three canonical files above, each with
a documented reason). The checker is unit-tested against bad fixtures so a green run is meaningful.
Runs in CI as its own step (`.github/workflows/ci.yml` → `pytest tests/test_architecture.py`).

**To add a new transport:** put it under `mira-relay/` (e.g. `mira-relay/mqtt_ingest/`), decode →
`build_*` → `ingest_batch`. Do **not** add it to the allowlist (only the canonical core is exempt).
If the guard fails, you forked the core — route through the contract instead.

## Cross-references
- `mira-relay/ingest_contract.py` — the canonical contract (PR #2281).
- `mira-relay/tag_ingest.py` — `ingest_batch` + `NeonTagStore`.
- `docs/design/2026-06-23-lane3-mqtt-subscriber-design.md` — the §7 reuse discipline this enforces.
- `.claude/rules/fieldbus-readonly.md` — the separate control-write prohibition.
- `.claude/rules/direct-connection-uns-certified.md` — tenant identity on every ingest turn.
