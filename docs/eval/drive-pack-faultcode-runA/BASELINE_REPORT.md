# Run A — Frozen G+ Mini fault-code baseline

**Status:** FROZEN, immutable. Do not edit, overwrite, or re-run in place. A new
observation goes in a new dated directory, never here.
**Subject:** IMPULSE G+ Mini — a Magnetek/Columbus-McKinnon crane/hoist VFD whose
fault codes are **mnemonic alphanumerics** (`oC`, `oV`, `GF`, `BE2`, `LL1`, …),
not integer enums.
**Constraint honored:** the schema was **not** repaired, **no** fallback was
added, extraction was **not** improved before this capture (per the freeze
order). Read-only execution; the harness writes only into this directory.
**Commit / env:** see `env.json`. **Metrics:** see `metrics.json`. **Hashes:**
see `MANIFEST.json` / `MANIFEST.md`. **Execution log:** see `run.log`.

---

## Headline

Under the current production schema and loader, the G+ Mini fault-code pack is
**empty — 0% coverage — and that is the correct, honest result.** It is empty for
**two independent reasons**, which this baseline deliberately keeps separate:

1. **Data-availability floor.** There is **no G+ Mini source material** anywhere
   in the repo or on the build host (no manual, candidate, gold set, or registry
   entry; Magnetek is not even a recognized vendor). Nothing to extract. Full
   evidence table: `raw_inputs/NO_SOURCE_MATERIAL.md`.
2. **Schema-representation floor.** Even *with* source, the schema field
   `live_decode.fault_codes: dict[int, str]` (`schema.py:56`) plus the loader
   gate `loader.py::_int_keyed` (`loader.py:73-88`, invoked at `loader.py:275`)
   **cannot represent a mnemonic identifier and hard-rejects it** with a
   deterministic `ValueError`. A source-preserving G+ Mini pack does not load
   *near-empty* — it **fails to load entirely**.

Both were exercised against the **real production modules** (imported, not
reconstructed) by `run_a_freeze.py`.

## What the harness observed (three scenarios)

| Scenario | What it exercised | Result |
|---|---|---|
| **S1** data-availability | `loader.resolve_pack()` for three G+ Mini identity strings, over the shipped packs `['durapulse_gs10','powerflex_40','powerflex_525']` | `None` for all three — G+ Mini matches no pack |
| **S2** schema gate (field) | real `loader._int_keyed()` on the probe's mnemonic `fault_codes` | `ValueError: … non-numeric key 'oC' in live_decode.fault_codes — wire enum tables must be int-keyed` |
| **S3** schema gate (whole pack) | real `loader._parse_pack()` on the full probe pack | same `ValueError` — the pack fails to load **entirely** (fault_codes is validated at load time) |

## The abstraction leak (documented, per the freeze order)

The int-keyed schema is **already leaky for a drive it "supports."** The shipped
GS10 pack stores mnemonic identity **inside the description string, under an
integer key**:

```
"21": "oL overload"          # mnemonic 'oL' embedded in the value
"58": "CE10 modbus timeout"  # mnemonic 'CE10' embedded in the value
"4":  "GFF ground fault"
"12": "Lvd undervoltage"
```

So even today, the mnemonic identity has **no first-class field** — it is free
text smuggled into the human-readable string. `dict[int, str]` cannot key on it,
cannot index it, cannot cite it as an identifier. For GS10 this is survivable
because GS10 *also* exposes an integer fault register; for a purely-mnemonic
drive like G+ Mini it is fatal. This is the strongest single piece of evidence
for the eventual Run-C direction (a source-preserved string identifier), and it
is why the empty G+ Mini pack is the **honest deterministic result, not a bug to
paper over**.

## Compatibility-sensitive readers (any future schema change must preserve these)

Five locations consume `live_decode.fault_codes` (or the numeric fault-code
assumption) and gate any schema evolution:

1. `mira-bots/shared/live_snapshot.py:48` — `_FAULT_CODES: dict[int,str] = _GS10_PACK.live_decode.fault_codes` (encodes the int-register assumption hardest).
2. `mira-bots/shared/drive_packs/loader.py:275` — `_int_keyed` gate; **this is the code that produces this floor**.
3. `mira-bots/shared/drive_packs/cards.py:89` — provenance read for `live_decode.fault_codes`.
4. `mira-bots/shared/drive_packs/cards.py:93` — `for code, name in pack.live_decode.fault_codes.items()` (int iteration).
5. `mira-bots/shared/drive_packs/template_reader.py` — numeric fault-code keying; **mirrors `docs/migrations/002_fault_codes.sql`** (sleeper: a string identifier needs a DB-migration story there too — verify the Neon column type before Run C).

## Honest Run-A floor (do not massage)

| Metric | Value |
|---|---|
| G+ Mini source material present | **False** |
| G+ Mini resolves to a pack | **False** |
| Deterministic resolution | **0.0%** |
| Fallback | **0.0%** (no fallback exists in Run A) |
| Unresolved | **100.0%** (12/12 probe tokens) |
| Raw mnemonic tokens captured by schema | **0** |
| G+ Mini pack coverage | **0.0%** |
| Hard failures (unsafe guesses) | **0** — Run A emits no answer, so it is never confidently wrong |
| Citation accuracy | N/A (no answers emitted) |
| Latency / token cost | N/A / 0 (no model calls) |

**Safety note:** Run A's "0 hard failures" is the safety bar Run B must clear.
Run A resolves nothing and therefore never guesses a crane/hoist fault meaning.
Any Run B that introduces a fallback must be **provably no-less-safe**: it must
never turn an honest refusal into a confidently-wrong crane fault decode.

## Provenance / integrity

- The only test input, `raw_inputs/gplus_mini_faultcodes_synthetic_probe.json`,
  is a **clearly-labeled synthetic probe** exercising the loader's key-type
  contract. No real manual content was fabricated (there was none to begin with,
  and inventing one would defeat the purpose of this baseline).
- Nothing here was promoted to `gold/`, added as a candidate, merged, deployed,
  or wired into any runtime path. WO-evidence behavior is untouched; no
  production flag was changed.
