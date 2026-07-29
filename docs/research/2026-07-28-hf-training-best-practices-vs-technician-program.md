# HF Training Best Practices vs. the FactoryLM Technician-Model Program

**Date:** 2026-07-28 · **Question:** Does the technician-model training program
(`docs/zta/2026-07-28-technician-training-plan-v2.md`, `factorylm_ai/dataset/behavior_spec.py`,
`technician_v2.py`, `holdout_eval.py`) follow industry-standard best practice for LLM
fine-tuning (and agent training) as documented by Hugging Face? What is it missing?

**Method:** compared against PRIMARY HF sources only — TRL docs, PEFT docs, the HF LLM
Course, the HF Agents Course, the HF Evaluation Guidebook (huggingface/evaluation-guidebook),
the Cosmopedia synthetic-data blog post, distilabel docs, and HF Hub dataset-card docs.
Anything not confirmable from those sources is marked **UNVERIFIED**.

---

## 1. Summary verdict: **PARTIALLY ALIGNED — aligned on method, thin on eval statistics and training-time monitoring**

The program's core design choices match HF-documented practice closely, and in several
governance dimensions it *exceeds* anything HF documents. The honest gaps cluster in four
places:

1. **Eval set size is below the HF floor.** The Evaluation Guidebook says "100 samples is
   usually a minimum for automatic benchmarks"; the frozen hold-out is 25 records. Plan v2
   Phase D's widening to 75–100 lands *at* the floor, not comfortably above it.
2. **Judge-bias mitigations are partial.** Per-record side randomization + a 3-judge panel
   covers position bias and self-preference at the panel level, but there is no per-judge
   order swap (each judge sees the same left/right for a record), no explicit
   length/verbosity-bias control, and no documented reasoning-before-score requirement.
3. **No training-time validation signal.** The LLM Course's first overfitting defense —
   watch validation loss vs training loss during the run — has no counterpart in the plan;
   all evaluation is post-hoc. (Whether a validation file is passed to the Together job:
   **UNVERIFIED** — not stated in the plan or eval harness.)
4. **The LoRA learning rate is below TRL's adapter guidance.** TRL: "When training
   adapters, you typically use a higher learning rate (≈1e-4)". The program uses 2e-5 —
   TRL's *full-model* SFT default, not its adapter recommendation.

The program's target — a grounded-answer **behavior policy** with knowledge supplied by
RAG at inference — is exactly the division of labor HF's own material implies: the LLM
Course frames SFT as behavior/format adaptation, and the Agents Course fine-tunes for
*robust behavior* (function calling), never for knowledge injection. On the biggest
architectural question, the program is right per HF's own doctrine.

---

## 2. Practice-by-practice comparison

