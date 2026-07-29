# Magnetek IMPULSE G+ Mini pack — provenance (Run B)

**Status: STAGED CANDIDATE — NOT deployed, NOT promoted, NOT in `gold/`.**
Run B of the Magnetek investigation: the extractor learned the IMPULSE document
dialect (`magnetek_dialect.py`, spec `../../MAGNETEK_DIALECT.md`). Run A — the
genuine unseen baseline (0 faults / 0 parameters) — is preserved UNMODIFIED in
`runA/` with the machine-readable delta in `runA/COMPARISON_CONTRACT.json`.

- Vendor: Magnetek (Columbus McKinnon) · Family: IMPULSE G+ Mini (crane-hoist VFD)
- Publication: IMPULSE G+ Mini Technical Manual, part 144-25085, firmware 14515
- Source URL: https://www.magnetekdrives.com/wp-content/uploads/sites/7/drives-g-mini-manual.pdf
- Source sha256: `56075883958090ed9b59b5c201feb19f556f19d232dfc9138d0caf68900d00be`
  (2,915,657 bytes, 182 pages) — **byte-identical to the Run A manual** (re-downloaded
  and re-hashed 2026-07-14), so the extraction delta is attributable to extractor
  changes alone. PDF is NOT committed (copyrighted; provenance + citations only).

## Run B result — 77 fault entries / 468 parameters, all cited

| Metric | Run A (PR #2690, `35fe2611`) | Run B |
|---|---|---|
| Fault identifiers | 0 | **77** (76 unique + `oV` plain/flashing pair) |
| Parameters | 0 | **468** (12 prefixes, A–U; 2 grouped-range rows deliberately skipped — see MAGNETEK_DIALECT.md) |
| Citation coverage | n/a | **77/77 faults, 468/468 params** (cite-gate verified verbatim) |
| Duplicates | n/a | 0 |
| Ambiguity-flagged identifiers | n/a | 53 (`ambiguous_glyphs`, detection-not-normalization) |
| Invented integer fault keys | n/a | **0** (`live_decode.fault_codes` = `{}` by design) |
| Grade | B (85.7) INCOMPLETE | **A (100.0) INCOMPLETE** |
| Promotable | NO | **NO** (gold-set categories still N/A — no gold set exists) |

Mnemonic fault identifiers (`oC`, `Uv1`, `LC dn`, `CPF18`…) are SOURCE-PRESERVED
strings in the candidate-layer `fault_entries` block — the runtime
`live_decode.fault_codes` is `dict[int,str]` and cannot hold them; the loader
tolerates (ignores) the extra key. **This is the Run C evidence: the runtime
schema needs a string-identifier decision before any Magnetek pack can be
promoted.** Out of scope here (Run C, not Run B).

Excluded by design (see `../../MAGNETEK_DIALECT.md`): auto-tune faults
(`Er-01`…`End 3`, p.141 — separate namespace), U-group monitor tables
(pp.129–133), symptom/maintenance guides (p.134), power-section checks
(pp.142–143), description-prose parameter mentions (pp.42–127).

## Reproduce (deterministic)

```
# manual at $PDF (sha256 above)
python - <<'PY'
import extractor; from self_eval_scout import build_pack
frag = extractor.extract("$PDF", doc="Magnetek IMPULSE G+ Mini Technical Manual (144-25085)")
# → 77 fault_entries / 468 parameters, every entry carrying page+verbatim excerpt
PY
python grading/grade_scientific.py --pack magnetek_impulse_g_plus_mini --manual $PDF \
  --out candidates/magnetek_impulse_g_plus_mini/
```

Grading note: `grading/domain_rules.py` (magnetek family conventions + crane-safety
citation rule) is inherited VERBATIM from the Run A branch (PR #2690) so grades
compare like-for-like; identical blobs merge cleanly whichever PR lands first.
