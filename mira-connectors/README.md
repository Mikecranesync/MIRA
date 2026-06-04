# mira-connectors

Translation layer between external systems and MIRA's canonical industrial asset
graph. Ships **mock** connectors (realistic fixtures, no credentials) for IBM
Maximo, Ignition/SCADA, SAP PM, MaintainX, and AVEVA PI.

**Full docs:** [`docs/mira/connector-framework.md`](../docs/mira/connector-framework.md)

## Quick start

```bash
python mira-connectors/demo.py          # end-to-end OT↔enterprise join demo
cd mira-connectors && pytest tests/ -q  # 67 tests (run from inside the module)
```

## Layout

| Path | What |
|---|---|
| `base.py` | `Connector` ABC: discover / import_records / normalize / validate / export_enriched / get_config_schema. `read_only` (guards source) + `dry_run` (guards MIRA) default `True`. |
| `canonical.py` | In-memory mirror of the live `kg_entities` / `kg_relationships` / `ai_suggestions` / `source_objects` schema. Everything connector-produced is `approval_state="proposed"`. |
| `uns_bridge.py` | Re-exports `mira-crawler/ingest/uns.py` path builders (reuse, never reimplement). |
| `cmms/` | `maximo_mock.py`, `sap_mock.py`, `maintainx_mock.py` (+ `fixtures/`). |
| `scada/` | `ignition_mock.py` — tag tree → signals + SCADA↔CMMS cross-reference (+ `fixtures/`). |
| `historian/` | `pi_mock.py` — AF hierarchy + PI points + event frames (+ `fixtures/`). |
| `demo.py` | Runnable pipeline. |
| `tests/` | Per-connector + canonical-model + base + e2e. |

## Invariants

- **Proposed, not verified.** Connectors never auto-verify; `proposed → verified`
  is a human action.
- **Preserve every source field** in `source_payload` + a `SourceObject` (custom
  fields included).
- **Read-only by default** — connectors don't write to source systems.
- **UNS paths only via `uns.py`** builders.
- **Safety proposals** (E-stop / LOTO / interlock) are `risk_level="safety_critical"`.

`mira-connectors/` is a `sys.path` root (like `mira-mcp/`); run tests from inside
the module so its `cmms/` subpackage doesn't collide with `mira-mcp/cmms`.
