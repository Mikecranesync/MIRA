# FactoryLM AI Model Lab (`factorylm_ai/`)

**Status:** lab package, not wired into any customer-facing path. **Owner doctrine:** ADR-0028
(Vision Zero-Token Architecture and FactoryLM-Owned Model Program) and
`.claude/rules/zero-token-architecture.md`. **Companion doc:** `docs/zta/together-liquid-model-strategy.md`
(the pricing / fine-tuning-economics / Liquid-license recon this package is built on).

## Mission

Build a provider-agnostic AI model lab/runtime that uses Together AI as the hosted proving ground
(behind explicit env flags, budget-capped, dry-run by default) and Liquid/local as a future edge
runtime candidate, and that converts successful interactions into reusable artifacts: schemas, eval
cases, training records (Together fine-tuning JSONL), a ZTA artifact registry, and a
benchmark-before-assist promotion gate. **Technicians never see any of this.** CI is deterministic:
mock provider only, zero network, zero dollars.

## The loop: Infer → Capture → Review → Convert → Split → Train → Benchmark → Promote → Export → Run

This is the lifecycle every candidate model behavior moves through before it can ever reach a
technician. Each step is a real module in this package; nothing here is aspirational plumbing.

| Step | What happens | Module |
|---|---|---|
| **Infer** | Call a model against a `ModelRequest` — the mock provider in CI/dev, Together only behind the network gate | `providers.get_provider()`, `providers.base.ModelRequest`/`ModelResponse` |
| **Capture** | Every call's outcome (cost, latency, JSON validity, evidence presence) is schema-validated and appended to a JSONL audit trail | `telemetry.log_model_run()` / `telemetry.ModelRun` |
| **Review** | A human (or a deterministic grader) marks the run `accepted` / `corrected` / `rejected` | `telemetry.ModelRun.human_rating`; feeds `flywheel.records` |
| **Convert** | A reviewed interaction becomes a schema-validated `interaction_record`, `feedback_event`, `eval_case`, or `training_record` | `flywheel.records` |
| **Split** | Records are assigned to `train` / `dev` / `test` / `holdout` deterministically (sha256 of the record id), with a near-dup guard so no near-duplicate straddles train and holdout | `flywheel.splits.assign_split()`, `flywheel.splits.split_records()` |
| **Train** | Export `train`/`dev` to a Together fine-tuning JSONL and run a LoRA job (documented in the strategy doc; not executed by this PR) | `flywheel.export.export_together_jsonl()`, `providers.together.create_finetune_job()` |
| **Benchmark** | Run the frozen, deterministic proofpack experiments and score them | `proofpack.run`, `proofpack.experiments`, `proofpack.scoring` |
| **Promote** | Check every benchmark-before-assist gate against the recorded `PromotionDecision` | `promotion.check_promotion()` |
| **Export** | Approved, non-holdout records become a Together fine-tuning file (or the artifact itself is registered) | `flywheel.export`, `registry.ArtifactRegistry.register()` |
| **Run** | A human flips `runtime_allowed=True` on an artifact that has both `review_status="approved"` and `benchmark_status="pass"` — the ONLY way this ever reaches a live seam, and it is a follow-up PR, never automatic | `registry.ArtifactRegistry.allow_runtime()` |

Nothing loops back on itself silently: `check_promotion()` only CHECKS (it is pure — reads a dict,
returns a verdict, writes nothing); `allow_runtime()` only PROMOTES, and it is a human-invoked action
per its own module docstring — no code in this package (proofpack, evals, the providers, the
flywheel) ever calls it. **Automation may CHECK; only humans PROMOTE.**

## Relationship to the rest of MIRA (read this before wiring anything up)

`factorylm_ai` is the proving ground and artifact factory. **The production chat path stays
`mira-bots/shared/inference/router.py`** (the Groq → Cerebras → Together cascade) **and
`printsense/interpret.py`** (the paid print interpreter — the repo's only other isolated,
owner-gated paid-provider precedent). Nothing in this package runs in a customer-facing container
until it graduates:

```
benchmark pass  →  promotion gate (check_promotion() == True)  →  explicit follow-up PR
                                                                   wiring it into an existing seam
```

