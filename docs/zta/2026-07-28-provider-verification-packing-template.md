# Provider Verification: Packing Loss-Mask + Chat-Template Parity (Together AI, Qwen3.5-9B LoRA)

**Date:** 2026-07-28
**Scope:** Two pre-paid-run stop-gate checks for a Together AI LoRA SFT job on `Qwen/Qwen3.5-9B`
(`packing=true`, `train_on_inputs=false`, chat-format JSONL; inference via `/v1/chat/completions`
with `chat_template_kwargs {"enable_thinking": false}`).
**Method:** Primary sources only — docs.together.ai, togethercomputer/together-py (Together's own
repo), huggingface.co/Qwen/Qwen3.5-9B (official tokenizer/template files, fetched raw), TRL docs
for comparison semantics. No third-party blogs used as proof.

---

## Verdict summary

| Check | Verdict | One-line basis |
|---|---|---|
| **CHECK 1** — packing preserves completion-only loss mask (no cross-example attention/loss bleed) | **NOT PROVEN** (strong circumstantial chain, no explicit doc statement) | Together documents packing + completion-only loss as simultaneous defaults and documents per-example `position_ids` reset, but never states explicitly that the loss mask survives packing or that attention is blocked across packed examples. |
| **CHECK 2a** — Together applies the model's own chat template server-side to chat-format training data | **PROVEN** | "The dataset is automatically formatted into the model's chat template if one is defined." (data-preparation doc, verbatim). |
| **CHECK 2b** — Qwen3.5 template renders training targets identically to inference with `enable_thinking=false` | **PROVEN** (from official template source) | The official `Qwen/Qwen3.5-9B` template renders the final assistant message at training time as `<|im_start|>assistant\n<think>\n\n</think>\n\n{answer}<|im_end|>` — byte-identical scaffolding to the `enable_thinking=false` generation prompt. `enable_thinking` has no effect on training-time rendering. |
| **Validation monitoring** — `validation_file` + `n_evals` on LoRA jobs, eval loss reported | **SUPPORTED** | Both are top-level params on the create-fine-tune endpoint (not gated by training type); metrics endpoint documented to include `eval/loss` when `validation_file` + `n_evals > 0` are set. |

**Stop-gate consequence:** CHECK 1 is NOT PROVEN from public docs alone. Mitigations that make the
run safe without waiting on Together support are listed in the final section (the strongest:
pre-tokenized Parquet with explicit `labels`/`position_ids`, which Together documents as fully
caller-controlled).

---

## CHECK 1 — Packing vs. completion-only loss mask

### What Together documents (verbatim quotes)

**Source: https://docs.together.ai/docs/fine-tuning/data-preparation** (raw markdown fetched
2026-07-28; also served at `.../data-preparation.md`)

Packing section, in full:

> "For JSONL training data, Together uses [sample packing](https://huggingface.co/docs/trl/main/en/reducing_memory_usage#packing): multiple short examples are concatenated up to `max_seq_length` so each training window uses the full context length instead of being padded out. Packing is enabled by default and makes the effective batch size larger than the `batch_size` you set, which significantly reduces the total number of training steps and overall training time."
>
> "To control packing, either set the [`packing` flag](/reference/post-fine-tunes#body-packing) to `false` for JSONL input, or supply a pre-tokenized [Parquet file](#tokenized-parquet-data). The `packing` flag applies only to JSONL input; it has no effect on Parquet data."

Loss-mask default, same page (conversational data section):

> "By default, training computes loss only on `assistant` messages. Pass `train_on_inputs=True` to include the rest."

Per-message weights, same page:

> "Set a `weight` on an individual message to control whether it contributes to the loss. Only `0` and `1` are supported: a message with `weight=0` is masked, and `weight=1` includes it. This is a finer-grained version of `train_on_inputs`, letting you mask or include specific messages rather than whole roles."

Parquet field table, same page — this is the trainer's documented packed-sequence convention:

> "`position_ids` | No | Position IDs. Reset to 0 at each example boundary inside a packed sequence and increment by 1. Padding tokens also receive 0."

> "`labels` | No | Target token IDs. Use `-100` to mask a position from the loss. Defaults to `input_ids`."

And about Together's own packing example script:

> "If `--packing` is passed, the script concatenates multiple short sequences into each `max_seq_length` window to reduce wasted compute, matching the [packing](#packing) training applies by default."

**Source: https://docs.together.ai/reference/post-fine-tunes** — the `packing` body parameter:

> "Whether to use sequence packing for training. This flag has no effect if the training data is in Parquet format."

`train_on_inputs`:

> "Whether to mask user messages in conversational data or prompts in instruction data."

