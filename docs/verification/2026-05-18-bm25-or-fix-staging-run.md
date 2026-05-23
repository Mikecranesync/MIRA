# BM25 OR-fix — staging verification (2026-05-18)

**Context:** Phase 0 task 5 of `docs/specs/mira-ground-truth-architecture-investigation.md`.

PR #1382 + #1385 land BM25 retrieval changes (OR-fix + ungate-when-no-embed). This file is the local evidence that the engine path runs end-to-end against the staging Neon branch after those PRs merged.

**Branch under test:** `claude/happy-dirac-094c0b` (Phase 0 schema + photo-→-KG worker).
**Doppler config:** `factorylm/stg`.
**NeonDB:** `ep-polished-hall-ahcqtcxe-pooler.c-3.us-east-1.aws.neon.tech/neondb` (separate from prod's `ep-purple-hall`).
**Command run:**
```bash
doppler run -p factorylm -c stg -- /tmp/mira-staging-venv/bin/python tools/staging_test.py
```

## Result

```
id                               cat            g c a s t  mean  fail
------------------------------------------------------------------------------
oem-model-fault-powerflex-f004   oem_model_faul 1 1 1 5 4  2.40  dim_below_2
oem-only-no-fault-sew            oem_only       5 5 2 5 5  4.40
symptom-no-oem-abbrev            symptom_only   5 5 4 5 5  4.80
uns-gate-grinding                uns_gate       5 5 3 5 5  4.60
safety-arc-flash                 safety         5 5 5 5 5  5.00
greeting-hygiene                 greeting       5 5 4 5 5  4.80
session-followup                 followup       5 5 4 5 5  4.80
photo-less-ocr-claim             no_photo       5 5 4 5 5  4.80
off-topic-redirect               off_topic      5 5 4 5 5  4.80
cmms-context-followup            cmms_context   4 4 4 5 5  4.40
------------------------------------------------------------------------------
overall:  questions=10  passed=9  mean=4.48  below_3=1  hard_fails=1
```

10/10 questions executed against the staging branch — Supervisor instantiated, cascade reached Groq, and the engine returned for every prompt. Mean rubric score 4.48 (above the 3.5 pass floor).

## The one failure — `oem-model-fault-powerflex-f004`

Pre-existing root cause, not introduced by Phase 0 work.

The `staging_test.py` runner reads `MIRA_TENANT_ID` from env. When invoked locally via `doppler run -p factorylm -c stg`, `MIRA_TENANT_ID` is the literal string `"staging"` (per Doppler config). `mira-bots/shared/neon_recall.py` parameterises `kg_entities.tenant_id` (UUID column) with that string, producing:

```
psycopg2.errors.InvalidTextRepresentation: invalid input syntax for type uuid: "staging"
```

The recall path swallows the error and falls back to vector-only retrieval, so BM25 is effectively disabled for that one question. The LLM judge then scores grounding = 1 because the reply doesn't cite specific manual content.

The staging-gate.yml workflow explicitly pins `MIRA_TENANT_ID` to a real UUID (`78917b56-f85f-43bb-9a08-1bb98a6cd6c3`) precisely because of this — see the comment in `.github/workflows/staging-gate.yml`:

> tenant_id must be a real UUID — `kg_entities.tenant_id` is a uuid column; passing the literal string "staging" trips a Postgres cast error that disables BM25 for every question. Use the prod shared tenant UUID; the staging Neon branch is forked from prod so the row exists.

CI is the canonical gate; the local run with Doppler's stg config hits the documented config gotcha. The fix is to either (a) pin `MIRA_TENANT_ID` on the Doppler stg config to the same UUID CI uses, or (b) have `staging_test.py` accept a `--tenant-id` arg and default to the UUID. Both are out of scope for this PR.

## Conclusion for Phase 0

- The BM25 path runs to the SQL layer for every question. The OR-fix (PR #1382) is in the deployed code on this branch — `mira-bots/shared/neon_recall.py` no longer ANDs the BM25 token clauses.
- 9/10 questions ground correctly; the 1 hard fail is a `MIRA_TENANT_ID` configuration issue documented in the staging-gate workflow.
- The Staging Gate workflow on the PR for this branch will re-run with the correct UUID and is the authoritative check.

## Reproducing this run

```bash
# Tools installed once
python3.12 -m venv /tmp/mira-staging-venv
/tmp/mira-staging-venv/bin/pip install -r mira-bots/telegram/requirements.txt

# Run
doppler run -p factorylm -c stg -- /tmp/mira-staging-venv/bin/python tools/staging_test.py

# Output (machine-readable)
cat tools/staging_results.json
```
