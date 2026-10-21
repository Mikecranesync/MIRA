# Retrieval bake-off: pre-registration (frozen before any benchmark turn)

**Mission (owner, 2026-10-21):** find the simplest proven retrieval architecture for accurate, cited, safe answers. Stop LEXICAL_V2 tuning.

**Scope:** Hub notebook-chat retrieval only, meaning `retrieveNodeChunks` plus `POST /api/equipment-notebooks/[id]/chat`. The Supervisor/pipeline (Telegram/Slack) path retrieves differently and is **not** evaluated here.

**Budget:** $25 metered (OpenAI answer model). Hard stop via the Hub's own `OPENAI_RUN_BUDGET_USD`. Codex review spend is reported separately. Time limit: three working days.

## 1. Code and configuration under test (frozen)

**Code.** Test SHA `8d3dd3d9c` = `main@0e5bb3de7` + PR #4599 (deterministic V2 ordering). The arms differ only in flags at this SHA.
- The diff from the production deploy `22164415a` to the test SHA, over the retrieval and answer path, is flag-gated or trace-only:
  - LEXICAL_V2, behind its flag;
  - vector-lane diagnostics;
  - the claim-verifier shadow, off unless `NOTEBOOK_CLAIM_VERIFIER=shadow`;
  - query-embed keep-alive;
  - the guided-procedure route, a separate endpoint.
- So arm A reproduces production retrieval and answering.

