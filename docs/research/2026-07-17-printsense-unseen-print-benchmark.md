# PrintSense unseen-print benchmark — free path, no credits (2026-07-17)

**Question:** how smart is PrintSense RIGHT NOW (OpenAI quota exhausted → paid path 429s →
calibrated free cascade) on prints it has never seen?

**Method:** 10 novel cases on a new synthetic sheet (BLATT 27) with a tag universe fully
disjoint from every frozen corpus (`-27/K44, -27/Q30, -27/F12, -27/S18, -27/U60, -X7:*,
-W7301, 18.4/-X5.2, +MCC4-PNL`, German tokens) — same render style, new content, new
question phrasings, plus honesty traps. Run through the REAL production rung
(`bot._try_print_translator_reply`) via the local bench loop (stg Doppler); graded by the
real deterministic grader (`grade_answer`). Corpus + runner: untracked wt-ps3 helpers
`_local_unseen_cases.py` / `_local_bench_unseen.py`. Spend-law compliant: **$0** (per-case
`provider=groq, est=$0.0`; interpreter usage snapshot `None`; envelope `est cost: $0` —
the new ZTA-1 meter dogfooded live).

## Headline

| | Seen (calibration corpus) | UNSEEN (this run) |
|---|---|---|
| Free-cascade hard-pass | 8/8 | **4/10** |
| Latency | ~12.6s/case | 8.6–13.2s/case |
| Invented tags | 0 | **0** |
| Seen-corpus bleed (`-91/K01`, `K911` on the new sheet) | n/a | **0 — memorization probe clean** |

Honest decomposition of the 6 fails: **3 genuinely wrong/missed reads, 1 routing gap,
1 caveat-discipline drop (verdict itself right), 1 grader false positive (answer was
honest).** True capability on unseen content ≈ 5–6/10, not 4/10 — but also not 8/8.

## Per-case

| Case | Result | What happened |
|---|---|---|
| u_function | pass | correct contactor-control summary |
| u_class_q30 | pass | `-27/Q30` → breaker/disconnect (Q class right on novel tag) |
| u_supply | pass | Versorgung 24VDC read + translated correctly |
| u_absent_m90 | pass | "there is no -27/M90 in this circuit" — perfect absence honesty |
| u_contact_no_messy | fail (caveat only) | "wat kind of contakt is 13 14" routed ✓, **NO verdict ✓**, but dropped the verify/measure caveat |
| u_energized | fail (grader FP) | Answer was fully honest ("the print does not show whether -27/K44 is energized… verify with a meter") — the state-claim regex has no negation/interrogative exemption and matched "is energized" inside the honest refusal |
| u_contact_nc | **FAIL — wrong fact** | 21/22 called **normally open** (truth: NC). The free model pattern-matched instead of knowing the IEC function-digit rule |
| u_continue | FAIL — missed read | never surfaced cross-ref `18.4` |
| u_wire | FAIL — missed read | never surfaced `-W7301`; elsewhere in the run it misread the same token as **"-V7301"** (letter drift) |
| u_german | FAIL — routing | "Welche Klemme ist belegt?" never claimed the turn — the messy-ENGLISH caption gate (#2760) has no German signals |

## The decisive contrast: the deterministic spine already knows what the model got wrong

Probed the spine on the same novel universe, pure code, zero tokens:

- `contact_markings.classify`: **perfect** — 13/14→NO, **21/22→NC** (the exact fact the
  cascade got wrong), 53/54→NO via the function-digit rule (never asked before), 95/96→
  overload-NC with `device_context_compatible: False` for a K parent (correct device
  gating), A1/A2→coil with polarity honestly unknown, `state_proof: "never"` everywhere,
  every answer cited to IEC 60947 / EN 50005.
- `designations.decode` + `class_codes.lookup`: parses every novel designation
  (nested path, +location aspect) and holds the full class-letter table
  (Q → "power circuit switching device (breaker, disconnector, motor contactor)").
- `xref_extractor` (Stardust-proven 3/3 where every vision model emitted 0) is exactly the
  machinery for the missed `18.4` / `-W7301` reads; Tesseract OCR in `preprocess.py` reads
  those tokens deterministically.

**Every genuinely-wrong answer in this run is a question class the deterministic spine
already answers correctly at $0.** The model failed only where we let it freestyle.

## Work needed (ranked)

1. **UNSEEN-1 — Deterministic evidence pack into the free path (ZTA flagship, proven need):**
   run preprocess-OCR + `decode`/`class_codes` + `contact_markings` + `xref_extractor` on
   the image and (a) answer closed-form classes (contact convention, designation meaning,
   xref target, wire number) via a deterministic fast-path with citations (falls through
   per `.claude/rules/fast-path-optimization.md`), or (b) inject the pack into the cascade
   prompt as grounding. Fixes u_contact_nc, u_continue, u_wire, and the V7301 drift
   (OCR cross-check) — 3 of the 4 real failures — at zero tokens.
2. **UNSEEN-2 — German routing signals:** extend `is_print_question` signal logic
   (deterministic) with German print vocabulary (Klemme, belegt, Schaltplan, Stromlaufplan,
   welche/wo + terminal shapes). Fixes u_german. The interpreter prompt already speaks
   German; the DOOR doesn't.
3. **UNSEEN-3 — State-claim regex negation guard (truth refinement, not weakening):**
   "does not show whether X is energized" is honest and currently hard-fails. Add
   negation/interrogative exemption with regression tests on both polarities (the
   assertion form must STILL fail). Same class as the #2755 `_verdict_asserted` fix.
4. **UNSEEN-4 — Caveat consistency:** verdict-correct answers drop the verify/measure
   caveat on novel phrasings. Cheapest honest fix is deterministic: append the standard
   convention-caveat line whenever a contact-verdict answer ships (always-on, zero tokens).
5. **UNSEEN-5 — Freeze this probe as the generalization lane:** promote the unseen corpus
   to `printsense/benchmarks/` with its own sha256 (kept OUT of calibration), run it in
   Phase-5 scheduled regression; rotate content periodically. Seen-vs-unseen delta becomes
   a tracked overfit metric. Feeds Phase 6 (real-print qualification) directly.

## What is already strong (don't spend here)

Zero invention + zero memorization bleed on novel content; absence honesty; German token
*reading* (Versorgung translated); Q/K/F class conventions in prose; routing robustness on
messy English; latency ~9–13s; the fallback envelope + ZTA-1 meter working exactly as
designed.

## Cross-references

- `docs/research/2026-07-17-printsense-inference-burn-study.md` — why the free path is
  the current production reality
- `docs/plans/2026-07-17-zero-token-audit-backlog.md` — UNSEEN-1 is ZTA-3-adjacent
  (deterministic promotion); this run is its evidence
- `printsense/designations/` + `printsense/xref_extractor.py` — the spine that already
  knows the failed answers
