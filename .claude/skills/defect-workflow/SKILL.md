---
name: defect-workflow
description: Reproduce and fix a MIRA defect using contract traceability, subagent separation, TDD both directions, and the deterministic phone battery. Use for any user-reported misbehavior, red battery fixture, or production incident.
---

# MIRA Defect Workflow

The full doctrine: `docs/agents/subagent-development-handbook.md` §14.1. Contract registry: `docs/contracts/contract-index.yaml`. This skill is the operational checklist with the repository's real commands.

## Phases

1. **Intake.** Record the exact interaction, observed vs expected output, current commit, related battery fixture, severity, safety impact, and the user's stop conditions.
1b. **Repo Archaeologist** (standing, read-only) — before any builder, and after an Answer Radar failure: what already exists on `main`, open/closed PRs, branches, and abandoned work? Dispatch `.claude/agents/repo-archaeologist.md`. Do not skip to implementer on BUILD until that search went beyond `main`.
2. **Independent investigation** — `investigator` agent (read-only). Required: reproduction, real execution path, competing hypotheses with falsifying evidence, recommended red tests. No production edit in this phase. Archaeologist maps reuse; investigator reproduces the defect.
3. **Contracts** — check `docs/contracts/contract-index.yaml`; involve `contract-architect` if the behavior isn't precisely specified. New IDs only when no current rule fits.
4. **Red tests** — `test-engineer` (test files only): the defect test failing for the expected reason + the opposite-direction preservation test. Battery fixtures for conversational behavior (grader checks the FINAL reply). Capture red output.
5. **Implementation** — `implementer`, one writer per file, isolated worktree, smallest root-cause fix. Engine edits need `codegraph_impact` first and the staging gate before merge.
6. **Mutation check** — break the fix, confirm the tests catch it, restore. **Commit before mutating.**
7. **Review** — `conversation-reviewer` for user-facing behavior; `safety-reviewer` for control/procedural/LOTO surface; `security-reviewer` for auth/secrets/connectivity/deploy.
8. **Verification, in order:** targeted tests → related suites (separate invocations for `tests/` vs `mira-bots/tests/`) → lint → full phone battery → diff-scope review.
9. **PR** — traceability body (root cause, contract IDs, red-before/green-after, battery result, safety/security impact, rollback). **Hold merge for the owner.**
10. **Production (when authorized)** — `release-verifier`: deploy log chain (`HEAD is now at <sha>` + container Started), pre-deploy artifact + checksum + redaction, then the owner's Telegram probe for live behavior.

## Real commands

```bash
# Targeted tests (Windows dev box)
py -3 -m pytest <paths> -q -p no:cacheprovider

# Phone battery (free: cascade + staging KB; local Ollama nomic-embed-text must be running)
PYTHONIOENCODING=utf-8 EVAL_DISABLE_JUDGE=1 MIRA_PROCESS_TIMEOUT=90 \
  doppler run -p factorylm -c stg -- \
  py -3 tests/eval/offline_run.py --suite text --only phone-battery

# Lint
py -3 -m ruff check <files> && py -3 -m ruff format --check <files>
```

Known traps: conftest basename collision (`tests/` vs `mira-bots/tests/` — separate invocations); pre-existing broken collections (`test_slack_relay`, `test_teams_adapter`); `PYTHONIOENCODING=utf-8` required on Windows; BEHIND strands armed auto-merge (re-update the branch); the GitHub API caches merge state (~5 s double-read).
