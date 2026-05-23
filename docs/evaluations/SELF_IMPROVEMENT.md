# MIRA self-improvement loop — design

**Status:** Phase 1 shipped (regression detection). Phase 2 (KB-gap surfacing) deferred.

The benchmark + workflow + regression checker form one feedback loop. This
doc lays out what's in scope today vs. what should ship next, so a future
session doesn't redesign from scratch.

## Phase 1 — Regression detection (SHIPPED in this PR)

```
                    Wed 05:00 UTC
                          │
                          ▼
     ┌──────────────────────────────────────────────┐
     │ .github/workflows/mira-benchmark-weekly.yml  │
     │   1. checkout, install deps                   │
     │   2. run tests/mira_bench.py vs stg Neon      │
     │   3. upload raw json + md as artifact         │
     │   4. scripts/check_benchmark_regression.py    │
     │       compares vs .github/baselines/...       │
     │   5. on regression → file labelled issue      │
     │   6. fail the job (so the failing run is red) │
     └──────────────────────────────────────────────┘
```

**Inputs the loop guarantees on every run:**

- `docs/evaluations/runs/YYYY-MM-DD-ci/mira-bench-raw.json` — uploaded artifact
- `docs/evaluations/runs/YYYY-MM-DD-ci/mira-bench-results.md` — uploaded artifact
- GitHub issue with `benchmark-regression` label and per-question delta table —
  filed only on regression, de-duped by date

**Why this is the floor, not the ceiling:** it tells you *that* MIRA got
worse and *which questions* fell, but doesn't tell you *why* or *what to
ingest to fix it*. That's Phase 2.

## Phase 2 — KB-gap surfacing (DEFERRED, design here)

The information for "what would fix question Qn" already exists in
`mira-bench-raw.json`:

```jsonc
{
  "id": "Q06",
  "equipment": ["Micro820", "CCW"],
  "question": "Walk me through Micro820 CCW Modbus setup",
  "retrieval": {
    "n_chunks": 5,
    "sources": [
      "Rockwell Automation / 2080-LC20-20QBB / p.69 (manual)",
      ...
    ],
    "coverage": 0.5,
    "relevance": 0.31
  },
  "grounded_score": { "total": 25, ... },
  "baseline_score": { "total": 30, ... }
}
```

Three signals fall out of that block:

1. **The question's `equipment` tags** name the manufacturer/model the answer
   needs to cover.
2. **`retrieval.sources`** says what the KB *does* have — by manufacturer +
   model + page. If a Micro820 question only retrieves
   `2080-LC20-20QBB` hardware-install pages, the gap is *CCW programming
   docs*, not *Micro820 docs broadly*.
3. **`baseline_score.total > grounded_score.total` + low `factual_accuracy`**
   pinpoints questions where the ungrounded LLM bluffs convincingly because
   MIRA refuses to fabricate — the right behavior, but resolvable by ingest.

### Proposed Phase 2 script (`scripts/identify_kb_gaps.py`)

```
Inputs:  docs/evaluations/runs/<date>/mira-bench-raw.json
Outputs: docs/evaluations/improvement-log.md (append-only) +
         GitHub issue body per gap

For each Q where MIRA lost to baseline by ≥ 3 points:
  1. Read question's `equipment` tags
  2. Collect distinct (manufacturer, model) tuples in retrieval.sources
  3. Compute "covered" tuples vs "asked-about" tuples
  4. For each asked-about tuple not in covered:
        → "ingest gap: need <equipment> docs"
     For each covered tuple with low chunk variety
     (all from same source_type, all from adjacent pages):
        → "depth gap: have <manufacturer> <model> but only
           <source_type>; need CCW user guide / wiring diagram /
           parameter reference"
  5. Append a row to `docs/evaluations/improvement-log.md`:
        | date | question | equipment | gap_type | suggested_source |
  6. Open or update issue `kb-gap-Q06` with a checkbox list of
     suggested sources (PDF URLs from manufacturer literature
     library, YouTube channel URLs, etc.)
```

Concretely, today's run would have surfaced:

| Q | Equipment | Gap | Suggested ingest |
|---|---|---|---|
| Q04 | RS-485 | depth gap (prose, no pinout) | Add Modicon Modbus over Serial Line user guide; AutomationDirect GS10 install ch. 2 figures |
| Q06 | Micro820 / CCW | ingest gap (no CCW manual seeded) | Rockwell pub. 2080-RM001-EN, "Micro800 Programmable Controllers General Instructions" |
| Q10 | CCW MSG_MODBUS | depth gap (no per-pin block detail) | Rockwell pub. 2080-RM005-EN, "Micro800 Programmable Controller External Reference" |

**Why this is deferred, not shipped:**

1. The "suggested source" mapping needs a small catalog —
   `tools/seeds/manuals/<vendor>/<topic>.yaml` — that doesn't exist yet.
   Without it, Phase 2 just says "find a CCW manual" which is what a human
   already knew.
2. The KB-gap → ingest pipeline (auto-PR to `tools/seeds/`, kicking off
   `seed-oem-manuals.yml`) is a separate workflow with separate risk:
   ingestion writes to KB.
3. Karpathy principle #2 — minimum code that solves the problem. The
   regression detector solves "is MIRA getting worse." Phase 2 solves "and
   here's the fix," which adds value but isn't in the loop today.

### When to build Phase 2

The first time the regression-detector fires for a *real* regression and
the on-call session has to manually look at the raw json to figure out
which manual to ingest — that's the trigger. If three consecutive monthly
weekly runs are green, defer further. If the first regression fires and a
human can't act on it in under 10 minutes from the issue body alone, build
Phase 2.

## Adjacent loops (not in scope here, but on the same wire)

- **`com.mira.eval-fixer` launchd** — daily 01:00, writes wiki entries from
  fix-proposer tasks (see `tests/eval/fix_proposer_tasks.py`). This already
  closes the loop on golden-case failures; the weekly mira-bench is a
  *different* signal (KB depth, not engine bugs).
- **`active_learning_tasks.py`** — flags low-groundedness sessions for
  human review. Operates per-session, not per-benchmark.

Both belong in the same `docs/evaluations/improvement-log.md` ledger once
Phase 2 ships.
