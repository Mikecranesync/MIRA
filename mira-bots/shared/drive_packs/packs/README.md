# Drive packs — schema

> **Maturity (GS10 today):** this is the **pack architecture foundation**, not
> yet the complete manual-backed service pack. The GS10 pack ships live-decode +
> envelope data + provenance and the *seams* for the manual-intelligence layers,
> but `knowledge.kb_document_ids` / `component_template_id` / `kg_entity_ids` may
> be empty/null, diagnostic cards are not yet KB/KG-enriched by default (they use
> the `TemplateReader` seam when a reader is injected), and real per-fault manual
> page/excerpt citations are a **follow-up**. See ADR-0025 §1b.

A **drive pack** is a language-neutral JSON manifest that turns a VFD
manufacturer's own register maps, status/fault tables, and operating
envelope into data a diagnostic engine can load — instead of hardcoding one
drive family into engine code. See
[`docs/adr/0025-drive-intelligence-packs-and-drive-commander.md`](../docs/adr/0025-drive-intelligence-packs-and-drive-commander.md)
for the product decision and
[`docs/plans/2026-07-05-drive-commander-gs10-pack.md`](../docs/plans/2026-07-05-drive-commander-gs10-pack.md)
for the build plan this schema is Task 1 of.

A pack is **not** a copy of the manufacturer's manual and **not** a parallel
knowledge store. Layers 1–2 (full manual text + extracted fault/parameter
intelligence) already live in `knowledge_entries` / `component_templates` /
`component_template_sources` / `kg_entities` — the pack **points at** those
rows by id. It only adds what doesn't exist anywhere else: the live-decode
tables, the expected operating envelope, and the family/nameplate-match
descriptor. **Reuse, don't re-hold.**

## Layout

```
packs/
  README.md                    # this file
  <family_id>/
    pack.json                  # the family pack (required)
    models/                    # optional per-model override files (v1: none required)
      <model>.json
```

`<family_id>` is a lowercase, underscore-separated slug (e.g.
`durapulse_gs10`) and doubles as the pack's `pack_id`.

## `pack.json` schema

Every field below is present in `packs/durapulse_gs10/pack.json` — read that
file alongside this doc.

### Top level

| Field | Type | Required | Notes |
|---|---|---|---|
| `pack_id` | `string` | yes | Must equal the containing directory name. |
| `schema_version` | `int` | yes | `1` for this schema generation. |
| `family` | object | yes | See below. |
| `nameplate` | object | yes | See below. |
| `live_decode` | object | yes | See below. |
| `envelope` | object | yes | See below. |
| `knowledge` | object | yes | ID pointers into existing stores; empty/null is valid. |
| `provenance` | object | yes | Per-item provenance tier; see below. |

### `family`

Identifies the drive family and its known aliases (used by `resolve_pack`'s
family-first match).

```json
{
  "manufacturer": "AutomationDirect",
  "series": "DURApulse GS10",
  "aliases": ["GS10", "DURApulse", "GS-10"]
}
```

### `nameplate`

Keywords a nameplate photo/OCR pass or free text can match to this pack —
checked by `resolve_pack` after `family.aliases`.

```json
{ "match_keywords": ["GS10", "DURAPULSE", "GS-10"] }
```

### `live_decode`

The wire-level decode tables. `status_bits`, `cmd_word`, and `fault_codes`
are JSON objects with **string** keys (JSON has no integer object keys); the
loader converts them to `int` keys on load, matching the shape of the module
dicts in `mira-bots/shared/live_snapshot.py` (`_STATUS_BITS`, `_CMD_WORD`,
`_FAULT_CODES`) — this is the anti-drift contract the loader's tests assert.

