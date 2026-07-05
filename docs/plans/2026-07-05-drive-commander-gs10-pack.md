# Plan — Drive Commander: GS10 gold reference pack (first build)

**Spec of record:** [ADR-0025](../adr/0025-drive-intelligence-packs-and-drive-commander.md). Read it first.
**Scope:** backend pack architecture only. NO desktop/mobile UI in this slice (stack undecided — later wave).
**Branch/worktree:** `feat/drive-commander-gs10-pack` @ `../mira-drive-commander` (off `origin/main`).
**Execution:** subagent-driven-development — sequential implementers, Sonnet, task review after each.

## Goal

Prove the engine runs **pack-driven** (not GS10-hardcoded) by extracting DURApulse GS10 into a language-neutral **drive pack**, reusing the existing manual-intelligence layers (KB/KG/`component_templates`) and adding only the live-decode + family/nameplate/cards glue. Close the `tag_entities.expected_envelope` gap as a side effect.

## Global Constraints (bind every task)

1. **Read-only, provably.** No Modbus/EtherNet-IP write function code (FC5/6/15/16) anywhere in the pack/loader surface. No socket, no fieldbus client. Data reshaping only.
2. **Reuse, don't re-hold.** Layers 1–2 (manuals, extracted intelligence) live in `knowledge_entries` / `component_templates` / `component_template_sources` / `kg_entities`. The pack **points at** them (ids), it does NOT copy their content into a parallel store.
3. **Byte-identical GS10 behavior.** Existing tests must stay green with GS10 loaded *as a pack*: `mira-bots/tests/test_live_snapshot.py`, `mira-bots/tests/test_engine_live_snapshot.py`, `mira-hub/src/lib/gs10-display.test.ts`.
4. **Pack = family-keyed, data not code.** JSON under `packs/<family_id>/`. Adding a drive = authoring JSON, not editing engine code.
5. **Provenance per-item** (`bench_verified` | `manual_cited`). Never say "verified" bare (collides with `kg_*.approval_state`).
6. **Python 3.12, ruff, httpx, existing style** (`.claude/rules/python-standards.md`). Offline-testable — no live DB/vision/network calls in unit tests; use fixtures + typed seams.
7. **TDD.** Test-first per task; a test that asserts nothing is a defect.

## Pack format (authoritative for Task 1)

Language-neutral JSON so the Python engine and TS Hub load the same file.

```
packs/
  README.md                         # schema doc
  durapulse_gs10/
    pack.json                       # the GS10 family pack
    models/                         # optional per-model override files (v1: none required)
```

`pack.json` shape:
```json
{
  "pack_id": "durapulse_gs10",
  "schema_version": 1,
  "family": {
    "manufacturer": "AutomationDirect",
    "series": "DURApulse GS10",
    "aliases": ["GS10", "DURApulse", "GS-10"]
  },
  "nameplate": { "match_keywords": ["GS10", "DURAPULSE", "GS-10"] },
  "live_decode": {
    "status_bits": { "0": "STOPPED", "1": "DECEL", "2": "STANDBY", "3": "RUNNING" },
    "cmd_word":    { "1": "STOP", "18": "FWD+RUN", "20": "REV+RUN" },
    "fault_codes": { "0": "no active fault", "4": "GFF ground fault", "...": "..." },
    "registers":   { "vfd_dc_bus": {"addr": null, "unit": "V", "scaling": 1.0, "datapoint": "dc_bus"} }
  },
  "envelope": {
    "dc_bus":    { "nominal": 320.0, "min": 300.0, "max": 340.0, "unit": "V" },
    "current":   { "rated": null, "unit": "A" },
    "frequency": { "min": 0.0, "max": 60.0, "unit": "Hz" }
  },
  "knowledge": {
    "kb_document_ids": [],
    "component_template_id": null,
    "kg_entity_ids": []
  },
  "provenance": {
    "items": {
      "live_decode.status_bits": "bench_verified",
      "live_decode.cmd_word":    "bench_verified",
      "live_decode.fault_codes": "manual_cited",
      "envelope.dc_bus":         "bench_verified"
    },
    "sources": [ { "doc": "GS10 User Manual", "page": "", "excerpt": "" } ]
  }
}
```
> Populate `live_decode.*` VERBATIM from the current `mira-bots/shared/live_snapshot.py` module dicts (`_STATUS_BITS`, `_CMD_WORD`, `_FAULT_CODES`) and its `_decode_one` register table. `envelope.dc_bus.nominal` = 320.0 (measured idle nominal, per `project_conv_simple_dc_bus_baseline`). Unknown numeric fields = `null`, not a guess. `knowledge.*` ids stay empty/nullable in v1 (filled when the GS10 `component_templates` row id is known — leave the seam).

