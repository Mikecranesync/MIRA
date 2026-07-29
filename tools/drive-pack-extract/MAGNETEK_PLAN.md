# Magnetek Drive Commander — implementation plan (scope lock)

Branch `feat/magnetek-drive-commander`. Task: make Magnetek (Columbus McKinnon)
the next Drive Commander unseen-family target and **execute** the first run now.

## In scope (this PR)
1. **Add Magnetek to the scout target pool** (`self_eval_scout.py`), G+ Mini first,
   with the verified official manual URL.
2. **`magnetek` family convention** in `grading/domain_rules.py` (dotted params
   `H01.01`, mnemonic faults `oC`/`BE2`/`LL1`) so an IMPULSE pack grades under its
   own family, not the strict PowerFlex fallback.
3. **Run G+ Mini through the real pipeline** (fetch → extract → gold-independent
   grade) and preserve every artifact under `candidates/magnetek_impulse_g_plus_mini/`.
4. **Scout selection rework (Phase 4):** unseen-never-attempted-first + persistent
   history (manufacturer/family/revision/firmware/timestamp), skip gold, deterministic
   order, fail loud when exhausted. Replaces the pure `run_index % len` modulo loop.
5. **Crane-domain grading supplement** in `domain_rules.py`: family-gated hard-fail
   that a crane-safety-critical fault (BE\* brake-proving, LL\*/UL\* limits, LC load-check,
   STO, PG/encoder) present in a pack must carry a cited corrective action — plus its own
   synthetic fixture test (the empty G+ Mini run will NOT exercise it).
6. **Research deliverables (durable docs):** Magnetek family inventory, Magnetek↔Yaskawa
   evidence matrix, broader-Magnetek opportunity map. Yaskawa-relabel claim = **strongly_inferred**
   (independent adversarial review downgraded the first agent's "confirmed").

## Explicitly OUT of scope (named follow-ups — do NOT build here)
- **Magnetek extractor dialect** (the real generalization fix). The G+ Mini fault table is a
  3-column mnemonic layout + dotted params; the extractor is PowerFlex-position-tuned +
  `fault_codes` is `dict[int,str]` (mnemonic faults can't key into it). So G+ Mini extracts
  near-empty — the honest unseen-eval finding, same class as GS20 (#2685) / GS10. File a
  tracked issue; do not build the dialect in this PR.
- **Crane-safety *answer* judge + Q&A coverage cases.** The spec's crane hard-fail is about
  Q&A *answers*; the scout has no answer-judge. This PR ships pack-extraction + a pack-level
  crane fault-integrity check. The answer judge is a named follow-up. Spec deliverables that
  are answer-only ("candidate user answers", "every judge result") are **N/A** for this PR.
- No promotion to `gold/`, no merge/deploy, no republished copyrighted PDFs (provenance +
  SHA-256 + size + citations only).

## Verify steps
- `python3.12 self_eval_scout.py --target magnetek_impulse_g_plus_mini --dry-run` → GRADED, artifact written.
- `pytest tools/drive-pack-extract/tests/ -q` green (existing + new magnetek + crane fixtures).
- Drive Pack Extract Tests CI job green.
