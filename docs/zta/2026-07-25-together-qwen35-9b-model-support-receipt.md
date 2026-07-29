# Model-Support Receipt — Together AI / Qwen3.5-9B LoRA SFT

Receipt for the `model_support_confirmed` check in `factorylm_ai/dataset/paid_gate.py`.
Consumed by `technician_v0.load_model_support_receipt` via `--model-support-receipt`.

**This receipt records a documentation check. No Together API call was made, no key was
used, and no spend occurred.** The check was a read of Together's published catalogue and
pricing pages — `method: serverless-catalog`, one of the two sanctioned values in
`ALLOWED_MODEL_CHECK_METHODS`.

## Machine-read fields

- model_id: `Qwen/Qwen3.5-9B`
- provider: `together`
- checked_at: `2026-07-25T00:00:00Z`
- method: `serverless-catalog`
- supported: `true`

## What was verified

**Model is fine-tunable with LoRA.** `Qwen/Qwen3.5-9B` appears on Together's fine-tunable
model list with LoRA support marked yes, corroborated across three independent pages: the
docs list, Together's own model product page (9B params, 262,144-token context), and the
fine-tuning quickstart, which uses `"Qwen/Qwen3.5-9B"` verbatim as its LoRA walkthrough
model and notes `client.fine_tuning.create()` defaults to a LoRA job.

- https://docs.together.ai/docs/fine-tuning-models
- https://www.together.ai/models/qwen3-5-9b
- https://docs.together.ai/docs/fine-tuning/quickstart

**Pricing matches our pinned constants exactly.** LoRA SFT on a ≤16B base is **$0.48 per
1M tokens** with a **$4.00 minimum job charge** — identical to
`FT_LORA_SFT_USD_PER_MTOK_LE16B = 0.48` and `FT_MIN_JOB_USD = 4.00` in
`factorylm_ai/pricing.py` (self-dated "verified 2026-07-19"). The floor is aggregate:
training tokens × epochs plus validation tokens × n_evals.

- https://www.together.ai/pricing

**API shape matches the PR-4 wire verification field-for-field.** `POST /fine-tunes`,
required `training_file` + `model`; optional `validation_file`, `n_epochs`, `n_evals`,
`n_checkpoints`, `suffix`, `packing`, `learning_rate`, `random_seed`; `training_method`
object (`sft`|`dpo`); `training_type` object (`Lora`|`Full` with `lora_r`, `lora_alpha`,
`lora_dropout`, `lora_trainable_modules`), defaulting to LoRA when omitted. No discrepancies
against `docs/zta/2026-07-23-pr4-together-wire-verification.md`.

- https://docs.together.ai/reference/post-fine-tunes

**Data format is compatible.** JSONL accepted; conversational format requires a `messages`
array of `role`/`content` starting with `system` or `user` and alternating `user`/
`assistant` thereafter — which is the shape `DatasetRecord.messages` already validates
(`message_validation_errors`). Formats must not be mixed in one file.

- https://docs.together.ai/docs/fine-tuning-data-preparation

## Explicitly NOT verified — read before authorising spend

- **Together's minimum sample count.** The validation report exposes a `has_min_samples`
  flag, so a floor exists, but the numeric threshold was not extractable from the published
  page. Our own `MIN_RECORDS = 100` very likely clears it, but that is an inference and is
  not cited.
- **Per-example token minimum.** Not documented on the pages read. Sample packing is on by
  default, implying no hard floor — again an inference, not a guarantee.
- **"Build Tier" gating.** Secondary sources mention a tier unlocked after $5 of spend;
  Together's own billing page did **not** mention build tiers. Unconfirmed against primary
  documentation — do not rely on it either way.

## Operational note

Together requires a **minimum $5 credit purchase** for platform access and offers no free
trial (https://docs.together.ai/docs/billing). Our `COST_CAP_USD = 5.00` sits right at that
floor, so a job estimated within cap can still fail on insufficient account balance. That is
an account-funding matter, not a gate defect.

## Scope

This receipt satisfies one gate check. It authorises nothing: no upload, no job, no
endpoint, no deployment, no spend. Paid execution remains gated on a separate signed
`PaidEventAuthorization` issued by Mike.
