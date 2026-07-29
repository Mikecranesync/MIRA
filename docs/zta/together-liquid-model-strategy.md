# Together + Liquid Model Strategy

**Verified 2026-07-19** against `docs.together.ai`, `together.ai/pricing`, `docs.liquid.ai`, and this
repo (`mira-bots/shared/inference/router.py`, `printsense/`, `simlab/`, `.claude/rules/`). Source: a
6-agent parallel recon pass (Together models/pricing, Together fine-tuning, Together platform/API,
Liquid LFM, MIRA repo seams, MIRA repo data assets). This doc is the pricing/economics/license
foundation `factorylm_ai/pricing.py` and `docs/zta/factorylm-ai-model-lab.md`'s fleet table are built
on. Companion doc: `docs/zta/factorylm-ai-model-lab.md` (the package architecture).

## 0. Method note — the live-probe law

Every section below inherited a hard lesson from this account's own 2026-07-18 testing: **Together's
own documentation contradicts itself about what is actually callable serverlessly**, repeatedly and
across unrelated product surfaces. Confirmed independently for:

- **Vision** — the rendered serverless-models catalog lists `moonshotai/Kimi-K2.6`,
  `Qwen/Qwen3.5-9B`, `MiniMaxAI/MiniMax-M3`, `google/gemma-4-31B-it` as serverless+vision; this
  account's real calls reject every Kimi/Qwen-VL/Llama-4/GLM vision id as non-serverless.
  `google/gemma-3n-E4B-it` is the one vision model with proven access — and it does not even appear
  on the catalog's own rendered vision table.
- **Rerank** — Together's 2024 blog announced a "serverless Rerank API"; the current
  `docs.together.ai/docs/rerank-overview` page states both known rerank models
  (`Salesforce/Llama-Rank-V1`, `mixedbread-ai/mxbai-rerank-large-v2`) are dedicated-endpoint-only.
- **Embeddings** — `togethercomputer/m2-bert-80M-32k-retrieval` and
  `Alibaba-NLP/GTE-ModernBERT-base` model pages both say outright *"This model is not available on
  Together's Serverless API"*, despite marketing copy describing "8 open source embeddings models"
  as available.
- **Chat** — `meta-llama/Llama-3.2-3B-Instruct`'s own page carries the identical
  not-available-serverless flag, despite being a headline Meta model.
- **Moderation** — `Llama Guard 4 12B` shows a serverless *price* on the pricing page while the
  official serverless-models catalog *simultaneously* states "there are currently no moderation
  models offered via serverless" — a direct self-contradiction on Together's own docs site.

**Rule this strategy follows everywhere below:** a model id is only "confirmed cheap serverless" here
if it has independent corroboration (its own model page **and** a catalog fetch **and**, ideally, a
third-party price tracker agreeing) — and even then, `factorylm_ai/providers/together.py` treats a
`model_not_available` response as a distinct, first-class `NotServerlessError` (never blindly retried
like a transient `ProviderError`) so a caller can act on it — the recommended caller-side pattern is to
permanently blacklist that model id for the session rather than re-asking a question the API already
answered. **Trust a live API call over any doc page, always.**

## 1. Together serverless reality

### 1.1 Base URL, auth, the exact rejection shape

- Base URL: `https://api.together.ai/v1` (current, documented). `api.together.xyz/v1` is a legacy
  alias `router.py` still uses — new code in this package uses the current host.
- Auth: `Authorization: Bearer $TOGETHERAI_API_KEY` on every endpoint, including multipart file
  uploads. Never logged, never echoed into an error/raw capture.
- The exact "not serverless" rejection (cross-consistent across multiple independent community
  incident reports, not a vendor schema doc, but textually exact every time):

  ```json
  {
    "error": {
      "message": "Unable to access non-serverless model <model-id>. Please visit https://api.together.ai/models/<model-path> to create and start a new dedicated endpoint for the model.",
      "type": "invalid_request_error",
      "param": null,
      "code": "model_not_available"
    }
  }
  ```

  Detector: **HTTP 400 AND `error.code == "model_not_available"`** (primary), falling back to a
  substring match on `"non-serverless model"` in `error.message` if the code field ever comes back
  empty. This is a *different* failure class from every other 400 — log it distinctly and never
  retry it; retrying just re-asks a question the API already answered.
