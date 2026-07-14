# Run C — reconcile the two Run B efforts into one authoritative result

Reconciles the **merged deterministic dialect** (PR #2695 / `6b91e303`) with the **unmerged
hybrid-fallback evidence** (branch `1d2ad978`). Rule applied: *deterministic first; LLM only for
unresolved cases; human-confirmed LLM wins become code/fixtures/tests/schema.*

## Method
Branched fresh off `origin/main`, reproduced `magnetek_dialect.parse_magnetek_fault_page` on the
exact verified manual (144-25085, sha256 `56075883…`), and compared token-by-token against the 10
hybrid records + the two negative probes.

## Deterministic reproduction
- **77 fault entries, 76 distinct fault_ids**, all with verbatim source strings, `code=None` (no
  invented integers), citations, page numbers. Includes all 10 probe tokens; correctly omits
  `SE1`/`BE2`; real brake series is `BE0/BE4/BE5`.

## Token-by-token comparison + classification

| # | token | deterministic | vs hybrid | classification | additive? |
|---|---|---|---|---|---|
| 1 | oC | ✓ "Over Current Fault" | same | no difference | no |
| 2 | oV | ✓ "Overvoltage Fault" | same | no difference | no |
| 3 | Uv1 | ✓ "Undervoltage 1 Fault" | same | no difference | no |
| 4 | oH | ✓ "Overheat Pre-Alarm" | same | no difference | no |
| 5 | oL1 | ✓ "Motor Overload Fault" | same | no difference | no |
| 6 | oL2 | ✓ "VFD Overload Fault" | same | no difference | no |
| 7 | GF | ✓ "Ground Fault" | same | no difference | no |
| 8 | **LL1** | ✗ **garbled** `'Lower Limit 1—SLOW Limit 1—SLOW DOWN changed)'` | hybrid clean | **extractor bug** (row alignment) | **YES → fixed** |
| 9 | CE | ✓ "Modbus Communication Error" | same | no difference | no |
| 10 | EF | `name`=description; `secondary_label`="External Fault" | hybrid identity="External Fault" | **taxonomy disagreement** (info not lost) | no (documented) |
| — | LL2 | ✗ **garbled** `'Lower Limit 2—STOP 2—STOP is input (switch'` | — (found via LL1) | **extractor bug** | **YES → fixed** |
| neg | SE1 | correctly absent | rejected | agree | no |
| neg | BE2 | correctly absent | rejected | agree | no |

## Findings

- **Is the hybrid additive?** Yes, **narrowly**: it surfaced the `LL1`/`LL2` name-garble extraction
  bug. For the other 8 tokens the deterministic extractor already resolves them correctly — *better
  wording does not count*. `SE1`/`BE2` agree (both reject). `EF` is a taxonomy disagreement (`name`
  vs `secondary_label`), not data loss.
- **Root cause of the bug (extractor bug, missing rule):** `_fault_columns` set ONE page-global
  action-column edge from `min(step_nums)`. On p138 one short row's `1.` sits at x0≈228 while the
  wide LL1/LL2 rows' steps sit at x0≈344; the global min sliced LL1/LL2's wrapped-name tails into the
  action band. **Fix:** per-row action edge (each row's own leftmost numbered step; page fallback
  only when a row has no steps). LL1 → "Lower Limit 1—SLOW DOWN Indicator", LL2 → "Lower Limit
  2—STOP Indicator". No change to the other 75 entries.
- **LL1 resolved:** it was an **extraction** problem (garbled name), **not** a severity-label
  disagreement. The deterministic extractor has no severity field at all; the "LL1 severity" the C5
  judge flagged was a property of the hybrid record, orthogonal to extraction.
- **Is fallback still needed?** **No — not for the fault table.** Deterministic extraction resolves
  all 10 (and 77). The additive item was a deterministic *bug fix*, not a fallback. No LLM fallback
  contract is introduced.

## Changes made (deterministic wins → code + tests)
- `magnetek_dialect.py`: per-row action-column edge (LL1/LL2 fix).
- `_make_magnetek_sample_pdf.py` + `fixtures/magnetek_sample.pdf`: new variable-action-column page
  (WL1 wide-name row + SH2 short row) that reproduces the bug license-free.
- `tests/test_magnetek_dialect.py`: `test_variable_action_column_wide_name_not_garbled` (fixture
  regression).
- `tests/test_magnetek_runc_reconcile.py`: real-manual locks (10 tokens resolve; LL1/LL2 clean;
  SE1/BE2 absent; `code is None` — no invented integer). Skipped when the sha-pinned manual is absent.
- **140 tests pass, 1 xfail, ruff clean; zero regressions** on the other 75 codes / PF40 / PF525 /
  GS10 / grading.

## Rejected ideas
- Keeping an **LLM fallback** for the fault table — deterministic resolves everything; no need.
- "Fixing" `EF`/`dnE` name-vs-description via a heuristic — fragile; info is already captured in
  `secondary_label`. Left as a documented taxonomy note.
- Any **mnemonic→integer** mapping — forbidden (a fabricated wire value).
- Promoting the hybrid records — better wording only; not additive.

## Schema recommendation
Ratify **ADR-0028**: source-preserved string `fault_id`, `code=None`, additive `fault_entries` list,
int-keyed `fault_codes` unchanged (readers untouched). No invented integers. No migration here.

## Promotion verdict
**NOT PROMOTED.** Candidate/evaluation layer only. No `gold/`, no deploy, no runtime reader consumes
`fault_entries` yet. #2691 stays open.
