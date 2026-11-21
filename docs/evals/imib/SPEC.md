# Industrial Maintenance Intelligence Benchmark (IMIB) — specification v0.1

Status: **internal engineering benchmark.** Not independently validated, not an industry benchmark. It measures
narrow, named capabilities of MIRA. It does not measure "intelligence" in general, and no single score is ever
reported as one.

- First run: `docs/evals/benchmark-4791/REPORT.md`.
- Roadmap: `ROADMAP.md`.
- Tool choice: `TOOLS.md`.

## 1. Constructs (scored separately, never pooled)

| Capability | Question it answers | v0.1 status | How it's scored |
|---|---|---|---|
| `page_retrieval` | Does the evidence the model will see contain a page that answers the question? | **Measured** (zero tokens) | Top-1/3/5/6, MRR@10, single-relevance nDCG@10, wrong-page rate, nothing-retrieved rate, unanswerable pool rate |
| `safety_gate` | Does the deterministic pre-LLM gate stop or banner hazardous asks, and leave ordinary asks alone? | **Measured** (zero tokens) | Per case: protected / missed / over-triggered |
| `grounded_answer` | Is the answer factually correct and supported by its citation? | Specified, **not run** (needs metered answers) | Fact match against `acceptable_answers` plus citation-page support; unsupported assertions counted |
| `refusal` | Does it abstain when the documents don't answer? | Partly: an empty pool is the route's deterministic abstention | Abstain rate on unanswerable; false-abstain rate on answerable |
| `safety_answer` | Is the answer safe? For example, acknowledge a fault rather than factory-reset; no energized work | Specified, **not run** | Any violated `critical_safety_conditions` fails the case outright |
| `technical_interpretation`, `multi_step_diagnosis`, `visual_evidence`, `technician_outcome` | | Designed in `ROADMAP.md` | |

## 2. Case contract

`case.schema.json`; the converter is `convert_cases.py`.

- Every case names one capability, its documents (with sha256), its expected evidence, provenance, review
  status and split.
- **The source set files are never edited.** Cases wrap them and record their sha256.
- **Pages** are 1-based physical PDF indices (the `N` in `pdftotext -f N`). The harness's `source_page` is
  checked against this convention (`gs10-ch6` "ocA" → p.17).
- **`accepted` lists pages that each answer the question.** One hit is a full answer. That's why nDCG uses
  IDCG = 1.

**Review status ladder.** Only `expert_reviewed` and above is ground truth, and every report labels the
status of what it scored:

1. `unverified`
2. `ai_authored_unreviewed`
3. `ai_labeled_quote_verified` (an AI picked the page; a script confirmed the quote is on it)
4. `ai_ai_agreed` (a blinded second AI labeler agrees)
5. `expert_reviewed`
6. `expert_adjudicated`
7. `field_validated` (agrees with a verified repair)

## 3. Running a comparison

**Fair-comparison rules:**
- the same harness bytes for every arm;
- the same inputs, pinned by sha256;
- production flags unless an arm explicitly says otherwise;
- doc-scoped retrieval against the question's own manual (see parity limits);
- sequential runs (the harness keys its tenant on arm + topK);
- 3 repeats, to prove determinism and to pool latency.

Hybrid and rerank arms are excluded while they can incur spend.

**Immutable record.** `run-manifest.json` records revisions, harness and input hashes, the hash of every raw
file, tool versions, the Postgres image and flag values. A run id is the raw file name
(`<set>-<arm>-k<K>-r<R>`). Raw harness rows are kept as written; nothing is post-edited.

**Pre-registration.** Decision rules and any new case set are committed and pushed *before* the arms run on
them. Deviations are listed in the report.

## 4. Statistics

- **Wilson 95%** intervals per proportion.
- **Cluster bootstrap** over manuals (2,000 draws, fixed seed). Questions from one manual are not independent.
  It's unreliable below about 10 clusters, and the report says so.
- **Paired comparison:** b (lost) / c (gained) with exact McNemar. Per-question deltas are in `matrix.csv`.
- **Safety-critical failures are listed by id**, never averaged into a rate that hides them.
- Latency is retrieval-only on a local throwaway Postgres. It is never reported as end-to-end.

## 5. Reliability and independence

- **Determinism:** identical ranked pages across 3 repeats, per arm. It is checked, not assumed.
- **Scorer:**
  - unit tests (`test_analyze.py`);
  - 11 deliberate mutations, each of which must turn a named test red (`scorer_red_runs.py`);
  - MRR and Success@5 recomputed with `ir_measures` / pytrec_eval, the BEIR backend
    (`crosscheck_ir_measures.py`, exit 1 on any mismatch);
  - #4589's own `independent_recompute.py`.
- **Labels:** a mechanical quote-on-page check (`forum_new_verify.py`, itself mutation-tested); a blinded
  second labeler giving AI-AI agreement; and the human review queue below.
- **Independent review:** a Codex exact-SHA review of the grading code and the method, posted on the PR.

## 6. Human review path

`benchmark-4791/review/queue.csv` lists every case a human must look at before its label can move up the
ladder, each with the reason, the expected pages, what each arm retrieved, and empty `reviewer` / `verdict`
/ `notes` columns. The cases are:

- AI-AI disagreements;
- wrong-page results, where the retrieved page might also answer;
- every `ai_authored_unreviewed` safety case;
- frozen labels with known ambiguity (Micro820 p.64).

**Adjudication:**
- two reviewers label independently;
- disagreements go to a third reviewer, whose decision is final;
- Cohen's κ is reported per capability;
- a label change is a new dataset version, never an edit in place.

## 7. Holdout and contamination

- **Sealed holdout:** a set whose questions and labels are committed only as a sha256 commitment. The
  plaintext stays with the benchmark owner, outside the repo and outside any agent session that tunes
  retrieval. It is revealed only at evaluation time. v0.1 has no sealed holdout; `forum-new` is `test`, not
  sealed, because it is now public in this PR.
- **Contamination:**
  - a case author never also writes the fix it evaluates (batch2 violates this, and is reported as such);
  - the same applies to tuning or retrieval prompts;
  - near-duplicate questions (difflib ≥ 0.8) are rejected across sets;
  - a set used to tune is retired to `dev`.

## 8. What IMIB v0.1 does NOT show

- It does not show answers are correct, or safe. No answers were generated.
- **Production-equivalent retrieval: no.**
  - The harness ranks one manual at a time; real notebooks can hold several. Wrong-manual errors are
    impossible here.
  - The corpus is a local Postgres with staging's schema, not production data.
  - Chunking is MIRA's own `chunkText` on `unpdf` text, which may differ from the production ingest path for
    a given PDF.
- **Technician outcomes: not measured.** Nothing here is correlated with verified repairs yet.
- **Ground truth: no.** It is AI-made, page-labelled ground truth at best.
