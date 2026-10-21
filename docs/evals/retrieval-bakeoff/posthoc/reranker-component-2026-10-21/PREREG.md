# Reranker fp32 vs int8 component latency — pre-registration (2026-10-21, CHARLIE session)

Written BEFORE any measurement. A component diagnostic: it CANNOT pass or fail the bake-off's
end-to-end 1.25x p95 gate and does not change the decision report's verdict (keep A, PARTIAL).

## Inputs (identical for both variants)
- `requests.json` sha256 `57addb01f10212212d6bed6a1edaaad09b4b11e8a2db66cdc2d3ee5871e2df61`: 81 requests
  built from the saved dev pool `retrieval-phase0/replay-out/candidates-lexical.json`
  (sha256 `aa1dde26…f659f4`, public-50, NOT the sealed bake-off set): pool 24 (42 questions with >=24
  candidates) and pool 50 (39 with >=50). Pools 24 and 50 are the two modes the bake-off reranker saw
  (86 and 32 of 253 calls). Query cut to 1000 chars, passages to 2000 — the Hub client's limits; the
  served tokenizer truncates at 512 tokens.
- Code: the image's own `/app/app.py` `Reranker` class (exact served scorer), model rev 233902d2;
  onnx sha256 recorded per run from inside the container.

## Protocol
- One fresh container per variant run, `--network none`, `--cpus 3`, `RERANKER_THREADS=3`, memory 768m
  (staging's caps). Order fp32, int8, int8, fp32 (ABBA). Sequential, never concurrent.
- Cold = model load + first request. Warm = 3 discarded warm-ups, then all 81 timed.
- Metrics per variant x pool: warm p50/p95 (nearest-rank), max, cold first, load ms, failures.
- Ranking differences fp32 vs int8 on identical requests: top-6 identical-order count, top-6 set
  overlap (mean), Spearman over the pool.
- Host load (load average, competing containers) recorded before and after each run.

## Hardware separation
CHARLIE = Apple M4 / arm64 image. Staging/prod host = OVH 6 vCPU Haswell x86 (AVX2, no VNNI).
Results are reported in separate tables and never pooled or compared across hosts as ratios.
The int8 file is an x86-AVX2 quantization; its ARM numbers say nothing about x86 speed.

## Production-host run (x86) — NOT run without explicit approval
Existing authority on that host is read-only (logs/stats/inspect). If approved: same script, same
inputs, one container at a time from the already-present staging reranker image, `--cpus 2`
`RERANKER_THREADS=2` (leaves >=4 of 6 vCPU), `--network none`, `--memory 768m`, `--rm`, no restarts.
Abort thresholds (checked before and every run, then each 30 s by a read-only watcher):
- host 1-min load > 3.0, or MemAvailable < 3 GiB;
- any production container (`mira-*` without `stg-`) CPU > 150% or a restart;
- `https://app.factorylm.com/api/health` not 200 or slower than 2x its pre-run median (5 probes).
On any trip: stop the container, record, report. Max wall time 15 min total.

## Budget
$0 metered (no model API calls).

## Amendment 1 (before any measurement; all four first attempts failed to start, exit 125)
CHARLIE's Colima VM exposes only 2 CPUs (`docker run --cpus 3` refused). CHARLIE runs therefore use
`--cpus 2`, `RERANKER_THREADS=2` for BOTH variants — the same allocation as the proposed x86 run.
Side finding to report: the bake-off's `bakeoff-reranker` ran `RERANKER_THREADS=3` inside this 2-CPU
VM, so its recorded local reranker latency includes thread oversubscription (and is ARM).