**Source: https://github.com/togethercomputer/together-py/blob/main/examples/tokenize_data.py**
(Together's own repo; the docs link this script as "matching the packing training applies by
default"). Its `pack_sequences` function:

- Docstring/comments: "Position IDs reset to 0 at the start of each sub-sequence." and "This
  ensures every chunk starts at a sequence boundary (position_ids[0] == 0)."
- Emits per-token `labels` (`-100` only on padding) and per-example-reset `position_ids`; the
  `attention_mask` it writes is `1` for every non-pad token across the whole packed window (no
  block-diagonal mask in the data — separation is carried by `position_ids`).

### Comparison context (TRL, which Together's doc cites as the definition of its packing)

**Source: https://huggingface.co/docs/trl/main/en/reducing_memory_usage#packing** (the exact page
Together's packing sentence hyperlinks):

> "This technique is available only for **SFT** training and setups that use **FlashAttention** (or its variants)."

TRL's packing implementation ("Best-Fit Decreasing") keeps each example whole (default `"bfd"`),
and TRL's adjacent padding-free section warns that without FlashAttention "you may encounter batch
contamination issues" — i.e., in the TRL/transformers ecosystem, example separation under
packing/flattening is achieved via position-id boundaries + FlashAttention varlen kernels, not via
tokens attending freely across a concatenated window.

### Why the verdict is NOT PROVEN

What the primary sources establish:

1. Completion-only loss ("loss only on `assistant` messages") and packing are **both documented
   defaults of the same JSONL pipeline, described on the same page**. If packing destroyed the
   loss mask, Together's documented default behavior would be self-contradictory. Strong
   implication — but no sentence says "the per-example loss mask is preserved when examples are
   packed."
2. The trainer's packed-sequence convention (`position_ids` "Reset to 0 at each example boundary
   inside a packed sequence") is documented, and Together's own packing script implements exactly
   that. Position-id-per-example is the standard mechanism by which FlashAttention-based trainers
   prevent cross-example attention. But Together **nowhere states** "tokens in one packed example
   cannot attend to tokens of another" or that its internal trainer uses varlen/FlashAttention
   sequence isolation for the JSONL path.
3. Together defines its packing by hyperlink to TRL's packing doc, which is FlashAttention-gated
   and example-preserving. This is definition-by-reference, not an explicit guarantee.

Missing for PROVEN: an explicit Together statement that (a) `train_on_inputs=false` masking is
applied per example and preserved inside packed windows, and (b) attention (and therefore loss
gradients) do not bleed across packed example boundaries.

---

## CHECK 2a — Server-side chat template application for training data

**Verdict: PROVEN.**

**Source: https://docs.together.ai/docs/fine-tuning/data-preparation** (conversational data
section), verbatim:

> "The dataset is automatically formatted into the model's [chat template](https://huggingface.co/docs/transformers/main/en/chat_templating) if one is defined. Instruction-tuned models always have a chat template; base models usually don't."

The hyperlink target is the Hugging Face `apply_chat_template` documentation — i.e., Together
declares it uses the model's own HF chat template for `{"messages": [...]}` JSONL.

Residual (informational, does not change the verdict): the exact template snapshot Together's
training workers load for `Qwen/Qwen3.5-9B` is not externally inspectable; the doc commits to "the
model's chat template," and the official template is unambiguous (below).

---

## CHECK 2b — Qwen3.5 template: training rendering vs. `enable_thinking=false` inference

**Verdict: PROVEN** (training targets and inference scaffolding are byte-identical), from the
official template source.

**Sources (fetched raw, 2026-07-28):**
- https://huggingface.co/Qwen/Qwen3.5-9B/raw/main/chat_template.jinja
- https://huggingface.co/Qwen/Qwen3.5-9B/raw/main/tokenizer_config.json — verified: the embedded
  `chat_template` field is **byte-identical** to `chat_template.jinja` (programmatic comparison),
  so there is no ambiguity about which template applies.
- Model card https://huggingface.co/Qwen/Qwen3.5-9B: "Qwen3.5 models operate in thinking mode by
  default, generating thinking content signified by `<think>\n...</think>\n\n` before producing
  the final responses." and "In multi-turn conversations, the historical model output should only
  include the final output part and does not need to include the thinking content. It is
  implemented in the provided chat template in Jinja2." Also: "Qwen3.5 does not officially support
  the soft switch of Qwen3, i.e., `/think` and `/nothink`."

### The load-bearing template lines (verbatim)

Final-assistant-message rendering (any assistant message after the last real user query — i.e.,
the training target in a `{"messages": [..., user, assistant]}` example):

```jinja
{%- if loop.index0 > ns.last_query_index %}
    {{- '<|im_start|>' + message.role + '\n<think>\n' + reasoning_content + '\n</think>\n\n' + content }}
{%- else %}
    {{- '<|im_start|>' + message.role + '\n' + content }}
{%- endif %}
```

Generation prompt (inference):

```jinja
{%- if add_generation_prompt %}
    {{- '<|im_start|>assistant\n' }}
    {%- if enable_thinking is defined and enable_thinking is false %}
        {{- '<think>\n\n</think>\n\n' }}
    {%- else %}
        {{- '<think>\n' }}
    {%- endif %}
{%- endif %}
```

### Derivation

**Training time** (full conversation, `add_generation_prompt` false): our plain-answer targets
have no `reasoning_content` and no `</think>` in `content`, so `reasoning_content` is `''` and the
final assistant message renders as:

```
<|im_start|>assistant\n<think>\n\n</think>\n\n{answer}<|im_end|>\n
```