- **HTTP 403 means context-length-exceeded on Together, not an auth failure** — inverted from most
  providers' convention (401 is auth here). A generic "4xx = auth or bad request" bucket copied from
  another provider's adapter will misroute this into a bad retry-with-same-oversized-payload loop;
  403 should trigger truncation/chunking instead.
- Rate limiting: Together **retired its Build Tier system** (Tier 1–5 / Scale / Enterprise no longer
  exist for a serverless pay-as-you-go account). Limits are fully dynamic and per-model, with no
  published RPM/TPM numbers to hardcode. A 429 carries `error_type`
  (`dynamic_request_limited` | `dynamic_token_limited`) and every response (not just 429s) carries an
  `x-ratelimit-reset` header. Retry policy: exponential backoff + jitter on 429 and on
  500/503/504/524/529 (transient-overload class); **never** retry 400/401/402/403/404 — those are
  permanent-until-fixed.

### 1.2 The confirmed-cheap table

$/M tokens, in / out. "Confidence" reflects how many independent fetches agreed (per §0's live-probe
law — re-verify with a real smoke call before routing production traffic to anything below "Highest").

| Model | Role in this package | $/M in | $/M out | Context | Confidence |
|---|---|---|---|---|---|
| `LiquidAI/LFM2.5-8B-A1B` | M05, M10, M12 | **0.03** | **0.12** | 128K (Liquid's own docs) / 32,768 (Together's own catalog page — **unresolved conflict**, treat 32K as safe) | High (3 fetches) — cheapest confirmed serverless TEXT model on the whole platform |
| `google/gemma-3n-E4B-it` | M01, M03 | **0.06** | **0.12** | 32,768 | **Highest — this account's own proven-working vision model**, even though it's absent from Together's own rendered vision catalog table |
| `openai/gpt-oss-20b` | M09 | **0.05** | **0.20** | 128,000 | High (3 fetches) — confirmed JSON mode + function calling |
| `intfloat/multilingual-e5-large-instruct` | M07 | **0.02** | 0.0 (embeddings) | **514 tokens (hard input cap)** | High (3 fetches) — the ONLY serverless embedding model on the platform |
| `openai/gpt-oss-120b` | M10 escalation | 0.15 | 0.60 | 128,000 | High |
| `Qwen/Qwen2.5-7B-Instruct-Turbo` | fallback | 0.30 | 0.30 | 32,768 | High (3 fetches) |
| `Qwen/Qwen3.5-9B` | M11 (documented) | 0.17 | 0.25 | 262,144 | Medium — vision claim on this id is unverified against this account |
| `meta-llama/Llama-3.3-70B-Instruct-Turbo` | text-cascade default (`router.py`), FT chat fallback | 1.04 | 1.04 | 131,072 | High — proven, heavily used in production already |

**Zero serverless rerank models exist** — see §1.3. Batch inference is a flat **50% off** the
real-time serverless rate, but **text models only**; the docs never mention image-input support for
`/v1/chat/completions` batch entries, and `google/gemma-3n-E4B-it` is not on the explicit
batch-discount allowlist (`Llama-3.3-70B-Instruct-Turbo`, `Llama-3-70b-chat-hf`,
`Qwen2.5-7B-Instruct-Turbo`, `Mixtral-8x7B-Instruct-v0.1`, `GLM-4.5-Air-FP8`, `whisper-large-v3` are
the named eligible models). **Do not route vision/OCR calls through Batch API without an isolated,
budget-capped empirical test first** — this package does not implement Batch API in this PR; it's
documented here as the corpus-processing lane for a future PR.

### 1.3 Zero serverless rerank

Both `Salesforce/Llama-Rank-V1` ("LlamaRank") and `mixedbread-ai/mxbai-rerank-large-v2` are
dedicated-endpoint-only, confirmed on `docs.together.ai/docs/rerank-overview`. A dedicated endpoint
has a real fixed-cost floor (**$5.49/hr for 1× H100** — roughly $4,000/month if kept warm 24/7) — the
opposite of a zero-token/pay-per-use architecture unless volume is very high. **This is a hard
blocker for a serverless-only rerank plan.** `factorylm_ai/tasks/__init__.py` does not register an
M08 task for this reason; the documented fallback is prompt-reranking a shortlist with
`LiquidAI/LFM2.5-8B-A1B` (JSON mode, pay-per-token) or leaning harder on BM25 fusion, which MIRA
already does.

