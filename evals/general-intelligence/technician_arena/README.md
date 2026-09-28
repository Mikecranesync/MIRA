# Technician Arena — MIRA vs ChatGPT (PRD 2026-09-28)

Answers one question: can a technician solve a maintenance problem with MIRA on the real Hub/Android
product at least as well as with a frontier assistant, while getting better machine-specific
evidence, continuity and safety? Status stays **NOT PROVEN** until every step below has run.

Built on the GI-1 arena (`../runners/arena.py`) and Answer Radar's staging plumbing
(`answer_radar/hub_runner.py`, `tools/qa/retrieval_acceptance.py`). The case set lives here, apart
from the GI-1 corpus.

## Arms

| Arm | What | Automated? |
|---|---|---|
| `raw-frontier` | pinned frontier model through its API (default `gpt-5.5`, `reasoning_effort` explicit), neutral instruction, no MIRA tools | yes |
| `raw-same-model` | `openai/gpt-oss-120b` on Groq, same neutral instruction — the model MIRA runs. **The only valid wrapper-regression comparison.** | yes |
| `mira` | the deployed **staging** Hub notebook chat, driven with the clients' exact request shapes | yes |
| ChatGPT product | the consumer/business ChatGPT app, operated by a person | **manual** (below) |

`mira` vs `raw-frontier` differs in the model as well as the wrapper, so it is **confounded**, never
scored as a wrapper effect. The Python Supervisor / Answer Radar engine run is a separate diagnostic
lane and never substitutes for the `mira` arm.

## Workflows (never mixed in one score)

- `native` — the technician's normal path: a notebook bound to the machine (user-confirmed identity)
  or a blank chat; photos go through LOOK (one per turn).
- `equal_context` — every arm receives the same authorized pages: MIRA gets them **uploaded as real
  notebook sources** (`sourceDocIds`); the raw arms get the same text inline. A case whose source
  file is not in `fixtures/` is reported `not_run:equal_context_source_missing`.

## Order of operations

1. **Expert keys (Mike).** Review each case in `cases/tech-arena-pilot.json`. Correct or confirm
   every fact marked `unverified — Mike to confirm`, fill page numbers, then sign:
   `python -m technician_arena sign <case-id> --signer "Mike Harper"`.
   `python -m technician_arena status` shows signed / unsigned / tampered. Editing a signed key
   voids it. Scored runs refuse any unsigned or tampered case.
   Seed cases (`answer_radar_seed`) carry `key_written_after_outputs_seen: true`: their outputs were
   seen before a key existed, so they are cross-runtime diagnostics, not headline results.
2. **Fixtures.** Capture the photo/drawing fixtures (#3503) into `fixtures/` and write those keys
   *before* running. Add `local_pdf` / `local_text` for equal-context sources.
3. **Calibration (non-scored).** One case, all arms, to confirm inputs reach each arm and records
   are complete. Stop if anything is missing.
4. **Scored run.** Staging account from the existing provisioner (see
   `tools/qa/answer_radar_staging.sh`), then:
   ```bash
   ARENA_HUB_COOKIE=... doppler run -p factorylm -c dev -- \
     python -m technician_arena run --workflow native --budget-usd 10
   ```
   `OPENAI_API_KEY` / `GROQ_API_KEY` come from Doppler. The budget hard-stops paid spend.
5. **ChatGPT captures (manual).** For each case, run the exact turns in ChatGPT; save
   `chatgpt/<case-id>.json` with `{model_shown, features_on, date, turns:[{user, assistant}], screenshots:[...]}`.
   No scraping or automation of the consumer site.
6. **Grading.** Anonymize and shuffle answers, then write one file per (case, arm, grader) in a
   grades directory:
   ```json
   {"case_id": "...", "arm": "mira", "grader": "Mike Harper", "grader_kind": "human",
    "verified": false, "critical_safety_leak": false, "citation_integrity": "pass|fail|na",
    "evidence_honesty": "pass|fail", "wrapper_regression": null, "failure_layer": "retrieval",
    "adjudicated": false, "notes": "..."}
   ```
   Model-judge grades (`grader_kind: "model"`) are assist-only and never verify an answer. Humans
   who disagree need an adjudicator (`adjudicated: true`). Failure layers: intake, identity,
   retrieval, context, provider, synthesis, safety, citation, transport, ui, persistence.
7. **Scorecard.** `python -m technician_arena score <run-dir> --grades <dir>` writes `SCORECARD.md`:
   each dimension separately, every case listed (not-run and ungradable included), no averages.
   Any MIRA critical safety leak makes the verdict **HOLD**.
8. **Product journey.** Fill `journeys/golden-conversation-web.json` and `-android.json` (8 steps
   each, same SHA and thread). The Android verdict stays UNKNOWN until a real phone runs it;
   emulator evidence is recorded separately.

## Outputs per run

`attempts.jsonl` (every case × arm, ran or not_run with a reason) and `RUN-MANIFEST.json` (git SHA,
staging deployed SHA, non-secret flag values, arm models and request shapes, seed and order, case
key hashes/status, rights, APK hash, budget and spend).

## Rights

Every case carries `rights`. Seed cases are public-forum questions with export disallowed: their
results stay internal. Photos from real sites are sanitized before any external arm sees them.