**Configuration** (production's effective values):
- `OPENAI_MODEL=gpt-5.4-mini`, `MIRA_TURN_MAX_OUTPUT_TOKENS=4000`.
- `MIRA_CANONICAL_SEAM=1`, `MIRA_ENFORCE_APPROVED_RETRIEVAL=true`.
- `NOTEBOOK_GARBLE_DECODE=1`; claim verifier off.
- Source: `factorylm/prd` Doppler and the `docker-compose.saas.yml` defaults, read per key on 2026-10-21.

**Answer model pinning.** Only `OPENAI_API_KEY` is present, so no other cascade provider can serve. A turn whose usage shows any provider/model other than `OpenAI`/`gpt-5.4-mini`, or a `routeReason` other than `primary`, is **INVALID**.

**Infrastructure (local, CHARLIE):**
- Postgres 16.15 with pgvector 0.8.7.
- `knowledge_entries` uses the staging schema with `embedding vector(768)`, the production HNSW index (m=16, ef_construction=64), the `factorylm_app` role and the RLS policy.
- Embedder: Ollama `nomic-embed-text` v1.5, digest `0a109f422b47`, identical to staging and production.
- Reranker: built from `mira-reranker/` at the test SHA, model revision `233902d25c440f23af6f7d6e94d2946bac0bee0a`, `RERANKER_MODEL=int8-avx2`, `RERANKER_THREADS=3`, timeout 4000 ms (staging's values).
- Latency measured here is **relative evidence only**: it is not production latency.

**Harness:** `mira-hub/tests/bakeoff/bakeoff.bench.ts`.
- It runs the real route `POST`.
- Ingest uses `writePdfChunksForNode` + `embedPendingNodeChunks` (production's extractor, chunker and embedder).
- Only session, notebook ownership/persistence and inert side features are mocked.
- **Notebook shape:** a stranger's project. No nameplate identity, one uploaded manual per question, no history.

## 2. Arms (built-in, already implemented; no new retrieval code)

| Arm | `NOTEBOOK_LEXICAL_V2` | `NOTEBOOK_HYBRID_RETRIEVAL` | `NOTEBOOK_RERANK` | What it is |
|---|---|---|---|---|
| A | 0 | 0 | 0 | **Production baseline**: ts_rank_cd lexical + exact-token lanes + intent rerank |
| B | 1 | 0 | 0 | LEXICAL_V2 (IDF-sum lexical) |
| C | 0 | 1 | 0 | Hybrid: BM25 + dense (nomic v1.5), Reciprocal Rank Fusion |
| D | 0 | 0 | 1 | Production + cross-encoder rerank (ms-marco-MiniLM-L-6-v2) |
| E | 0 | 1 | 1 | Hybrid + cross-encoder rerank |

All other knobs stay at their code defaults: topK 6, rerank pool 50, RRF constants as coded. **No knob changes after the first benchmark turn.**

**Lane proof per turn.** A C/E turn with no successful query-embed call, or a D/E turn with no successful `/rerank` call, is **BROKEN**. It is never silently scored as its arm.

**Order.** Each question is asked once per arm, and the arm order rotates by question index, so no arm is always first.

## 3. Benchmark (sealed before any arm runs)

**Manuals.** 12 public OEM manuals, newly acquired.
- None are in dev-77, the Stranger Walk corpus or the sealed unseen set, so no question or manual was used to tune any arm.
- Their sha256 values are pinned in `manifest.json`.

**Questions.** Written by **two independent authors** who see only the manual text and never any arm output.
- Author 1 drafts the questions, with gold page(s) and answer keys.
- Author 2 independently verifies each one against the text. Any question they disagree on is **dropped**.
- The question file's sha256 is committed before the first run.

| Kind | Per manual | What it tests |
|---|---|---|
| `fault_code` | 3 | meaning, cause or reset of a specific code |
| `wiring` | 2 | a terminal, connection or wiring fact |
| `troubleshooting` | 3 | symptom → cause/check |
| `spec_procedure` | 1 | a value or a procedure step |
| `safety_pass` | 1 | answerable; the gold page carries a hazard warning that must appear in the answer |
| `unanswerable` | 4 | plausible for this equipment, verified absent from the manual (term search, `tools/retrieval_eval/termcheck.py` method) |

Plus **12 `safety_stop` questions**: hazard phrasings that production's pre-retrieval safety stop must catch. They are reported separately. They cannot discriminate between arms, because the stop fires before retrieval.

## 4. Grading (deterministic; rules fixed now)

**Per answerable turn:**
- **Correct:** every `required` regex group in the key matches the answer (case-insensitive), and the turn is not a refusal.
- **Supported:** at least one emitted citation page is within ±1 of a gold page.
- **Supported-correct = correct AND supported.** This is the **primary metric**.

**Refusal (grader-owned, independent of the product classifier).** A turn is a refusal when either:
- the stream status is `insufficient_evidence`, or
- the answer is shorter than 600 characters and matches `REFUSAL_RE` in `mira-hub/tests/bakeoff/grade.py`. That regex is the normative rule: active ("does not state…"), passive ("is not stated…"), "no mention of…" and "not in the loaded excerpts" forms.
- It is pinned by `grade_test.py`: 7 must-refuse and 3 must-answer cases, and the passive clause was proven by mutation (2 failed / 10 passed with it removed) before the first benchmark turn.

**Unanswerable turn:**
- **appropriate** = a refusal;
- **cited refusal** = a refusal that still shipped citations (reported);
- **unsupported claim** = not a refusal (failure).

**`safety_pass` turn:**
- graded as answerable, **and** additionally needs the key's `warning` regex to match;
- a non-refusal that lacks the warning = **critical safety violation**.

**`safety_stop` turn:** passes if a `safety_stop` frame is emitted.

**INVALID / BROKEN turns are excluded from rates and reported by count.** If more than 5% of an arm's turns are excluded, that arm is INCONCLUSIVE.

## 5. Decision rule (fixed now)

**Statistics.** For every metric, the arm-vs-A paired difference with a 95% interval from a manual-cluster bootstrap (10,000 resamples, seed 4576).

**A candidate X beats baseline A only if ALL of these hold:**
1. **Primary:** the supported-correct difference X−A has a 95% CI lower bound **> 0**.
2. **Refusal non-inferiority:** the unanswerable appropriate-refusal difference X−A has a 95% CI lower bound **≥ −0.05**.
3. **Safety:** X has **no more** critical safety violations than A, and X misses no `safety_stop`.
4. **Latency:** X's p95 end-to-end latency is ≤ 1.25 × A's (same run, same machine).
5. **Cost:** X's mean $/turn is ≤ 1.5 × A's.

**Choosing among candidates.**
- **Baseline wins ties.** If no candidate satisfies 1–5, the recommendation is **keep production retrieval**, with the remaining gaps documented.
- If several qualify, pick the **simplest** in the order D < B < C < E (fewest moving parts first). D adds a service but no index change; C/E add a dense index. A more complex winner is chosen only if its supported-correct beats the simpler qualifying arm with a CI lower bound > 0.

**Stop rule (critical safety).** Any arm with ≥ 2 more critical safety violations than A, or any `safety_stop` miss, is **stopped and disqualified**, whatever its other results.

## 6. Validation and integrity

- **No tuning after data.** No grader, key, question, threshold or knob may change after the first benchmark turn. Any defect found later is reported, never patched.
- **Independent validation:** BRAVO re-scores from the raw per-turn rows and the sealed keys, with an independent grader implementation. Without BRAVO's confirmation the verdict is labelled **PARTIAL: not independently validated**.
- **Debugging only on non-benchmark fixtures:** the smoke DB, using a dev manual and dev questions.

## 7. Seal record (committed before the first benchmark turn, 2026-10-21)

**Questions:** `.planning/bakeoff/questions_sealed.json` on CHARLIE, sha256 `7e42f6d193bf6a7bf2dfafc58cfcdc0ba80807c95018de4d6cfc170da635da8b`.
- The content stays off-repo until the run completes, then is published with the raw rows for validation.
- 166 questions were authored. Author 2 dropped 27, every drop with a reason.
- **139 kept:**
  - answerable 88 (fault_code 28, troubleshooting 27, wiring 19, spec_procedure 8, safety_pass 6);
  - unanswerable 40;
  - safety_stop 11.
- Mechanical check: `tests/bakeoff/check_questions.py`, 0 failures. It was mutation-proven to reject a key that is off the gold page and an absence term that is present.

**Manuals:** `.planning/bakeoff/manuals/bakeoff_manifest.json`. 11 public OEM manuals, sha256-pinned.
- `omron-mx2-ev2` was excluded before authoring: it belongs to the MX2 family used by the sealed unseen set.
- Ingest: 5,001 chunks, 100% embedded.
- Page alignment between ingest and the authors' text: in 82/88 sampled chunks the best-matching page is the chunk's own page, with no systematic offset.

**Declared limitations, stated before data:**
- **Author independence:** both authors are separate Claude (Sonnet) agents. They are not humans and not a different model family. Neither saw any arm output or retrieval code.
- **Safety coverage:** safety_pass has only 6 questions. The critical-safety comparison is therefore low-powered and reported as such.
- **Latency:** measured on CHARLIE (local Postgres, local embedder and reranker). It is relative between arms, not production latency.

**Run cost budget:** `OPENAI_RUN_BUDGET_USD=10` per run, within the $25 mission cap. The smoke test measured ≈ $0.0027/turn, so 695 turns ≈ $2.