### 1.4 Structured outputs and function calling

- `response_format` accepts `"text"` | `"json_object"` | `"json_schema"` | `"regex"` (the last is
  Together-specific, not in the OpenAI spec). `json_schema` shape:
  `{"type":"json_schema","json_schema":{"name":"<task>","schema":{...}}}`.
- **There is no `strict` flag.** Together's own guidance is to inline a plain-text copy of the schema
  into the prompt **in addition to** setting `response_format` — this is prompt-reinforced
  constrained decoding, not a grammar guarantee. `factorylm_ai/providers/together.py` follows this as
  policy: when `req.json_schema` is set, it is passed as `response_format` **and** appended to the
  system message as `"Return ONLY JSON matching this schema: ..."` — always both, never either alone.
  Every returned JSON string is parsed defensively (best-effort extraction of the first `{...}` block
  on a parse failure) and `json_valid` is set accordingly — never trust a Together `json_schema`
  response as pre-validated.
- Function calling is the standard OpenAI `tools`/`tool_choice` shape. `tool_calls` entries:
  `{index, id:"call_...", type:"function", function:{name, arguments:"<JSON string>"}}`. There is
  **no `parallel_tool_calls` flag** — the model returns multiple `tool_calls` automatically whenever
  it decides multiple functions are needed (a confirmed example showed 5 simultaneous calls from one
  request). Design any tool executor to always expect an array of 0–N tool calls per turn.

## 2. Fine-tuning economics

### 2.1 Training is cheap

LoRA SFT pricing by base-model-size tier (per 1M tokens processed = `n_epochs × training tokens +
n_evals × validation tokens`):

| Tier | LoRA SFT | LoRA DPO | Full SFT | Full DPO |
|---|---|---|---|---|
| ≤16B params | **$0.48** | $0.54 | $1.20 | $1.35 |
| 17B–69B | $1.50 | $1.65 | $3.75 | $4.12 |
| 70–100B | $2.90 | $3.20 | $7.25 | $8.00 |

**Minimum job charge: $4.00** for most models (larger/specialty models carry their own higher
minimums — e.g. `gpt-oss-120B` $6, `Kimi K2` $60, `DeepSeek-R1` $20 — none relevant to the ≤16B tier
this package targets). Worked example matching the handoff's illustrative scenario: **500 records ×
~1k tokens/record × 3 epochs = 1,500,000 billable tokens.** At $0.48/M LoRA-SFT that's **$0.72** —
below the $4.00 minimum, so **the job bills at the $4.00 floor** regardless of which ≤16B base is
chosen. Training an adapter is, in practice, a flat ~$4.

**Pricing-formula gotcha:** if `packing` is disabled, billing formula becomes
`len(dataset) × max_seq_length` — NOT actual token count. Leaving `max_seq_length` at a large default
(e.g. 32,768) while real examples average ~1K tokens can inflate a ~$4 job into $20+ purely from the
billing formula, not from more actual training happening. Keep `packing=true` (the default).

### 2.2 Serving is the catch — no serverless LoRA

**There is no documented serverless/per-token path to serve a fine-tuned LoRA adapter on Together, as
of this check (verified across 5 current docs pages: `fine-tuning/lora-vs-full`,
`fine-tuning/deployment`, `deploying-a-fine-tuned-model`, `lora-training-and-inference`,
`dedicated-endpoints/lora-adapter`).** Together's own Dec 2024 "Serverless Multi-LoRA" announcement
(pay only base-model per-token price) is absent from every current fine-tuning/deployment/LoRA page —
no explicit deprecation notice was found, only its total absence, so treat it as an inference from
absence, not a documented statement, but treat it as **gone** for planning purposes.

The current mechanism is **dedicated-endpoint LoRA attachment**: create ONE dedicated endpoint with
`--enable-lora`, then attach up to **16 adapters per endpoint** (5 for Qwen models) via
`tg endpoints adapters add`. All attached adapters share the endpoint's hardware at no extra
per-adapter charge — but the endpoint itself still bills **$5.49/hr for 1× H100 80GB on-demand**
(confirmed identically on two separate pricing pages), per minute, whether idle or not, with **$0
only while scaled to zero or deleted.** A single always-on H100 endpoint would run roughly
**$3,950/month** kept warm 24/7 (arithmetic from the documented hourly rate — Together does not quote
a monthly figure directly).

