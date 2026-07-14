# ADR-0028: Run C — source-preserved mnemonic fault codes (no invented integers)

## Status

Accepted — 2026-07-14

**Related:** ADR-0025 (Drive-Intelligence Packs / Drive Commander — the pack schema this refines),
the Run A frozen baseline (`docs/eval/drive-pack-faultcode-runA/`), the Run B efforts
(deterministic dialect PR #2695 / `6b91e303`; hybrid-fallback evidence, branch `1d2ad978`), and
issue #2691 (extractor-dialect follow-up — **not closed by this ADR**).

**Origin:** the Run A→B→C investigation. Run A proved the deterministic extractor resolved 0/12 G+
Mini mnemonic fault codes because `live_decode.fault_codes: dict[int, str]` hard-rejects mnemonic
keys. Two independent Run B efforts followed; this ADR is the reconciliation + the Run C schema
decision the design deferred.

---

## Context

Magnetek IMPULSE (and DuraPulse GS-series) drives label faults with **mnemonic strings** — `oC`,
`Uv1`, `BE4`, `LL1`, `CPF18` — where **casing is semantic** (`oC` ≠ `OC` ≠ `0C`; `Uv` ≠ `UV`).
The shipped drive-pack schema keys fault decode by **integer** (`live_decode.fault_codes:
dict[int, str]`), mirroring the PowerFlex wire enum and `docs/migrations/002_fault_codes.sql`.

Five reader sites depend on the int-keyed shape (Run A `compat_sensitive_readers`):

- `mira-bots/shared/live_snapshot.py:48` — `_FAULT_CODES: dict[int,str]`
- `mira-bots/shared/drive_packs/loader.py:275` — `_int_keyed` gate (raises on a non-numeric key)
- `mira-bots/shared/drive_packs/cards.py:89`, `:93` — provenance read + `for code, name in
  fault_codes.items()`
- `mira-bots/shared/drive_packs/template_reader.py` — numeric fault_code keying

The deferred Run C question (RUN_B_DESIGN.md #1–#4): how does a mnemonic code live in the pack
without either (a) inventing an integer — a fabricated wire value, i.e. a guess — or (b) rewriting
all five int-keyed readers and the migration?

### Reconciliation of the two Run B efforts

- **Deterministic dialect (merged, #2695):** resolves all 77 real fault codes (incl. all 10 probe
  tokens) with verbatim source strings + citations; correctly omits `SE1`/`BE2`.
- **Hybrid-fallback evidence (unmerged):** 10 labeled LLM-fallback records. Compared token-by-token
  against the deterministic output, it added **no** new resolutions (deterministic already got all
  10) — **but it surfaced one real deterministic bug**: `LL1`/`LL2` names were garbled by a
  page-global action-column edge. That is the hybrid's entire additive value; per "better wording
  does not count," nothing else was additive, and **no LLM fallback is needed for the fault table** —
  deterministic extraction resolves it. The bug is now fixed deterministically (per-row action edge)
  with a fixture regression + a real-manual lock. `LL1` was therefore an **extraction** problem, not
  a severity-label disagreement (the deterministic extractor has no severity field at all).

## Decision

**Preserve the source string. Never invent an integer.** Concretely — ratify the shape the merged
extractor already produces:

1. **Mnemonic families carry a `fault_entries` list**, additive alongside `live_decode.fault_codes`.
   Each entry: `fault_id` = the **verbatim source string** (case-preserved), `code` = **`None`**
   (never a fabricated integer), plus `name` / `action` / `references_parameters` / `page` /
   `excerpt` / `flashing` / `secondary_label` / `ambiguous_glyphs`.
2. **`live_decode.fault_codes` stays `dict[int, str]` and stays `{}` for mnemonic-only families.**
   The five int-keyed readers are **unchanged** — they simply see an empty int map for these
   families and ignore the extra `fault_entries` key (the loader tolerates it). No reader rewrite,
   no migration change, no version bump of the int schema. (Resolves deferred #2 = additive field,
   not a version bump/adapter; #5 = reader compat preserved.)
3. **A structured record list, not a string-keyed map.** We do NOT relax `fault_codes` to
   `dict[str, str]` — that would silently change the type the five readers depend on. A separate
   `fault_entries` list is the safe shape. (Resolves deferred #1.)
4. **Casing is data. Never casefold.** `fault_id` is stored exactly as the source renders it;
   confusable glyphs are *flagged* (`ambiguous_glyphs`), never normalized. (Resolves deferred #4.)
5. **No wire_value / integer enum is asserted** unless bench-verified. G+ Mini exposes **no integer
   fault register** (Run C input gathered in Run B) — so for this family a fault integer would be
   pure invention. `code` stays `None`.

Promotion of `fault_entries` from candidate into any runtime read path remains a **separate,
human-gated** step (train-before-deploy); this ADR defines the *shape*, not a deployment.

## Consequences

- **Positive:** mnemonic drives become representable with zero risk to the int-keyed readers;
  source fidelity (casing/spacing) is preserved for future alias derivation; no fabricated integers
  enter the data; the fix + tests make the extractor authoritative for the G+ Mini fault table.
- **Negative / deferred:** `fault_entries` is not yet read by any runtime decode path (candidate
  layer only) — wiring a reader that consumes string-keyed fault decode is future work under #2691.
  Fault→parameter linking (#6) and existing-pack migration (#7) remain deferred; no pack is migrated
  here.
- **Non-goals:** no mnemonic→integer mapping, ever; no `gold/` promotion; no deployment; this ADR
  does not close #2691.
