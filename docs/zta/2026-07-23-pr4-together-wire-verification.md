# PR 4 Together Wire Verification

Date: 2026-07-23

Scope: verify the API surface used by PR 4 before any metered fine-tune or temporary endpoint can run. This document is evidence only; PR 4 still performs no upload, no job, no endpoint, and no paid call.

Official Together docs checked:

- Create fine-tune job: https://docs.together.ai/reference/post-fine-tunes
- Estimate price: https://docs.together.ai/reference/post-fine-tunes-estimate-price
- List job events: https://docs.together.ai/reference/get-fine-tunes-id-events
- List checkpoints: https://docs.together.ai/reference/get-fine-tunes-id-checkpoint
- Download checkpoint/model: https://docs.together.ai/reference/get-finetune-download
- Fine-tuned model deployment and teardown: https://docs.together.ai/docs/fine-tuning/deployment
- Dedicated endpoint create/delete: https://docs.together.ai/reference/createendpoint and https://docs.together.ai/reference/deleteendpoint
- LoRA settings: https://docs.together.ai/docs/fine-tuning/lora-vs-full

Verified request shape used by `factorylm_ai.providers.together`:

- `POST /fine-tunes`
- Required: `training_file`, `model`
- Optional PR-4 fields: `validation_file`, `n_epochs`, `n_evals`, `n_checkpoints`, `suffix`, `packing`, `learning_rate`, `random_seed`
- SFT/DPO method object: `training_method={"method": "sft"|"dpo", "train_on_inputs": ...}`
- LoRA/full object: `training_type={"type": "Lora"|"Full", "lora_r": ..., "lora_alpha": ..., "lora_dropout": ..., "lora_trainable_modules": ...}`

Verified monitoring/checkpoint endpoints:

- `GET /fine-tunes/{id}`
- `GET /fine-tunes/{id}/events`
- `GET /fine-tunes/{id}/checkpoints`
- `GET /finetune/download?ft_id=...&checkpoint=adapter|merged|model_output_path`

Verified endpoint lifecycle:

- Dedicated endpoints are billable while running.
- A temporary benchmark path must be budget-prechecked, explicitly authorized, and delete the endpoint in `finally`.
- PR 4 exposes only the budgeted temporary benchmark wrapper publicly; low-level endpoint create/get/delete helpers are private.

Remaining live gate:

- Before a real paid event, Mike must provide a `paid_event_authorization_ref`.
- The dry-run package must include the dataset gate report, token/cost preflight, model-support evidence, and this wire-verification note.