**Preflight before committing training budget:** some fine-tunable bases cannot be deployed as
dedicated endpoints at all. Run `client.endpoints.list_hardware(model="<BASE_MODEL>")` before
training — a 404 means the base can't host a fine-tune, mirroring this account's own
catalog-vs-access lesson one layer deeper.

### 2.3 The forced split: Together = training factory, local = runtime

Given §2.2, this package's economics point in exactly one direction, and the strategy states it
explicitly rather than leaving it implicit: **fine-tune on Together (cheap, ~$4/adapter), but serve
locally.** Two ways to use the dedicated-endpoint path, both bounded:

1. **Short-lived benchmark bursts only.** Spin up the shared H100 endpoint ($5.49/hr, billed per
   minute) to run an acceptance-test batch against all attached adapters together, then
   `tg endpoints delete` immediately. A ~30-minute eval run costs roughly **$2.75** — this is the
   `--live` proofpack shape, budget-capped and declared up front, exactly matching the
   "paid inference = validation only" law.
2. **Download-and-self-host for anything durable.** LoRA fine-tunes support three checkpoint types on
   download: `merged` (base+adapter combined, recommended for local use), `adapter` (LoRA weights
   only — `adapter_config.json` + `adapter_model.safetensors` shape), and `model_output_path` (raw
   training output). Download via `tg fine-tuning download <FT-ID>` (or
   `client.fine_tuning.download()`), output is a `.tar.zst` archive, load via Hugging Face
   Transformers (merged) or vLLM/PEFT (adapter-only). This is the durable production path — it avoids
   the recurring $5.49+/hr bill entirely and matches the existing local-Ollama-fallback pattern
   already in the cascade (Bravo node runs Ollama today).

`factorylm_ai/providers/together.py` exposes the fine-tune job helpers (`upload_file`,
`create_finetune_job`, `get_finetune_job`) purely as building blocks for this flow — nothing in this
PR stands up a dedicated endpoint or serves an adapter. `create_finetune_job` REQUIRES a
`BudgetGuard` plus a caller-supplied `est_training_tokens`: the dollar precheck (floored at the
$4.00 job minimum) runs before even the network gate, so an over-budget training job is refused
mechanically — the spend law applied to the most expensive call in the package. Serving is
deliberately future work, gated by `promotion.check_promotion()` and an explicit follow-up PR, per
`docs/zta/factorylm-ai-model-lab.md`'s graduation rule.

### 2.4 What can and cannot be fine-tuned

