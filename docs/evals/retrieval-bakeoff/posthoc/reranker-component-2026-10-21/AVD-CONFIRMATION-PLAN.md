# Proposed: one A-vs-D end-to-end confirmation (NOT RUN — needs approval)

**What it re-tests:** the ORIGINAL pre-registered gate (D's end-to-end p95 <= 1.25x A's), on CHARLIE,
with the reranker oversubscription removed. **What it cannot say:** anything about x86/staging
latency. It does not replace the original verdict; it is reported as a labelled confirmation.

- Harness: the existing `mira-hub/tests/bakeoff/bakeoff.bench.ts` on `eval/retrieval-bakeoff`
  @ `69fdda6c4` (pinned), same sealed 139 questions (sha256 `7e42f6d1…`), same `bakeoff` DB in
  `bakeoff-pg`, same answer model and settings from `.planning/bakeoff/env.sh`.
- Arms: `BAKEOFF_ARMS=A,D`, ABBA-interleaved as in run 1. Only `NOTEBOOK_RERANK` differs.
- Reranker: a NEW throwaway container from the same image `sha256:f1fb68d3…`,
  `RERANKER_MODEL=int8-avx2` (the graded arm D variant), `RERANKER_THREADS=2`, `--cpus 2`,
  on a new local port; `bakeoff-reranker` is left untouched. Removed after the run.
- Pre-registration committed before the run: primary = D/A end-to-end p95 ratio, gate 1.25x unchanged,
  baseline wins ties; per-turn proof the rerank lane ran (reranker request count == D turns,
  fallback count reported; any fallback rate > 5% voids the latency reading).
- Contention: VM CPUs are shared with bakeoff-pg (as in run 1); recorded, not removed.
- Cost: run 1 measured $2.10 / 695 turns = $0.0030 per turn -> 278 turns ~ $0.84 measured
  (upper bound incl. the unrecorded second call ~ $1.76). Running total stays far under the $25 cap.
- Wall time ~15 min. No staging, no production, no shared flags.
