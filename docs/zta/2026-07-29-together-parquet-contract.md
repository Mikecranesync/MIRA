# Together Pre-Tokenized Parquet Fine-Tuning Contract — Primary-Source Verification

**Date:** 2026-07-29 · **Scope:** LoRA SFT on `Qwen/Qwen3.5-9B` via pre-tokenized Parquet upload
**Sources:** docs.together.ai (data-preparation, models, pricing, API reference), togethercomputer/together-python `main` (constants.py, utils/files.py, examples/tokenize_data.py). $0 spent; no API calls made.
**Method note:** quotes below were extracted via web-fetch summarization of the live pages; each is attributed to its URL. Anything the pages were silent on is marked UNVERIFIED.

---

## Verdict table

| # | Fact | Verdict | One-liner |
|---|------|---------|-----------|
| 1a | Parquet columns = `input_ids` (req), `attention_mask` (req), `labels` (opt), `position_ids` (opt) | **PROVEN** (docs) | Exactly these four fields documented; one row = one sequence. |
| 1b | Dtypes (int32 vs int64) | **UNVERIFIED** | Docs and SDK validator specify NO dtype; SDK checks column names only. Mirror `tokenize_data.py` (HF `datasets.to_parquet()` defaults) to be safe. |
| 1c | Max seq length for Qwen3.5-9B fine-tune | **PROVEN** (docs models table) | SFT context max = **65,536**; DPO = 49,152. Behavior for over-length Parquet rows: UNVERIFIED. |
| 1d | File limits | **PROVEN w/ drift** | Docs: "must be `.parquet` and under 100 GB"; SDK client constant `MAX_FILE_SIZE_GB = 50.1`. |
| 2 | `-100` loss mask respected verbatim | **PROVEN** (docs) | "Use `-100` to mask a position from the loss. Defaults to `input_ids`." Labels are NOT pre-shifted: "The trainer shifts them internally." |
| 3a | Packing flag has no effect on Parquet | **PROVEN** (docs + API ref, two independent pages) | "The `packing` flag applies only to JSONL input; it has no effect on Parquet data." |
| 3b | Supplied `position_ids` honored for boundary isolation | **PARTIAL** | Docs define the field's packed-boundary semantics (reset to 0 per example), implying it's honored; no explicit "we use your position_ids for attention isolation" sentence. **SDK client-side check REJECTS a `position_ids` column** (drift — see §3). |
| 4 | Billing for Parquet = tokens supplied? padding billed? | **UNVERIFIED** (key gap) | Pricing formula is per "tokens_per_training_dataset"; the only padding rule documented is JSONL-specific ("If you disable packing, training tokens are computed as `dataset_length` × `max_seq_length`"). No Parquet-specific billing language anywhere. |
| 5 | Parquet `validation_file` + `n_evals` eval loss | **UNVERIFIED** | API ref: `validation_file` is just a "File-ID… uploaded to the Together API" — format-agnostic, no Parquet statement either way. |
| 6 | estimate-price accepts a file id | **PROVEN** (SDK source) | SDK POSTs `fine-tunes/estimate-price` with `training_file` / `validation_file` **file IDs** + model/n_epochs/n_evals — so a Parquet file id is passable; Parquet-specific accuracy UNVERIFIED. |
| 7 | Reference build script exists | **PROVEN** | `together-python/examples/tokenize_data.py` — "Pretokenize examples for finetuning via Together"; packed + padded modes; linked from the docs. |
| 8 | Server-side tokenizer revision for Qwen3.5-9B | **UNVERIFIED / MOOT for Parquet** | No doc names a tokenizer revision. Docs explicitly say Parquet exists so you can "run with a tokenizer that differs from the base model's" — i.e. token IDs are taken verbatim; the server tokenizer question only matters for JSONL. |

---

## Evidence

### 1. Parquet schema

