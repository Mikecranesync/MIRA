# Answer Radar re-run — 2026-09-27 (vs day-one 2026-09-05)

**Result: VCAD 0 of 6 again.** Both independent graders returned FAIL on all six, with
zero disagreements. Scorecard: `SCORECARD-2026-09-27.txt`. Answers: `batch-2026-09-27T2017.json`.
Grades: `grades/`.

## Read this first — what this benchmark measures
Answer Radar drives the **Python engine** (`tests/eval/local_pipeline.py::LocalPipeline` →
Supervisor). That is the Telegram/Slack/pipeline path. It is **not** the Hub/mobile notebook
chat route. The retrieval fixes #3943–#3946 landed in the Hub route, so this re-run does not
measure them. The product surface (Hub/phone) is covered by `retrieval_acceptance.py` on
staging, which passes, but that suite asserts contracts, not answer quality. **The product
surface currently has no answer-quality benchmark.**

## Run conditions
- Code: `origin/main` @ 772dc2927. Doppler `factorylm/dev` (its own Neon branch, not prod).
  `INFERENCE_BACKEND=cloud`, free cascade only.
- Seed 001's first attempt was the engine-timeout placeholder ("This is taking longer than
  usual…", 30.9 s), but the harness recorded it as `answered`. It was re-run once
  (`rerun-FIELD-SEED-001.json`, 19.2 s, a real answer). The scorecard uses the re-run via
  `batch-scored-001-rerun.json`. Both attempts are kept.
- **Ground truth was reconstructed.** The PRS's written expected solutions were never committed
  and are lost. Graders got the ground-truth fragments quoted in the 09-05 grade files
  (`grader-packet.json`), cross-checked with their own knowledge. That makes them weaker than
  a written key; the fact-level checker proposed on 09-05 is still missing.
- The graders were two fresh Claude Sonnet sessions with opposed roles (verifier/adversary),
  `DIFFERENT_MODEL_SAME_PROVIDER`, the same class as 09-05.

## What changed since 09-05
- **Retrieval is no longer empty:** 4/6 retrieved 3 chunks (09-05: 0/6). Seed 001 retrieved
  the right Rockwell passage (DH-485 over RS-485 needs a 1761-NET-AIC). The other three
  retrieved **wrong-manufacturer** chunks (PowerFlex 70 for a ProSoft PLX32; AutomationDirect
  for a CM hoist).
- **Seed 003 (AUMA bootloader)** now declines instead of inventing a recovery procedure. It was
  the one unsafe answer on 09-05; both graders now give it safety 20/20.

## Defects found (not fixed here)
1. **Harness mislabels 3 of 6 as `uns_gate`** (003, 005, 006), which excludes them from the
   denominator and flatters the rate. None of those replies asks for site or asset. What trips
   `classify_answer` is a new engine note: "I removed a citation because I haven't established
   which machine you're working on" — even when the question names the make and model. Both
   graders independently flagged that note as false or self-contradictory.
2. **Harness counts the engine-timeout placeholder as `answered`** (seed 001, first attempt).
3. **Wrong-manufacturer `[Source: …]` tags survive in the answer text** (005 PowerFlex 70,
   006 AutomationDirect, 001 CompactLogix for an SLC 5/03), while the `citations` array is empty
   and the relevance guard reports a miss.
4. **Seed 002 asks for the manufacturer the question already names** (Festo), in 315 ms, with 0 chunks.
5. **Seed 005 answers a Modbus-gateway networking question with a drive fault-code intake
   template** (`wrong_subsystem`).
6. **Seed 004 mislabels the Modbus/TCP client as "MELSEC-NET"** (grader B) and stops before the
   register/data-format part of the question.
7. Environment: the NVIDIA/Nemotron rewrite endpoint returns `410 Gone` (a dead provider). A
   groq `REASONING_BURN` hit the 256-token cap and was retried. In dev, the `decision_trace`
   insert fails near `context_manifest` (dev Neon likely lacks migration 071; dev-only).

## Honest trend statement
0/6 → 0/6. Retrieval recall improved; answer correctness did not, on this path. Do not read the
harness's "3 scored" as progress — it comes from defect 1.
