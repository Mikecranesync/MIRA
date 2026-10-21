# Proposed release gates for notebook retrieval changes (#4576)

**Status:** provisional policy, accepted by the owner on 2026-10-21. It governs retrieval
promotion decisions until revised. Threshold changes are made here, before the numbers they
judge exist.

This applies to any change that alters which passages notebook chat retrieves or how they are
ordered: lexical scoring, the vector lane, rerank, chunking, admission, or the ingest that feeds
them. It reuses the instruments that already exist (gates 1 to 3 in
`docs/specs/notebook-retrieval-idf-scoring.md`) and adds the validity checks and guardrails they
lacked.

Every threshold below is fixed **before** a change's numbers exist. A change that misses one is
reported, not re-tuned against the set that judged it.

## 0. A run is only evidence if it is valid

A run that fails any check below is **INVALID**: it is re-run, not scored. `walk_eval` enforces
this. For an invalid pair it withholds the paired scores, prints which checks failed, and exits 3.
`--diagnostic` prints the scores anyway, labelled as not evidence, for audits only. UNVERIFIED
counts as a failure. An invalid run is
never a pass, and never a fail of the change.

| # | Check | How |
|---|---|---|
| V1 | Both arms ran the same build: one identical `gitSha` | `walk_eval` `validity.v1_build`. `builtAt` is reported, not compared, because changing a flag means rebuilding the container from the same SHA. |
| V2 | Both arms used the same corpus bytes | `validity.v2_corpus`: each manual in `--manual-dir` must hash to its `corpus.json` sha256. A changed OEM PDF is BROKEN. |
| V3 | The configuration is captured at run time for both arms, and the only difference is the flag under test | `validity.v3_config`: a `--config` snapshot per arm containing every key in `walk_eval.REQUIRED_CONFIG` (`""` = unset); the differing keys must equal `--vary`. A partial snapshot is UNVERIFIED. |
| V4 | **Lanes actually ran.** For any arm that claims the vector lane, `mira.retrieval.vector_lane=ran` on ≥ 90% of turns. An arm configured hybrid-on is a vector arm whether or not `--vector-arm` names it. An arm configured hybrid-off must show `off` on every question; a question without lane evidence fails. Both arms are within 10 points of each other. | `tools/retrieval_eval/lanes.py`, then `walk_eval --lanes` → `paired.*.validity.v4_vector_ran`. An untraced question counts as missing, never as ran. It uses the Langfuse v2 API; the v1 trace endpoint stops working on **2026-11-16**. |
| V5 | Rerank outcome is known per turn | `validity.v5_rerank`: until #4579 adds a trace attribute, only rerank unambiguously off (unset, `""` or `"0"`) passes. `"1"` or any other value (`"true"`) is UNVERIFIED. |
| V6 | BROKEN = 0, and every question was asked in both arms | `walk_eval` `paired.*.validity.v6_pass`. The expected set always comes from outside the arms: the corpus, or `--expected` (required for a sealed subset). A question dropped from both arms therefore fails. |

By these rules, the #4571 staging A/B fails V4 and V5. Its result describes lexical ranking plus
an unverified rerank, not "lexical underneath hybrid + rerank", and not production's
configuration either (`results-2026-10-21.md` §1).

## 1. Gates, in the order they run

**Who decides what.**
- `walk_eval` decides only whether a comparison is **valid**: V1–V6 above. Exit 0 means
  "scoreable", never "GO".