Together = model factory. Liquid/local = future edge runtime. **FactoryLM = the product.** This
package never adds a paid provider to `router.py`'s cascade (No-Anthropic-style law, PRD §4 / the
same discipline that keeps `printsense/interpret.py` unwired from the free cascade), never opens a
Modbus/EtherNet-IP/OPC-UA socket to a plant (`.claude/rules/fieldbus-readonly.md`), and never routes
plant/tag data through anything but `mira-relay/ingest_contract.py` if it ever needs to (the
one-pipeline-ingest law). If a graduated behavior is ever surfaced to a technician, it goes through
the existing grounding/citation/UNS-gate machinery — a model-lab output presented ungrounded to a
technician is a hallucination-audit failure by construction, not a shortcut this package takes.

## The spend law (ZTA Hard Rule 1)

> "Inference should only go to test the item being developed for ZTA, never used for other things;
> use Claude to fix any developmental issues." — Mike, 2026-07-17, verbatim
> (`.claude/rules/zero-token-architecture.md`)

Made mechanical by `budget.BudgetGuard`: every code path that could spend money declares a dollar
budget up front, calls `precheck(estimated_usd)` BEFORE the call, and calls `record(actual_usd)`
AFTER. Dry-run — the mock provider, `$0.0` everywhere — is the default across this entire package;
a `BudgetGuard` is only ever exercised by an explicit `--live` proofpack run. Debugging this package
never spends a real dollar: fix developmental issues against the hermetic mock-provider fixtures,
never by re-running a live call to see if it's fixed. Re-validation on unchanged inputs is banned —
if nothing about the artifact changed, a prior paid run's evidence still stands.

## Package map

```
factorylm_ai/
  __init__.py            # FACTORYLM_AI_VERSION, package docstring, relationship statement
  budget.py               # BudgetGuard — the spend-law seam
  pricing.py               # PRICING table + estimate_cost() — Together $/M token rates
  telemetry.py             # ModelRun dataclass + JSONL sink + schema validation
  registry.py               # ZTA artifact registry (append-only JSONL, fail-closed promotion)
  promotion.py               # benchmark-before-assist gate (this doc's "Promote" step)
  providers/
    base.py                    # ModelRequest / ModelResponse / ModelProvider ABC (the contract)
    mock.py                     # deterministic fixture provider — the CI default
    together.py                  # Together serverless via httpx (chat/vision/embeddings/rerank + FT jobs)
    local_liquid.py               # placeholder edge provider — raises NotImplementedError w/ doctrine msg
  tasks/
    __init__.py                    # TASKS registry (M01, M03, M05, M07, M09, M10, M12) + get_task()
    prompts/                        # one prompt-version .txt file per task
  schemas/
    validate.py                      # minimal JSON-Schema-subset validator (no jsonschema dependency)
    *.schema.json                     # model_run, interaction_record, feedback_event, training_record,
                                       # eval_case, promotion_decision, zta_artifact — each self-validating
                                       # via an embedded `examples` array
    task_outputs/*.schema.json         # per-task output shape (validated against the mock's canned outputs)
  flywheel/
    records.py                          # build/validate interaction_record, feedback_event,
                                         # training_record, eval_case
    redact.py                            # IP/MAC/serial redaction (independent of, same patterns as,
                                          # InferenceRouter.sanitize_context)
    splits.py                             # deterministic sha256 70/10/10/10 split + near-dup guard
    export.py                              # Together fine-tuning JSONL exporter (chat + function-calling)
  proofpack/
    __main__.py                             # python -m factorylm_ai.proofpack
    run.py                                   # CLI: --experiment e01|e02|e03|e04|all --live --budget-usd
    experiments.py                            # the 4 experiments (vision intake, intent routing,
                                               # retrieval, tool selection)
    scoring.py                                 # deterministic scorers
    report.py                                   # markdown report writer
    fixtures/                                    # committed, small, synthetic JSONL corpora
tests/factorylm_ai/                                # test_flm_ai_* — repo-unique basenames, no network
docs/zta/                                            # this doc + together-liquid-model-strategy.md
```