```json
{
  "status_bits": { "0": "STOPPED", "1": "DECEL", "2": "STANDBY", "3": "RUNNING" },
  "cmd_word":    { "1": "STOP", "18": "FWD+RUN", "20": "REV+RUN" },
  "fault_codes": { "0": "no active fault", "4": "GFF ground fault", "...": "..." },
  "registers": {
    "vfd_dc_bus": { "addr": null, "unit": "V", "scaling": 0.1, "datapoint": "dc_bus" }
  }
}
```

`registers` maps an analog tag's short key (the raw-tag dict key seen on the
wire, e.g. `vfd_dc_bus`) to its decode:

| Field | Type | Notes |
|---|---|---|
| `addr` | `int \| null` | Modbus/EtherNet-IP register address. `null` when not yet documented — never a guess. |
| `unit` | `string \| null` | Engineering unit (`"V"`, `"A"`, `"Hz"`). |
| `scaling` | `float` | Multiplier: `engineering_value = raw_value * scaling`. |
| `datapoint` | `string` | Human-readable datapoint name. |

### `envelope`

The expected operating band for each analog signal — closes the
`tag_entities.expected_envelope` gap described in ADR-0025. Any field may be
`null` when the value isn't yet known from a manual or the bench; **`null`
means unknown, never a guessed number.**

```json
{
  "dc_bus":    { "nominal": 320.0, "min": 300.0, "max": 340.0, "unit": "V" },
  "current":   { "rated": null, "unit": "A" },
  "frequency": { "min": 0.0, "max": 60.0, "unit": "Hz" }
}
```

### `knowledge`

ID pointers into the **existing** KB/KG stores. This is the seam a later
task fills once the family's `component_templates` row and KB document ids
are known — v1 packs ship this empty/`null`, not fabricated.

```json
{ "kb_document_ids": [], "component_template_id": null, "kg_entity_ids": [] }
```

### `provenance`

Per-item provenance tier plus the sources it's based on. `items` maps a
dotted field path (e.g. `"live_decode.fault_codes"`) to exactly one of:

- **`bench_verified`** — measured/confirmed on physical hardware (e.g. the
  GS10 idle DC-bus baseline, bench-decoded status/command words).
- **`manual_cited`** — taken from a manufacturer manual/datasheet, not
  independently bench-verified.

Never say bare `"verified"` — that word is reserved for
`kg_*.approval_state` (ADR-0017) and means something different (admin
sign-off on a knowledge-graph edge, not "this pack field is trustworthy").

```json
{
  "items": {
    "live_decode.status_bits": "bench_verified",
    "live_decode.fault_codes": "manual_cited",
    "envelope.dc_bus": "bench_verified"
  },
  "sources": [ { "doc": "GS10 User Manual", "page": "", "excerpt": "" } ]
}
```

## Loader contract (`mira-bots/shared/drive_packs/`)

Pure Python, no network/DB/fieldbus I/O — the only file access is reading
`packs/<pack_id>/pack.json` off disk.

- `load_pack(pack_id: str) -> DrivePack` — reads and validates one pack.
  Raises `FileNotFoundError` if the pack doesn't exist, `ValueError` on a
  structurally invalid pack (missing keys, bad JSON, an invalid provenance
  value, or a `pack_id` mismatch between the directory and the file).
- `list_packs() -> list[str]` — discovers every `<family_id>` under `packs/`
  that has a `pack.json`.
- `resolve_pack(text: str) -> DrivePack | None` — case-insensitive match of
  `text` against each pack's `family.aliases` first, then
  `nameplate.match_keywords`. Returns the first match, or `None`.

## Reuse KB/KG, don't re-hold — the rule

If you're tempted to paste manual text, a fault-code table's prose
explanation, or a troubleshooting procedure into `pack.json`: don't. That
content lives in `knowledge_entries` (the manual, chunked + citable) and
`component_templates` / `component_template_sources` (the extracted
intelligence — failure modes, troubleshooting steps, citations). The pack's
`knowledge.*` fields are **pointers** into those stores. A pack that
duplicates KB/KG content instead of pointing at it is a defect — it creates
a second, driftable copy of the same fact.
