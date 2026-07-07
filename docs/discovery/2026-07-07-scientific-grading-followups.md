# Discovery — Scientific-grading follow-ups (2026-07-07)

## Question investigated

Finish the DriveSense scientific-grading follow-ups in order, without changing
runtime behavior or promoting any pack: (1) fix the PowerFlex 525 P053 gap,
(2) build a GS10 gold set, (3) make the domain rules GS10-aware, (4) re-grade all
packs, (5) design a CI promotion gate, (6) write a runbook, (7) record findings.

## Files inspected

- Grading engine: `tools/drive-pack-extract/grading/{scientific,grade,grade_scientific,report,cite_check,domain_rules,gold_score,schema_check}.py`.
- Extractor: `tools/drive-pack-extract/extractor.py` (`_find_cross_refs`).
- Generators/gold: `generate_pf525_pack.py`, `gold/powerflex_525/gold.json`.
- Live packs: `mira-bots/shared/drive_packs/packs/{powerflex_525,durapulse_gs10}/pack.json`.
- Back-grade: `docs/drive-commander/scientific-grading/`.
- Real manuals (scratch, NEVER committed): PF525 `520-um001` (sha `b9445a63…`), PF40 `22b-um001` (sha `15c10c64…`).

## Commands run (representative)

- `extractor.parse_faults(PF525, pages=161..165)` — showed F101→P053 captured but **F100/F109 not**.
- `page.extract_words()` on p.163 with full-precision `top` — `P053.top=177.2793` vs `[Reset.top=177.279` (bracket ~0.0003 pt higher).
- `parse_parameters(PF525, pages=[66])` and `[89]` — P053 present on BOTH (grid summary p.66 already in `PARAM_PAGES`; labeled p.89 duplicates it).
- Live GS10 `pack.json` inspection — 10 mnemonic fault codes, 1 dotted param `P09.03`, `related_faults=[CE10]`, citations on chapter-section pages (`4-188`, `3-6`).
- `grade_scientific.py` before/after for each pack; `domain_rules.check_domain` contamination probes.

## Observed results

- **PF525 P053 — real root cause found (the earlier finding was wrong).** P053
  *was* already in the pack (page-66 grid). The bug was `_find_cross_refs` using a
  raw global `(top, x0)` sort: sub-pixel `top` jitter put the bracket token
  *before* its own id, breaking the "id-followed-by-`[`" adjacency. Only F101
  (whose tokens tied) survived. **Fix:** cluster the action band into visual lines
  first (existing `_LINE_TOL`), then scan in reading order. All 6 links resolve.
- **GS10 conventions confirmed:** dotted params (`P09.03`), mnemonic faults
  (`CE10`/`GFF`/`Lvd`/`oL`/`EF`), largely `bench_verified`, chapter-section page
  labels the int-page cite-integrity cannot verify.
- **Grades:**
  | pack | before | after | note |
  |---|---|---|---|
  | powerflex_40 | A/100 | A/100 | unchanged |
  | powerflex_525 (live) | A/98.3* | A/96.9 | *old gold; gap now fully counted; fixed candidate = **A/100** |
  | durapulse_gs10 (live) | D/60 INCOMPLETE | **A/95.2 INCOMPLETE** | gold + family rules; only citation N/A |
- **No pack promoted; no live pack.json changed.** PF525's fix is proven on a
  regenerated **staged candidate**; the live pack is untouched.

## Conclusions

1. The P053 gap was an extractor floating-point fragility, not a missing param —
   found by reading the real token geometry, not guessing.
2. GS10 is scientifically gradeable once (a) a gold set exists and (b) the domain
   rules are family-aware — but citation fidelity is honestly N/A (bench-verified
   + chapter-section pages), so GS10 stays INCOMPLETE / not promotable.
3. Two truthfulness fixes fell out: a mis-diagnosed prior finding was corrected,
   and committed grading reports leaked the local manual path (now filename-only,
   cross-platform).

## Deterministic workflow created / updated

- `_find_cross_refs` is now line-clustered (jitter-tolerant) — deterministic for
  every manual with intra-line `top` jitter.
- `domain_rules` is **family-aware** (`_FAMILY_CONVENTIONS` + `_family_key`),
  unknown → strict PowerFlex, leak guard absolute.
- Grading reports are path-free and reproducible (`report._basename`,
  `grade._sanitized_command`).
- New gold: `gold/durapulse_gs10/gold.json`. New docs: `runbook.md`,
  `ci-promotion-gate-design.md`, this record.

## Tests / fixtures added

- `test_find_cross_refs_tolerates_subpixel_top_jitter` (crafted from the real
  P053 token geometry; the old global-sort returned `[]`).
- `test_build_report_stores_manual_basename_not_absolute_path` (cross-platform).
- 9 family-aware domain tests: PowerFlex grades, GS10 IDs accepted, all four
  contamination directions caught, leak guard holds under GS10, unknown→strict.
- Full tool suite green (93 extractor+grading; +9 family = 99 with GS10 gold set changes).

## PRs

- **#2519** — PF525 P053 cross-ref fix + path-free reports (refs #2517).
- **#2520** — GS10 gold set + family-aware domain rules (refs #2516).
- **this PR** — runbook, CI-gate design note, discovery record.

## Remaining risks / open items

- **Citation for chapter-section page labels (GS10):** the int-page
  `cite_integrity` can't verify `4-188`. GS10 stays INCOMPLETE on citation until a
  chapter-section-aware cite check exists. Tracked implicitly by GS10's INCOMPLETE
  grade + `ci-promotion-gate-design.md` §2.
- **CI promotion gate not wired** — blocked on the manual-in-CI decision
  (design note options a/b/c) and on #2519/#2520 merging. Deliberate.
- **PF525 live pack still carries the gap (A/96.9)** — reaches A/100 only on a
  human-gated re-promotion of the regenerated candidate. Not done here (doctrine).
- **Provenance scorer** treats a bench-verified pack's missing manual sources as a
  partial score (GS10 provenance 50). Truthful, but a future refinement could
  credit bench-verified provenance explicitly.
