# MIRA PLC Parser — Evaluation Rubrics

> **How we test, in one breath:** three layers. (1) **Unit tests** (`tests/`, 111) — does each piece
> do what it says? (2) **Golden snapshots** (`tests/test_golden.py`) — did the `report@1` / `i3x@1`
> contract drift? (3) **This rubric + scorer** (`evals/score_phases.py`) — *how good* is each phase,
> graded on real CCW exports it was never tuned on? Layers 1–2 are pass/fail regression. Layer 3 is
> the quality gate you read before deciding a phase is "done enough to build on."
>
> **Run the benchmark:** `python evals/score_phases.py` → prints a scorecard, writes
> `evals/EVAL_SCORECARD.md`. Re-run it before adding any new phase.

## Why a rubric and not just "tests pass"

A green test suite proves the code does what the author *expected*. It says nothing about whether the
expectation was good, or whether the parser falls apart on a real customer's messy export. So every
phase is graded against two kinds of input:

- **Synthetic** — the hand-built fixtures in `tests/fixtures/` (`conveyor.L5X`, `gs10_tags.csv`,
  `conveyor.st`, …). The code was written against these, so passing them only proves *no regression*.
- **GENERALIZATION** — the **real** CCW exports under `plc/` (`Micro820_v4.1.9_Program.st`, a
  557-line GS10 state machine with a real comm watchdog; `vars_ConvSimple_v1.9.csv`). The parser was
  **never tuned on these**. Generalization criteria are weighted **1.5–2×** because this is what a
  paying customer actually hands us.

A grade that's all-green on synthetic data and quietly fails on the real program is a **D**, not an A.
That's the point.

## Grading scale (what a letter means to a maintenance buyer)

