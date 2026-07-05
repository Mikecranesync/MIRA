# Task 1 report — pack schema + GS10 pack.json + Python loader

**Status:** DONE
**Commit:** `c1e624ca64c5d32e12b6265e46580448052f594b` on `feat/drive-commander-gs10-pack`
**Worktree:** `C:/Users/hharp/Documents/GitHub/mira-drive-commander`

## What was built

1. **`packs/durapulse_gs10/pack.json`** — the DURApulse GS10 family pack.
   - `live_decode.status_bits` / `cmd_word` / `fault_codes` are copied
     **verbatim** (values, not re-derived) from `mira-bots/shared/live_snapshot.py`'s
     `_STATUS_BITS` / `_CMD_WORD` / `_FAULT_CODES` module dicts.
   - `live_decode.registers` encodes the four analog decode formulas from
     `_decode_one` (`vfd_frequency`, `vfd_freq_sp`, `vfd_current`, `vfd_dc_bus`),
     expressed as `scaling` multipliers (`n/100` → `scaling: 0.01`, `n/10` →
     `scaling: 0.1`) plus unit + datapoint name. `addr` (the actual Modbus
     register address) is `null` for all four — `live_snapshot.py` only encodes
     the scaling formula keyed by tag name, never a register address, so `null`
     is the honest value, not a guess.
   - `envelope.dc_bus` = `{nominal: 320.0, min: 300.0, max: 340.0, unit: "V"}`
     per the brief and the bench baseline
     (`project_conv_simple_dc_bus_baseline` memory). `envelope.current.rated`
     is `null` (no source yet). `envelope.frequency` = `{min: 0.0, max: 60.0,
     unit: "Hz"}` per the brief.
   - `knowledge.*` (`kb_document_ids`, `component_template_id`,
     `kg_entity_ids`) is empty/`null` — the seam a later task fills once the
     GS10 `component_templates` row and KB doc ids are known. No content
     copied in from KB/KG (reuse, don't re-hold).
   - `provenance.items` covers `live_decode.status_bits` (bench_verified),
     `live_decode.cmd_word` (bench_verified), `live_decode.fault_codes`
     (manual_cited), `live_decode.registers` (bench_verified — I added this
     one beyond the brief's example set since the registers section is new
     data introduced by this task), `envelope.dc_bus` (bench_verified). One
     placeholder source entry (`GS10 User Manual`, page/excerpt blank —
     filling real page/excerpt is future ingestion work, not this task).

2. **`packs/README.md`** — full field-by-field schema doc: layout
   (`packs/<family_id>/pack.json` + optional `models/`), every top-level
   field with type/required/notes, the `registers` sub-schema, the
   provenance vocabulary (`bench_verified` | `manual_cited`, explicitly
   never bare `"verified"` — that word means something different on
   `kg_*.approval_state` per ADR-0017), and a "reuse KB/KG, don't re-hold"
   section spelling out that pasting manual text or extracted intelligence
   into `pack.json` is a defect.

3. **`mira-bots/shared/drive_packs/`** — pure Python loader.
   - `schema.py`: frozen dataclasses (`Family`, `Nameplate`, `RegisterEntry`,
     `LiveDecode`, `EnvelopeBand`, `Envelope`, `Knowledge`, `Provenance`,
     `DrivePack`), Python 3.12 typing (`str | None`, `list[str]`,
     `dict[int, str]`), `from __future__ import annotations`.
   - `loader.py`:
     - `load_pack(pack_id) -> DrivePack` — reads + validates
       `packs/<pack_id>/pack.json`. Raises `FileNotFoundError` if the pack
       doesn't exist; `ValueError` on invalid JSON, missing required
       top-level keys, an out-of-vocabulary provenance value, or a
       `pack_id` mismatch between the directory and the file's own
       `pack_id` field. Converts the JSON string-keyed `status_bits` /
       `cmd_word` / `fault_codes` objects to `int`-keyed dicts (JSON has no
       integer object keys; `live_snapshot.py`'s dicts are int-keyed) —
       this is what makes the anti-drift equality assertion meaningful.
     - `list_packs() -> list[str]` — discovers every subdirectory of
       `packs/` that contains a `pack.json`.
     - `resolve_pack(text) -> DrivePack | None` — case-insensitive
       substring match of `text` against each pack's `family.aliases`
       first, then `nameplate.match_keywords` (family-first per ADR-0025
       §1a); returns the first match or `None`.
     - `_packs_dir()` locates `packs/` by walking up from `Path(__file__)`
       (no hardcoded absolute path) — resolves correctly to the repo root
       regardless of checkout location.
     - Pure: the only I/O is `Path.read_text()` / `Path.iterdir()` on the
       local `packs/` tree. No network, no DB, no socket, no fieldbus
       client import, no write path anywhere in the module.
   - `__init__.py`: exports the public API (`load_pack`, `list_packs`,
     `resolve_pack` + all dataclasses).

4. **`mira-bots/tests/test_drive_packs.py`** — 14 tests, written first
   (confirmed red before implementation — `ImportError: cannot import name
   'DrivePack'`), then green after implementation:
   - `load_pack("durapulse_gs10")` succeeds, returns a `DrivePack`, has the
     right `pack_id`/`schema_version`.
   - **Anti-drift guard**: `pack.live_decode.status_bits == _STATUS_BITS`,
     `.cmd_word == _CMD_WORD`, `.fault_codes == _FAULT_CODES` — imported
     directly from `live_snapshot.py` and asserted for exact equality (not
     just presence).
   - `envelope.dc_bus` nominal/min/max match the brief's values.
   - `envelope.current.rated is None` (unknown fields stay `null`, not a
     guess).
   - `provenance.items` is non-empty and every value is in
     `{bench_verified, manual_cited}`.
   - `knowledge.*` fields are all empty/`None` (v1 seam).
   - `load_pack("no_such_pack_xyz")` raises `FileNotFoundError`.
   - `list_packs()` includes `"durapulse_gs10"`.
   - `resolve_pack(...)` matches on a family alias, matches on a nameplate
     keyword, returns `None` for `"PowerFlex 525"`, returns `None` for
     empty text.

## Decisions worth flagging

- **`registers` provenance**: the brief's example `provenance.items` list
  didn't include `live_decode.registers`; I added it (`bench_verified`)
  since the registers table is new data this task introduces (not present
  in the brief's literal example) and every other `live_decode.*` section
  has a provenance entry. If the reviewer wants `registers` provenance
  omitted or scoped differently, that's a one-line pack.json edit.
- **Register `addr: null` for all four analog tags**: `live_snapshot.py`
  never encodes a Modbus register address — only a tag-name-keyed scaling
  formula. I did not invent addresses. This is called out explicitly in the
  pack's own README section and in the schema docstring for `RegisterEntry`.
- **`resolve_pack` family-first tie-break**: with only one pack in v1 this
  never actually branches, but I implemented literal family-alias-then-
  nameplate-keyword ordering (not just a merged keyword set) so the
  "family-first" behavior described in ADR-0025 §1a is real once a second
  pack (e.g. PowerFlex 525) exists and keyword sets could otherwise
  collide.
- Did **not** touch `live_snapshot.py` — confirmed by `git status`/diff
  showing only new files.

## Verification run

```
$ cd mira-bots && python -m pytest tests/test_drive_packs.py -q
14 passed in 0.10s

$ python -m pytest tests/test_live_snapshot.py tests/test_engine_live_snapshot.py tests/test_drive_packs.py -q
46 passed in 1.70s

$ python -m ruff check mira-bots/shared/drive_packs/ mira-bots/tests/test_drive_packs.py
All checks passed!

$ python -m ruff format --check mira-bots/shared/drive_packs/ mira-bots/tests/test_drive_packs.py
4 files already formatted
```

(`ruff` wasn't on `PATH` directly in this git-bash session; `python -m ruff`
resolved it fine.)

## Self-review notes

- Diff is scoped to exactly the 6 new files (`packs/README.md`,
  `packs/durapulse_gs10/pack.json`, `mira-bots/shared/drive_packs/{__init__,loader,schema}.py`,
  `mira-bots/tests/test_drive_packs.py`) — nothing else staged or touched.
  `.superpowers/` (brief + progress tracking) was left untouched/uncommitted
  as pre-existing orchestration scaffolding, not part of this task's
  deliverable.
- No write-capable code anywhere (no Modbus/EtherNet-IP client import, no
  write function codes, no socket) — Task 6's provable-read-only gate test
  will have nothing to catch in this module, but I didn't add that test
  here since it's explicitly Task 6's scope.
- Followed the repo's existing test-file convention
  (`sys.path.insert` + `from shared.X import ...`, matching
  `test_engine_live_snapshot.py`) rather than inventing a new import style.

## Blocking concerns

None. Task 1 is complete and the pack/loader contract is ready for Task 2
(sourcing `live_snapshot.py`'s decode tables from `load_pack("durapulse_gs10")`).

## Fix pass

Review found two issues in `mira-bots/shared/drive_packs/loader.py`; both fixed.

### Fix 1 (Important) — `resolve_pack` is now a true two-pass "family-first" match across ALL packs

**Bug:** the old loop checked each pack's `family.aliases` then its own
`nameplate.match_keywords` before moving to the next pack. Once a second pack
existed, an earlier-listed pack's nameplate-keyword match could win over a
later-listed pack's family-alias match — violating the documented
"family-first" precedence (README / ADR-0025 §1a). With only the GS10 pack in
the repo this never actually manifested, which is why it slipped through in
the original pass.

**Fix:** `resolve_pack` now loads every pack once, then runs two full passes:
first every pack's `family.aliases`, and only if none of those match, a
second pass over every pack's `nameplate.match_keywords`. A family-alias match
on any pack always wins over a nameplate-keyword match on any other pack,
independent of `list_packs()` ordering. Case-insensitivity, return type
(`DrivePack | None`), and single-pack behavior are all unchanged — the 12
pre-existing `resolve_pack`-touching tests still pass unmodified.

**New test** —
`test_resolve_pack_family_alias_beats_other_packs_nameplate_keyword_regardless_of_order`:
builds two minimal synthetic `DrivePack`s via a new `_minimal_pack()` helper
(no disk I/O) — `pack_a` has `"widget"` only as a nameplate keyword, `pack_b`
has `"widget"` as a family alias. Monkeypatches
`shared.drive_packs.loader.list_packs` / `.load_pack` to serve these two packs
in **both** orders (`["pack_a", "pack_b"]` then `["pack_b", "pack_a"]`) and
asserts `resolve_pack("the widget drive is faulted")` returns `pack_b` (the
family-alias match) in both cases — proving the precedence holds regardless
of iteration order, not just for the one order that happened to work before.

### Fix 2 (Minor) — `_int_keyed` now raises a pack-id-scoped, actionable error

**Bug:** `_int_keyed` did `{int(k): v for k, v in raw.items()}` with no
error handling. A pack shipping a non-numeric key in `status_bits` /
`cmd_word` / `fault_codes` (e.g. a typo'd JSON key) raised a bare
`ValueError: invalid literal for int() with base 10: '...'` with no pack id
and no field name — useless for a pack author debugging their `pack.json`.

**Fix:** `_int_keyed` now takes keyword-only `pack_id` and `field_name`
(the three `load_pack` call sites pass `"status_bits"` / `"cmd_word"` /
`"fault_codes"` respectively), iterates explicitly, and on a conversion
failure raises `ValueError(f"pack '{pack_id}': non-numeric key {key!r} in "
f"live_decode.{field_name} — wire enum tables must be int-keyed")` chained
from the original exception (`from exc`) — matching the existing
`pack '{pack_id}': ...` message style used elsewhere in `load_pack`
(missing-key / bad-JSON / invalid-provenance errors).

**New test** —
`test_load_pack_non_numeric_live_decode_key_raises_actionable_pack_scoped_error`:
writes a synthetic `bogus_pack/pack.json` to `tmp_path` with
`status_bits: {"not_a_number": "RUNNING"}`, monkeypatches
`shared.drive_packs.loader._packs_dir` to point at `tmp_path`, and asserts
`load_pack("bogus_pack")` raises `ValueError` matching
`r"pack 'bogus_pack'.*not_a_number.*status_bits"`.

### Verification run

```
$ cd C:/Users/hharp/Documents/GitHub/mira-drive-commander
$ python -m pytest mira-bots/tests/test_drive_packs.py -q
................                                                         [100%]
16 passed in 0.12s

$ python -m ruff check mira-bots/shared/drive_packs/ mira-bots/tests/test_drive_packs.py
All checks passed!

$ python -m ruff format --check mira-bots/shared/drive_packs/ mira-bots/tests/test_drive_packs.py
4 files already formatted
```

(`ruff` isn't directly on `PATH` in this git-bash session; `python -m ruff`
resolved it, same as the original pass.)

### Scope discipline

Only `mira-bots/shared/drive_packs/loader.py` and
`mira-bots/tests/test_drive_packs.py` were touched. `live_snapshot.py` was
not opened or modified. No socket/network/fieldbus code added — `_int_keyed`
and `resolve_pack` remain pure in-memory/JSON-file operations. All 14
pre-existing tests plus the 2 new tests pass (16 total, up from 14).

### Blocking concerns

None. Both review findings are fixed, tested, and green.