**Fields** — docs data-preparation page, "Tokenized (Parquet) data" section
(<https://docs.together.ai/docs/fine-tuning-data-preparation>):

> "Use Parquet when you want to skip tokenization on every job, customize attention masks or labels, or run with a tokenizer that differs from the base model's."

| Field | Required | Doc description (quoted) |
|---|---|---|
| `input_ids` | Yes | "Token IDs fed to the model" |
| `attention_mask` | Yes | "1 for tokens the model should attend to, 0 for padding" |
| `labels` | No | "Target token IDs. Use `-100` to mask a position from the loss. Defaults to `input_ids`" |
| `position_ids` | No | "Position IDs. Reset to 0 at each example boundary inside a packed sequence and increment by 1. Padding tokens also receive 0" |

- **One row = one sequence** (docs organize the format that way; the reference script emits one packed-or-padded sequence per row).
- **Shifting:** "You don't need to shift `labels` relative to `input_ids`. The trainer shifts them internally for next-token prediction." (same page)
- **File constraint:** "The file must be `.parquet` and under 100 GB." (same page)

**Dtypes:** UNVERIFIED. The docs table gives no arrow types. The SDK validator (`src/together/utils/files.py`) reads the file with `parquet.read_table(str(file), memory_map=True)`, checks `"input_ids" in column_names`, loops columns against `PARQUET_EXPECTED_COLUMNS`, checks `num_samples >= MIN_SAMPLES` — and "performs no dtype validation whatsoever." The reference script saves via HF `datasets` `tokenized_data.to_parquet(args.out_filename)` with no explicit schema (HF datasets default inference — `list<int64>` for Python-int token sequences). **De-risk: produce the file with the same `datasets.Dataset.to_parquet()` path as the reference script rather than hand-rolled pyarrow with int32.**

**Max sequence length for Qwen3.5-9B** — docs fine-tuning models table
(<https://docs.together.ai/docs/fine-tuning-models>):

> Model "Qwen3.5 9B", API ID `Qwen/Qwen3.5-9B` — Context (SFT) **65536**, Context (DPO) 49152; "Context lengths are the maximum for that model in SFT and DPO modes." Same context lengths listed for LoRA and full fine-tuning.

API reference (`POST /fine-tunes`, <https://docs.together.ai/reference/post-fine-tunes>): `max_seq_length` — "Maximum sequence length to use for training. If not specified, the maximum allowed for the model and training method will be used." What happens to a Parquet row longer than `max_seq_length` (truncate vs error) is **UNVERIFIED**.

**Metadata:** none required beyond the columns; no manifest/metadata row documented.

### 2. Loss-mask semantics

- "Target token IDs. Use `-100` to mask a position from the loss. Defaults to `input_ids`" (docs data-preparation).
- Reference script confirms the convention in code: `LOSS_IGNORE_INDEX = -100`, and padding labels set via `LOSS_IGNORE_INDEX if token_id == tokenizer.pad_token_id else token_id` (`examples/tokenize_data.py`).
- No other sentinel is documented. Nothing suggests the mask is re-derived server-side; combined with "customize… labels" as the *stated purpose* of the Parquet path, supplied labels are the operative loss mask. **Verdict: respected verbatim (PROVEN at doc level).**

### 3. Packing semantics on Parquet

Two independent primary statements:

1. Docs data-preparation: "The `packing` flag applies only to JSONL input; it has no effect on Parquet data."
2. API reference `POST /fine-tunes`, `packing` param: "Whether to use sequence packing for training. This flag has no effect if the training data is in Parquet format." (<https://docs.together.ai/reference/post-fine-tunes>)

So packing for Parquet is whatever you baked into the file. For self-packing, the documented boundary mechanism is `position_ids`: "Reset to 0 at each example boundary inside a packed sequence and increment by 1. Padding tokens also receive 0." The docs do **not** explicitly state that supplied `position_ids` drive attention isolation (e.g., blockwise attention/flash-attn varlen) — that inference is one doc-sentence deep. Also note the reference script's packed mode does **not** emit `position_ids` (it concatenates with EOS separators and chunks to `max_seq_len`: `buffer.extend(input_ids)`; `buffer.append(eos_token_id)`), i.e. Together's own reference packing relies on EOS boundaries, not position_ids.

**SDK drift (operationally important):** `src/together/constants.py` on `main`:

```python
PARQUET_EXPECTED_COLUMNS = ["input_ids", "attention_mask", "labels"]
```

and `utils/files.py` fails the file check on any column not in that list (sets `is_check_passed = False`, message "Parquet file {file} contains an unexpected column…"). **A Parquet file containing the doc-sanctioned `position_ids` column fails the SDK's client-side check.** Upload with the check disabled, or omit `position_ids`, or expect a newer SDK release to fix the constant. Whether the *server* accepts a `position_ids` column at training time is UNVERIFIED from source alone (docs say yes; SDK says no).

### 4. Billing for Parquet jobs — the decision-driving gap

Pricing page (<https://docs.together.ai/docs/fine-tuning/pricing>):

> "total_tokens = (n_epochs × tokens_per_training_dataset) + (n_evals × tokens_per_validation_dataset)"
>
> "If you disable packing, training tokens are computed as `dataset_length` × `max_seq_length` instead."
>
> "Your final token count and price are calculated and recorded after tokenization completes, after which they appear on the fine-tuning jobs dashboard."
>
> "Fine-tuning jobs have a $4.00 minimum charge. Some models are exempt."

The pricing page contains **no mention of Parquet or tokenized datasets**. Two readings are possible and the docs do not disambiguate:

- **Optimistic:** Parquet tokens are counted as supplied (`tokens_per_training_dataset` = sum of row lengths). Variable-length unpadded rows ⇒ you pay only for real tokens ⇒ **self-packing is pointless for billing** (it may still matter for throughput/step count, which Together eats, not you).
- **Pessimistic:** the "packing disabled ⇒ `dataset_length` × `max_seq_length`" rule generalizes to any non-packed data, and since the packing flag "has no effect" on Parquet, unpacked variable-length Parquet rows are billed as if padded to `max_seq_length` ⇒ **self-packing (or at least tight per-row lengths + explicitly small `max_seq_length`) is mandatory for cost control.**

**UNVERIFIED — this is the single most consequential open question.** It is empirically answerable for $0: call `fine-tunes/estimate-price` twice on two tiny Parquet files with identical token content, one padded to a large max length and one unpadded, and compare estimates (see §6).

Note the $4.00 minimum charge floors any small job regardless (project spend law: budget-declared validation runs only).

### 5. Parquet validation_file

- API reference: `validation_file` — "File-ID of a validation file uploaded to the Together API"; `n_evals` — "Number of evaluations to be run on a given validation set during training." (<https://docs.together.ai/reference/post-fine-tunes>)
- Docs (quickstart/guide): "At set intervals during training, the model is evaluated on your validation set and the evaluation loss is recorded in your job event log."
- No page states either "validation files may be Parquet" or "validation files must be JSONL". The file-upload validator applies the same Parquet check to any uploaded file with purpose fine-tune. **Verdict: UNVERIFIED** — no documented prohibition, no documented confirmation that eval loss respects Parquet labels/-100 in the validation set. (Symmetry with training strongly suggests yes, but that's inference, not documentation.)

### 6. estimate-price endpoint

From SDK source `src/together/resources/finetune.py` (main):

> POST `"fine-tunes/estimate-price"` with request parameters: `training_file` (File ID, required), `validation_file` (File ID, optional), `model` (required), `n_epochs`, `n_evals`, `training_type`, `training_method`. The method does **not** accept `max_seq_length` or `packing`.

Pricing docs corroborate: "API/SDK: Call the estimate price endpoint with the same parameters you plan to submit." (<https://docs.together.ai/docs/fine-tuning/pricing>)

Since the endpoint takes a **file id** with no format restriction, a Parquet file id is passable — the $0 pre-sign probe survives. Two caveats, both UNVERIFIED: (a) whether the estimator counts Parquet tokens exactly (vs a heuristic — recall "final token count… after tokenization completes" implies the estimate is not final); (b) the absence of `max_seq_length`/`packing` params means the estimator cannot see those job settings — consistent with either billing reading in §4, and a reason to treat the two-file A/B probe as the discriminating experiment.

### 7. Reference tooling

**`togethercomputer/together-python/examples/tokenize_data.py`** — "Pretokenize examples for finetuning via Together" — linked from the docs data-preparation page.
<https://github.com/togethercomputer/together-python/blob/main/examples/tokenize_data.py>

Key mechanics (from source):

- Writes `input_ids`, `attention_mask`, and (conditionally) `labels`. **Does not write `position_ids`.**
- `LOSS_IGNORE_INDEX = -100`; pad labels: `LOSS_IGNORE_INDEX if token_id == tokenizer.pad_token_id else token_id`.
- Packed mode: `process_fast_packing` — tokenize with `truncation=False`, then `pack_sequences` concatenates with EOS (`buffer.extend(input_ids)`; `buffer.append(eos_token_id)`) and chunks into `max_seq_len` blocks.
- Padded mode: `padding="max_length"` with truncation to `--max-seq-length` (default 8192).
- Tokenizer: `AutoTokenizer.from_pretrained(args.tokenizer)` (no `revision` pin in the script); `tokenizer.pad_token = tokenizer.eos_token`.
- Save: `tokenized_data.to_parquet(args.out_filename)` — HF datasets default arrow schema, no explicit pyarrow schema.
- Docs recommend the script's `--packing` mode to "reduce wasted compute, matching the packing training applies by default."

**De-risk recipe:** build our file by *modifying this script* (swap in our chat-template + completion-only label masking) rather than writing a fresh pyarrow producer — schema, dtypes, and layout then match Together's own reference by construction.

### 8. Tokenizer fidelity

- No Together doc names a tokenizer *revision* for `Qwen/Qwen3.5-9B` (or any model) used server-side for JSONL tokenization. **UNVERIFIED.**
- For the Parquet path the question largely dissolves: the docs' stated purpose includes running "with a tokenizer that differs from the base model's" — i.e., supplied token IDs are consumed verbatim; there is no server-side re-tokenization to drift against. The remaining fidelity requirement is ours: the IDs must be valid for the model's embedding table, so tokenize with `AutoTokenizer.from_pretrained("Qwen/Qwen3.5-9B", revision=<pinned>)` and record the revision hash in the run manifest ourselves.
- The reference script does not pin a revision (plain `from_pretrained(args.tokenizer)`); pinning is our own discipline, not a Together requirement.

---

## Discrepancies found (docs vs SDK, both primary)

| Item | Docs | SDK (`main`) |
|---|---|---|
| `position_ids` column | Optional, documented semantics | `PARQUET_EXPECTED_COLUMNS` excludes it → client file-check **fails** on it |
| Max file size | "under 100 GB" (data-prep page) | `MAX_FILE_SIZE_GB = 50.1` |
| Reference-script link target | docs link path says `together-py` | actual repo is `together-python` (link resolves) |

## Open questions — need a support ticket or a $0/low-cost empirical probe

1. **Parquet billing basis (§4, decision-driving):** are unpadded variable-length rows billed as supplied, or as `dataset_length × max_seq_length`? → **$0 probe:** upload two tiny Parquet files (same tokens; one padded, one not), call `fine-tunes/estimate-price` on each, compare. If estimates match token sums, drop self-packing; if they scale with padded length, self-pack.
2. **Server acceptance of `position_ids`** given the SDK client-check rejects it → upload with check disabled + estimate-price (accepted file id ⇒ server-side schema OK), or support ticket. Fallback: pack the reference-script way (EOS-separated, no position_ids) and accept cross-example attention within a block, exactly as Together's own reference does.
3. **Parquet `validation_file` + eval-loss label masking (§5)** → cheapest empirical check is bundling it into the first real (budget-declared) job with `n_evals=1` and inspecting the event-log eval loss; or support ticket.
4. **Over-length Parquet rows** vs `max_seq_length` / the 65,536 Qwen3.5-9B SFT cap: truncated or rejected? → keep all rows ≤ cap and the question never fires.
5. **Attention isolation inside packed rows** (does training use varlen/blockwise attention keyed on position_ids or EOS?): not documented at all. If isolation matters for our data, the conservative $-free answer is one-example-per-row unpadded (contingent on Q1 resolving to "billed as supplied").
6. **Dtype tolerance** (int32 lists vs int64): no doc, no validator check → sidestep by emitting via HF `datasets.to_parquet()` like the reference script.

## Primary-source URL index

- Data preparation (Parquet schema, -100, packing sentence, script link): <https://docs.together.ai/docs/fine-tuning-data-preparation>
- Fine-tuning models table (Qwen3.5-9B 65,536 SFT ctx): <https://docs.together.ai/docs/fine-tuning-models>
- Pricing (formula, packing-disabled rule, $4 min, estimate methods): <https://docs.together.ai/docs/fine-tuning/pricing>
- API reference `POST /fine-tunes` (packing/no-effect-on-Parquet, max_seq_length, validation_file, n_evals): <https://docs.together.ai/reference/post-fine-tunes>
- Reference script: <https://github.com/togethercomputer/together-python/blob/main/examples/tokenize_data.py>
- SDK constants (`PARQUET_EXPECTED_COLUMNS`, `MAX_FILE_SIZE_GB`): <https://github.com/togethercomputer/together-python/blob/main/src/together/constants.py>
- SDK Parquet validator (column-name-only check, no dtypes): <https://github.com/togethercomputer/together-python/blob/main/src/together/utils/files.py>
- SDK estimate-price method (`fine-tunes/estimate-price`, file-id params): <https://github.com/togethercomputer/together-python/blob/main/src/together/resources/finetune.py>
