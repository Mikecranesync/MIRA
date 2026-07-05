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
