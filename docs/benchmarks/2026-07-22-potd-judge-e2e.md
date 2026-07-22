# POTD judge packaging + independence — live staging E2E (2026-07-22)

Budget-declared acceptance test of the POTD judge packaging + independence PR
(v3.206.0), run against a freshly built staging container. Owner cap: **$0.15
USD hard ceiling**. One interpret + one judge call, **dry run** (no `--send`,
no schedule, no production change).

## Container

| | |
|---|---|
| Image | `mira-print-of-day:fe27249c…` (freshly built at this PR's HEAD) |
| Image revision (OCI label = `IMAGE_REVISION`) | `fe27249cac877322b77167788aba8622589e5993` |
| Provenance git_sha (from the run) | `fe27249cac877322b77167788aba8622589e5993` (matches) |
| Judge packaging | `shared.inference.router` COPYed into `/app/shared/` (3-file closure) |

**Judge import verified in-container** (keyless): `from shared.inference.router
import InferenceRouter; InferenceRouter()` → import + init OK (`enabled=False`,
`providers=[]` without keys). With a Together key + `INFERENCE_BACKEND=cloud`:
`enabled=True`, vision provider `('together', 'google/gemma-3n-E4B-it')` — a
model **different** from the interpreter's MiniMax-M3.

## Live run — model identities + independence

| | requested | returned |
|---|---|---|
| **Interpreter** | together / MiniMaxAI/MiniMax-M3 | together / **MiniMaxAI/MiniMax-M3** (4289 in / 1715 out) |
| **Judge** | free_cascade / (cascade-selected) | together / **google/gemma-3n-E4B-it** (2619 in / 1402 out) |

- **Independence:** `reduced_same_cascade` (class `reduced_same`) — same provider,
  **different model**, so NOT self-review.
- `self_review=false`, `identity_verified=true`, `validation_status=valid`,
  `provisional=true`.
- `judge_gold_blocked=false` on independence grounds (a real different model).
- Prompt SHA-256 `527cf2ace2461536…`, raw-response SHA-256 `450495757f3c2574…`
  recorded in the manifest.

## Gold behavior (the point of the PR)

- `eligibility.state = runtime_eligible`; **`gold_candidate = false`**
  (blocker: *"run is ungraded (no ground-truth rubric)"*); `approved_gold = false`.
- The judge ran, is identity-verified, and is a different model — so it does NOT
  block gold on independence — but the run is still **not a gold candidate**
  (ungraded), and only a human can set `approved_gold`. Human approval is intact.
- `degraded = []` (the judge is healthy and independent-enough; no silent
  downgrade).

## Spend

- Interpreter ≈ $0.0232, judge ≈ $0.0163 (conservative $3/$6-per-M upper bound;
  gemma-3n is cheaper in reality). **Total ≈ $0.0394 of the $0.15 ceiling.**
- Together/MiniMax + Together/gemma only; no Anthropic/OpenAI. No email sent
  (`--send` not passed). Production untouched; no PR-8; no schedule enabled.

## Reproduce

```
SHA=$(git rev-parse HEAD)
docker build -f tools/print_of_day/Dockerfile --build-arg GIT_SHA=$SHA \
  --build-arg VERSION=$(cat VERSION) --label org.opencontainers.image.revision=$SHA \
  -t mira-print-of-day:$SHA .
doppler run -p factorylm -c stg -- docker run --rm \
  -e TOGETHERAI_API_KEY -e GROQ_API_KEY -e CEREBRAS_API_KEY \
  -e INFERENCE_BACKEND=cloud -e FACTORYLM_NETWORK_MODE=enabled -e PRINT_VISION_MAX_TOKENS=4000 \
  -v <print>:/in/print.png:ro -v <work>:/work \
  mira-print-of-day:$SHA --case potd-judge-e2e --image /in/print.png --out /work/out \
  --source-url https://example.com/judge-e2e.png
```