`factorylm_ai/data/` (runtime JSONL — model runs, the artifact registry ledger) and
`factorylm_ai/proofpack/reports/` (generated markdown reports) are gitignored — they are local,
regenerable state, never committed. `.venv-flmai/` (the package's own dev virtualenv) is gitignored
too.

## Env vars

All or-form (`os.getenv("X") or "default"`) — never a bare two-arg `os.getenv("X", "default")` —
because a compose-mapped `${VAR:-}` delivers an **empty string**, not "unset," and the two-arg form
only fires its default on a missing key. None of these are wired into any docker-compose file today
(this package doesn't run in a container); if that ever changes, this table is where the new row
goes, alongside `docs/env-vars.md`.

| Var | Values | Default | Notes |
|---|---|---|---|
| `FACTORYLM_AI_PROVIDER` | `mock` \| `together` \| `local_liquid` | `mock` | Resolved by `providers.get_provider(None)`. An explicit unrecognized name raises `ValueError` — no silent fallback. |
| `FACTORYLM_AI_ALLOW_NETWORK` | `true` \| `false` (and other truthy spellings, lowercased) | `false` | Half of the Together network gate. CI never sets this. |
| `FACTORYLM_AI_BUDGET_USD` | a non-negative float | `1.00` | Hard cap read by `BudgetGuard(cap_usd=None)`. Per-invocation, not global — a fresh `BudgetGuard` starts at `spent_usd == 0.0`. |
| `FACTORYLM_AI_DATA_DIR` | a directory path | `factorylm_ai/data` | Overridden in every test via `tmp_path` — nothing in `tests/` ever writes to the real data dir. |
| `FACTORYLM_AI_TOGETHER_TIMEOUT` | seconds (float) | `90` | httpx request timeout for the Together provider (or-form parsed — compose empty-string safe). Mirrors the production cascade's `TOGETHERAI_TIMEOUT=90` ceiling. |
| `TOGETHERAI_API_KEY` | (secret) | — | The existing repo secret name (Doppler-managed) — **reused, never renamed, never committed.** The other half of the Together network gate. |

Together is "live" only when **both** `TOGETHERAI_API_KEY` is non-empty **and**
`FACTORYLM_AI_ALLOW_NETWORK` is truthy. Missing either raises `NetworkDisabledError` before any
`httpx` call is attempted — tests never set either, so a test that accidentally exercises
`TogetherProvider.complete()` fails loudly instead of silently reaching the network.

## Running the tests

Hermetic, no network, no real dollars:

```bash
cd C:\wt-ocr
.venv-flmai/Scripts/python.exe -m pytest tests/factorylm_ai/ -v
```

Lint/format/type-check the package (the same commands CI runs):

```bash
.venv-flmai/Scripts/ruff.exe check factorylm_ai tests/factorylm_ai
.venv-flmai/Scripts/ruff.exe format --check factorylm_ai tests/factorylm_ai
npx -y pyright --pythonpath .venv-flmai/Scripts/python.exe   # factorylm_ai is in pyrightconfig.json's include
```

## Running the proof pack

**Dry-run (the default — mock provider, $0, deterministic, safe to run anywhere):**

```bash
python -m factorylm_ai.proofpack --experiment all
```

Writes `factorylm_ai/proofpack/reports/<timestamp>_<experiment>.md` plus a `ModelRun` JSONL row per
call via `telemetry.log_model_run()`. Exit code `0` means the pack ran and a report was written —
the SCORES inside the report may still show failures; a non-zero exit is a pack-execution error, not
a benchmark failure.

**Live run against Together, with an explicit, small, pre-declared budget (the spend law in
practice):**

```bash
export TOGETHERAI_API_KEY=...        # from Doppler factorylm/dev — never paste a prod value
export FACTORYLM_AI_ALLOW_NETWORK=true
python -m factorylm_ai.proofpack --experiment e01 --live --budget-usd 0.50 --images-dir ./some/dir
```

Omit `FACTORYLM_AI_ALLOW_NETWORK=true` (or the API key) and `--live` exits `2` with a clear message
instead of silently falling back to mock — a `--live` run that can't actually reach Together is a
configuration error to fix, not a run to quietly downgrade. `--budget-usd` is a hard stop: the
`BudgetGuard` inside the run raises `BudgetExceeded` the moment a call's estimated cost would push
`spent_usd` over the cap, before that call is made. This mirrors the "paid inference = validation
only" law (project memory, `.claude/rules/zero-token-architecture.md`) — a `--live` proofpack run is
a bounded, pre-budgeted acceptance test of the artifact already built by dry-run development, never a
debugging tool.

## Model fleet (M01–M13)

Pricing is Together serverless, $/M tokens, **verified 2026-07-19** — see
`docs/zta/together-liquid-model-strategy.md` for the full recon and the catalog-vs-access caveats.
"Registered" means the task has a `TaskSpec` in `tasks.TASKS` in this PR; the others are documented
for the roadmap but not built here — don't assume they exist.

| Task | Role | Registered in `TASKS`? | Model | $/M in | $/M out | Note |
|---|---|---|---|---|---|---|
| M01 | Vision intake classifier | **Yes** | `google/gemma-3n-E4B-it` | 0.06 | 0.12 | The only vision model with proven serverless access on this account — live-probe law, don't substitute a catalog-claimed vision model without testing it first. |
| M02 | *(reserved)* | No | — | — | — | Not defined by this package or the recon; a gap in the fleet numbering, not an omission to fix here. |
| M03 | Print region extractor | **Yes** | `google/gemma-3n-E4B-it` | 0.06 | 0.12 | Same model as M01; tile large/high-res prints (32K-token-equivalent context). |
| M04 | *(reserved)* | No | — | — | — | Not defined by this package or the recon. |
| M05 | Intent router | **Yes** | `LiquidAI/LFM2.5-8B-A1B` | 0.03 | 0.12 | Cheapest confirmed serverless text model on the platform; a Liquid model served on Together — the strategy convergence point. |
| M06 | OCR cleanup / field-parsing | Documented only | `LiquidAI/LFM2.5-8B-A1B` (Together) or local `LFM2-1.2B-Extract` (edge, future) | 0.03 | 0.12 | The repo's real OCR floor is Tesseract (`ocr_items`/`ocr_tokens`); M06 would sit downstream of it, not replace it. |
| M07 | Dense retriever embeddings | **Yes** | `intfloat/multilingual-e5-large-instruct` | 0.02 | 0.0 (embeddings) | The ONLY serverless embedding model on Together — hard 514-token input cap forces small chunk sizes. |
| M08 | Reranker | No — zero serverless models exist | — | — | — | Both known rerank models are dedicated-endpoint-only ($5.49/hr floor). Not built in this PR; a prompt-reranked shortlist via a cheap chat model is the documented fallback. |
| M09 | Tool selector | **Yes** | `openai/gpt-oss-20b` | 0.05 | 0.20 | Cheapest serverless model with confirmed function calling + JSON mode. |
| M10 | Answer writer (evidence-gated) | **Yes** | `LiquidAI/LFM2.5-8B-A1B` | 0.03 | 0.12 | Escalation path if grounding/citation discipline proves insufficient: `openai/gpt-oss-20b`. |
| M11 | Verifier | Documented only | `Qwen/Qwen3.5-9B` | 0.17 | 0.25 | Deliberately a different model lineage than the M10 writer, to catch correlated hallucination a same-family verifier would miss. |
| M12 | Feedback curator | **Yes** | `LiquidAI/LFM2.5-8B-A1B` | 0.03 | 0.12 | Cheap structured drafting; a batch/offline job (Together's Batch API gives a further 50% off text-only). |
| M13 | *(documented, not registered)* | No | — | — | — | Reserved for a future task; see `tasks/__init__.py`'s own docstring for the current, authoritative registered set. |

## Cross-references

- `docs/zta/together-liquid-model-strategy.md` — the full 2026-07-19 recon this fleet table and
  `factorylm_ai/pricing.py` are built on.
- `docs/adr/0028-vision-zero-token-architecture.md` — this package's charter/acceptance-criteria
  document (content-addressed identity, independent-verification gates, the model-registry/manifest
  requirements this package's `registry.py` implements).
- `.claude/rules/zero-token-architecture.md` — Hard Rules 1–3, the 5-question decision rule, the
  ZTA-1..8 backlog.
- `mira-bots/shared/inference/router.py` — the production free-tier cascade this package never adds
  a paid provider to.
- `printsense/interpret.py` + `printsense/providers/registry.py` — the repo's existing isolated
  paid-provider and fail-closed capability-registry precedents this package's `providers/together.py`
  and `registry.py` mirror.
- `.claude/rules/fieldbus-readonly.md`, `.claude/rules/one-pipeline-ingest.md` — the OT-read-only and
  single-ingest-pipeline laws this package never bypasses.
