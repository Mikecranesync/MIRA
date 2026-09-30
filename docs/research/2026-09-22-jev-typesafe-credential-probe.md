# Jev (TypeSafe AI System One) — credential probe and FactoryLM experiments

**Date:** 2026-09-22 · **Key:** `JEV_API_KEY` in Doppler `factorylm/{dev,stg,prd}` (same value in all three, read via `doppler run --config dev`, never printed) · **Endpoint:** `POST https://api.typesafe.ai/v1/systemone`, `Authorization: Bearer` · **Model served:** `jev-1.13.0` (alias `jev-latest`) · **Nothing wired into MIRA; no repo dependency added; production untouched.**

## Connectivity
First authenticated call: HTTP 200 in 447 ms, `{"model":"jev-1.13.0","answers":{"is_greeting":{"type":"noul","noul":0.94}},"usage":{"input_tokens":282,"output_tokens":23}}`. Error shapes: 422 with a Pydantic-style `detail[]` naming the missing field (`questions.<q>.choice.criteria`, `score.criteria` must be a list), 400 `{"detail":{"error_type":"api_usage_error"}}` for an unknown question type. No rate-limit, cost, or request-id headers are returned. Body must be one object (one `state`, many `questions`); an array is rejected.

## What the key enables
| Type | Request | Response |
|---|---|---|
| `noul` (boolean) | `{type:'noul', instructions}` | `{noul: 0..1}` — probability of true, no separate confidence |
| `choice` | `{type:'choice', instructions, criteria:{key:description}}` | `{choice, confidence, probabilities:{key:p}}` |
| `score` | `{type:'score', instructions, criteria:[ordered rubric]}` | `{score: continuous position, confidence, legend, probabilities}` |
| multi-question | many questions on one `state` | all answered in one call (~400 ms) |
| usage | — | `usage.input_tokens/output_tokens` on every response ($0.042/M input per vendor page; output free) |

Deterministic: the same input five times returned `noul=0.98` five times (spread 0.00). Latency 337–536 ms across 30 calls.

## Experiment A — evidence sufficiency (MIRA's Gate G / `evidence_sufficient`)
**Schema:** state = `Question: …\nEvidence: …`; question `sufficient` (noul): *is the evidence sufficient to answer with a specific grounded fact; no if generic, unrelated, or missing the asked-for value.*

| Case | Expect | noul | ms |
|---|---|---|---|
| nameplate_answers | True | 0.98 | 500 |
| manual_answers | True | 0.89 | 464 |
| unrelated_chunk | False | 0.02 | 414 |
| generic_only | False | 0.11 | 442 |
| no_evidence | False | 0.04 | 434 |
| partial | False | 0.10 | 536 |
| wrong model, same vendor (KTP400 for a TP700 question) | False | 0.05 | — |
| right model, wrong quantity (voltage chunk for a temperature question) | False | 0.03 | — |
| right model, hedged but specific range | True | 0.91 | — |

**6/6 + 3/3 adversarial correct.** Threshold: `noul ≥ 0.5` → sufficient; observed margin is wide (true cases 0.89–0.98, false 0.02–0.11). **Wrap:** in the notebook chat route, after retrieval and before generation, `evidence_sufficient` today is `chunks>0 || photo || machine packet` — a presence test. Jev would make it a *relevance* test: retrieved-but-irrelevant chunks (the live case-2 pattern) would be judged insufficient, and the answer gate could abstain or the badge could refuse the documentation label *before* the model writes prose. Surprising: it correctly rejected same-vendor wrong-model evidence, which BM25 cannot.

## Experiment B — retrieval relevance (which chunk supports the question)
**Schema:** state = question + 4 numbered candidates; question `best` (choice over c1..c4 + `none`).

| Case | Expect | choice | conf | ms |
|---|---|---|---|---|
| clear_winner | c2 | c2 | 1.00 | 418 |
| distractors | c3 | c3 | 1.00 | 414 |
| none_supports | none | none | 1.00 | 442 |

