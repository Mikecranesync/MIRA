# Ignition Scaling Contract (Drive Commander follow-up #2)

**Status:** shipped v3.70.0 (2026-07-05). **Spec of record:** [ADR-0025](../adr/0025-drive-intelligence-packs-and-drive-commander.md) §4.

## The problem this closed

Envelope-driven analog assessment already shipped on the **engine snapshot path**
(`live_snapshot.assess_snapshots`, v3.65.0): it compares already-decoded,
engineering-unit values against the GS10 pack `envelope` (e.g. DC bus 300–340 V).

The **Ignition wire path** (`assess_from_paths`) deliberately abstained on analog:
a wire value `vfd_dc_bus = 3200` is ambiguous — raw register (×0.1 → 320 V) or
already 320 V? The pack knows the *register* scaling but not whether a given
customer's Ignition tag is pre-scaled. Guessing risks a 10×/100×-wrong number and
a false undervoltage alarm ("confidently wrong is worse than no answer").

## The contract

Analog is assessed on the Ignition path **only when the tag carries an explicit,
verified scaling mode** — the contract removes the guess rather than making one.

- **`mira-bots/shared/wire_scaling.py`** (pure, no I/O) — `TagScaling{mode, scale,
  unit, source}`, `mode ∈ {raw_register, engineering_value, unknown}`.
  `to_engineering(raw, scaling)` converts only when explicit; `unknown`/missing/
  un-coercible → `None` (abstain). A `raw_register` tag with no `scale` inherits
  the pack's trusted register scaling.
- **`live_snapshot.assess_analog_from_paths(path_values, scaling_by_path)`** — a
  separate, opt-in function beside `assess_from_paths` (the enum/bool boundary is
  untouched — analog leaves are still not in the assessable sets). Reuses the pack
  envelope via `_analog_band_status`. Renders a self-explaining card:

  ```
  DC bus: 320 V
  Source value: 3200
  Scaling: raw register ×0.1 (approved tag mapping)
  Normal band: 300–340 V
  Assessment: normal
  ```

  A tag with explicit scaling but no full pack band (e.g. `current`) stays silent.
- **`mira-pipeline/ignition_chat.py`** — the existing verified-`tag_entities`
  enrichment SELECT now also reads `scaling` (a read; no new write path); the
  endpoint builds `{path → TagScaling}` from `tag_entities.scaling` and appends
  the card(s). Unknown/missing scaling → no card → prior display-only behavior.

## Stored shape

`tag_entities.scaling` (JSONB, migration 025 — column already existed, unused)
holds the contract verbatim: `{"mode": "raw_register", "scale": 0.1}`. A `NULL`/
mode-less value reads as `unknown` (honest abstention). `tag_entities.units`
supplies the display unit.

## Deferred (out of this PR)

- **Populate** `tag_entities.scaling`/`expected_envelope`/`units` for real tenants
  (the pack→DB activation path, ADR-0025 §First-build step 2). Until then the
  capability is proven by fixtures/route tests; live bench activation needs a seed.
- Hub TS mirror of the scaling contract (the Hub live path does no envelope
  assessment today).
- Component-template citation pointers on the analog card; per-component UNS
  granularity.
