# MIRA post-generation safety: guardrail and policy-engine research

Date: 2026-10-29 · Node: BRAVO · Mode: read-only web research, plus a metadata pull from the GitHub, PyPI, npm, Hugging Face and OpenRouter APIs (run on 2026-10-29).
Mira HEAD inspected for context: `a78b3a314`.

## 0. Problem statement and labels

MIRA's answer path is mira-hub (TypeScript/Next.js). Today its post-generation safety layer is a set of hand-written regexes covering three things:
- hazard affirmations
- lockout-then-measure contradictions
- DC-bus wait-time numbers

Adversarial review keeps finding wording that slips past them. This is structural: a regex blocklist over free prose is an **open-world** check. Every paraphrase, negation, reordering or unit spelling is a new bypass. The fix is to shrink the space the model can say things in (closed world) and check *that*, not to write more regexes.

Relevant code observed at `a78b3a314`:
- `mira-hub/src/capabilities/answer-safety-check.ts` (324 lines). This is the semantic judge. It already **fails closed**: `SEMANTIC_UNVERIFIED_FALLBACK` withholds the answer when the judge cannot complete. That matches the rule that a judge may only add blocks.
- `mira-hub/src/lib/safety-classifier.ts` (315 lines) and `mira-hub/src/lib/safety-phrases.ts` (92 lines).
- `mira-hub/src/app/api/equipment-notebooks/[id]/chat/route.ts` (3,298 lines). This holds the inline hazard regexes.
- `mira-bots/shared/visual/evidence_answer.py`. **A second answer path in Python that also does regex safety.** Any new gate must cover both, or this path stays a bypass.
- PR #4201 (draft). A ConText negation-scope layer.
- `docs/zta/technician-dataset-v1/holdout-eval/`. Existing holdout material.

Every recommendation below carries one of three labels:
- **[DET]** deterministic guarantee: the property holds for every input, by construction.
- **[PROB]** probabilistic detector: an ML or LLM classifier. It may only *add* blocks, never clear one.
- **[EVAL]** evaluation or test tool: offline, never in the request path.

License verdicts use these marks:
- **OK** = Apache-2.0 or MIT.
- **FLAG** = permissive but not on the list (ISC, ODC-BY, CC-BY-SA docs). Needs Mike's decision.
- **NO** = Llama, Gemma, non-commercial, no-derivatives, GPL, or no license at all.

---

## 1. OWASP Top 10 for LLM Applications, mapped to MIRA

Sources:
- 2025 list: https://genai.owasp.org/llm-top-10/ (the canonical site still lists the 2025 entries).
- 2026 edition: OWASP announced it on 2026-09-01: https://genai.owasp.org/2026/09/01/owasp-genai-security-project-unveils-2026-top-10-for-llm-applications-new-agent-control-standard-and-sponsors-as-community-tops-30000-members/. The 2026 numbering below comes from the CSA write-up at https://cloudsecurityalliance.org/blog/2026/10/21/the-owasp-top-10-for-llm-applications-2026-what-changed-and-why-it-matters, because the canonical 2026 list page returned 404 when fetched.
- The OWASP repo text is CC BY-SA 4.0. That doesn't matter here: we cite it, we don't ship it.