**3/3 correct with confidence 1.00 and one-hot distributions**, including `none` when no candidate supports the question. **Wrap:** a post-BM25 rerank/select step: pass the top-N chunks as candidates, use `choice` to pick the supporting one(s) or `none`; `none` ⇒ honest abstain instead of six weakly-related chunks in the prompt. Caution: with one-hot outputs the distribution gives no ranking signal beyond the winner; to rank several, ask one `score`/`noul` per candidate (multi-question, one call).

## Experiment C — completion / review decision (is more verification required?)
**Schema:** state = change + tests + CI + review + staging lines; `needs_more` (noul) and `risk` (score, 4-rung rubric).

| Case | Expect more? | needs_more | risk (rung, conf) | ms |
|---|---|---|---|---|
| fully_evidenced | False | 0.47 | 0.66 (negligible: all claims evidenced, 0.34) | 455 |
| green_badge_stale_sha | True | 0.96 | 2.65 (high: core behaviour unproven, 0.65) | 394 |
| tests_never_ran | True | 0.93 | 2.66 (high: core behaviour unproven, 0.66) | 429 |
| local_only | True | 0.97 | 2.74 (high: core behaviour unproven, 0.74) | 476 |

**4/4 correct at a 0.5 threshold, but the fully-evidenced case sits at 0.44–0.47 with score confidence 0.34** — decisive when something is missing (0.93–0.97), hedging when everything is present. An inverted question (*is every claim evidenced?*) gave 0.65. **Wrap:** use it as a *not-done detector* with an asymmetric threshold (`needs_more ≥ 0.7` ⇒ block; `< 0.5` ⇒ merely 'no objection', not proof), never as the sole 'done' authority. Unreliable for: certifying completeness; reliable for: catching stale badges, unexecuted tests, missing staging evidence, 'should be fine' claims.

## Best immediate FactoryLM use case
**Evidence sufficiency at the answer gate.** It is the exact judgment the acceptance loop showed MIRA getting wrong (six Siemens chunks retrieved, none relevant, prose answered anyway), it is deterministic, ~450 ms, ~350 input tokens (~$0.000015 per turn), and it slots into an existing seam: compute `evidenceSufficient` from a Jev `noul` over (question, retrieved chunks) instead of from chunk presence. Second: `choice` over top-N chunks as a relevance selector before context assembly.

## Risks / limitations
- One shared key across dev/stg/prd Doppler configs; no per-environment scoping or usage attribution. No rate-limit headers, so overload behaviour is unknown.
- Vendor is a week old (released 2026-09-15); model alias `jev-latest` moves; pin `jev-1.13.0`. Not Apache/MIT — it is a hosted API (an inference *provider*, like Groq), so it does not violate PRD §4 licences, but it is a new external dependency on the diagnostic path and must be fail-open.
- Cannot explain a judgment; treat outputs as evidence (`trust=candidate`), record them on the Turn Evidence Packet, never let them auto-promote anything (materialized-evidence rule 9).
- Completion-review is asymmetric (see C). Sufficiency judged on ~350-token states; long contexts untested.
- Zero-token architecture rule: a runtime Jev call is 'inference'; it needs the 5-question justification (what varies: the evidence; what is stable: the rubric; invalidation: prompt/instruction version). Cheap enough to keep on the path, but declare it.

## Smallest next implementation step
A shadow-mode `evidence_sufficient_jev` field on the Turn Evidence Packet: in the chat route, after retrieval, one fail-open `noul` call over (question, chunk texts) recorded on the packet and span (`mira.evidence.jev_sufficient`), **not** consulted by the gate. Run the acceptance suite; compare the Jev judgment against the wire outcome on real staging traffic for a few days; then decide whether it replaces the presence test. Behind `MIRA_JEV_SHADOW=1`, key `JEV_API_KEY`, timeout 1.5 s.

## Evidence
Raw call records (status, latency, sanitized headers, response body; no key, no auth header) in the session scratchpad `jev/` (`probe_noul`, `cap_*`, `expA/B/C`, `det*`, `adv_*`, `fe*`). 30 calls, all 200 except the intentional 422/400 schema probes. Commands: `doppler run --project factorylm --config dev -- python3 probe.py '<body>' <tag>` with the key read from the environment inside the subprocess.
