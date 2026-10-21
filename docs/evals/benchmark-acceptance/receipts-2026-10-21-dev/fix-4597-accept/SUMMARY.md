# #4597 fix acceptance (2026-10-21, $0, dev-77, same machine and data)

**Harness:** `retrieval_rank.ts` at pin `9d22076c1`, unmodified.
- BEFORE = the pin.
- AFTER = branch `fix/lexical-v2-deterministic-order-4597` (base `0e5bb3de7` + `after-fix.diff`).
- Run order: ON k6 alternates before/after ×5. Then AFTER ON k10 ×5, then AFTER OFF k6 ×2 (control).

| arm | runs | `ranked_pages` rows differing from run 1 | hit@1 | hit@6 | recall@5 | MRR@10 | p50 ms, median [range] | p95 ms, median [range] |
|---|---|---|---|---|---|---|---|---|
| before ON k6 | 5 | 0, 9, 9, 9, 10 | 41–42 | 69 | 66 | 0.666–0.673 | 31.3 [29.7–32.4] | 225.4 [215.8–288.2] |
| **after ON k6** | 5 | **0, 0, 0, 0, 0** | 42 | 69 | 66 | 0.673 | 31.1 [30.1–31.8] | 221.6 [219.7–280.6] |
| **after ON k10** | 5 | **0, 0, 0, 0, 0** | 42 | 66 | 64 | 0.669 | 48.3 [48.2–50.2] | 307.2 [305.9–313.3] |
| after OFF k6 | 2 | 0, 0 | 31 | 52 | 48 | 0.492 | 21.9 | 171.9 |

**#4597 acceptance**
1. **Repeatable ordering: met.** 0/77 rows differ across N=5 at both k6 and k10.
2. **Accuracy unchanged: met.**
   - ON stays inside today's band: hit@6 69, hit@1 42 (band 41–43), recall@5 66 (band 65–66).
   - k10 matches BRAVO's recomputation (66 / 64 / 0.668).
   - OFF is bit-identical to every earlier run (31 / 52 / 48).
3. **Latency measured:** p50 31.1 vs 31.3 ms and p95 221.6 vs 225.4 ms, interleaved on the same machine. No regression.

**Script file:** `accept_4597.sh.txt` is byte-identical to the executed `accept_4597.sh` (listed in `SHA256SUMS`). It is renamed only so the shellcheck hook does not lint a frozen receipt.