- **Standardize on `meta-llama/Llama-3.2-3B-Instruct`** as the shared base for FactoryLM's first
  adapters — LoRA + Full both supported, 131,072-token context, ≤16B pricing tier, and Llama's
  16-adapter-per-endpoint cap (vs Qwen's 5) leaves the most headroom to add adapters later without a
  second endpoint.
- **`google/gemma-3n-E4B-it` (this account's working vision model) is NOT fine-tunable on Together**
  — confirmed absent from both the general and the vision-specific fine-tuning supported-models
  lists. A fine-tuned vision adapter would have to target a *different* id
  (`google/gemma-3-4b-it-VLM` or `google/gemma-4-31B-it-VLM`) — a materially different model from the
  one in production, not a drop-in upgrade.
- **No LiquidAI/LFM model is fine-tunable on Together, at any size — confirmed by direct page fetch
  and by search.** LFM's hybrid gated-short-convolution architecture is not a transformer, so a
  Together-trained LoRA adapter is architecture-bound to whatever base it was trained against
  (Llama/Qwen/Gemma/etc.) and **cannot be re-hosted on an LFM base.** "Fine-tune on Together, move the
  adapter to Liquid" is not a supported path — Liquid-targeted fine-tuning happens entirely outside
  Together, via Liquid's own TRL/LoRA recipe (§4).
- Function-calling fine-tuning is real and well-documented (`messages` + `tools` + `tool_calls` JSONL
  schema, LoRA default) across Qwen 2.5/3/3.5, Llama 3.1/3.2/3.3/4, Gemma-4, Kimi K2, GLM, and
  `gpt-oss-20b/120b` — but it inherits the identical dedicated-endpoint-only serving constraint as
  everything else in this section.

## 3. The training-first roadmap

**First adapter: `factorylm_intent_router`** on `meta-llama/Llama-3.2-3B-Instruct`, LoRA, ~$4 (per the
§2.1 worked example — 500-ish records comfortably clears the $4 floor either way). Routing/intent
classification is exactly the "style/format/domain vocabulary" task LoRA is documented to handle well
(vs. teaching genuinely new knowledge, where Full FT or a bigger base wins). Benchmark via a
scale-to-zero dedicated burst (§2.3, item 1) or a local vLLM smoke test, gated through
`promotion.check_promotion()` before it is ever considered "ready," and served locally per §2.3, item 2, if
it graduates — never a standing Together endpoint.

**Then, in order:**

1. **`printsense_answer_contract_agent`** (M10) — same base, LoRA, same shared endpoint. Fallback if
   quality plateaus on 3B: `Qwen/Qwen2.5-7B-Instruct` (also ≤16B tier, LoRA-only, but forces a
   *second* dedicated endpoint since adapters must match their endpoint's base model — only split off
   if 3B genuinely underperforms, not for convenience).
2. **`feedback_record_curator`** (M12) — same base, same endpoint, structured-output/compliance
   shape identical to the answer-contract task.
3. **`printsense_tool_selector`** (M09, function-calling FT) — viable per §2.4's supported-model list;
   fine-tune on whichever base printsense's tool-call parser already expects the chat template from,
   so tool-call formatting stays consistent between the fine-tuned path and the serverless fallback.

**Every adapter is benchmark-gated via `promotion.check_promotion()` before anything downstream reads
it as "ready."** No exceptions, no shortcuts for a small/cheap adapter — the gate doesn't scale with
training cost.

**Data sources — extend what's already in the repo, don't build new curation:**

| Adapter | Primary data source | Why |
|---|---|---|
| `printsense_answer_contract_agent` (M10) | `tools/internet_print_test/benchmarks/2026-07-18-towerop/` — 24 judged (photo, question, real production reply, 14-criterion judge verdict, 6 hard-failure flags) captures, growing one case per `/print-eval-email-loop` run against `sources.json`'s license-clean public OEM sources | Already DPO/contrastive-ready with no new labeling: judge "fail" captures carrying a `hard_failures` flag (`invented_device_tag`, `false_certainty_on_illegible_area`, etc.) are negative exemplars; "pass"/"partial" high-`correctness_0_10` captures are positives. Photos are proprietary and must be pulled out-of-band per run, never committed. |
| `printsense_tool_selector` (M09) | `simlab/scenarios.py` (6 deterministic fault scenarios) + `simlab/observe/evalpacks/` (~10 labeled RCA cases) | The grader is deterministic code (`simlab.evaluation`, zero LLM, zero token cost) and scenario drift is a pure function of `(tick, seed)` — the corpus can be replayed at additional tick/seed pairs for free, generating fresh labeled `(question, tool-call sequence, evidence packet, pass/fail)` records with **zero marginal inference spend.** |
| `feedback_record_curator` (M12) | NeonDB `conversation_eval` (migrations 012/013) + `print_autoeval.py`'s deterministic flags + SQLite `interactions`/`feedback_log` | Real technician phrasing with route/model/`input_sha256`/`fallback_reason` provenance already flows through `mira-bots/shared/conversation_logger.py` (PII-sanitized, fail-open). `tools/harvest_golden_cases.py` and `tools/relational_distill.py` already implement the human-gated "propose, never auto-write" pattern this adapter's training-label source should imitate or directly reuse — don't re-derive that logic. |

**Minimal new capture to grow all three corpora, in priority order:** (a) schedule the existing
`mira_eval.score_conversation_eval` Celery beat on the VPS (built, not yet wired per project memory)
so every live turn is auto-scored with zero new code; (b) run `/print-eval-email-loop` against the
remaining `sources.json` OEM sources — one paid vision call per case, honoring the spend law; (c)
replay `simlab/scenarios.py` at additional `(tick, seed)` pairs — zero marginal cost; (d) add new
deterministic rules to `print_autoeval.py` — each new rule retroactively re-labels the entire
historical `conversation_eval` table for free.

**Frozen-corpus discipline — never violate this:** `golden_corpus`, `single_photo_cases`,
`session_cases`, `messy_captions`, and `robustness_transforms` are ONE sha256-frozen calibration lane
(`messy_captions` is explicitly paraphrases of `single_photo_cases`, so training on one while
evaluating on the other is a near-duplicate leak even though the files differ).
`printsense/benchmarks/unseen_lane/` is the **one true holdout** — its own README states in writing
that its content must never appear in any prompt, fixture, or few-shot example, and a guard test
enforces this mechanically. Training an adapter on `unseen_lane` content would retroactively
invalidate every existing PrintSense benchmark number. `factorylm_ai/flywheel/splits.py`'s near-dup
guard (never let a duplicate straddle train and holdout) is this package's mechanical analogue of that
same discipline — extend it, don't route around it.

## 4. Liquid verdict

### 4.1 License — a flagged policy decision, not a green light

Every public LFM/LFM2/LFM2.5 checkpoint ships under **"LFM Open License v1.0"** (Hugging Face tag
`lfm1.0`). It is **Apache-2.0-*derived* text, but it is not Apache License 2.0** — a distinct, custom,
non-OSI license because of an added revenue-threshold clause (Section 5) and automatic-termination
language. The threshold is exactly **$10,000,000 USD annual revenue** for the *using Legal Entity*:
below it, commercial use — including embedding model weights in a shipped product — is free, subject
only to attribution/NOTICE retention and marking modified files; at or above it, the license grants
**zero** commercial-use rights and requires contacting `sales@liquid.ai`.

**This conflicts on a literal reading with this repo's hard constraint #1, "Licenses: Apache 2.0 or
MIT ONLY,"** if LFM weights bundled into a shipped local/edge runtime count as a "dependency" under
that rule. The existing precedent (Groq/Cerebras/Together already serve non-Apache/MIT-licensed
models over a remote API without triggering that rule) suggests the rule targets bundled code
libraries, not third-party model weights accessed at inference time — but **embedding LFM weights
INTO a distributable local runtime (a plant-PC installer, an on-prem appliance image) is a materially
different act than calling a remote API**, and is exactly the scenario the license's Section 5 is
written for. **This package does not resolve that question — it flags it.**
`factorylm_ai/providers/local_liquid.py` stays a placeholder interface (`NotImplementedError` with a
doctrine message) in this PR. **No LFM weights ship until Mike makes an explicit, recorded policy
call** (a short ADR is the right shape, mirroring how ADR-0025 recorded the Drive Commander
read-only-fieldbus carve-out).

### 4.2 Edge reality (why Liquid is a real edge candidate, not vaporware)

Deployment tooling is genuinely edge-realistic — GGUF (llama.cpp/Ollama), ONNX, and MLX ship for
nearly every checkpoint:

- **LFM2.5-230M**: ~42 tok/s decode on a Raspberry Pi 5 (~$50–90), under 1GB RAM, Q4_K_M GGUF file
  ~153MB on disk (third-party benchmark, directly fetched).
- **LFM2.5-1.2B**: 720MB–1.1GB RAM across phone/laptop CPUs, 63–235 tok/s decode depending on
  platform (Liquid's own blog: 63–82 tok/s on a Snapdragon 8 Elite via llama.cpp CPU Q4_0; 96 tok/s on
  an Apple M4 Pro INT8; 235 tok/s on an AMD Ryzen AI Max 395 CPU). Liquid's own claim: "on par with
  Qwen3-1.7B" (47% more parameters) and "2x faster decode than Qwen3 on CPU."
- Any plant PC clears these numbers trivially — this is a genuine offline/zero-network-dependency
  runtime option, architecturally distinct from the remote-HTTP cascade
  (`InferenceRouter`/Groq→Cerebras→Together), not a fourth tier bolted onto it.
- **Known gotcha:** stable Ollama v0.17.0 fails on LFM's MoE variants (`LFM2-24B-A2B`,
  `LFM2-8B-A1B`) with a missing-tensor error; v0.17.1-rc0+ is required for those specifically. Does
  not appear to affect the dense checkpoints (230M–2.6B) that are the realistic edge-pilot candidates.

### 4.3 The two concrete Liquid lanes

| Lane | Model | Where | Status |
|---|---|---|---|
| **Prove Liquid quality today** | `LiquidAI/LFM2.5-8B-A1B` | Together serverless, $0.03/$0.12 per M | The one Liquid model with real (if unverified-against-this-account) serverless access — M05/M10/M12's default model in this package. Context conflict unresolved (Together shows 32,768, Liquid's own docs claim 128K for the same id) — treat 32K as the safe assumption until tested live. |
| **Future OCR-free edge extraction** | `LFM2.5-VL-450M-Extract` / `LFM2.5-VL-1.6B-Extract` | Local only — absent from Together entirely | Image → JSON directly (no OCR step), 128K context, 98.9%/99.6% JSON validity and 98.8%/99.6% schema-consistency F1 on Liquid's own 2,000-sample eval. The natural successor to the repo's current Tesseract-floor + LFM2-1.2B-Extract two-step for nameplate/keypad photos specifically — a genuinely compelling M06 candidate once the license question (§4.1) is resolved, not built in this PR. |

