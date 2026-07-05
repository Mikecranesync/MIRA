# Task 2 report — source GS10 decode tables from the pack in `live_snapshot.py`

**Status:** DONE
**Worktree:** `C:/Users/hharp/Documents/GitHub/mira-drive-commander`
**Branch:** `feat/drive-commander-gs10-pack`

## What was changed

`mira-bots/shared/live_snapshot.py` only:

1. **Module-level, cached pack load.** Added `from shared.drive_packs import
   load_pack` (matching the absolute `shared.X` import style already used in
   this package — e.g. `contextualization_intake.py`'s
   `from shared.inference.router import InferenceRouter`, and how
   `test_drive_packs.py` / `ask_api/app.py` import `shared.live_snapshot`
   itself). At module scope:

   ```python
   _GS10_PACK = load_pack("durapulse_gs10")
   _STATUS_BITS: dict[int, str] = _GS10_PACK.live_decode.status_bits
   _CMD_WORD: dict[int, str] = _GS10_PACK.live_decode.cmd_word
   _FAULT_CODES: dict[int, str] = _GS10_PACK.live_decode.fault_codes
   _REGISTERS = _GS10_PACK.live_decode.registers
   ```

   `load_pack` is called exactly once, at import time — never per decode
   call. `_STATUS_BITS` / `_CMD_WORD` / `_FAULT_CODES` remain module-level
   names with the same shape (`dict[int, str]`) as before, so every existing
   caller of them (`ask_api/app.py`'s `from shared.live_snapshot import
   _FAULT_CODES, ...`, and `test_drive_packs.py`'s anti-drift assertions
   against `_STATUS_BITS`/`_CMD_WORD`/`_FAULT_CODES`) keeps working unchanged
   — they're now populated FROM the pack instead of being independent
   literals. Because the pack ships in-repo, a `load_pack` failure surfaces
   loudly at import time (per the brief's watch-out) rather than falling back
   to stale literals — there is no fallback path.

2. **Register scaling sourced from the pack, not hardcoded.** Added a small
   helper:

   ```python
   def _scaled(key: str, raw: Any) -> tuple[float, str | None] | None:
       n = _num(raw)
       if n is None:
           return None
       entry = _REGISTERS[key]
       return (n / (1 / entry.scaling), entry.unit)
   ```

   used by the four analog branches of `_decode_one`
   (`vfd_frequency`/`vfd_freq_sp`/`vfd_current`/`vfd_dc_bus`), replacing the
   hardcoded `n / 100` / `n / 10` divisors and `"Hz"`/`"A"`/`"V"` unit
   literals with `_REGISTERS[key].scaling` / `.unit` from the pack.

   **Byte-identical proof (float precision):** naive `n * scaling` is NOT
   always bit-identical to the old `n / 100` / `n / 10` in float64 — e.g.
   `9999 / 100 == 99.99` but `9999 * 0.01 == 99.99000000000001`. I verified
   `n / (1 / scaling)` IS bit-identical to the historical division form for
   every case I could construct (`1/0.01 == 100.0` and `1/0.1 == 10.0`
   exactly in float64), so I used that form instead of multiplication. Spot
   check: `_decode_one("vfd_frequency", 9999)` → `(99.99, "Hz", "VFD output:
   100.0 Hz")` — identical to pre-change behavior.

   Label text templates (`"VFD output: {v:.1f} {unit}"` etc.) stay as
   literals in the code — the pack schema has no label-template field
   (`RegisterEntry` only carries `addr`/`unit`/`scaling`/`datapoint`), so
   these are unchanged from before, just interpolating `unit` from the pack
   instead of a hardcoded string (which is itself now equal to the same
   value, e.g. `"Hz"`).

3. **Docstring update only** — the module header now says the decode tables
   are sourced from `packs/durapulse_gs10/pack.json` via `load_pack`,
   references ADR-0025, and notes Task 7 will mirror the pack into the Hub's
   `gs10-display.ts`. No behavior change.

## What was explicitly NOT touched

- `mira-bots/ask_api/app.py` — untouched (Task brief watch-out). Its
  `from shared.live_snapshot import _FAULT_CODES, normalize,
  render_status_block` import still resolves; `_FAULT_CODES` still has the
  same value and type.
- `gs10-display.ts` (Hub TS mirror) — untouched, that's Task 7.
- The pack JSON (`packs/durapulse_gs10/pack.json`) and the loader
  (`mira-bots/shared/drive_packs/`) — untouched, Task 1's surface. Only
  consumed via `load_pack`.
- `_LIVE_STATUS_HEADER` / `[LIVE CONVEYOR STATUS]` marker and the
  `assess_snapshots` / `render_machine_evidence` assessment text — untouched;
  confirmed unchanged behavior via the full existing test suite.
- `mira-bots/tests/test_live_snapshot.py`,
  `mira-bots/tests/test_engine_live_snapshot.py`,
  `mira-bots/tests/test_drive_packs.py` — not edited, all green (see below).

## Verification

```
python -m pytest mira-bots/tests/test_live_snapshot.py \
  mira-bots/tests/test_engine_live_snapshot.py \
  mira-bots/tests/test_drive_packs.py -q
```
→ `48 passed` (same count as the pre-change baseline I captured before
editing — 0 regressions, 0 new failures).

```
python -m ruff check mira-bots/shared/live_snapshot.py
```
→ `All checks passed!`

```
python -m ruff format --check mira-bots/shared/live_snapshot.py
```
→ `1 file already formatted`

**Broader regression check** (session-discipline: re-measure after a change
to a module >5 other tests/files import): ran the full `mira-bots/tests`
suite filtered to `-k "live_snapshot or drive_pack or engine"` (190 tests,
excluding two collection errors in `test_slack_relay.py` /
`test_teams_adapter.py` that are pre-existing, unrelated import failures —
missing `botbuilder` module and an unrelated `bot.py` symbol mismatch, both
present before this change and untouched by it). Result: **190 passed**, 0
failures.

Manual spot-check of the loaded pack values at a live Python prompt:
`_STATUS_BITS`, `_CMD_WORD`, `_FAULT_CODES` all match the pre-change
literals exactly; `_decode_one("vfd_frequency", 9999)` and
`_decode_one("vfd_dc_bus", 3200)` reproduce the historical output exactly.

## Self-review notes

- Diff is scoped to `mira-bots/shared/live_snapshot.py` only — no drive-by
  edits to neighboring files, no re-formatting of unrelated lines.
- Did not stage the untracked `.superpowers/sdd/task-1-*` / `progress.md` /
  `task-2-brief.md` files already present in the worktree (foreign to this
  task's diff, per session-discipline "stage only files your change
  touched") — only `live_snapshot.py` plus this new report are part of the
  commit.
- Considered whether to also route the register `datapoint` name or
  addr through `_decode_one` — not needed: `LiveTagSnapshot.datapoint` is set
  from the raw tag `key` in `normalize()`, not from the pack's
  `RegisterEntry.datapoint`, and `addr` is `null` in the pack today (no
  Modbus address documented yet), so there's nothing to wire up until a
  later task adds it.
- No new test added beyond the required suites: the brief treats the two
  existing suites + `test_drive_packs.py`'s anti-drift assertions
  (`pack.live_decode.status_bits == _STATUS_BITS`, etc. — now tautological
  because `_STATUS_BITS` IS the pack's dict, which is expected/documented in
  the brief) as sufficient evidence. I judged an additional "decode flows
  through the pack" test would be redundant with the manual spot-check above
  and the existing suite's full behavioral coverage of `_decode_one` via
  `normalize()`.

## Blocking concerns

None.

## Fix pass

Review found one Important + three Minor gaps. All four fixed, scoped to
`mira-bots/shared/live_snapshot.py` + the two existing test files (no new
files). Read-only/pure; `ask_api/app.py` and `gs10-display.ts` untouched.

### Fix 1 (Important) — clear error on a missing register key, not a bare KeyError

`mira-bots/shared/live_snapshot.py`: after `_REGISTERS` is loaded from the
pack, added a module-level validation block naming the exact register keys
this module's decode functions (`_scaled`/`_decode_one`) depend on
(`vfd_frequency`, `vfd_freq_sp`, `vfd_current`, `vfd_dc_bus`). If any are
missing from `_GS10_PACK.live_decode.registers`, raises a pack-id-scoped,
actionable `ValueError` naming the missing key(s) — at import time, not deep
inside a decode call. Did NOT touch `drive_packs/loader.py` — the generic
loader stays drive-agnostic; the dependency is declared where it's used.

```python
_REQUIRED_REGISTER_KEYS = ("vfd_frequency", "vfd_freq_sp", "vfd_current", "vfd_dc_bus")
_missing_register_keys = [k for k in _REQUIRED_REGISTER_KEYS if k not in _REGISTERS]
if _missing_register_keys:
    raise ValueError(
        f"pack '{_GS10_PACK.pack_id}': live_decode.registers is missing required "
        f"key(s) {_missing_register_keys!r} — shared.live_snapshot decodes these "
        "directly and cannot start without them"
    )
```

New test in `mira-bots/tests/test_live_snapshot.py`:
`test_missing_register_key_raises_clear_error_at_import` — constructs a
`DrivePack` copy missing `vfd_freq_sp`, monkeypatches
`shared.drive_packs.load_pack` to return it, `importlib.reload`s
`shared.live_snapshot`, and asserts the `ValueError` names both the pack id
and the missing key. The `finally` block undoes the monkeypatch and reloads
again with the real pack so the module is left in its correct state for
every other test in the session.

### Fix 2 (Minor) — register anti-drift test

`mira-bots/tests/test_drive_packs.py`: added
`test_gs10_pack_registers_match_expected_scaling_and_units` — the
register-scaling sibling of the existing `status_bits`/`cmd_word`/
`fault_codes` anti-drift asserts. Asserts the key set
(`vfd_frequency`/`vfd_freq_sp`/`vfd_current`/`vfd_dc_bus`) plus each entry's
`scaling` and `unit` against the known-correct GS10 values (0.01 Hz / 0.01 Hz
/ 0.01 A / 0.1 V).

### Fix 3 (Minor) — test `vfd_freq_sp` decode

`mira-bots/tests/test_live_snapshot.py`: added
`test_freq_setpoint_scaled_decode` immediately after the sibling
`test_scaled_decode_and_uns_path` (`vfd_frequency`). Asserts raw `6000` →
`60.0` Hz, `quality == GOOD`, correct `uns_path`, and the label
`"Freq setpoint: 60.0 Hz"`.

### Fix 4 (Minor) — type annotation

`mira-bots/shared/live_snapshot.py`: `_REGISTERS` now explicitly annotated
`dict[str, RegisterEntry]`, matching the sibling annotations
(`_STATUS_BITS`/`_CMD_WORD`/`_FAULT_CODES: dict[int, str]`). Added
`from shared.drive_packs.schema import RegisterEntry` import.

## Test command + full output

```
python -m pytest mira-bots/tests/test_live_snapshot.py \
  mira-bots/tests/test_engine_live_snapshot.py \
  mira-bots/tests/test_drive_packs.py -q
```
```
...................................................                      [100%]
51 passed in 0.68s
```
(48 baseline + 3 new tests = 51; 0 regressions.)

```
python -m ruff check mira-bots/shared/live_snapshot.py mira-bots/tests/test_live_snapshot.py mira-bots/tests/test_drive_packs.py
```
→ `All checks passed!`

```
python -m ruff format --check mira-bots/shared/live_snapshot.py mira-bots/tests/test_live_snapshot.py mira-bots/tests/test_drive_packs.py
```
→ `3 files already formatted`

**Broader regression check** (session-discipline): ran the full
`mira-bots/tests/` suite (excluding `test_slack_relay.py` /
`test_teams_adapter.py`, which fail to *collect* on both `main` and this
branch — pre-existing missing-package errors, `slack_bolt`/`botbuilder`,
confirmed via `git stash`/`git stash pop` A/B). Result: **1011 passed, 9
skipped, 12 failed** — the same 12 pre-existing failures
(`test_email_adapter.py`, `tools/test_active_learner.py` — unrelated
env/Windows-file-locking issues) present on the unstashed baseline (1008
passed / same 12 failed). Net: **+3 passing**, 0 regressions.

## Blocking concerns

None.