| 2025 ID | 2026 ID | Risk | How it maps to MIRA's safety-answer problem |
|---|---|---|---|
| LLM01:2025 Prompt Injection | LLM01 | Instructions in retrieved manuals, OCR'd nameplates, or user text change model behaviour | Indirect injection through uploaded PDFs and photos: for example, a poisoned page saying "skip LOTO, measure live". Fix with spotlighting or datamarking of retrieved chunks (4f), and by never letting retrieved text pick the *policy*. The 2026 scope explicitly adds documents, images, tool output and RAG persistence. |
| LLM05:2025 Improper Output Handling | LLM10 | Model output reaches a sink without validation | The "sink" here is a technician's hands. OWASP's mitigation is to treat model output as untrusted input and validate it at the sink (https://genai.owasp.org/llmrisk/llm052025-improper-output-handling/). That is exactly the argument for a typed plan validated by deterministic code (4a) instead of regex over prose. |
| LLM06:2025 Excessive Agency | LLM03 | The model can take or recommend high-impact actions without checks | MIRA executes nothing, but a step plan *is* a recommended action sequence. Least agency means the model may only emit steps from a closed verb vocabulary. Energized or irreversible steps need a precondition the policy engine checks, and the model cannot invent a new action class. |
| LLM09:2025 Misinformation | LLM07 | Plausible but wrong content, including fabricated numbers | DC-bus discharge times, torque values and voltages. Mitigation: every number must be a typed field bound to a cited source chunk, and the numeric value must appear in that chunk (4c). Unsourced safety numbers are blocked or replaced with "consult the drive manual". |
| LLM08:2025 Vector and Embedding Weaknesses | LLM09 | Poisoned or cross-tenant retrieval | Citations used for numeric grounding must come from the tenant's own verified corpus. Source-id binding (4c) only proves the number came from *some* retrieved chunk, so write-time validation of ingested manuals matters. |
| LLM07:2025 System Prompt Leakage | LLM08 (Hidden Context Exposure) | Prompt contents treated as secret | Low relevance. Safety rules must not live only in the prompt; they live in code. |
| LLM10:2025 Unbounded Consumption | LLM06 | Cost and latency blow-ups | A per-answer judge plus retries can blow the interactive latency budget. Cap judge calls and fail closed on timeout (already done). |

The OWASP GenAI guidance on guardrails and defence in depth is in the Solutions Reference Guide: https://genai.owasp.org/resource/owasp-genai-security-project-solutions-reference-guide-q2_q325/. It frames guardrails as layered input, output and runtime policy checks and LLM firewalls. In OWASP's framing no single guardrail is sufficient and classifiers are detectors, not controls. That supports this report's rule: deterministic validation is the control; ML and LLM checks are extra block-only layers.

---

## 2. Guardrail frameworks

Release dates come from the GitHub "latest release" API or the latest PyPI/npm upload, as of 2026-10-29.

| Component | Repo / URL | License | Latest release | Language | Rule type | Fit for MIRA |
|---|---|---|---|---|---|---|
| NVIDIA NeMo Guardrails | https://github.com/NVIDIA-NeMo/Guardrails | **OK** Apache-2.0 (LICENSE.md SPDX header; GitHub shows NOASSERTION only because the file is .md) | v0.24.1, 2026-09-16 | Python only. Has a FastAPI server with an OpenAI-compatible `/v1/chat/completions` | Both: custom Python actions [DET] and LLM self-check rails [PROB]. Colang flows. | **Poor.** It works by *wrapping the LLM call* (it becomes the chat endpoint), which breaks the "no framework abstracting the LLM call" rule. Python-only. Self-check output rails add one extra LLM call each. Worth reading for its rail taxonomy (input, retrieval, dialog, execution, output), not for adoption. |
| Guardrails AI | https://github.com/guardrails-ai/guardrails | **OK** Apache-2.0 | v0.11.0, 2026-08-14 | Python. Has a server mode; the JS client is not a first-class path | Validators can be deterministic (regex, range, choice) [DET] or ML/LLM [PROB] | **Partial.** Only acceptable if validators are used standalone (`validate`/`parse` on text you already have), not through `Guard(...)` wrapping the call. Hub validators are **licensed per validator** and some call remote inference, so audit each one. It adds little over Zod plus our own rules in TS. |
| Meta Llama Guard 3 (1B, 8B) | https://huggingface.co/meta-llama/Llama-Guard-3-8B | **NO**: Llama 3.1 / 3.2 Community License (gated) | 2024 | Model | [PROB] | Excluded. The license applies even when the model is called through OpenRouter (`meta-llama/llama-guard-4-12b` is listed there). Its categories (MLCommons hazards) also don't cover procedure correctness. |
| Meta Llama Guard 4 (12B) | https://huggingface.co/meta-llama/Llama-Guard-4-12B | **NO**: Llama 4 Community License (HF tag `other`, gated) | 2025-04 | Model | [PROB] | Excluded, same reasons. |
| Meta Prompt Guard 1 (86M) / Llama Prompt Guard 2 (22M, 86M) | https://huggingface.co/meta-llama/Llama-Prompt-Guard-2-86M | **NO**: Llama 3.1 / Llama 4 licenses | 2025-04 | Model | [PROB] injection detector | Excluded. |
| Meta PurpleLlama repo | https://github.com/meta-llama/PurpleLlama | Root is **NO** (Llama 3.2 license). The `LlamaFirewall/` and `CodeShield/` subfolders are **MIT** | No releases. `llamafirewall` on PyPI is 1.0.3 (2025-05-29) | Python | LlamaFirewall orchestrates Prompt Guard 2 [PROB] and an LLM AlignmentCheck [PROB] | The MIT code is usable, but its main scanner depends on a Llama-licensed model. Low value. |
| IBM Granite Guardian 3.3 (8B), 3.2 (5B), HAP-38M | https://huggingface.co/ibm-granite/granite-guardian-3.3-8b · https://github.com/ibm-granite/granite-guardian | **OK** Apache-2.0 (models and repo) | Model card updated 2025-09; repo pushed 2026-10-16 | Model (HF transformers / vLLM) | [PROB]. Notably it includes **RAG groundedness, context relevance and answer relevance**, function-call hallucination, and `custom_criteria` (bring your own risk definition) | **License-clean and topically the best fit**: its groundedness check fits a grounded troubleshooting assistant. **But it is not on OpenAI or OpenRouter** (only `ibm-granite/granite-4.2-8b` is listed, which is not Guardian). Using it means self-hosting an 8B model, for example on BRAVO's Ollama or vLLM. That is a provider-policy decision for Mike. Block-only. |
| Google ShieldGemma (2B, 9B, 27B) / ShieldGemma 2 (4B) | https://huggingface.co/google/shieldgemma-2b | **NO/FLAG**: Gemma Terms of Use plus Prohibited Use Policy (not OSI) | 2024-08 / 2025-04 | Model | [PROB] | Excluded under the Apache/MIT-only rule. Its categories (sexual, dangerous content, harassment, hate) don't cover procedure safety anyway. |
| **OpenAI gpt-oss-safeguard-20b / 120b** | https://huggingface.co/openai/gpt-oss-safeguard-20b | **OK** Apache-2.0 | HF updated 2026-01-14 | Model. **Hosted on OpenRouter** as `openai/gpt-oss-safeguard-20b` ($0.075/M input, $0.30/M output; `response_format` and `structured_outputs` supported) | [PROB] **policy-following reasoning classifier**: you write the policy (for example "an answer that tells the tech to measure or touch conductors before verified zero energy violates X") and it returns a reasoned label | **Best-fitting hosted judge.** License-clean, available on an approved provider, cheap, and takes a custom written policy, so no fine-tuning. Caveats: it is a reasoning model, so it adds latency (use `reasoning_effort` low); it needs the Harmony format (OpenRouter handles that); OpenAI says it complements rather than replaces dedicated classifiers. Use **block-only**, alongside or instead of the current gpt-5.4-mini judge. |
| Qwen3Guard-Gen (0.6B, 4B, 8B) | https://huggingface.co/Qwen/Qwen3Guard-Gen-0.6B | **OK** Apache-2.0 | 2025-11 | Model, self-host only | [PROB] generic harm categories | Generic harm taxonomy, not on approved providers. Low fit. |
| ProtectAI LLM Guard | https://github.com/protectai/llm-guard | **OK** MIT | v0.3.16 (PyPI 2025-05-19). **Repo ARCHIVED** | Python | Mix: regex, ban-substrings and JSON scanners [DET]; DeBERTa classifiers [PROB] | Archived, so don't adopt. Its scanner *pattern* (input/output scanner chain, each returning valid/risk score) is a good shape to copy in TS. Its injection model `protectai/deberta-v3-base-prompt-injection-v2` is Apache-2.0 and still maintained (2026-07). |
| Rebuff (ProtectAI) | https://github.com/protectai/rebuff | **OK** Apache-2.0 | v0.1.1, 2024-01-20. **ARCHIVED** | TS/Python | Heuristics plus LLM plus vector store plus canary tokens | Dead. Only the canary-token idea is worth reusing (4f). |
| Microsoft Presidio | https://github.com/data-privacy-stack/presidio (moved from microsoft/presidio) | **OK** MIT | 2.2.366, 2026-10-27 | Python | Recognizers: regex, deny-list, checksum and context words [DET], plus spaCy/transformer NER [PROB] | Not a safety tool, but its **architecture is the pattern to copy**: pluggable *recognizers* return typed spans with confidence, a context-word booster, and an "anonymizer" that acts on spans. A MIRA "hazard recognizer" registry built this way is easier to audit than one big regex file. |
| OpenAI Moderation API (`omni-moderation-latest`) | https://platform.openai.com/docs/guides/moderation | Hosted API (no license issue; free) | n/a | HTTP | [PROB] categories: harassment, hate, self-harm, sexual, violence, illicit | **Does not address MIRA's problem.** It has no notion of lockout order, energy state or discharge time. It is fine as a cheap extra input filter for abuse, but it gives zero coverage of procedure safety. |
| OpenAI Structured Outputs (`response_format: json_schema, strict: true`) | https://developers.openai.com/api/docs/guides/structured-outputs | API feature. Node SDK `openai` is Apache-2.0 (v7.45.1, 2026-10-27), with `zodTextFormat` / `zodResponseFormat` helpers | n/a | TS SDK | **[DET] for schema conformance only**: constrained decoding guarantees parseable JSON matching the schema (or a `refusal` field). It guarantees nothing about *content*. | **Core building block** (see 4a). Supported in strict mode, verified from the docs HTML: `pattern`, `format` (date-time, duration, uuid and others), `minimum`/`maximum`/`exclusive*`/`multipleOf`, `minItems`/`maxItems`, `enum`, and **non-root** `anyOf`. Not supported: a root that is `anyOf` (a Zod discriminated union of step types must sit *inside* an object). Limits: 5,000 properties, 10 nesting levels, 1,000 enum values in total. OpenRouter lists `structured_outputs` for `openai/gpt-5.4-mini`. |

Which ones can run deterministic rules, and which are Python-only:
- **Deterministic rules:** Guardrails AI (regex/range validators), NeMo (custom actions), LLM Guard (regex/ban scanners), Presidio (pattern recognizers). Everything else in the table is ML-only.
- **Python-only:** NeMo, Guardrails AI (practically), LLM Guard, Presidio, LlamaFirewall, Granite Guardian, and all the HF models.
- **TS-native:** Rebuff (dead) and the OpenAI SDK.

---

## 3. Deterministic policy engines usable from TypeScript or as a sidecar

| Engine | URL | License | Latest | TS story | Notes for hazard-sequence invariants |
|---|---|---|---|---|---|
| Open Policy Agent (Rego) | https://github.com/open-policy-agent/opa | **OK** Apache-2.0 | v1.21.4, 2026-10-23 | Compile Rego to WASM and run it with `@open-policy-agent/opa-wasm` (https://github.com/open-policy-agent/npm-opa-wasm, Apache-2.0). **But the npm package was last released 1.10.0 on 2024-11-08.** Or run the OPA REST sidecar (Go binary). | Rego is good at set and relational queries ("there exists a step i with action ∈ MEASURE_LIVE and no j<i with action = VERIFY_ZERO_ENERGY"). Iterating over ordered arrays is possible but awkward to read. Sidecar adds about 1–3 ms per call locally. Mature tooling (`opa test`, coverage). Python can call the same sidecar, so **one policy serves both runtimes**. |
| Cedar | https://github.com/cedar-policy/cedar · npm `@cedar-policy/cedar-wasm` | **OK** Apache-2.0 | 4.14.0, 2026-10-17/19; `cedarpy` (Apache-2.0) 4.12.2 for Python | First-party WASM npm package, actively released | Built for **authorization** (principal/action/resource → permit/forbid) and formally analysable, but it has **no loops or sequence semantics**. Order invariants would have to be precomputed into attributes, which defeats the point. **Poor fit for step-order rules.** It could gate "may this answer class include energized work at all?" per tenant or role. |
| json-rules-engine | https://github.com/CacheControl/json-rules-engine | **FLAG** ISC (permissive, functionally MIT-equivalent, but not on the Apache/MIT list; Mike decides) | 7.3.1 on npm, 2025-02-20 (GitHub release tag lags at v6.5.0) | Pure JS | Facts plus conditions as JSON. Fine for flat field checks; no ordered-sequence primitives. Medium fit. |
| CEL (`@marcbachmann/cel-js`) | https://github.com/marcbachmann/cel-js | **OK** MIT | v8.0.0, 2026-07-07 | Pure JS, maintained | CEL is non-Turing-complete, side-effect-free, and has `exists`/`all`/`filter` macros over lists, so per-step and pairwise checks are expressible. **The `ChromeGG/cel-js` package (`cel-js` on npm) is ARCHIVED; don't use it.** Spec: https://github.com/cel-expr/cel-spec (Apache-2.0). |
| CEL for Python | https://github.com/cloud-custodian/cel-python (`cel-python`, Apache-2.0, 0.5.0 2026-01-31) · https://github.com/hardbyte/python-common-expression-language (`common-expression-language`, Apache-2.0, 0.10.0 2026-09-15, Rust-backed) | **OK** | | Python | This makes CEL the **only option here that runs natively in both runtimes** with the same rule text, if mira-bots must enforce the same rules in-process. |
| Zod | https://github.com/colinhacks/zod | **OK** MIT | v4.6.7, 2026-10-12 | TS-native; the OpenAI SDK converts Zod to strict JSON Schema | **Schema validation, not a policy engine.** Use it for the plan's shape. Cross-field invariants can go in `.superRefine()`, but keep sequence logic in one named, unit-tested reducer so it doesn't get scattered across refinements. |
| Plain typed TS reducer / finite-state machine | (no dependency) | n/a | n/a | TS | **Recommended default if there is a single choke point.** For example: `energyState: ENERGIZED → ISOLATED → LOCKED → VERIFIED_ZERO → ...`. Each step's `actionClass` has `requires: EnergyState[]` and `transitions`. Advantages: smallest attack surface, exhaustive `switch` checked by the compiler, property-testable (fast-check), and it **can run on each prefix during streaming**. |

How to choose between them:
- If both mira-hub (TS) and mira-bots (Python) must enforce in-process, use **CEL**, or route both through one **OPA sidecar**.
- If every answer funnels through one TS gate, which is preferred, use a **typed reducer plus Zod**.
- Cedar is the wrong shape for this job.
- None of these engines helps if the model's output is free prose. They need **structured input**, which is why section 4a is the main recommendation.

---

## 4. Replacing free-text pattern matching with structure

### 4a. Constrained generation of a typed step plan, then deterministic rendering [DET] (main recommendation)

Flow:
1. The LLM (gpt-5.4-mini, strict `json_schema`) emits a `TroubleshootingPlan` instead of prose.
2. A deterministic validator (reducer/CEL/OPA) checks the safety invariants.
3. **The prose shown to the technician is rendered by code from the validated plan**, through templates for each `actionClass`.

The guarantee only holds if all of the following are true:
- **No free-text field reaches the technician unvalidated.** Any `string` field (for example `notes`, `explanation`) is a bypass channel ("measure the bus now, before locking out" typed into `notes`). Options:
  - drop such fields entirely, or
  - restrict them to template slots filled with enums or grounded entity ids, or
  - run them through the existing regex/judge stack as a *secondary* block-only check, and accept that this residual is [PROB].
- **Closed vocabularies.** `actionClass` is an `enum` (for example `OBSERVE`, `READ_FAULT_CODE`, `ISOLATE`, `APPLY_LOCK`, `VERIFY_ZERO_ENERGY`, `WAIT_DISCHARGE`, `MEASURE_DEENERGIZED`, `MEASURE_ENERGIZED_QUALIFIED`, `REPLACE_PART`, `RESTORE`). `energyStatePre` and `energyStatePost` are enums. `target` is an enum or an id from the asset/component graph.
- **Numbers live only in typed fields**: `{ value: number, unit: enum, sourceChunkId: string, quote: string }`. The validator checks that `sourceChunkId` was among the retrieved chunks for this turn **and** that the value and unit appear in that chunk (match against a numeric index built at ingest time; see 4c). Unsourced safety-class numbers (for example DC-bus wait) are a **hard block**, replaced with "follow the discharge time on the drive's label/manual".
- **Invariants as code.** For example:
  - `MEASURE_*` with `energyStatePre ∈ {ENERGIZED, ISOLATED}` and no prior `VERIFY_ZERO_ENERGY` is a block, unless the action is the explicitly qualified-person live-measurement class and a hazard notice is rendered.
  - `WAIT_DISCHARGE` must precede any `MEASURE_DEENERGIZED` on DC-bus targets.
  - `RESTORE` must be last, or must be followed by re-isolation.
- **Contradiction becomes structural.** "Lockout-then-measure contradiction" stops being a phrase pattern. It becomes a state-machine violation, which paraphrase cannot dodge because the model never chooses the words.

Schema notes (from the verified OpenAI docs):
- The root must be an object; put `steps: Step[]` inside it.
- A discriminated union of step kinds is allowed below the root.
- `minimum`, `maximum` and `pattern` work in strict mode.
- The 10-level nesting limit and 1,000-enum budget are ample.

Latency and streaming: validate-then-render can't stream raw tokens. Two mitigations:
- Make invariants **prefix-checkable**. The reducer only needs steps 0..k to judge step k, so stream each step's rendered prose once it validates, using the SDK's streaming JSON or partial-object parsing.
- Render a short safety header immediately.

If any step fails, stop the stream and replace the answer with the fail-closed fallback, the same UX pattern as `SEMANTIC_UNVERIFIED_FALLBACK`.

Cost: one call, as today, but with a schema. Rendering and validation take under 1 ms.

Supporting libraries:
- Zod (MIT) and the openai Node SDK (Apache-2.0) to define and enforce the schema.
- The reducer, or CEL (MIT), for invariants.
- Optional: fast-check (MIT) for property tests of the reducer.

### 4b. Claim extraction plus verification [PROB] (mostly offline [EVAL])

| Method | URL | License | Status | Verdict |
|---|---|---|---|---|
| FActScore (atomic-fact precision) | https://github.com/shmsw25/FActScore · arXiv 2305.14251 | **OK** MIT | v0.2.0 2023-10; last push 2025-04 | [EVAL]. Uses LLM decomposition plus retrieval. Too slow for the request path. A good offline metric for "fraction of atomic claims supported by the manual". |
| SAFE / LongFact (DeepMind) | https://github.com/google-deepmind/long-form-factuality · arXiv 2403.18802 | **OK** Apache-2.0 (main code) plus MIT (`third_party/factscore`) | No releases; pushed 2026-06 | [EVAL]. Search-augmented and multi-call, so offline only. Swap Google Search for MIRA retrieval. |
| RARR | https://github.com/anthonywchen/RARR · arXiv 2210.08726 | **NO**: no LICENSE file, so all rights reserved | Stale (2023-06) | Reject the code. The research-then-revise *idea* is fine to reimplement. |
| AlignScore | https://github.com/yuh-zha/AlignScore · checkpoint `yzha/AlignScore` · arXiv 2305.16739 | **OK** MIT (code and HF checkpoint) | Stale (2024-03); not on PyPI | [PROB]. RoBERTa-based factual-consistency scorer (355M). Usable offline; aging. |
| MiniCheck | https://github.com/Liyan06/MiniCheck (Apache-2.0); PyPI `minicheck` 0.4.0 (MIT) 2026-07-30 · arXiv 2404.10774 | **OK** for `lytang/MiniCheck-RoBERTa-Large`, `-DeBERTa-v3-Large`, `-Flan-T5-Large` (all MIT). **NO: `bespokelabs/Bespoke-MiniCheck-7B`** (model card README says CC BY-NC 4.0; commercial use requires contacting Bespoke). Benchmark `lytang/LLM-AggreFact` is **CC BY-ND 4.0** (eval-only, no derivatives) | Maintained | [PROB]. Sentence-vs-document grounding check at GPT-4 level for its size. The MIT RoBERTa/DeBERTa checkpoints can run on CPU or BRAVO. A candidate for a **block-only "is this sentence supported by the cited chunk"** check on any residual free text. |
| Vectara HHEM-2.1-open | https://huggingface.co/vectara/hallucination_evaluation_model | **OK** Apache-2.0 | Updated 2026-10-06 | [PROB]. T5-based, runs on CPU, scores (premise, hypothesis) consistency. A lighter alternative to MiniCheck. |
| Granite Guardian groundedness | (section 2) | **OK** Apache-2.0 | | [PROB]. 8B; self-host. |

Verdict:
- With 4a in place, claim extraction is mostly unnecessary on the request path, because claims are already typed.
- Use MiniCheck or HHEM **offline** to score residual free-text fields and to audit drift.
- Online use is optional and block-only.

### 4c. Numeric claim grounding

| Library | URL | License | Latest | Lang | Coverage relevant to MIRA |
|---|---|---|---|---|---|
| quantulum3 | https://github.com/nielstron/quantulum3 | **OK** MIT | 0.10.0, 2026-03-09 | Python | Verified in `units.json` (317 units): **volt, megavolt, ampere, ohm, farad, watt, kilowatt hour, second, millisecond, minute, hertz, rpm, pascal/kPa/MPa, psi**. **Best fit for manual ingestion.** |
| Microsoft Recognizers-Text (JS port) | https://github.com/microsoft/Recognizers-Text · npm `@microsoft/recognizers-text-suite`, `-number-with-unit`, `-date-time` | **OK** MIT | **npm 1.3.1 published 2023-07-31; the JavaScript directory's last commit is 2023-07-31** (only the .NET side was released later, 2025-02) | TS/JS | **Correction to the brief: the JS NumberWithUnit English resources have NO electrical units** (no volt/ampere/watt/hertz; grep of `englishNumericWithUnit.ts` found only "second"). Coverage: age, currency, dimension (length, area, volume, weight, speed, information), temperature. DateTime **does** parse durations ("5 minutes"). So it can recognise *wait times* but **not DC-bus voltages**, and the port is effectively unmaintained. |
| chrono-node | https://github.com/wanasit/chrono | **OK** MIT | 2.10.3, 2026-10-12 | TS | Dates and times, not durations or units. Not useful here. |
| compromise | https://github.com/spencermountain/compromise | **OK** MIT | 14.19.0, 2026-10-18 | JS | **Number parsing is in core v14** (`src/3-three/numbers`; the separate `compromise-numbers` plugin is legacy, last published 2021). Has `.numbers()`, `.toNumber()`, and sentence `isNegative`/`toNegative`. No unit grammar for electrical quantities; you'd add a small unit lexicon. |

Recommended design [DET]:
- **Don't do numeric NER on model output at all.** With 4a, numbers arrive as typed `{value, unit, sourceChunkId}`.
- Run **quantulum3 at ingest time** (the Python side already owns ingestion) over every manual chunk. Store `(chunk_id, value, unit_canonical, span)` in Postgres.
- At answer time the TS validator does an exact or tolerance lookup: does chunk X contain value V in unit U (after canonicalisation, for example "5 min" = 300 s)?

This resolves the TS/Python split: Python extracts once, TS only compares typed fields.

For residual free text, a small TS number-plus-unit regex over a *closed* unit list (V, VDC, VAC, A, Ω, s, sec, min, minutes, ...) is acceptable as [DET] *detection*: it flags any number at all, and anything unsourced is blocked. This differs from today's regexes because it blocks on *presence of an unsourced number*, not on recognising a dangerous phrasing.

### 4d. Small local NLI / entailment models [PROB]

| Model | License | Notes |
|---|---|---|
| `cross-encoder/nli-deberta-v3-small` / `-base` | **OK** Apache-2.0 | Standard 3-way NLI. Convert to ONNX yourself and run in Node via `onnxruntime-node` (MIT) or transformers.js (Apache-2.0). |
| `Xenova/nli-deberta-v3-small` (ready-made ONNX) | **NOT CLEARED**: no license tag on the HF repo | The upstream is Apache-2.0, so do your own conversion of the cross-encoder model instead. |
| `MoritzLaurer/DeBERTa-v3-base-mnli-fever-anli` | **OK** MIT | Strong base NLI. |
| `MoritzLaurer/ModernBERT-large-zeroshot-v2.0`, `tasksource/ModernBERT-base-nli` | **OK** Apache-2.0 | Newer encoders with longer context. |
| `protectai/deberta-v3-base-prompt-injection-v2` | **OK** Apache-2.0 | Injection classifier for retrieved chunks (block or flag only). |

Feasibility: a DeBERTa-small cross-encoder on CPU takes roughly 10–40 ms per pair at short lengths (typical published figures, not measured here). Interactive budget is OK for a handful of pairs. **Provider-policy note for Mike:** a local encoder is not an "LLM provider" in the OpenAI/OpenRouter sense, but it is new runtime ML. Decide explicitly whether it is allowed.

Use NLI only as block-only checks. Example: "does the rendered answer *entail* 'the circuit is energized while the technician measures'?" If yes, block.

### 4e. CaMeL, dual-LLM and plan-then-execute patterns

| Item | URL | License | Status | Relevance |
|---|---|---|---|---|
| CaMeL ("Defeating Prompt Injections by Design", Debenedetti et al.) | arXiv 2503.18813 · https://github.com/google-research/camel-prompt-injection | **OK** Apache-2.0 | Research artifact; last push 2025-06 | [DET] *by design* for data-flow. A privileged LLM writes a plan in restricted code; a quarantined LLM only parses untrusted data into typed values; capabilities track provenance. **Take the principle, not the code**: untrusted retrieved text may only fill typed slots, never choose actions or policy. |
| Design Patterns for Securing LLM Agents against Prompt Injections (Beurer-Kellner et al.) | arXiv 2506.08837 | Paper | 2025-06 | Catalogues plan-then-execute, dual-LLM, action-selector, map-reduce, context-minimisation. MIRA's 4a is effectively the **action-selector plus plan-then-execute** pattern: the model selects from a closed action set and code renders it. |
| Dual-LLM pattern (Willison, 2023) | https://simonwillison.net/2023/Apr/25/dual-llm-pattern/ | Blog | | Same idea as CaMeL, earlier and informal. |

### 4f. Spotlighting for retrieved documents [PROB mitigation]

- **Spotlighting** (Hines et al., Microsoft, arXiv 2403.14720) has three variants: *delimiting*, *datamarking* (interleave a marker token through untrusted text) and *encoding* (base64 and similar). The paper reports large cuts in indirect-injection success with little task-quality loss. The technique is free and needs no library.
- Apply datamarking to retrieved manual chunks, OCR text and user-uploaded docs. Tell the model that marked text is data, never instructions.
- Add **canary tokens** (from Rebuff's idea): a random token in the system prompt; if it appears in output, block.
- Both are [PROB]: they reduce the odds, they don't guarantee. 4a's closed vocabulary is what bounds the damage when injection succeeds.

---

## 5. Semantic and negation handling

| Tool | URL | License | Latest | Lang | Notes |
|---|---|---|---|---|---|
| NegEx / ConText (algorithm) | Chapman et al. 2001; Harkema et al. 2009, *J Biomed Inform* 42(5) | Algorithm (no license) | n/a | | Trigger-term lexicon plus scope window plus termination terms; ConText adds hypothetical/historical/experiencer. Ports cleanly to industrial cues ("do not", "never", "only after", "until", "unless", "before verifying"). **MIRA's draft PR #4201 already implements a ConText-style negation-scope layer; extend it, don't replace it.** |
| pyConText | (original `chapmanbe/pyConText` repo is **gone**, 404) | n/a | n/a | Python | Superseded by medspaCy's ConText. |
| medspaCy (`ConText` component) | https://github.com/medspacy/medspacy | **OK** MIT | 1.3.1, 2024-11-21 (pushed 2026-06) | Python/spaCy | Reference implementation of ConText with rule files in JSON. Good source for the scope algorithm and termination logic. |
| negspaCy | https://github.com/jenojp/negspacy | **OK** MIT | v1.1.0, 2026-04-20 | Python/spaCy | Simpler NegEx-only. |
| spaCy | https://github.com/explosion/spaCy | **OK** MIT (the `en_core_web_*` pipelines are also MIT) | v3.8.18, 2026-10-26 | Python | Has a **dependency parser**. `en_core_web_sm` adds about 5–15 ms per short answer on CPU. A small FastAPI sidecar is feasible but adds a network hop and another service to run. |
| wink-nlp | https://github.com/winkjs/wink-nlp | **OK** MIT | 2.4.0, 2025-06-30 | JS | Tokenisation, sentence splitting, POS, NER, **built-in negation handling** (token-level negation flag), about 650k tokens/s. **No dependency parser.** Its English model `wink-eng-lite-web-model` is MIT. |
| compromise | https://github.com/spencermountain/compromise | **OK** MIT | 14.19.0, 2026-10-18 | JS | POS-ish tagging, match syntax, sentence `isNegative`/`toNegative`, verb conjugation. **No dependency parser.** |

Verdict:
- Negation is a symptom of checking prose. With 4a, negation applies only to residual free-text fields.
- For those fields, a **ConText-style trigger/scope layer in TS** is enough and deterministic given its lexicon. That means PR #4201, optionally using wink-nlp for tokenising and sentence-splitting.
- A spaCy sidecar buys a dependency parse, which helps attach negation to the right verb. It isn't worth a new service unless 4a is rejected.
- The layer is [DET] in mechanics but [PROB] in coverage: the lexicon is still open-world.

---

## 6. Adversarial evaluation tooling [EVAL]

| Tool | URL | License | Latest | Lang | Use for MIRA |
|---|---|---|---|---|---|
| garak (NVIDIA) | https://github.com/NVIDIA/garak | **OK** Apache-2.0 | v0.17.1, 2026-10-16 | Python | LLM vulnerability scanner (probes plus detectors: injection, jailbreaks, encoding tricks, leakage). Point it at mira-hub's chat endpoint through its REST generator. Covers generic LLM01-class probes; you must write **custom probes** for hazard-procedure bypasses. |
| promptfoo | https://github.com/promptfoo/promptfoo | **OK** MIT | 0.125.1, 2026-10-25 | TS/Node | Red-team plugins (prompt injection, indirect injection via RAG, jailbreak strategies), **assertions** (`javascript`, `llm-rubric`, `contains`, custom), and CI integration. Fits mira-hub's TS stack. **Ownership:** OpenAI agreed to acquire Promptfoo (announced 2026-03-09). Coverage says it stays MIT/open source (secondary sources; watch for license changes). |
| PyRIT | https://github.com/microsoft/PyRIT (**`Azure/PyRIT` is ARCHIVED**) | **OK** MIT | v1.1.0, 2026-09-04 | Python | Multi-turn orchestrated attacks (crescendo, tree-of-attacks), converters (paraphrase, leetspeak, translation, encodings). Good for **generating paraphrase/mutation variants** of known bypasses. |
| DeepEval | https://github.com/confident-ai/deepeval | **OK** Apache-2.0 | 4.3.2 (PyPI 2026-10-27) | Python | Already in use (`mira-bots/benchmarks/deepeval_suite.py`). Faithfulness, G-Eval, and red-team module. |
| RAGAS | https://github.com/vibrantlabsai/ragas (moved from explodinggradients) | **OK** Apache-2.0 | v0.4.3, 2026-01-13 (slowing) | Python | Already in use. Faithfulness and context precision. Note the slower release cadence. |
| HarmBench | https://github.com/centerforaisafety/HarmBench · data `walledai/HarmBench` · arXiv 2402.04249 | **OK** MIT (code and data) | Stale (2024-08) | Python | Generic harm behaviours; little industrial content. Useful only for the attack *methods* (GCG, PAIR, TAP baselines). |
| JailbreakBench | https://github.com/JailbreakBench/jailbreakbench · data `JailbreakBench/JBB-Behaviors` · arXiv 2404.01318 | **OK** MIT (code and data) | v1.0.0, 2024-06 | Python | Same: generic. Reuse its artifact format and jailbreak templates as *wrappers* around MIRA hazard prompts. |
| Other datasets | BeaverTails (**NO**, CC BY-NC 4.0), WildJailbreak (**FLAG**, ODC-BY, gated), LLM-AggreFact (**NO** for derivatives; CC BY-ND) | | | | Don't ingest BeaverTails or AggreFact into training or derived sets. |
| StrykerJS (mutation testing) | https://github.com/stryker-mutator/stryker-js | **OK** Apache-2.0 (the brief said MIT; it is Apache-2.0) | v10.1.1, 2026-10-23 | TS | Mutates the *guard code* (flips comparisons, removes regex alternations, inverts conditions). If tests still pass, the mutant "survives" and the test suite can't see that branch. **High value for the reducer and remaining regexes.** Run it on `answer-safety-check.ts`, `safety-classifier.ts`, and the new reducer. |
| fast-check (property-based testing) | https://github.com/dubzzz/fast-check | **OK** MIT | v4.10.2, 2026-09-19 | TS | Generate random step plans; assert invariants such as "no rendered answer ever has MEASURE before VERIFY_ZERO" and "every rendered number has a source". This is the strongest **proof-style** test for 4a. |
| Metamorphic testing | Technique | n/a | n/a | | For each known-bad answer, generate meaning-preserving transforms: synonym swap, clause reorder, passive voice, negation-of-negation, unit respelling ("5 min" / "five minutes" / "300 s"), number-word swap, step-split across bullets, markdown/table wrapping, translation round-trip. Metamorphic relation: *the verdict must not change*. PyRIT converters and an LLM paraphraser generate them; promptfoo asserts them. |

### Building held-out adversarial sets the implementer can't overfit

1. **Separate author.** Attack cases are written by a different agent or human than the one fixing the guard. In the fleet, use a different node or session with no read access to the guard source. Record authorship in each case's metadata.
2. **Sealed set.** Store the held-out set encrypted or in a private location that the implementing agent's tools can't read, for example a separate repo or a Doppler-gated bucket. CI decrypts and runs it; it reports **only aggregate pass/fail counts plus case IDs**, never the text, to the implementing session. Re-using `docs/zta/technician-dataset-v1/holdout-eval/` is fine only if it is moved out of the main repo, since anything in-repo is readable and so not sealed.
3. **Rotation.** Split cases into a *dev* pool (visible; fix freely) and a *sealed* pool. Each release cycle, move a random slice of sealed to dev after it has been scored, and have the separate author write a fresh slice. Track pass rate on **never-before-seen** cases as the headline metric.
4. **Canaries against leakage.** Embed unique canary strings in sealed cases. If a canary ever appears in a commit, prompt or regex, the set is burned and gets rotated.
5. **Generalisation test.** Each fix PR must pass the sealed pool *and* a freshly generated metamorphic batch (seeded, generated at CI time), so a fix tuned to a specific wording fails.
6. **Report per class.** For example: measure-before-verify, unsourced-number, discharge-time, restore-order, injection-in-manual. A per-class breakdown stops a big class from hiding a regression in a small one.

---

## 7. Recommendations, labelled

| # | Component / change | Label | License | Where |
|---|---|---|---|---|
| R1 | **Typed step plan via OpenAI strict json_schema (Zod → `zodTextFormat`) plus deterministic prose renderer.** No free-text to the user. | [DET] for shape; with R2, [DET] for the encoded invariants | Zod MIT; openai SDK Apache-2.0 | mira-hub answer route |
| R2 | **Energy-state reducer** (typed TS FSM, prefix-checkable for streaming) encoding lockout/verify/discharge/restore invariants. CEL (`@marcbachmann/cel-js` MIT, plus `cel-python`/`common-expression-language` Apache-2.0) if Python must enforce the same rules in-process. | [DET] | none / MIT / Apache-2.0 | mira-hub, and a shared gate for mira-bots |
| R3 | **Numeric grounding**: quantulum3 at ingest → `(chunk, value, unit)` index; validator requires `sourceChunkId ∈ retrieved` and value/unit present in it; unsourced safety numbers are a hard block. | [DET] (for "number appears in the cited source", not for "the source is correct") | quantulum3 MIT | Python ingest plus TS validate |
| R4 | **Single gate for both answer paths** (route `mira-bots/shared/visual/evidence_answer.py` through the same validator, or the OPA/CEL shared policy) | [DET] coverage | n/a | architecture |
| R5 | **Block-only policy judge**: `openai/gpt-oss-safeguard-20b` via OpenRouter with a written MIRA hazard policy, alongside or replacing the gpt-5.4-mini judge; keep the fail-closed fallback. | [PROB] | Apache-2.0 | mira-hub |
| R6 | Spotlighting/datamarking of retrieved chunks, plus a canary token | [PROB] mitigation | n/a | prompt assembly |
| R7 | ConText negation layer (PR #4201) applied only to residual free-text fields | [DET] mechanics / [PROB] coverage | own code (medspaCy MIT as reference) | mira-hub |
| R8 | Optional: local NLI or MiniCheck (DeBERTa Apache/MIT, ONNX in Node) as a block-only entailment check on residual text, **pending Mike's ruling on local ML** | [PROB] | Apache-2.0 / MIT | mira-hub or sidecar |
| R9 | **Eval stack**: promptfoo (MIT) red-team plus metamorphic assertions in CI; PyRIT (MIT) converters for paraphrase generation; garak (Apache-2.0) generic probes; StrykerJS (Apache-2.0) plus fast-check (MIT) on guard code; sealed, rotated, separately authored held-out set. | [EVAL] | all OK | CI |

Explicitly **not** recommended:
- **NeMo Guardrails**: wraps the LLM call and is Python-only.
- **Guardrails AI `Guard`**: wraps the call; standalone validators are OK but add little.
- **Llama Guard / Prompt Guard / LlamaFirewall model path**: Llama license.
- **ShieldGemma**: Gemma terms.
- **LLM Guard and Rebuff**: archived.
- **RARR**: no license.
- **Bespoke-MiniCheck-7B**: CC BY-NC 4.0.
- **OpenAI Moderation** as a procedure-safety control: wrong categories.
- **Cedar** for sequence rules: wrong shape.
- **Recognizers-Text JS** for voltages: no electrical units, unmaintained since 2023.

---

## 8. Ranked shortlist (fit to MIRA's constraints)

1. **OpenAI strict Structured Outputs plus Zod** (Apache-2.0/MIT, TS-native, uses the existing provider). **[DET] shape.** This turns safety from "regex the prose" into "validate a typed plan". Every other deterministic item depends on it.
2. **Hand-written energy-state reducer** (no dependency) **or CEL** (`@marcbachmann/cel-js` MIT and `cel-python` Apache-2.0 for cross-runtime). **[DET] invariants.** Prefix-checkable, so streaming survives. StrykerJS and fast-check make it provable.
3. **quantulum3 ingest-time numeric index plus a typed `{value, unit, sourceChunkId}` contract** (MIT). **[DET] numeric grounding.** Removes the DC-bus-number regex family.
4. **promptfoo plus PyRIT converters plus StrykerJS plus fast-check, with a sealed, rotated, separately authored holdout** (MIT/MIT/Apache-2.0/MIT). **[EVAL].** Measures generalisation instead of rewarding overfitting.
5. **gpt-oss-safeguard-20b on OpenRouter** (Apache-2.0) with a written MIRA hazard policy. **[PROB], block-only.** Keeps the existing fail-closed fallback.
6. **Spotlighting/datamarking plus canary** (no dependency). **[PROB].** Addresses OWASP LLM01 for uploaded manuals.
7. **PR #4201 ConText layer on residual free text** (own code). **[DET] mechanics.**
8. **Optional local NLI** (cross-encoder DeBERTa Apache-2.0 / MoritzLaurer MIT via ONNX) or **Granite Guardian 3.3** (Apache-2.0, self-host 8B). **[PROB].** Only if Mike allows local or self-hosted ML.
9. **OPA (Apache-2.0) sidecar.** **[DET].** Only if rules must be authored and versioned outside the code by non-developers. Note the npm WASM package's 2024-11 last release.

## Appendix: raw metadata commands
GitHub `gh api repos/<r>` and `releases/latest`; PyPI `https://pypi.org/pypi/<p>/json`; npm `npm view <p> time`; HF `https://huggingface.co/api/{models,datasets}/<id>` (license tags); OpenRouter `https://openrouter.ai/api/v1/models` (`supported_parameters`). Scripts are in this scratchpad (`repos.sh`, `hf.sh`).