## Loader (Python) — Task 1

`mira-bots/shared/drive_packs/` : `schema.py` (frozen dataclasses mirroring pack.json), `loader.py`:
- `load_pack(pack_id: str) -> DrivePack` — read+validate `packs/<pack_id>/pack.json`.
- `list_packs() -> list[str]`.
- `resolve_pack(text: str) -> DrivePack | None` — match `nameplate.match_keywords` / `family.aliases` against nameplate/vision text (family-first). Case-insensitive.
- Pure; only I/O is reading the JSON from the packs dir. No network, no DB.

## Tasks

### Task 1 (BARRIER — everything depends on it): pack schema + GS10 pack.json + Python loader
- Author `packs/durapulse_gs10/pack.json` (data verbatim from `live_snapshot.py` dicts + envelope). `packs/README.md` documents the schema.
- Build `mira-bots/shared/drive_packs/` (`schema.py`, `loader.py`, `__init__.py`).
- Tests (`mira-bots/tests/test_drive_packs.py`): loads GS10, schema validates, decode tables match the current `live_snapshot.py` dicts exactly, `resolve_pack("DURApulse GS10 ...")` returns the pack, `resolve_pack("PowerFlex 525")` returns None.
- **Does NOT modify `live_snapshot.py` yet.**

### Task 2: source GS10 decode from the pack in `live_snapshot.py`
- Refactor `_STATUS_BITS`/`_CMD_WORD`/`_FAULT_CODES`/register decode in `live_snapshot.py` to load from `load_pack("durapulse_gs10")` (module-level, cached) instead of literal dicts.
- **Constraint 3:** `test_live_snapshot.py` + `test_engine_live_snapshot.py` stay green, unchanged.

### Task 3: envelope-driven analog assessment (closes deferred #1)
- Add an envelope check to `assess_snapshots`/`assess_from_paths`: when an analog value (dc_bus/current/freq) is present AND the pack envelope defines a band, assess in-band/out-of-band; when the wire scaling is ambiguous (Ignition path) OR no band, stay silent (per ADR-0025 honesty rule). Populate `tag_entities.expected_envelope` conceptually from the pack (document the write seam; no live DB write in tests).
- Tests: dc_bus within/below/above band → correct assessment; missing band → no assertion.

### Task 4: nameplate → pack resolver (reuse structured-vision)
- `resolve_pack_from_vision(vision_output: dict) -> DrivePack | None` mapping the existing structured-vision shape (`{"component": "GS10 VFD", ...}` per `test_structured_vision.py`) → the GS10 pack, family-first.
- Tests with fixtures mirroring the real vision output; no live model call.

### Task 5: diagnostic cards (derived, cited view)
- `build_cards(pack, *, template_reader=None) -> list[DiagnosticCard]` producing `{fault_or_symptom, meaning, likely_causes[], first_checks[], citations[], confidence, provenance_tier}` from the pack's fault table + a **typed `template_reader` seam** for `component_templates`/KG (injected; default returns nothing so tests run offline).
- Tests: cards built from GS10 fault table carry provenance + (stub) citations; shape validated.

### Task 6: provable-read-only gate test
- `mira-bots/tests/test_drive_packs_readonly.py`: assert the `drive_packs` package + pack JSON contain no write-FC constant (5/6/15/16 as Modbus write), no `pymodbus`/`pycomm3`/socket import, no write path. Fail loud if a future edit introduces one. The Drive Commander shipping gate.

### Task 7: TS mirror (Hub)
- `mira-hub/src/lib/drive-packs/` loads the same `packs/durapulse_gs10/pack.json`; refactor `gs10-display.ts` to source decode from the pack.
- **Constraint 3:** `gs10-display.test.ts` stays green.

## Done = whole-branch review clean + all constraints held + all existing GS10 tests green with GS10 loaded as a pack.
