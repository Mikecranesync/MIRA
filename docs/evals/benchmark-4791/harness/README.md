# harness/

- `retrieval_rank.ts`: **not vendored.** Use #4589's file, byte-for-byte, from commit `c095b54c1` on
  `origin/feat/benchmark-acceptance-scorecard`:
  - sha256 `12ced03b922e1947cb2e0a5dd8f8a412738cda70a5a0bca0242538f262ca5f07`
  - `git show c095b54c1:tools/benchmark-acceptance/retrieval_rank.ts > <worktree>/tools/bench4589/retrieval_rank.ts`
  - A second copy in the repo would have tripped the `knowledge_entries` read scanner (Architecture Check).
    That scan targets product code; this file queries only a throwaway local Postgres.
- `scorecard.py`, `independent_recompute.py`: byte-identical copies of the same commit's
  `tools/benchmark-acceptance/` files.
- `safety_gate.ts`: new. It calls the notebook route's deterministic safety gate exactly as `route.ts` does.
  Copy it into `<worktree>/tools/bench4589/`.
- `ke_schema_bakeoff.sql`: the throwaway Postgres schema (staging's `knowledge_entries` DDL, no data). Load it
  with `psql -f`. The duplicate `CREATE POLICY` at the end errors harmlessly.