| Grade | Plain meaning | Ship decision |
|---|---|---|
| **A** | Works on real exports; a tech can trust the output with a glance at the confidence/REVIEW flags. | Build on it. |
| **B** | Works, but with a known rough edge (noise, a dialect it doesn't cover) that's documented and bounded. | Build on it; track the edge. |
| **C** | Right idea, real-data precision is weak — useful as a *draft a human edits*, not a trusted answer. | Usable behind human review; don't auto-trust. |
| **D** | Passes synthetic, misses the real-world case it was built for. | **Fix before building on it.** |
| **F** | Not built, or fundamentally wrong. | Not available. |

Each phase grade is a weighted average of its criteria (each scored 0.00–1.00, every score carrying
the evidence it measured — see the scorecard's Evidence column). Generalization criteria carry the
most weight.

---

## The rubrics

### Phase 1 — Structural extraction (L5X + CSV → IR)
*The foundation. If extraction is wrong, every downstream finding is wrong.*

| # | Criterion | Why it matters |
|---|---|---|
| 1.1 | L5X controller / tags / rungs extracted exactly | The IR is only trustworthy if it mirrors the export. |
| 1.2 | CSV tags **and physical addresses** survive into the IR | Addresses are what tie a tag to a live Modbus register later. |
| 1.3 | A closed project (`.ACD`) is **refused with guidance**, never faked | Pretending to parse a binary blob is worse than an honest "export an L5X". |
| 1.4 | **GEN:** a real 557-line CCW program parses without crashing | Real programs are 50× the size of the fixture. |

### Phase 2 — Eval dataset + golden snapshots
*The contract guard.* The `report@1` / `i3x@1` JSON is what downstream MIRA ingest consumes, so its
shape is an asset. Any field/count/ordering drift must be a **deliberate, reviewed** golden regen.

### Phase 3 — IR hardening
*The shape is pinned.* camelCase tokenizer fix + the golden gate keep the IR stable across parser
changes.

### Phase 4 — Structured Text + PLCopen XML
*The reasoning bridge — the export format CODESYS / OpenPLC / Siemens-SCL / CCW can all emit.*

| # | Criterion | Why it matters |
|---|---|---|
| 4.1 | ST assignments lift into rungs (output-dependency view works on ST) | Lets the same analysis run on ladder *and* text. |
| 4.2 | PLCopen XML reuses the ST body-lift | One reasoning path, many front-ends. |
| 4.3 | **GEN:** real CCW **no-VAR** export recovers undeclared variables + warns | CCW keeps the var table in a separate CSV; the body alone must still yield signals. |
| 4.4 | **ST role precision** — how many "output" tags are *real* outputs vs internal flags | Every `LHS :=` becomes an "output"; on real code that's noisy. **Known rough edge.** |

### Phase 5 — Analysis depth (permissives · timer→fault chains · sequences)
*The maintenance-intelligence layer — the "why is this stopped" reasoning on top of the structural IR.*

| # | Criterion | Why it matters |
|---|---|---|
| 5.P1 | Permissive: synthetic motor output captured w/ e-stop **interlock → REVIEW** | Safety conditions must never be auto-trusted. |
| 5.P2 | **GEN:** permissive **precision** on the real program | Over-firing on internal flags makes the list noise. **Known rough edge.** |
| 5.T1 | Timer-chain: synthetic L5X watchdog (`TON` + `.DN`) → fault detected | The Rockwell shape works. |
| 5.T2 | **GEN:** real IEC-FB watchdog (`vfd_err_timer.Q` → fault) detected | **The headline use case** — the real GS10 5 s comm watchdog. Weighted 2×. |
| 5.S1 | **GEN:** real state machine (`conv_state` CASE) detected HIGH, ≥5 transitions | Sequencer extraction on real logic. |
| 5.S2 | A non-state assignment is **not** mislabeled a sequencer | No false positives. |

### Phase 6 — Siemens TIA Openness XML — *not built* (recognized + routed, no parser).
### Phase 7 — PDF / screenshot OCR fallback — *not built*.

---

## Current grades (run `python evals/score_phases.py` to refresh)

See `evals/EVAL_SCORECARD.md` for the live numbers + evidence. Headline at last run:

| Phase | Grade | Note |
|---|---|---|
| 1 Structural extraction | **A+** | solid on synthetic + the real 557-line program |
| 2 Goldens / 3 IR hardening | **A+** | contract pinned |
| 4 ST + PLCopen | **B+** | works; ST role precision is the rough edge (4.4) |
| 5 Analysis depth | **A−** | sequences A, timer-chains now catch the real IEC-FB watchdog; permissive precision (5.P2) is the remaining drag |
| 6 Siemens / 7 OCR | **F** | not built |

## What the benchmark caught — and what's still open

1. **CLOSED — Phase 5 / 5.T2: the timer→fault analyzer missed the real watchdog.** First benchmark run
   scored this **0.00**: the real CCW program writes `vfd_err_timer(IN := vfd_comm_err, PT := T#5000ms);
   IF vfd_err_timer.Q THEN …`, but the detector only knew the Rockwell `TON(tag)` + `tag.DN` shape — it
   missed the one pattern it exists to catch. **Fixed** by recognizing IEC timer **function-block
   instances** (`name(… PT := …)` + `.DN/.ET/…` members) from the source, which lifted Phase 5 from
   **D (68%) → A− (92%)** and now detects `vfd_err_timer`, `vfd_poll_timer`, `uptime_timer` on the real
   program. This is the benchmark doing its job: it found a real defect in shipped work and drove the fix.
2. **OPEN — Phase 4 / 5.P2 precision: ST role inference over-fires.** Every assignment LHS becomes an
   "output", so internal flags (`button_rising`, `prev_button`, …) pollute the outputs (4.4 ≈ 0.46) and
   permissives (5.P2 ≈ 0.60). → fix: distinguish a driven *equipment* output from an intermediate logic
   variable (demote a variable only ever read by other rungs that maps to no IO point / asset keyword).
   This is **Phase 4/5 hardening, not a new phase** — close it and re-grade before Phase 6.
