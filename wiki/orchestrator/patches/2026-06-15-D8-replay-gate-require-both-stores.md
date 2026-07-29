# D8 patch — eval-replay-gate: require BOTH replay stores in the presence check

**Staged:** 2026-06-15 (D8). **Target:** origin/main @64e156c9 (deploy truth). **Keyless, mergeable today.**

## Why
`eval-replay-gate.yml` activates only when the recorded store is present, checking
`hashFiles('tests/eval/fixtures/llm_replay/cascade.json')`. But strict replay loads
TWO stores — `cascade.json` (LLM cascade) AND `retrieval.json` (`neon_recall`) —
see `tests/eval/llm_replay.py:40-41`. The activation runbook's own Step 1 verify
expects BOTH present + non-empty. With the single-file check, a half-recorded store
(cascade captured but the DB was down during `record`, so `retrieval.json` never
landed) flips the gate ACTIVE and then raises on the first retrieval call → a
false-red on engine PRs. Require both files so the gate flips active only when the
seam is actually replayable.

## Apply
```
cd <repo>            # on a branch off origin/main
git apply -p1 wiki/orchestrator/patches/2026-06-15-D8-replay-gate-require-both-stores.patch
```

## Verify
```
git apply -p1 --check wiki/orchestrator/patches/2026-06-15-D8-replay-gate-require-both-stores.patch   # clean
grep -n 'retrieval.json' .github/workflows/eval-replay-gate.yml                                       # now present in the store step
actionlint .github/workflows/eval-replay-gate.yml                                                     # YAML still valid
```

## Notes
- Pure workflow change, 8 ins / 0 del, inline-documented. Does not activate the gate
  on its own (store still `.gitignore`d) — it hardens the activation predicate so the
  founder's store-recording step (runbook `2026-06-11-D4-replay-seam-activation.md`)
  can't flip the gate active-but-broken.
- Forward-only: `git apply -R --check` fails on a clean origin/main tree.