(`'<think>\n' + '' + '\n</think>\n\n'` = `<think>\n\n</think>\n\n`.) So yes — the template DOES
insert an empty think block into the training target. Earlier assistant turns (before the last
user query) render with **no** think block (`else` branch), matching the model card's "historical
model output should only include the final output part."

**Inference time** with `add_generation_prompt=true` and `enable_thinking=false`, the prompt ends:

```
<|im_start|>assistant\n<think>\n\n</think>\n\n
```

and the model generates `{answer}<|im_end|>`.

**Parity:** the scaffolding is byte-identical. Training teaches the model to produce
`<think>\n\n</think>\n\n{answer}<|im_end|>` after `<|im_start|>assistant\n`; inference with
`enable_thinking=false` force-feeds exactly the `<think>\n\n</think>\n\n` prefix and asks for the
rest. There is no scaffolding the model sees at inference that it did not see at training, and
vice versa.

**Key robustness fact:** `enable_thinking` appears **only** inside the `add_generation_prompt`
block. It has **zero effect** on training-time rendering — so whatever kwargs Together does or
does not pass when applying the template to training data cannot change the training targets.

Two informational corollaries (not gate items):
- The empty-think tokens are inside the assistant message, so with completion-only loss they are
  trained targets — the adapter will also learn to *emit* an empty think block, which is harmless
  under `enable_thinking=false` (the block is force-fed) and degrades gracefully if thinking is
  ever left enabled.
- Together's serving stack accepts `chat_template_kwargs: {"enable_thinking": false}` on chat
  completions (shown on Together's Qwen3.5-9B model page, https://www.together.ai/models/qwen3-5-9b).

---

## Validation monitoring (informational)

**Verdict: SUPPORTED.**

- **Source: https://docs.together.ai/reference/post-fine-tunes** — request body includes
  `validation_file` ("File-ID of a validation file uploaded to the Together API") and `n_evals`
  ("Number of evaluations to be run on a given validation set during training") as **top-level job
  parameters**, alongside `training_type: Lora`. Nothing in the reference gates them on Full vs
  LoRA.
- **Source: https://docs.together.ai/docs/fine-tuning/supervised** — "`validation_file` | none | A
  held-out file to evaluate against during training. Required when `n_evals > 0`."
- **Source: https://docs.together.ai/docs/fine-tuning/monitoring** — "When you supply
  `validation_file` and set `n_evals > 0`, the response also includes `eval/loss` and other
  validation metrics." Sample metrics object: `{ "timestamp": ..., "train/global_step": 3,
  "train/epoch": 0.3, "eval/loss": 2.05 }`. Metrics are also mirrored to W&B via `wandb_api_key`.

So the validation-monitoring requirement (eval loss visible during a LoRA job) is supportable via
`validation_file` + `n_evals > 0` and the job metrics endpoint (`/reference/get-fine-tunes-id-metrics`).

---

## What remains unprovable from public docs, and what would prove it

Only CHECK 1 has a gap. Options, cheapest first:

1. **$0 — Sidestep the ambiguity entirely with pre-tokenized Parquet.** Together documents that
   Parquet input gives the caller full control of `input_ids`, `attention_mask`, `labels` (`-100`
   masking) and `position_ids` ("Reset to 0 at each example boundary inside a packed sequence"),
   and that "the `packing` flag ... has no effect on Parquet data." Tokenize locally with the
   official Qwen3.5-9B tokenizer + template, apply completion-only `-100` masking ourselves, pack
   with Together's own `tokenize_data.py` convention (or don't pack at all), and upload. The loss
   mask is then provably ours by construction. Cost: $0 extra; slight pipeline work. **This is the
   recommended mitigation if the gate must be hard-closed before spending.**
2. **$0 — Support ticket / official forum question to Together engineering.** Ask precisely: "For
   JSONL SFT with `packing=true` and `train_on_inputs=false`: (a) is the completion-only loss mask
   applied per example before packing and preserved inside packed windows; (b) does the trainer use
   position-id/varlen (FlashAttention) sequence separation so tokens cannot attend across packed
   example boundaries?" A written yes converts CHECK 1 to PROVEN.
3. **Pennies — empirical A/B canary.** Two minimal LoRA jobs on a tiny synthetic dataset (e.g.,
   200 examples where each answer is a per-example secret token that cross-example attention would
   leak), identical except `packing=true` vs `packing=false`, 1 epoch, min batch size, plus a
   validation file. Compare `eval/loss` trajectories and post-train behavior on probe prompts. At
   Together's per-token fine-tuning pricing a sub-100k-token pair of jobs costs on the order of
   cents to a few dollars. Detects gross mask loss or contamination, though absence of signal is
   weaker evidence than (1) or (2).

Nothing remains unprovable for CHECK 2: 2a is a direct doc statement, and 2b is proven from the
template source itself, independent of any Together behavior (because `enable_thinking` cannot
affect training-time rendering).

---

*Fetched artifacts (session scratchpad): `together-data-prep.md` (raw doc), `tokenize_data.py`
(Together repo), `qwen35_chat_template.jinja` + `qwen35_tokenizer_config.json` (HF raw, verified
identical templates).*