Do not spend Together credits validating the Extract nanos — they are absent from Together's catalog
entirely; the only thing Together can validate is general LFM output quality/style via the larger,
architecturally-different `LFM2.5-8B-A1B`, and per the spend law that should be a single declared,
budgeted test call, not iterative dev-loop usage.

## 5. What we do NOT do

- **No standing dedicated endpoints.** Every dedicated-endpoint use is a scale-to-zero benchmark
  burst, spun up and deleted around a declared `--budget-usd` — never a recurring bill (§2.3).
- **No vendor lock.** `providers.base.ModelProvider` is the seam every task/proofpack/flywheel caller
  codes against; `mock`/`together`/`local_liquid` are interchangeable behind
  `providers.get_provider()`. Nothing downstream imports a provider-specific type.
- **No production wiring without graduation.** Benchmark pass → `promotion.check_promotion()` →
  explicit follow-up PR is the only path from this package into a customer-facing seam. No paid
  provider is ever added to `mira-bots/shared/inference/router.py`'s free cascade — that cascade stays
  Groq → Cerebras → Together, exactly as it is today.
- **No training on frozen eval sets.** The six sha256-frozen PrintSense corpora (§3's
  frozen-corpus-discipline paragraph) and `printsense/benchmarks/unseen_lane/`'s mechanically-enforced
  holdout are never training inputs; `flywheel/splits.py`'s near-dup guard is this package's own
  version of that same law.
