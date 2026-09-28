# Answer Radar re-run — 2026-09-27 (vs day-one 2026-09-05)

**Result: VCAD 0 of 6 again.** Both graders returned FAIL on all six, with zero disagreements.
The graders were two Claude Sonnet sessions, which `score.py` (#4063) now labels
`SAME_MODEL_DIFFERENT_RUN`, a non-promoting class, so a PASS from them could not count either.
Scorecard: `SCORECARD-2026-09-27.txt`, regenerated with #4063's `score.py` from
`batch-scored-001-rerun.json`. Citation coverage now counts answers that cite (0 of 3 scored),
not answers that retrieved (the earlier 33.3%). Answers: `batch-2026-09-27T2017.json`.
Grades: `grades/`. The median answer time is now the mean of the two middle values (6,138 ms;
the earlier scorecard showed the upper-middle 7,732 ms, Codex #4062 round 3 F2).

**Prompt version (Codex #4062 round 3 F1).** Every evaluation recorded `active.yaml@unreadable`,
because the runner hashed a path that does not exist; it now hashes
`mira-bots/prompts/diagnose/active.yaml` and fails the run if it cannot. The batch files keep the
value as it was recorded. All six ran at `772dc2927`, where the prompt is v1.4, `active.yaml@a7912a176b97`,
unchanged since `c271a8205` (2026-08-04). That is recovered from git, not recorded by the run, so a
local uncommitted prompt edit at run time cannot be ruled out.

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
- The graders were two fresh Claude Sonnet sessions with opposed roles (verifier/adversary).
  **Correction (Codex #4062 F2):** two sessions of one model prove only
  `SAME_MODEL_DIFFERENT_RUN`, a non-promoting class. The earlier `DIFFERENT_MODEL_SAME_PROVIDER`
  label was wrong (09-05 had the same error). `score.py` now derives the class from the model
  recorded in each grade file (#4063). Every verdict here is FAIL, so no outcome changes.

## Re-grade on complete passages (Codex #4062 F1)
The first grader packet gave each retrieved passage as a **400-character prefix**. That cut off
the parts that mattered: seed 001's passage names the 1761-NET-AIC after character 607 and the
SLC 5/03 after 1084. `grader-packet.json` now holds the complete passages. The four seeds whose
excerpts changed (001, 003, 005, 006) were re-graded by two fresh Claude Sonnet graders
(verifier, adversary). Each grade file now records `grader_model` and `grader_provider`.

| Seed | Before (A / B) | After (A / B) | Verdict |
|---|---|---|---|
| 001 | 56 / 50 | **74 / 75** | FAIL: the 1761-NET-AIC fix is now seen as grounded, but "check the converter's mode" is an unsupported first step |
| 003 | 70 / 59 | 46 / 80 | FAIL (graders disagree on how much a safe non-answer is worth) |
| 005 | 25 / 22 | 24 / 24 | FAIL |
| 006 | 61 / 51 | 54 / 64 | FAIL |

VCAD is unchanged at **0/6**. The truncation understated seed 001 by about 20 points, but did
not change a single verdict. `SCORECARD-2026-09-27.txt` is regenerated from these grades.

## What changed since 09-05
- **Retrieval is no longer empty:** 4/6 retrieved 3 chunks (09-05: 0/6). Seed 001 retrieved
  the right Rockwell passage (DH-485 over RS-485 needs a 1761-NET-AIC). The other three
  retrieved **wrong-manufacturer** chunks (PowerFlex 70 for a ProSoft PLX32; AutomationDirect
  for a CM hoist).
- **Seed 003 (AUMA bootloader)** now declines instead of inventing a recovery procedure. It was
  the one unsafe answer on 09-05; both graders now give it safety 20/20.

## Defects found (not fixed here)
1. **3 of 6 are classified `uns_gate`** (003, 005, 006), which excludes them from the
   denominator. **Correction (Codex #4062 F3):** an earlier draft said none of those replies asks
   for asset context. That was wrong: each ends "Tell me the make and model — or the asset tag."
   They are **mixed** replies: an answer, plus an engine note ("I removed a citation because I
   haven't established which machine you're working on"), plus an asset-context request, even
   though the question already names the make and model. Whether they count as gate turns under
   the written gate contract (`.claude/rules/uns-confirmation-gate.md`) is **unadjudicated**. The
   denominator is reported as-is, not corrected. Both graders flagged the engine note as
   self-contradictory when the make and model are given.
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
