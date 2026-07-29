# Hold-Out Evaluation Proposal — base vs `technician-v0` (awaiting Mike's budget)

**Status: PREPARED, NOT RUN. Zero paid calls made. Requires a fresh budget declaration
and a new single-use signed authorization before any provider call.**

## What it measures

Blinded A/B on the **25 reserved PowerFlex 40 records** (lineage
`rockwell-automation:22b-um001j-en-e`, split `held_out`, never trained on — leakage
guard enforced in code and CI-tested): base `Qwen/Qwen3.5-9B` vs
`mike_578c/Qwen3.5-9B-technician-v0-47089483`, identical prompts, temperature 0,
max 300 output tokens.

Harness: `factorylm_ai/dataset/holdout_eval.py` (dry-run proven end-to-end on the mock
provider; 5 hermetic guard tests in `tests/factorylm_ai/test_holdout_eval.py`).

- **Blinding:** per-record left/right assignment seeded from the prompt-set hash; model
  identities live only in `sealed_mapping.json` (opened after scores are locked; both
  files hash-chained in `run_summary.json`). The blinded file provably contains no
  model names (tested).
- **Deterministic scores** (computed for every output): unsupported-number detector
  (specificity not grounded in evidence/prompt), claim-term fidelity, safety-stance
  presence on safety-sensitive records, refusal shape on refusal records.
- **Judged scores** (blinded grader, per rubric): technical correctness, maintenance
  usefulness, grounding/evidence discipline, uncertainty honesty, safety, instruction
  following, hallucination, regression-vs-base. Reported per record AND aggregate;
  wins/ties/losses by interaction type (all 25 records share one lineage, so
  per-lineage breakdown is degenerate — reported honestly as such).
- **Small-sample honesty:** with n=25, the report REFUSES to claim improvement unless
  wins-losses is decisive (pre-registered: sign test p<0.05, i.e. ≥18/25 wins among
  non-ties); otherwise verdict is "insufficient evidence".

## Cost (independent local calculation — NOT provider estimates)

| Item | Count | Tokens (worst case) | Cost (worst case) |
|---|---|---|---|
| Generations | 50 calls (25 × 2 models) | 50 × (500 in + 300 out) = 40k | ~$0.04–0.08 serverless |
| LLM judge (optional, recommended) | 25 pairwise calls | 25 × (1,500 in + 200 out) ≈ 42.5k | ~$0.03–0.10 |
| **Expected total (serverless path)** | 75 calls | ~82.5k tokens | **< $0.25** |

**Endpoint risk (the real cost variable):** Together's model list shows serverless
LoRA variants for Qwen3.5-2B and -35B but **not** 9B — the tuned adapter may require a
dedicated endpoint (~$1.70–3.50/hr for a 9B). Eval runtime ≤15 min; worst case one
billed hour ≈ **$3.50**. Teardown guaranteed via the provider's
`TemporaryEndpointRun` + `TogetherEndpointLeaseLedger` (lease-ledger cleanup, already
in `together.py`). We attempt serverless first; endpoint only if serverless refuses
the adapter.

**Proposed authorized cap: $5.00** (single job umbrella, same unit as Gate 4).
Lesson from the unpacked-training incident applied: no provider estimate is trusted
as a bound; the run aborts if observed per-call usage exceeds the local worst-case
model by 2×, and the BudgetGuard hard-fails at the cap.

## Authorization binding (fields for the fresh single-use approval)

- `action`: `together.holdout_eval`
- `dataset_manifest_hash`: prompt-set hash `sha256:7efa6127b307f937463d2d28e067015e5f4a95e1e2a58e5b29150c53694c40a5`
- `model`: `Qwen/Qwen3.5-9B` (base; tuned adapter bound inside request_hash)
- `request_hash`: canonical hash over {action, prompt_set_hash, base model, tuned
  model, max_output_tokens=300, temperature=0, max_calls=50} — computed by the
  harness, verified AND consumed before the first network call
- `spend_cap_usd`: 5.00 · `single_use`: true · short expiry (24 h)

## The command Mike runs after declaring a budget

```
# 1. Mike (on any device): keygen + publish public key
py -3 tools/factorylm_ai/sign_paid_authorization.py keygen --private-key <outside-repo>
doppler secrets set FACTORYLM_AI_PAID_AUTH_PUBLIC_KEY_B64=<printed value> --project factorylm --config dev

# 2. Claude prepares authorization.json bound as above; Mike signs:
py -3 tools/factorylm_ai/sign_paid_authorization.py sign --private-key <key> \
    --authorization <auth.json> --registry <registry.jsonl>

# 3. The one live run (budget-capped, authorization consumed on first call):
FACTORYLM_AI_ALLOW_NETWORK=1 doppler run --project factorylm --config dev -- \
  py -3 -m factorylm_ai.dataset.holdout_eval run --live \
      --authorization <auth.json> --budget-usd 5.00
```

## If estimates are unavailable or inconsistent

Fail closed: the harness has no dependence on Together's estimate endpoint. The only
cost authorities are the local worst-case table above and the BudgetGuard cap; any
disagreement or overrun aborts the run with the authorization already consumed
(accepted single-use cost, same posture as Gate 4).