- **No LFM weights shipped** until the license policy question (§4.1) is explicitly resolved by Mike.
- **No direct fieldbus sockets, no bespoke ingest path.** If this package ever needs live plant/tag
  data, it goes through `mira-relay/ingest_contract.py` like every other source
  (`.claude/rules/one-pipeline-ingest.md`); it never opens a Modbus/EtherNet-IP/OPC-UA socket
  (`.claude/rules/fieldbus-readonly.md`).

## Sources / confidence ledger

Every number above traces to a 2026-07-19 fetch of `docs.together.ai`, `together.ai/pricing`, or
`docs.liquid.ai`, cross-checked where the recon pass fetched a page more than once. A handful of
figures are lower-confidence and are called out inline above rather than silently blended in:

- The LFM2.5-8B-A1B context-window conflict (32,768 vs 128K) — **unresolved from documentation
  alone**, needs a live long-context test.
- `Rnj-1 Instruct` and `meta-llama/Llama-3-8B-Instruct-Lite` pricing — single-fetch, **not**
  independently corroborated; confirm on their own model pages before relying on either id or price.
- `Prism-ML/Ternary-Bonsai-27B`'s $0.00 promotional price — corroborated by external sources as
  genuine but explicitly time-limited ("verify the current rate before you budget around it");
  **do not architect a production role around it staying free.**
- The exact `model_not_available` error JSON shape — community-sourced (cross-consistent incident
  reports), not a Together-authored schema doc; verify empirically against this account's own key
  before trusting it as a permanent contract.
- Mistral/Mixtral serverless availability — **zero hits across three official catalog fetches**;
  treat the entire family as not currently serverless until confirmed with a live model-list call.

Where this doc and a live API response disagree, **the live response wins** — that is the entire
lesson §0 opens with.
