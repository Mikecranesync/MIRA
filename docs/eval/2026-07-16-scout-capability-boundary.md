# Scout capability boundary — decision record (2026-07-16)

Sanitized from the local-only evaluation record; the corpus is a 27-sheet
confidential industrial print book that never enters the repo. All grading is
deterministic (frozen truth rubric + B7 scorers); numbers below are from the
identical production harness (preprocess → production prompt → PrintSynthGraph
schema validation → confidence gate).

## Evidence

- Full-book Phase D run on the free vision lane (Groq llama-4-scout via
  InferenceRouter, $0): page_ordering **.963**, uncertainty **1.000**,
  invention_resistance **1.000**, device_identity .025, all xref-fed lanes
  0.000. Frontier per-page reference on the same corpus: A-band.
- Improvement experiment (deterministic 3×2 tiling + local OCR hints, merge
  by normalized tag, gates unchanged): device recall on the dense rack sheet
  0 → **1.00** at ~0.50 precision; noise floods on power sheets; **zero
  cross-references emitted in every configuration**.
- Provider bake-off (identical harness, direct calls, no fallback): every
  reachable non-frontier vision model also emitted **zero cross-references**;
  the best (a paid-lite model) achieved perfect complete-truth rack-sheet
  device extraction, repeatably. Five of ten reconstruction lanes are
  xref-fed — they cannot move without cross-reference extraction.

## Approved capability boundary (operator decision, 2026-07-16)

**Scout-class models are approved for:** intake & routing, page ordering,
image-quality detection, uncertainty handling, invention resistance, basic
extraction, and tiled **device-inventory suggestions** (recall-oriented,
~50% precision — suggestions, never truth).

**Not approved for:** dense-print reconstruction — cross-references,
continuity, system paths, contact semantics, or anything a technician would
rely on. Reconstruction remains gated behind provider capability
qualification (`cross_reference_extraction` + `system_reconstruction`), per
`docs/plans/2026-07-16-printsense-degraded-mode.md`.

Further Scout reconstruction tuning is **stopped** by decision; effort goes
to the deterministic xref extractor and the degraded-mode pipeline instead.
