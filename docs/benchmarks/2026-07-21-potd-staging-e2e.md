# Print of the Day — staging live E2E evidence (ADR-0031 PR 7)

**Date:** 2026-07-21 · **Environment:** staging (`factorylm/stg`) · **Budget ceiling:** $0.50 (hard)
**Verdict:** ✅ **PASS** — all seven activation requirements proven live. **No production activation.**

The image revision below (`b12f586d…`/`6218ecc7…`) reflects two rebuilds during the run (a readiness
probe fix + a host-side driver fix); the final proven image is **`6218ecc7ae240ec63b283b4f6f6123ac07adeabc`**.

## Container / config

| | |
|---|---|
| Image | `mira-print-of-day:6218ecc7ae240ec63b283b4f6f6123ac07adeabc` (390 MB, python:3.12.13-slim + tesseract-ocr) |
| OCI label `org.opencontainers.image.revision` | `6218ecc7ae240ec63b283b4f6f6123ac07adeabc` |
| Runtime `IMAGE_REVISION` == running git SHA | `6218ecc7…` (provenance gate: match) |
| Staging Doppler | `PRINT_VISION_PROVIDER=together`, `PRINT_VISION_MODEL=MiniMaxAI/MiniMax-M3`, `PRINT_PROVIDER_POLICY=strict`, `OCR_REQUIRE_TESSERACT=1`, `FACTORYLM_NETWORK_MODE=enabled` |
| Production Doppler | **unchanged** |

## The seven proofs

| # | Requirement | Evidence | Result |
|---|---|---|---|
| 1 | correct deployed container revision | image label == requested SHA `6218ecc7…`; container provenance `git_sha == image_revision` | ✅ |
| 2 | known-token vision canary passes | readiness `--live` returned exit 0 (gate requires `vision_probe == ok`); independently, MiniMax-M3 read the fixture `"MIRA CANARY 7"` verbatim | ✅ |
| 3 | required Tesseract available | manifest `ocr.tesseract_version = 5.5.0`, `pytesseract_version = 0.3.13`, `available = true`, `required = true` | ✅ |
| 4 | one real POTD case completes | MiniMax-M3 interpreted the print → `PrintSynthGraph` → grade → manifest written | ✅ |
| 5 | grading + provenance survive end to end | manifest `grader.import_verdict = PASS`; `provenance.git_sha == image_revision`; artifact sha256 for extraction/grade/judge/print recorded | ✅ |
| 6 | exactly one gated email sent | Resend id `d3a0797e-d093-4c88-9600-8e053a1bc3a0`, status 200; send ledger holds **exactly 1** entry | ✅ |
| 7 | duplicate delivery prevented | second `--send` on the same case → `DUPLICATE_RUN`, exit 1, **blocked before any paid call**, ledger unchanged, no second email | ✅ |

## Model identity (requested vs returned)

| | Requested | Returned |
|---|---|---|
| interpreter provider | `together` | `together` (`resolved`) |
| interpreter model | `MiniMaxAI/MiniMax-M3` | `MiniMaxAI/MiniMax-M3` (`responded_model`) — no silent substitution |
| endpoint class | serverless | serverless |
| fallback attempts | — | `[]` (strict policy, none) |

## External calls + spend

All calls were to Together (`api.together.ai`). No Anthropic or OpenAI key was present or used; the
judge is on the free cascade and was unavailable in-container (see degraded states).

| Call | Tokens (in / out) | Note |
|---|---|---|
| direct vision diagnostic (canary) | 407 / 42 | confirmed MiniMax reads "MIRA CANARY 7" |
| readiness `--live` text probe ×N | ~16 each | "reply OK" |
| readiness `--live` vision canary ×N | ~407 / ~40 each | known-token read |
| interpret (send-gate-blocked run) | 4541 / 3651 | blocked at send (source_url), still billed |
| interpret (successful run) | 4541 / 3846 | the emailed case |
| duplicate second run | 0 / 0 | blocked before interpret ($0) |

**Total paid interpret calls: 2.** **Conservative upper-bound spend ≈ $0.086** (priced at an assumed
$3/$6 per-Mtok, deliberately 3–10× MiniMax-M3's real serverless rate; actual is materially lower).
**Well under the $0.50 hard ceiling.** The `staging_e2e.py` driver enforces the ceiling from recorded
usage and aborts before the duplicate pass if it is ever approached.

## Degraded states / honest gaps

- **Judge unavailable in-container.** `tools/internet_print_test/judge.py` imports
  `shared.inference.router` (mira-bots/shared), which the POTD image does not ship. The judge was
  recorded as `judge_error: "InferenceRouter unavailable: No module named 'shared'"` — best-effort,
  never blocking; the deterministic grade (the primary grader state) ran and passed. Shipping the
  free-cascade judge into the POTD image (or invoking it out-of-container) is a follow-up.
- **Deterministic grade score is `null`** because no frozen rubric was passed (`import_verdict = PASS`
  is the truth-free structural gate). A rubric-graded score arrives when a frozen rubric is supplied.
- **Tesseract OSD auto-rotate skipped** on the synthetic test print (`too few characters`) — expected
  for a sparse synthetic ladder; the OCR floor is still present and required.

## Reproduce

See `docs/runbooks/2026-07-21-potd-staging-activation.md`. Rollback is a single env flip
(`PRINT_VISION_PROVIDER=openai|anthropic`) preserving registry/readiness/OCR/provenance.
**Production remains untouched pending separate PR 8 approval.**
