# Notebook retrieval: staging and production configuration (2026-10-21)

Owner: retrieval evaluation (#4576). Read-only snapshot: Doppler values, compose passthroughs and
`/api/health` were read and nothing was changed. **Re-read before relying on it**, because flags move.

## The two builds

| | Staging (`app-staging.factorylm.com`) | Production (`app.factorylm.com`) |
|---|---|---|
| Hub build (`/api/health` `gitSha`) | `8bce49000` (built 2026-10-21 02:44Z) | `22164415a` (built 2026-10-20 05:30Z) |
| Tracing | on (Langfuse OTLP) | **off** |

Retrieval-path commits in staging but not production: #4546 and #4549 (vector-lane warm-up and
telemetry), #4550 (claim verifier, shadow, off), and #4556 (lexical IDF behind its flag). With the
flags off, all four are behaviour-neutral or trace-only. **A "production configuration" arm on
staging is still not the production build.**

## Retrieval and answer-stage switches

"Effective" means what the container actually receives. A Doppler value only reaches the hub if
the compose file forwards it.

| Switch | Code default | Staging Doppler | Staging effective | Production Doppler | Production compose forwards it? | Production effective |
|---|---|---|---|---|---|---|
| `NOTEBOOK_LEXICAL_V2` (IDF ranking) | off | `1` | **on** | unset | **no** | off |
| `NOTEBOOK_HYBRID_RETRIEVAL` (vector lane + RRF) | off | `1` | **on, mostly skipped** (below) | unset | yes (`:-0`) | off |
| `NOTEBOOK_RERANK` (cross-encoder) | off | `1` | **on, fallbacks unrecorded** (below) | unset | **no; there is no reranker service either** | off |
| `NOTEBOOK_RERANK_TIMEOUT_MS` | 1500 | `4000` | 4000 | — | no | — |
| `RERANKER_MODEL` | `int8-avx2` (compose) | **`fp32`** | fp32 | — | — | — |
| `MIRA_ENFORCE_APPROVED_RETRIEVAL` | false | `true` | on | `true` | yes | on |
| `NOTEBOOK_ANSWER_GATE` | on | unset | on | unset | n/a (default) | on |
| `NOTEBOOK_SEMANTIC_CHECK` | on | unset | on | unset | n/a | on |
| `NOTEBOOK_ENERGIZED_HARD_STOP` | on | unset | on | unset | n/a | on |
| `NOTEBOOK_CLAIM_VERIFIER` | off | unset | off | unset | not forwarded | off |
| `NOTEBOOK_GARBLE_DECODE` | on | unset | on | unset | yes (`:-1`) | on |
| `NOTEBOOK_GUIDED_PROCEDURE` | — | `1` | **nothing reads it** | unset | — | — |
| Answer model | `OPENAI_MODEL` `gpt-5.4-mini` | unset → default | gpt-5.4-mini | unset → default | yes | gpt-5.4-mini |
| Provider keys present | | OpenAI, Groq, Together | | OpenAI, Groq, Together | | |

`RETRIEVAL_BACKEND=openwebui` in production is read by `mira-mcp/server.py` only. It is not on
the notebook chat path.

## What this means

1. **Production enablement of rerank or IDF is a compose change, not a flag flip.**
   `docker-compose.saas.yml` forwards neither variable and runs no `mira-reranker`. Setting
   Doppler alone would silently do nothing.
2. **The staging "hybrid" lane mostly did not run during the #4571 A/B.** See
   `results-2026-10-21.md` §1: the query embedding timed out on most turns while the walk's own
   uploads were being embedded.
3. **Staging rerank cannot be audited after the fact.** A fallback writes only a `console.warn`
   (`reranker_fallback reason=…`) and no trace attribute. The compose comment records fp32 at
   p95 4.1 s against the 4000 ms timeout set in staging.
4. **The answer model and the safety and answer gates are identical in both environments.** A
   refusal difference between them is therefore not a model difference.
5. **`NOTEBOOK_GUIDED_PROCEDURE=1` in staging is dead configuration.** No consumer exists in
   `mira-hub/src` or in either compose file on `023cd64c5`.

## How to regenerate

```bash
for c in stg prd; do for k in NOTEBOOK_LEXICAL_V2 NOTEBOOK_HYBRID_RETRIEVAL NOTEBOOK_RERANK \
  NOTEBOOK_RERANK_TIMEOUT_MS RERANKER_MODEL MIRA_ENFORCE_APPROVED_RETRIEVAL OPENAI_MODEL; do
  echo "$c $k=$(doppler secrets get $k --project factorylm --config $c --plain 2>/dev/null)"; done; done
curl -s https://app-staging.factorylm.com/api/health/ ; curl -s https://app.factorylm.com/api/health/
git grep -n -E "NOTEBOOK_|RERANK" origin/main -- docker-compose.saas.yml docker-compose.staging-vps.yml
```
