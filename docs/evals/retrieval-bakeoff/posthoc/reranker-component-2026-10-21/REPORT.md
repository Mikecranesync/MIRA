# Reranker fp32 vs int8 — component diagnostic (POST-HOC, 2026-10-21)

**Label: POST-HOC component diagnostic.** It cannot pass or fail the bake-off's end-to-end 1.25x p95
gate. The decision report's verdict (keep production, arm A) and its PARTIAL status are unchanged.
Pre-registration: `PREREG.md` (+ Amendment 1, written before any measurement). Inputs and scripts
are pinned in `SHA256SUMS`.

## 1. CHARLIE — Apple M4, arm64 image, Colima VM (2 CPUs), --cpus 2, threads 2
Image `sha256:f1fb68d3…` (the bake-off's own reranker image). app.py sha256 `fcafe461…`, ORT 1.23.2.
fp32 onnx `5d3e70fd…`, int8-avx2 onnx `c80a8b34…` (both = `mira-reranker/MODEL_SHA256`).
Competing load: CHARLIE load average 3.3 → 11.0 peak during run 2 (other sessions); bakeoff-reranker idle;
bakeoff-pg also lives in this 2-CPU VM (idle during these runs).

| run | variant | pool | n | warm p50 ms | warm p95 ms | max ms | cold: load + first request ms (single sample) | failures |
|---|---|---|---|---|---|---|---|---|
| 1 | fp32 | 24 | 42 | 1122 | 1549 | 2798 | 316+1097 | 0 |
| 4 | fp32 | 24 | 42 | 1115 | 1455 | 2374 | 295+1097 | 0 |
| 2 | int8-avx2 | 24 | 42 | 547 | 786 | 1142 | 250+459 | 0 |
| 3 | int8-avx2 | 24 | 42 | 552 | 734 | 1172 | 258+497 | 0 |
| 1 | fp32 | 50 | 39 | 2262 | 3723 | 4146 | | 0 |
| 4 | fp32 | 50 | 39 | 2300 | 3418 | 3454 | | 0 |
| 2 | int8-avx2 | 50 | 39 | 1084 | 1736 | 1771 | | 0 |
| 3 | int8-avx2 | 50 | 39 | 1104 | 1734 | 1833 | | 0 |

Ranking, fp32 vs int8 on identical requests: top-6 identical order 14/42 (pool 24), 14/39 (pool 50);
mean top-6 set overlap 0.952 / 0.966 (worst 4 of 6 / 5 of 6); mean Spearman 0.990 / 0.995;
max |score diff| 0.94 / 1.08 logits. Each variant reproduced its own scores exactly across runs.
The int8 file is an x86-AVX2 quantization: these ARM timings say nothing about x86 int8 speed.

## 2. Staging x86 — OVH 6 vCPU Haswell (AVX2, no VNNI), read-only evidence only
Served config (docker inspect, 2026-10-21): `RERANKER_MODEL=fp32`, threads 3, cpus 3, mem 768m,
image `sha256:a65a83fc…`, restarted 10:45Z. Its app.py hash was NOT read (read-only authority; no exec);
the served model tag/revision is confirmed from its own load log line. Host at probe: load 0.23, 8.2 GiB available.
Served calls since restart (container's own log): n=2 — 46 passages 3569 ms, 42 passages 4107 ms.
No identical-input x86 comparison was run: existing authority on that host is read-only.

## 3. Reconciling the earlier numbers (do not pool across hosts)
| source | host | variant | config | pool | result | contention |
|---|---|---|---|---|---|---|
| CU-RR1 step 3 | CHARLIE native ARM | fp32 | 2 threads | 24 | p50 ≈ 1.6 s | — |
| CU-RR1 speed phase | CHARLIE native ARM | int8 | 8 threads | 24 | p50 955 → 243 ms | — |
| CU-RR1 walks | staging x86 | fp32 | 3 thr / 3 cpu | served (24–50) | p50 2.6, p95 4.1 s, n=123 | embedder uncapped at the time; contention not measured |
| CU-RR1 walks | staging x86 | int8 | 3 thr / 3 cpu | served | p50 2.3, p95 3.3 s, n=41 | embedder at ~557% CPU (starved) |
| Bake-off report | CHARLIE Colima ARM | int8 | **3 threads in a 2-CPU VM** | 24–50 (253 calls) | p50 1.57, p95 2.85 s | oversubscribed; `bakeoff-pg` shared the same 2-CPU VM |
| Today (served) | staging x86 | fp32 | 3 thr / 3 cpu | 42–46 | 3.6 / 4.1 s, n=2 | host idle, embedder capped |

Consequences:
- The report's "staging corroboration 3.3–4.1 s" pairs a contended int8 p95 (3.3) with an fp32 p95
  (4.1). Neither is a clean measurement of int8 on uncontended x86.
- The report's local reranker numbers (and therefore arm D/E's local end-to-end latency) were taken with
  3 threads inside a 2-CPU VM. This is a measurement-condition caveat, not a reason to change the verdict.
- The pool the reranker sees is 24–50, not the fixed 24 CU-RR1 measured; latency scales ~linearly.

## 4. Is int8 promising enough for an A-vs-D confirmation? Not decidable yet.
Gate arithmetic (local, post-hoc illustration only): A's p95 3.81 s x 1.25 = 4.76 s, so D may add
~0.95 s at p95. ARM int8 adds 0.73–1.74 s by pool. The deciding number is uncontended x86 int8 at
pools 24 and 50 — the approval request below. Run 1's arm D was graded on **int8-avx2** (the
bake-off reranker's served variant); staging serves **fp32**. fp32 and int8 rank differently on the same
inputs (14/42 identical top-6 order), so any confirmation must pin int8 to stay the graded arm, and
any fp32 deployment would be an ungraded arm.