- The GO / NO-GO / INCONCLUSIVE verdict comes from one engine, `tools/benchmark-acceptance/scorecard.py`
  (#4589), which implements the owner's acceptance criteria. Valid walk results are converted into its
  row format, so there is no second verdict engine.
- The table below is the project-level gate list those criteria sit beside.

| Gate | Instrument | Pass rule | Notes |
|---|---|---|---|
| **R1 Retrieval, development** | Zero-token replay (#4534), 77 questions, top-6 | Paired McNemar p < 0.05 in favour, and **no top-1 loss** | The existing gate 1. Free. Run as often as needed. |
| **R2 Retrieval, sealed** | Unseen set, 60 answerable, aggregate only | Top-6 discordant gained ≥ lost | The existing gate 2. Run **once** per change. Never read per-question. |
| **A1 Answer, citation** | Staging Stranger Walk, 50 questions | Net loss (lost − gained) ≤ 3 rows (`gates.a1_citation`) | 3 is the worst net loss a same-build repeat has produced (#4460: 3 and 1 of 50). At n = 50 this catches a net loss of 4+ rows (8+ points), no finer. A Newcombe lower bound > −10 points was rejected: an unchanged build can fail it (worst no-op: −13.6). |
| **A2 Per manual** | Same walk | No manual loses ≥ 2 of its 5 questions | The ten manuals are the clusters. Per-manufacturer numbers are anecdote at this n and are not gated. |
| **S1 Refusal** | Unanswerable questions, by answer text (`isRefusal`) | Clean refusals: gained ≥ lost | See §2: at today's n = 7, this is "zero losses". |
| **S2 Cited refusal** | Same | Refusals that carry a citation do not increase | A cited refusal is scored `answered` and looks grounded. |
| **S3 Safety** | Same walk, 15 safety questions | Structured-notice red lines do not increase, **and** prose warnings do not decrease | The red-line count is 12 in both arms. It measures the notice system (#4508), not retrieval, so it can only guard against regressions. |
| **P1 Cost and latency** | `retrieval.execute` span latency (`lanes.py`) | Retrieval p95 ≤ baseline × 1.2; booked $ per turn unchanged | Whole-turn latency (~47 s) cannot see a retrieval regression. Gate 1 measured retrieval alone at 233 → 308 ms. Booked $ is a flat rate per turn today (#4522), not measured spend. |
| **D1 Production parity** | Configuration matrix | The arm judged is the production configuration, or every difference is listed and accepted by the owner | Production also needs its compose to forward the flag (the matrix, point 1). |

**Promotion to production** needs R1, R2, A1, A2, S1, S2, S3, P1 and D1 to pass on valid runs,
plus the owner's decision. "Observed better" is not "supported better":
- Report a gain as **supported** only when the paired p < 0.05 **and** the manual-cluster
  bootstrap interval excludes 0.
- Otherwise report it as observed.

## 2. Power: what n = 7 unanswerable questions can and cannot show

- At n = 7, **no** refusal regression is statistically detectable. An exact McNemar test needs
  at least 6 discordant pairs, all in one direction, to reach p < 0.05 (`mcnemar_min_discordant`).
- Detecting a refusal rate falling from 95% to 85% (one-sided, α 0.05, power 0.8) needs
  **at least about 44 unanswerable questions** (`n_to_detect_drop`). That is a one-sample
  approximation against a fixed baseline; the paired comparison S1 actually uses may need more.
- So S1 is a **hold-and-review** rule at today's n, not a test. Any refusal lost stops promotion
  until a human reads why. That is what #4572 did, and it was correct.

**Recommendation:** build a development unanswerable set of at least 44 questions on the ten
public Stranger Walk manuals. Write the questions fresh, and hand-verify that the manual does not
contain each answer. Do **not** draw them from the sealed set. This is the cheapest way to turn
S1 from a tripwire into a measurement (#4584). It should be a small extension of `corpus.json` (an
`expectedPage: null` row type), owned by the walk harness (#4461/#4534), not a new harness.

## 3. Reproducing a decision

```bash
python3 tools/retrieval_eval/walk_eval.py \
  --arm base=<walk out dir> --arm change=<walk out dir>[,<resume dir>] \
  --corpus mira-hub/tests/stranger-walk/corpus.json \
  --lanes base=<lanes.jsonl> --lanes change=<lanes.jsonl> \
  [--vector-arm base --vector-arm change]   # arms that claim the vector lane (V4 >= 90%)
  --json report.json
# a run is scoreable only if paired.*.validity.v6_pass is true and v4.v4_pass is not false
# sealed set: add --sealed --key .planning/unseen-set/gold.jsonl (only qid + accepted_pages
# are read); aggregates only, no per-question or per-manual output
doppler run --project factorylm --config stg -- python3 tools/retrieval_eval/lanes.py <walk out dir> <lanes.jsonl>
```
