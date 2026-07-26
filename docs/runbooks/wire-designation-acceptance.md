# Wire-designation acceptance run

How an authorized developer measures conductor/wire designation accuracy against
a **local, uncommitted** corpus. Nothing here requires — or permits — committing
customer drawings.

## What is being measured

Exact character identity of conductor/cable designations. The error class is a
letter collapsing into its look-alike digit (`I`/`1`, `O`/`0`, `S`/`5`, `B`/`8`,
`Z`/`2`), which produces a designation that still *looks* plausible but is
unsearchable for a technician tracing a wire.

`printsense.designation_metrics.measure(graph, rubric)` returns exact matches,
mismatches (with both expected and observed), missing and extra designations —
or an explicit `not_measured` state when there is no ground truth. **It never
reports zero errors for a graph it did not compare.**

## CI (free, hermetic, every PR)

```bash
python -m pytest tests/printsense/test_homoglyph_corpus_gate.py \
                 tests/printsense/test_designation_metrics.py \
                 tests/printsense/test_interpret_designation_grammar.py \
                 tests/printsense/test_verify_trust_independence.py -q
```

Grades the committed synthetic corpus (`printsense/benchmarks/homoglyph_corpus.py`,
fictional panel PNL-99) through the deterministic metric path. No model call, no
network, no spend. Truth is frozen against `homoglyph_corpus.sha256`; changing it
is a deliberate two-file diff.

## Local acceptance against a private corpus

Requires: a directory of your own drawings and a hand-written rubric. Both stay
outside the repo — put them anywhere **except** a working tree.

1. **Write the ground truth.** For each sheet, read the designations off the
   drawing (at magnification — that is the whole point) into a rubric:

   ```json
   { "categories": { "wire": { "expected": ["<designation>", "..."] } } }
   ```

   Save as e.g. `C:/<private-corpus>/<sheet>/rubric.json`. Never in the repo.

2. **Run extraction** through the normal path with a staging provider key. Keep
   outputs in the private directory:

   ```bash
   doppler run --project factorylm --config stg -- \
     python -m printsense interpret --local-file "C:/<private-corpus>/raw/<sheet>.jpg" \
                                    --out "C:/<private-corpus>/results/<sheet>/"
   ```

3. **Measure.** Compare each extraction to its rubric:

   ```python
   import json
   from printsense import designation_metrics as dm

   graph  = json.load(open(r"C:/<private-corpus>/results/<sheet>/extraction.json"))
   rubric = json.load(open(r"C:/<private-corpus>/<sheet>/rubric.json"))
   print(json.dumps(dm.measure(graph, rubric), indent=2))
   ```

   Roll the corpus up with `dm.summarize([...])`. Cases without a rubric are
   counted as `cases_not_measured`, never folded in as zero errors.

## Reading the result

- `exact_match_rate == 1.0` — every expected designation was transcribed exactly.
- `mismatches` — the actionable output: `{"expected": ..., "observed": ...}`.
  A one-character difference between the two is the homoglyph class.
- `missing` / `extra` — designations with no near-miss partner: a recall gap and
  a spurious assertion respectively.
- `measured: false` — **no conclusion was reached.** Not a pass.

## Rules

- Customer drawings, their extractions, rubrics, filenames, hashes and crops are
  **never committed**. The committed fixture is synthetic and fictional.
- Metered inference is a budget-declared acceptance test only, never a
  development loop — develop against the synthetic corpus and saved extractions.
- If a run does not reach the target, report the residual pattern (expected vs
  observed characters). Do not add a second paid verification call in response;
  that is a separate, explicitly-approved escalation.

## Related

- `printsense/designation_metrics.py` — the metric
- `printsense/benchmarks/homoglyph_corpus.py` — the synthetic CI fixture
- `printsense/verify.py` — why repeat agreement cannot promote a designation
- `printsense/interpret.py` `_SYSTEM` — the DIN/IEC + North American grammar