| # | HF-documented practice (source) | What we do | Verdict |
|---|---|---|---|
| 1 | **SFT is the standard first post-training step**; prompt-completion / conversational message formats; chat template auto-applied ([TRL SFTTrainer](https://huggingface.co/docs/trl/en/sft_trainer)) | LoRA SFT on Qwen3.5-9B via Together, messages-format records | **Aligned** |
| 2 | **Completion-only / assistant-only loss**: TRL computes loss on completion tokens only by default for prompt-completion data (`completion_only_loss`), and `assistant_only_loss=True` for conversational data ([TRL SFTTrainer §Train on assistant/completion only](https://huggingface.co/docs/trl/en/sft_trainer)) | `train_on_inputs=False` on Together. Together's docs define it as loss masking: "prompts or user messages are excluded from the loss computation" ([Together fine-tuning reference](https://docs.together.ai/reference/finetune); their [multi-turn fine-tuning blog](https://www.together.ai/blog/fine-tuning-llms-for-multi-turn-conversations-a-technical-deep-dive) covers per-assistant-turn masking). Semantics match TRL's. | **Aligned** — with the note that recent research cited by Together ("Instruction Tuning With Loss Over Instructions") found *not* masking can help when responses are short relative to prompts and data is small; our long-evidence-prompt/short-answer shape is the classic case *for* masking, so the choice is defensible. |
| 3 | **Packing** for efficiency: `packing=True`, multiple examples per sequence ([TRL SFTTrainer §Packing](https://huggingface.co/docs/trl/en/sft_trainer); [LLM Course ch. 11.3](https://huggingface.co/learn/llm-course/en/chapter11/3): "multiple short examples to be packed into the same input sequence, maximizing GPU utilization") | `packing=True` | **Aligned.** Whether Together's packing preserves the loss mask correctly across packed boundaries: **UNVERIFIED** (TRL's `bfd` strategy does; Together's implementation is not documented at that level). |
| 4 | **Epochs:** "Begin with 1-3 epochs" ([LLM Course ch. 11.3](https://huggingface.co/learn/llm-course/en/chapter11/3)) | 3 epochs; plan v2 considers 2 for the larger corpus | **Aligned** |
| 5 | **Learning rate for adapters ≈1e-4**: "When training adapters, you typically use a higher learning rate (≈1e-4) since only new parameters are being learned" ([TRL SFTTrainer §Train adapters with PEFT](https://huggingface.co/docs/trl/en/sft_trainer)). TRL's 2e-5 default is for full-model SFT. | lr 2e-5 with LoRA | **Partial** — 5× below TRL's adapter guidance. Conservative lr is not wrong, but it is not the documented convention. |
| 6 | **LoRA rank/alpha/dropout:** rank "typically between 4-32"; "lora_alpha: scaling factor for LoRA layers, usually set to 2x the rank value"; dropout "typically 0.05-0.1" ([LLM Course ch. 11.4](https://huggingface.co/learn/llm-course/en/chapter11/4)) | r16 / alpha 32 (= 2×r) / dropout 0.05 | **Aligned** — textbook values. |
| 7 | **Target modules:** all-linear (QLoRA-style) "can provide performance equal to a fully finetuned model" vs q/v-only for efficiency ([PEFT LoRA developer guide](https://huggingface.co/docs/peft/main/en/developer_guides/lora); [LLM Course ch. 11.4](https://huggingface.co/learn/llm-course/en/chapter11/4)) | Whatever Together's LoRA job targets by default — **UNVERIFIED**, not pinned in our config | **Partial** — an uncontrolled hyperparameter. |
| 8 | **Seed / determinism:** `seed` in config, `full_determinism` option ([TRL SFTConfig](https://huggingface.co/docs/trl/en/sft_trainer)) | Seed fixed, explicit batch/checkpoints, content-hashed prompt sets | **Aligned** (exceeds — see §3) |
| 9 | **Chat-template consistency & EOS alignment:** TRL warns to align EOS with the chat template ("for `Qwen/Qwen2.5-1.5B`, one should set `eos_token=…`") and patches templates for assistant-only loss ([TRL SFTTrainer §Instruction tuning](https://huggingface.co/docs/trl/en/sft_trainer)); the Evaluation Guidebook warns models need proper templates/system-prompt placement at eval time ([automated-benchmarks tips](https://github.com/huggingface/evaluation-guidebook/blob/main/contents/automated-benchmarks/tips-and-tricks.md)) | Train and eval both go through Together's chat endpoint for the same model family; hold-out eval explicitly disables Qwen3.5 thinking mode on both sides | **Partial** — same-provider round-trip makes template drift unlikely, but we have never *verified* that the template applied at fine-tune time equals the one at inference (Together internal): **UNVERIFIED**. Thinking-mode handling at eval is a real, correct control. |
| 10 | **When SFT vs preference optimization:** DPO trains on preference pairs after SFT; TRL/smol-course sequence is instruction tuning → preference alignment ([TRL DPO trainer](https://huggingface.co/docs/trl/en/dpo_trainer), badge "smol_course Chapter 2 — preference alignment") | SFT only today; plan v2 Phase E banks base-vs-tuned preference pairs from every eval and names a DPO round as the next rung | **Aligned** (deliberately staged; pairs already accumulating) |
| 11 | **NEFTune** noise embeddings "can drastically improve model performance for instruction fine-tuning", alpha 5–15 ([TRL v0.13 SFT docs](https://huggingface.co/docs/trl/v0.13.0/en/sft_trainer); [NEFTune paper page](https://huggingface.co/papers/2310.05914)) | Not used; almost certainly not exposed by Together's managed API (**UNVERIFIED**) | **Missing / N-A** — worth knowing about, not actionable on a managed platform. |
| 12 | **Synthetic-data diversity:** Cosmopedia scaled diversity via audience × style × format variation ("up to 12x" per topic) and seed diversity, because "maintaining diversity... becomes significantly challenging when scaling up" ([Cosmopedia blog](https://huggingface.co/blog/cosmopedia)) | Plan v2 Phase B is exactly this: paraphrase axis, evidence-format axis, distractor axis, multi-turn axis over a fixed fact pool | **Aligned** — the v2 plan's own diagnosis ("one phrasing per fact" was the failure) matches Cosmopedia's lesson. |
| 13 | **Deduplication:** Cosmopedia found prompt variation alone "insufficient to prevent a high rate of duplicate content" ([Cosmopedia blog](https://huggingface.co/blog/cosmopedia)) | `technician_v2.py` diversity audit: Jaccard-over-4-grams near-dup detection at 0.85; build **fails** on violations | **Aligned** |
| 14 | **Decontamination / held-out hygiene:** Cosmopedia 10-gram overlap decontamination vs benchmarks; Guidebook: "assume that a dataset publicly available on the internet is or will be contaminated" ([Cosmopedia](https://huggingface.co/blog/cosmopedia); [Guidebook tips](https://github.com/huggingface/evaluation-guidebook/blob/main/contents/automated-benchmarks/tips-and-tricks.md)) | Public-benchmark contamination is N/A (private fact pool, private eval). Internal leakage is guarded harder than HF asks: lineage-based splits, PF40 lineage locked, `holdout_eval.build_prompt_set` hard-fails on any held-out record/lineage in the trained set, plus the A/B fact partition | **Aligned / exceeds** for the threat model that actually applies. |
| 15 | **Human-in-the-loop review:** distilabel + Argilla — synthetic pipelines with "Argilla integration for human feedback and annotation", research-backed generation steps ([distilabel docs](https://distilabel.argilla.io/latest/)) | Custom review-by-exception console: independent AI screening + bulk approval + deterministic QA sampling; strict machine gate (`validate_training_record`) *before* human time is spent | **Aligned** — same architecture (automated screen → human exception review), home-built instead of Argilla. |
| 16 | **Eval set size:** "100 samples is usually a minimum for automatic benchmarks"; "your evaluation result will only be as good as your evaluation dataset"; manually inspect ~50 random samples ([Guidebook: designing your automatic evaluation](https://github.com/huggingface/evaluation-guidebook/blob/main/contents/automated-benchmarks/designing-your-automatic-evaluation.md)) | 25 hold-out records today; Phase D targets 75–100 across ≥2 lineages | **Missing today / Partial after Phase D** — the plan itself admits "25-record verdicts stop being over-read". |
| 17 | **LLM-as-judge biases & mitigations:** position bias → "randomize answer positions"; self-preference → "deploy a jury of multiple judges"; inconsistency → reasoning-before-score + self-consistency; verbosity bias → account for length; judges underperform at *hallucination/faithfulness detection* ([Guidebook: model-as-a-judge tips](https://github.com/huggingface/evaluation-guidebook/blob/main/contents/model-as-a-judge/tips-and-tricks.md), [basics](https://github.com/huggingface/evaluation-guidebook/blob/main/contents/model-as-a-judge/basics.md)) | Blinded left/right with sealed mapping; deterministic per-record side assignment (position randomized across records); 3-judge panel; **deterministic metrics are primary** in Phase D, judges demoted to tie-breaker | **Partial** — see gap G2. The demotion of judges below deterministic metrics is *stronger* than HF's baseline precisely where HF says judges are weakest (hallucination/faithfulness — our fabrication axis is deterministic). |
| 18 | **Statistical treatment of small evals:** paired per-sample comparison; significance testing (Guidebook designing/tips; explicit test prescriptions are thin in the Guidebook itself) | Phase D: paired per-record win/loss + sign test | **Aligned (planned)** — not yet run. |
| 19 | **Overfitting monitoring during training:** "Validation loss increasing while training loss decreases (overfitting)"; monitor both quantitative metrics and actual outputs ([LLM Course ch. 11.3](https://huggingface.co/learn/llm-course/en/chapter11/3)) | No documented validation-loss monitoring during the Together job (**UNVERIFIED** whether a validation file is uploaded); qualitative output reading happens post-hoc via judges | **Missing** — see gap G3. |
| 20 | **Dataset documentation:** dataset cards with license, provenance, biases, curation rationale ([HF Hub dataset cards](https://huggingface.co/docs/hub/datasets-cards)) | No HF-style dataset card, but per-record lineage/rights/provenance metadata, rights-clean eligibility gates, and a plan doc — machine-checkable, which a card is not | **Aligned in substance**, missing only the standard card *format* (matters only if the dataset is ever shared). |
| 21 | **Agents: fine-tune vs prompt.** The Agents Course teaches tools + prompting as the mainline; fine-tuning appears only as a *bonus* unit for function-calling robustness ("function calling trains your model to take actions... making your AI more robust") ([Agents Course bonus unit 1](https://huggingface.co/learn/agents-course/en/bonus-unit1/introduction)); agent *evaluation* = observability, offline benchmark datasets, LLM-as-judge, cost/latency metrics ([bonus unit 2](https://huggingface.co/learn/agents-course/en/bonus-unit2/introduction)) | Knowledge via RAG + prompting; fine-tuning reserved for the behavior policy (cite-or-refuse, safety floor) — i.e., fine-tune only what prompting can't make robust | **Aligned** — this is the Agents Course's exact division of labor, and the LLM Course's "Consider SFT only if you need additional performance beyond what prompting can achieve" test is explicitly met (base model fabricated under pressure; tuned model didn't). |

---

## 3. What we do that HF doesn't emphasize (exceeds documented practice)

None of the following appears in the HF corpus reviewed; all reduce real failure modes:

- **Cryptographic spend governance:** live eval/training requires a fresh, single-use,
  signed `PaidEventAuthorization` bound to the prompt-set hash + models + generation
  params, verified and consumed through a trusted ledger before the first network call
  (`holdout_eval.py`). HF has nothing comparable.
- **Sealed blinding:** outputs stored as left/right with the model→side mapping sealed in
  a separate file; unsealing only after scores lock. The Guidebook recommends blinding in
  spirit; it does not specify a tamper-evident mechanism.
- **Answer-key independence (anti-self-training law):** the answer key derives from the
  evidence, never from the generating model (§15, plan v2) — a structural defense against
  the "echo-chamber effect" the Guidebook warns about, applied at *generation* time, not
  just judge time.
- **A/B fact partition:** a fact trained evidence-present may never be the withheld
  subject of an evidence-absent record, enforced at assembly with a failing audit
  (`technician_v2.py`). This anti-recall-leak law has no HF analogue.
- **Deterministic behavior validators as a training-data admission gate:**
  `validate_training_record` mechanically rejects any generated record with unsupported
  numbers/tokens, missing citation/safety/next-step markers, or claim leaks — before
  human review. distilabel's quality-filter steps are the nearest HF-ecosystem analogue,
  but they are LLM-judged, not deterministic.
- **Build-failing leakage guards** (`SystemExit` on held-out material in the trained set)
  rather than advisory checks.

---

## 4. Gaps and recommendations (ranked by impact)

**G1 — Eval set size and statistics (highest impact).**
25 records is a quarter of the Guidebook's stated minimum ("100 samples is usually a
minimum for automatic benchmarks" — [designing-your-automatic-evaluation](https://github.com/huggingface/evaluation-guidebook/blob/main/contents/automated-benchmarks/designing-your-automatic-evaluation.md)).
Phase D's 75–100 target should be treated as a floor, not a stretch goal: land ≥100
held-out records across the ≥2 lineages, keep the planned per-record sign test, and report
per-axis counts (deterministic metrics are cheap — the Guidebook's "unlimited samples via
rule-based generation avoids contamination" point applies directly to our deterministic
tracks). Also adopt the Guidebook's manual-inspection rule: eyeball ~50 random eval
records for quality before trusting any run.

**G2 — Complete the judge-bias mitigations (high impact, cheap).**
Per the [model-as-a-judge tips](https://github.com/huggingface/evaluation-guidebook/blob/main/contents/model-as-a-judge/tips-and-tricks.md):
(a) **Order swap per judge or per record-pass:** today the side assignment is randomized
*across* records but every judge sees the same order for a given record — a judge with
position bias biases that record for the whole panel. Either evaluate each record in both
orders and keep only consistent verdicts, or randomize order per judge.
(b) **Reasoning before scoring** in the judge prompt (mitigates inconsistency).
(c) **Length control:** track answer-length deltas between sides and check verdict-length
correlation (verbosity bias); the v1 "answers too bare" episode is exactly the signature.
(d) **Self-preference:** ensure no judge is from the same family as either evaluated model,
or note it as a known bias. The panel-of-judges and judges-as-tie-breaker decisions are
already the right structure.

**G3 — Add a training-time validation signal (medium impact).**
[LLM Course ch. 11.3](https://huggingface.co/learn/llm-course/en/chapter11/3): watch
validation loss vs training loss to catch overfitting during the run. Upload the
validation split to the Together job (Together supports validation files/evals —
**UNVERIFIED** for the exact job type used; confirm) and record the curves in the run
receipt. With a 25–50× larger corpus and 2–3 epochs this is the cheapest early-warning
instrument the program lacks.

**G4 — Revisit LoRA lr and pin target modules (medium impact).**
TRL: adapters "typically use a higher learning rate (≈1e-4)"
([SFTTrainer](https://huggingface.co/docs/trl/en/sft_trainer)). Our 2e-5 is 5× lower. On
the next run, either A/B a 1e-4 arm (fits under the $4 minimum anyway) or document why
conservative lr is intentional. Separately, pin (or at least record) which modules
Together's LoRA targets; [PEFT](https://huggingface.co/docs/peft/main/en/developer_guides/lora)
documents all-linear as the higher-capacity option — right now this is an invisible
hyperparameter.

**G5 — DPO as the next rung (medium impact, already planned).**
The banked base-vs-tuned preference pairs map exactly onto TRL's preference dataset format
(`prompt`/`chosen`/`rejected` — [DPO trainer](https://huggingface.co/docs/trl/en/dpo_trainer)),
and the SFT→preference-alignment sequence is the HF course progression. When a few hundred
pairs exist, the DPO round is the standard next step, not an exotic one. Note TRL's DPO
adapter lr guidance is ≈1e-6–1e-5, much lower than SFT.

**G6 — Verify Together's chat template and packing-mask behavior (low impact, one-time).**
Two **UNVERIFIED** provider internals worth one verification pass each: (a) the chat
template applied at fine-tune time equals the one at inference (TRL devotes a warning to
EOS/template alignment — [SFTTrainer](https://huggingface.co/docs/trl/en/sft_trainer));
(b) `train_on_inputs=False` masking is preserved correctly under `packing=True` across
packed-example boundaries. A single decoded-batch inspection or a Together support answer
closes both.

**G7 — NEFTune: note and skip (low impact).**
"Can drastically improve model performance for instruction fine-tuning"
([TRL v0.13 docs](https://huggingface.co/docs/trl/v0.13.0/en/sft_trainer)) — but it is a
trainer-side embedding-noise knob almost certainly unavailable on Together's managed API
(**UNVERIFIED**). Not worth switching platforms for; revisit only if training ever moves
to self-hosted TRL.

**G8 — Dataset card (lowest impact).**
If the corpus is ever shared beyond the repo, wrap the existing provenance metadata into an
HF-style dataset card ([Hub docs](https://huggingface.co/docs/hub/datasets-cards)). In-repo,
the machine-checked lineage already exceeds what a card provides.

---

## 5. Sources (primary)

- TRL SFTTrainer: https://huggingface.co/docs/trl/en/sft_trainer
- TRL SFTTrainer (v0.13, NEFTune section): https://huggingface.co/docs/trl/v0.13.0/en/sft_trainer
- TRL DPO trainer: https://huggingface.co/docs/trl/en/dpo_trainer
- PEFT LoRA developer guide: https://huggingface.co/docs/peft/main/en/developer_guides/lora
- HF LLM Course ch. 11 (intro / SFT / LoRA): https://huggingface.co/learn/llm-course/en/chapter11/1 · /3 · /4
- HF Agents Course bonus unit 1 (fine-tuning for function calling): https://huggingface.co/learn/agents-course/en/bonus-unit1/introduction
- HF Agents Course bonus unit 2 (observability & evaluation): https://huggingface.co/learn/agents-course/en/bonus-unit2/introduction
- HF Evaluation Guidebook — model-as-a-judge basics/tips, automated-benchmarks designing/tips: https://github.com/huggingface/evaluation-guidebook
- Cosmopedia synthetic-data blog (HF staff): https://huggingface.co/blog/cosmopedia
- distilabel docs (Argilla, HF ecosystem): https://distilabel.argilla.io/latest/
- HF Hub dataset cards: https://huggingface.co/docs/hub/datasets-cards
- NEFTune paper page: https://huggingface.co/papers/2310.05914
- Together fine-tuning reference (`train_on_inputs` semantics — non-HF, used only to verify provider semantics): https://docs.together.ai/reference/finetune · https://www.together.ai/blog/fine-tuning-llms-for-multi-turn-conversations-a-technical-deep-dive

**UNVERIFIED items carried in the text:** Together's default LoRA target modules; whether a
validation file is (or can be, for this job type) attached to the Together run; packing ×
loss-mask interaction on Together; train-vs-inference chat-template identity on Together;
NEFTune availability on Together.
