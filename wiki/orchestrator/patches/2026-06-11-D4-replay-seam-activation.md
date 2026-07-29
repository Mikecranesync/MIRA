# D4 — Replay-seam activation runbook (founder, ~30 min)

Audited `origin/main` @cb1be3fa (D4, 2026-06-11). The deterministic-eval seam is
**built but INERT** on deploy truth. This is the exact sequence to make it operable.
**No code patch is staged** because steps 1–2 record LLM outputs and step 4 edits
routine config — both founder judgment calls (matches D3/C3/F restraint). Each step has a verify.

## Why this matters now (not just measurement hygiene)
`cp_citation_vendor_relevance` (`tests/eval/grader.py:376`) is the **only deterministic
regression-guard** for the **#1858** quickstart cross-vendor citation-strip — the merged
fix that closed F3's last stranger-reachable blocker (the wrong-vendor citation *lie*).
It cannot run in CI today:
- the replay store is `.gitignore`d (`.gitignore:241`, `tests/eval/fixtures/llm_replay/*.json`)
  → absent on a fresh checkout → strict replay **raises on call #1** (`llm_replay.py:137`,
  `by_scenario` empty);
- `offline_run --replay` is wired into **0 workflows** (`ci-evals.yml` runs
  `synthetic_eval.py --mode dry-run`; `deepeval-ci.yml` runs **live** on `GROQ_API_KEY`).

Until this seam is operable, a future commit can silently re-introduce the wrong-vendor
lie and no CI gate will catch it.

## Step 1 — record the store (needs live keys, once)
```
doppler run -p factorylm -c dev -- env MIRA_EVAL_REPLAY=record python tests/eval/offline_run.py
```
Verify: `ls -la tests/eval/fixtures/llm_replay/` → `cascade.json` + `retrieval.json` present, non-empty.

## Step 2 — commit the store
- Edit `.gitignore`: remove (or narrowly scope) line 241 `tests/eval/fixtures/llm_replay/*.json`.
- `git add -f tests/eval/fixtures/llm_replay/cascade.json tests/eval/fixtures/llm_replay/retrieval.json`
- Verify: `git show HEAD:tests/eval/fixtures/llm_replay/cascade.json | head` → store is in the tree.
- Note: recorded responses are model outputs over the 59 offline fixtures with `sanitize=True`
  on the cascade — no customer PII. Eyeball once before committing.

## Step 3 — wire the keyless deterministic gate
Add a CI step (own workflow, or fold into `ci-evals.yml`) on PRs touching
`mira-bots/shared/**` or `tests/eval/**`:
```
env MIRA_EVAL_REPLAY=replay python tests/eval/offline_run.py   # strict, NO api keys
```
Verify: the step passes with `GEMINI_API_KEY` / `GROQ_API_KEY` / `CEREBRAS_API_KEY` **unset**
in the job env. This fills the missing **WIRING** edge (`offline_run --replay` → 0 workflows today).

## Step 4 — gate eval-fixer on a 3-run median
`fix_proposer_tasks.py` clusters off **one** scorecard (`min_cluster=3`, no median) → mints
phantom clusters (#1773/#1788; `vfd_abb_03` "fails" but passes 7/9).
Change: a fixture must fail in **≥2 of the last 3 committed scorecards** before it counts
toward a cluster.
Verify: replay the 06-07→06-08 scorecard series — the 6 FSM + 1 keyword fails persist; the
noise-band flappers drop out.

## Done when
- A `*-replay` scorecard is committed under `tests/eval/runs/` (byte-stable across 2 runs).
- The keyless replay gate is a **required** check on engine/eval PRs.
- D flips **YELLOW → GREEN**: the seam guards #1858, and eval-fixer stops phantom-filing.
