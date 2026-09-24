# Retrieval/evidence acceptance — ALL PASS on staging (2026-09-22 07:13Z)

**Staging:** `26eae84e1cfdaba2bbea89e855e368cc2c21a3a0` (v3.354.3), deploy run 35698169241.
**Run:** `.github/workflows/retrieval-acceptance.yml` run **35698495558**, auto-fired by the deploy (`workflow_run`), stranger self-provisioned, artifact `run-35698495558.json` beside this file.
**Harness:** `tools/qa/retrieval_acceptance.py` — the mobile request shapes over HTTPS, packets read via the diagnostics endpoint, invariants as machine checks. Nothing mocked.

The loop that produced this: #3943 (routing, continuity, gate) → #3944 (OEM chunks ground the turn) → #3945 (truthful badge/tokens/evidence ids + the harness + the workflow) → #3946 (honest-refusal classification, fixtures). Each fix came from a live trace; each rerun covered all scenarios.

| # | Scenario | Trace | Strategy | Executed | Corpus | Candidates | Source docs | Ctx evidence ids | Prior visual | Identity | Evidence sufficient | Prompt | Citations | Badge | Gate / status | Anomalies | Tokens in/out | Result |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | empty notebook + generic question | `c5f68fe028df2082edbb8601aa2bd8de` | `skipped_general_mode` | False | — | 0 | 0 | 0 | 0 | unknown | False | general | 0 | `general_reasoning` | answered / answered | none | 535/330 | **PASS** (12/12) |
| 2 | empty notebook + resolved Siemens identity | `064a66f0fbd25963c537e271d99105ce` | `oem_corpus_bm25` | True | shared OEM | 6 | 0 | 6 | 0 | unknown (mfr+model on notebook) | True | grounded | 0 | `general_reasoning` | insufficient_evidence / insufficient_evidence | none | 3146/124 | **PASS** (13/13) |
| 3 | notebook with attached manual | `7fdfa86c7bfa2244325a4c6cc0e8fd12` | `notebook_sources_bm25` | True | notebook | 1 | 1 | 1 | 0 | unknown | True | grounded | 1 | `oem_documentation` | answered / answered | none | 1447/118 | **PASS** (13/13) |
| 4 | photo turn → text-only follow-up | `59bc414da8c9342eeb294c3463afb640` | `oem_corpus_bm25` | True | shared OEM | 6 | 0 | 6 | 1 | unknown | True | grounded | 1 | `oem_documentation` | answered / answered | none | 3591/82 | **PASS** (16/16) |
| 5 | no evidence + exact rating requested | `89f3a0ec94a7e97a97c4351560fafec7` | `skipped_general_mode` | False | — | 0 | 0 | 0 | 0 | unknown | False | general | 0 | `general_reasoning` | answered / answered | none | 547/124 | **PASS** (11/11) |

Every row also passed: trace id identical on the response header, the first SSE frame, the packet, and the diagnostics endpoint; `environment=staging`; provider/model recorded; numeric token usage; no secret markers and no question/answer text anywhere in the packet.

## What each row proves
- **1** A generic question in an empty notebook skips retrieval by policy and is labelled general. Unchanged behaviour, now asserted.
- **2** With a Siemens identity on an empty notebook, the shared OEM corpus is searched (6 candidates, `source_url#page` ids recorded), the six chunks reach a grounded prompt, and the model refuses honestly because they do not contain the TP700 supply spec — persisted as `insufficient_evidence` with no basis claim. Before #3943 nothing was searched; before #3944 the chunks were discarded; before #3946 the refusal was recorded as `answered`.
- **3** An attached manual is retrieved, one chunk reaches the model, one citation ships, badge "Grounded in this notebook's sources."
- **4** After a photo turn, a text-only "what voltage was it?" recalls the earlier photo **server-side** (prior observation count 1, the photo's file id on the packet), the recognised manufacturer unlocks OEM retrieval, and the answer ships a citation. This is the Pixel session's turn-3 failure, closed.
- **5** With no evidence and an exact rating requested, no value is asserted as this machine's fact (the model declines and any range it quotes is hedged with an explicit can't-verify disclaimer); the gate's exact-rating rule stands behind it for the unhedged case.

## Known non-blockers (product, not infrastructure)
- Retrieval *quality*: case 2's six Siemens chunks did not include the Comfort Panels spec page. That is a corpus/ranking question, deliberately out of scope until execution was proven — which it now is.
- `refusal_regex` classification is phrase-based; a novel refusal phrasing could still persist as `answered`. The packet's `evidence_sufficient=false` plus `ungrounded_unit_claim` keeps such a turn diagnosable.

