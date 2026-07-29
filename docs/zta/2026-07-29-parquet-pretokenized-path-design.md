# Parquet Pre-Tokenized Training Path — Design (closes the packing-mask stop-gate)

**Date:** 2026-07-29 · **Status:** DESIGN (Mike-requested: "start envisioning the parquet path")
**Contract facts:** `docs/zta/2026-07-29-together-parquet-contract.md` (pinned from primary
sources; verdicts referenced below as C1–C8). **No paid call in this design or its prototype.**

## Why this closes the gate

The unproven claim was "Together's server-side packing preserves the completion-only loss
mask." The Parquet path makes the claim unnecessary: **we supply `input_ids` and `labels`
ourselves, and Together documents that `-100` label positions are excluded from loss
verbatim (C2, PROVEN) and that server-side packing has no effect on Parquet data (C3a,
PROVEN twice).** The mask stops being a trust question and becomes a local artifact with
unit tests.

## Decision summary

1. **One row = one example, EOS-terminated, NO self-packing** — pending the billing probe
   (below). Rationale: the SDK validator *rejects* a `position_ids` column (C3b), so
   packed-boundary isolation can only be EOS-separation like Together's reference packer —
   weaker than what we'd build for ourselves. Unpacked rows sidestep boundary questions
   entirely. If the billing probe shows per-row padding billing, fall back to EOS-packed
   mode mirroring the reference script exactly.
2. **Mirror `together-python/examples/tokenize_data.py`** (C7) for file mechanics —
   emit via HF `datasets.to_parquet()` so dtypes match their reference (C1b hedge).
3. **Pin the tokenizer ourselves.** Parquet exists so the IDs are consumed verbatim (C8):
   `Qwen/Qwen3.5-9B` tokenizer at an explicit HF revision SHA, recorded in the run
   manifest. Rendering uses the same chat template already proven byte-identical between
   training and `enable_thinking=false` inference (2026-07-28 verification, CHECK 2b) —
   including the empty `<think>` block in assistant targets.

## Pipeline

```
reviewed+gated records ──> render (chat template, pinned revision)
                     ──> tokenize (input_ids, attention_mask=1s)
                     ──> mask (labels = input_ids; non-assistant spans = -100)
                     ──> one Parquet row per example (+EOS), datasets.to_parquet()
                     ──> proof suite ($0, local)  ──> upload ──> $0 estimate probes
                     ──> [existing ceremony: sign → create job]
```

Module: `factorylm_ai/dataset/parquet_export.py` (extends the pipeline; no new platform).
Assistant-span detection: token-offset bookkeeping while assembling the template render
per message — never regex over decoded text. Multi-turn records take loss on every
assistant turn.

## The proof suite (all $0, hermetic; blockers if red)

| Test | Proves |
|---|---|
| template-identity | our rendered text == `apply_chat_template` output for train mode; assistant scaffold includes the `<think>\n\n</think>` block exactly as CHECK 2b verified |
| mask-exactness | decoding label≠-100 positions reproduces the assistant texts and NOTHING else, per record incl. multi-turn |
| round-trip | decode(input_ids) == rendered text; attention_mask all 1s; row lengths ≤ 65,536 (C1c) |
| determinism | same reviewed set → byte-identical Parquet; file sha256 stamped into the receipt chain |
| count-reconciliation | sum(row lengths) == local token estimate used for the cost precheck |
| mutation | corrupting one label position fails mask-exactness (the suite has teeth) |

## The two $0 probes (pre-sign, mandatory)

1. **Billing discriminator (C4 — the open key gap):** upload two tiny Parquet files with
   identical content, one minimal-length rows, one deliberately padded; call
   `/fine-tunes/estimate-price` on both (C6, PROVEN it accepts file IDs). If estimates
   differ ≈ proportionally to supplied tokens → billed-as-supplied → unpacked mode
   confirmed. If both estimate as rows×max_seq → **STOP: fall back to EOS-packed mode**
   (the v0 padded-billing trap at Parquet scale would be ~$44, not $11).
2. **Validation-file probe (C5):** estimate-price with a Parquet `validation_file` +
   `n_evals=3`. If rejected → validation falls back to a JSONL validation file (its own
   packing question doesn't arise: validation is forward-pass only, and if THAT is
   ambiguous we accept monitoring-only JSONL loss curves or drop n_evals with Mike's
   sign-off — recorded as a deviation, not silently).

## Governance integration (unchanged rails)

- Exporter consumes ONLY post-sitting, paid-gate-passed records; refuses otherwise.
- File sha256 + tokenizer revision + template hash + row count into the run receipt.
- $0 estimate probe before the signing ceremony binds the request hash, as always.
- Spend law unchanged: one job, ≤$5 cap, two-key ceremony, single-use authorization.

## Residual risks (named, bounded)

- **Estimate-price Parquet accuracy UNVERIFIED (C6 note):** if the estimate is wrong the
  $4 minimum + $5 signed cap still bound the loss; the job receipt reconciles after.
- **Over-length rows (C1c behavior UNVERIFIED):** we enforce ≤65,536 locally; our longest
  current record is ~3 orders of magnitude below that.
- **Dtype silence (C1b):** mitigated by emitting through the reference script's own
  writer path.
- **SDK validator drift (C1d 100 GB vs 50.1 GB):** irrelevant at our ~MB scale.

## Build plan (each step $0 until the ceremony)

1. `parquet_export.py` + proof suite (deps: `transformers` tokenizer + `datasets` —
   both Apache-2.0, PRD §4 compliant; no LangChain).
2. Run proofs over the current 180-record unified compile (pre-sitting dry material) —
   validates the machinery while the general-family scale-up proceeds in parallel.
3. Upload probes + billing discriminator on throwaway tiny files.
4. Wire into the launch driver behind the existing stop-gates; update
   `train_config.json` gate list (packing gate → "parquet proof suite green + billing
   probe resolved").
5. The real export happens only after the final sitting, on the final manifest.
