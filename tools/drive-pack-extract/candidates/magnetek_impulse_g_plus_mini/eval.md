# Run B evaluation — Magnetek IMPULSE G+ Mini (2026-07-14)

**Question Run B answers:** can the deterministic extractor learn the Magnetek
document dialect and produce a substantially better, cited candidate WITHOUT
changing the production runtime schema? **Answer: YES.**

| | Run A (baseline, PR #2690) | Run B (this branch) |
|---|---|---|
| Fault identifiers | 0 | **77** (76 unique + `oV` plain/flashing) — mnemonic strings, source-preserved |
| Parameters | 0 | **468** — dotted ids, verbatim ranges/defaults |
| Citation coverage | — | **100%** both tables (cite-gate re-verified against the PDF) |
| Duplicates | — | 0 |
| Ambiguity-flagged ids | — | 53 (`ambiguous_glyphs` detection; nothing normalized) |
| Invented integer keys | — | **0** — `live_decode.fault_codes` stays `{}` |
| Grade | B (85.7) INCOMPLETE | **A (100.0) INCOMPLETE** |
| Promotion verdict | NOT PROMOTABLE | **NOT PROMOTABLE** (gold categories N/A — no gold set; verdict policy unchanged, no thresholds touched) |
| Regressions | — | **0** — full pre-existing suite green (186 tests: PF40/PF525/GS10 extraction, grading, registry) |

Same manual bytes as Run A (sha256 `56075883…d00be`) — the delta is the
extractor, nothing else. How it works: `magnetek_dialect.py` +
`MAGNETEK_DIALECT.md` (geometry: rect-rule row spans, whitespace-channel +
step-number column edges; identifiers preserved verbatim with confusable-glyph
flagging; `and`-continuation multi-code cells; sub-row anchors).

**Remaining blockers to promotion (Run C material, NOT addressed here):**
1. **Runtime schema**: `schema.LiveDecode.fault_codes: dict[int,str]` cannot
   hold mnemonic identifiers. Run B evidence supports moving to a
   string-identifier fault representation (the candidate-layer `fault_entries`
   loads through the real loader untouched today). Decision + migration = Run C.
2. **No gold set**: fault/parameter coverage-precision categories are
   ungradeable until a human-curated `gold/magnetek_impulse_g_plus_mini/`
   exists. 
3. **Auto-tune fault namespace** (`Er-01`…`End 3`, p.141) deliberately out of
   scope — Run C should decide whether it ships as a separate table.
4. Runtime consumers (ask/cards/nameplate) have no code path for
   `fault_entries` — deploying this pack would answer nothing yet. By design.
