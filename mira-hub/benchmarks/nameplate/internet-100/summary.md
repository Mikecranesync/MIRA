# internet-100 — 154 real-world nameplate photos vs the FactoryLM pipeline

**Ran:** 2026-08-15/16 · **Pipeline:** production seam (`resolveRecognitionImage` → detect
service crop w/ guarded uprighting → `defaultRecognizer` → evidence layer), plus a whole-photo
baseline leg per sample · **Verdict: NO-GO for unsupervised identity promotion; the safety
architecture held on numerics (0 silent numeric promotions); the improved path beats baseline
on every accuracy axis but absolute accuracy on real-world photos is far below the
qualification case.**

## Dataset

| | |
|---|---|
| Unique real photographs collected | **154** (sha256-deduplicated; 1 collection round sufficed) |
| Evaluated / excluded | **152 / 2** (2 GT-unreadable: label too small/blurred — retained in manifest) |
| Improved-leg total failures | 5 more samples errored on BOTH legs (recognizer JSON truncated at `max_tokens: 500`) — measured as failures, not excluded |
| Domains | 32 (top: hgrinc.com 26, commons.wikimedia.org 21, surplusselect.com 14, eng-tips.com 9, indiamart.com 9) |
| Source types | used-equipment dealers 113, Wikimedia Commons 21, forums 10, photo archives 4, articles 4, auctions 2 |
| Manufacturers | **89** (Allen-Bradley 11, Siemens 8, SMC 6, Baldor-Reliance 5, Square D 5, FANUC/Yaskawa/Grundfos/SEW 4 each…) |
| Categories | 23 (ac_motor 30, vfd_drive 13, gearmotor 10, plc/transformer/compressor/servo/breaker 9 each…) |
| Difficulty | easy 43 / medium 76 / hard 33 (rated by the blind GT reader per fixed rubric) |

Ground truth: blind per-photo human-grade reading (multimodal agent, forbidden from seeing
pipeline output), fields unreadable-with-confidence marked `unknown` and not scored. Images
NOT committed (third-party); manifest.json + sources.md carry page/image URLs + sha256.

## Headline metrics (scored fields only; both legs scored by the same deterministic rubric)

| Metric | Improved (detect→crop→recognize) | Baseline (whole photo) |
|---|---|---|
| Identity exact accuracy | **66.4%** (247/372) | 60.6% (226/373) |
| Identity wrong claims | 88 | 109 |
| Spec exact accuracy | **65.2%** (808/1239) | 56.2% (699/1244) |
| Decimal accuracy | **73.3%** (151/206), 1 decimal failure | 60.1% (128/213), 3 decimal failures |
| Unit accuracy | **53.5%** | 45.6% |
| Hallucinated marks | 5 | 4 |
| Incorrect identity promotions | **72** | 95 |
| **Incorrect safety-critical NUMERIC promotions** | **0** | **0** |
| Mean latency / sample | 8.3 s (2 inferences + detect) | 3.5 s (1 inference) |

Per-sample identity: improved better on 35 samples, tied 91, worse 20.

By difficulty (improved): easy id 79% / spec 81% / decimal 93% → medium id 63% / spec 59% →
hard id 48% / spec 50%. The system degrades roughly linearly with real-world difficulty;
hallucinated marks were 0 on hard photos (it fails toward silence, not invention).

## Detection metrics

| | |
|---|---|
| Detector produced a usable crop | **147/152 (96.7%)** |
| Fallback to whole photo | 5 (2 on hard photos) |
| Mean text regions / photo | 25.3 |
| Orientation corrections applied | 11 (8×180°, 2×90°, 1×270°) — guarded re-classify kept 0° on the other 131 |
| Adjudicated detector faults | 6 detector_missed_label, 11 detector_omitted_region, 2 orientation_misclassified |

## Adjudicated failure taxonomy (independent second reader re-examined all 106 flagged samples)

270 findings: **224 genuine pipeline defects**, 46 benchmark-apparatus artifacts (38
scorer string-normalization artifacts, 2 GT errors, 6 insufficient ground truth) — retained,
not hidden. 167 findings were wrong claims; 53 were safe failures; 50 dissolved on inspection.

| Category | n |
|---|---|
| recognition_substitution (misread characters presented as read) | 83 |
| catalog_model_confusion (right string, WRONG FIELD: frame→model, bearing→serial, RPM-row→model, memory-card→catalog) | 36 |
| field_omitted_safe | 33 |
| hallucination | 20 |
| detector_omitted_region | 11 |
| decimal_dropped | 6 |
| detector_missed_label | 6 |
| provider_error (max_tokens 500 JSON truncation, both legs) | 5 |
| unit_error | 4 |
| orientation_misclassified | 2 |

**Severity-1 (wrong safety-relevant numeric presented as read): 42 findings** — e.g. FL RPM
880→380, pressure-vessel shell thickness .184→181, FLA rows mis-assigned (`values.current`
= a CSA compliance code `030A` instead of the real 4.50 A). None was promoted — the evidence
layer never promotes numerics — but they are presented in `values`/`rawText` as read.

**Severity-2 (wrong model/catalog/serial identity): 86 wrong claims across 59 samples**, and
these DO reach `review.promotable` (identity fields are permissive by design, on the
assumption that OEM discovery independently validates them). On real-world plates that
permissiveness promotes bearing numbers as serials and frame sizes as models.

## What held and what didn't

**Held:** the safety floor. Zero safety-critical numerics promoted, on either leg, across 152
real photos — verified empirically, not just by construction. Hard photos fail toward null,
not invention. The detector+crop+uprighting path beats whole-photo baseline on every accuracy
axis and cuts identity wrong-claims by 19%.

**Did not hold:** (1) *field assignment* — the dominant genuine defect is not character OCR
but slotting a correctly-read string into the wrong identity/spec field; (2) the qualification
case (Oriental Motor, 3/3 exact) is far above the real-world mean — single-photo GO does not
generalize; (3) `max_tokens: 500` truncates dense plates and kills the whole recognition
(3.3% of samples); (4) identity promotion is too permissive for unsupervised use.

## Recommended next engineering change (measured, in order)

1. **Deterministic field-assignment layer**: anchor identity/spec extraction to printed label
   keywords (MODEL/CAT/SER/FRAME/BRG/RPM/FLA…) in rawText before accepting the model's field
   mapping; refuse to promote an identity value whose anchor keyword is absent. This attacks
   catalog_model_confusion (36 findings) and most severity-2 promotions at zero inference cost.
2. **Raise/handle the recognizer `max_tokens` truncation** (5 total-failure samples): larger
   cap + JSON-repair-or-retry on parse failure.
3. Keep the detector path (it wins everywhere) and add the crop-recall check for the 11
   detector_omitted_region cases (compare region count inside crop vs frame).

Artifacts: `manifest.json` (154 entries + URLs + sha256), `results.json` (per-sample scores both
legs), `adjudication.json` (270 findings), `failures.md`, `sources.md`, harness (`run-sample.ts`,
`score-all.ts`). Reproduce: see run-sample.ts header (needs the detect service + Doppler dev keys).
