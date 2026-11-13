# Benchmark acceptance scorecard: **INCONCLUSIVE**

- Failed gates: Q1, Q2
- Not measured: Q3, Q4, Q5, S1, S2, S3, S4, S5
- Approved exceptions: none
- Input sha256: `a0c444d5d661d3254d0f34e00d28cf8cd3de3f97e6418b4141b39664ba4efcb6`

| Gate | Status | Detail |
|---|---|---|
| V1_integrity | PASS | complete pairs |
| V1_sample | FAIL | n=77 kinds={'answerable': 77} (need 100/20/20) |
| Q1 | FAIL | Recall@5 0.597 vs >= 0.9 |
| Q2 | FAIL | MRR@10 0.487 vs >= 0.85 |
| Q3 | NOT_MEASURED | answer correctness not measured |
| Q4 | NOT_MEASURED | citation accuracy not measured |
| Q5 | NOT_MEASURED | not measured |
| Q6 | TARGET_MISSED | Recall@5 +0.0 pp (target, not a release gate) |
| Q7 | PASS | no secondary regression > 2 pp |
| S1 | NOT_MEASURED | no #4572 rows |
| S2 | NOT_MEASURED | refusal rate not measured |
| S3 | NOT_MEASURED | fabrication-free safety answers not measured |
| S4 | NOT_MEASURED | safety warning placed before hazard not measured |
| S5 | NOT_MEASURED | no paired refusal/safety rows |
| P1 | PASS | p95 415 -> 298 ms (-28.2%) |

| Metric | OFF | ON |
|---|---|---|
| recall5 | 46/77 = 0.597 [0.486, 0.700] | 46/77 = 0.597 [0.486, 0.700] |
| hit1 | 31/77 = 0.403 [0.300, 0.514] | 31/77 = 0.403 [0.300, 0.514] |
| hit6 | 51/77 = 0.662 [0.551, 0.758] | 51/77 = 0.662 [0.551, 0.758] |
| mrr10 | /77 = 0.487 [0.389, 0.585] | /77 = 0.487 [0.389, 0.585] |
| answer_correct | not measured | not measured |
| citation_correct | not measured | not measured |
| refusal | not measured | not measured |
| s1_4572 | not measured | not measured |
| fabrication_free | not measured | not measured |
| safety_warning | not measured | not measured |
| unsupported_claims | not measured | not measured |
| latency_p50 | 77.91195900000093 | 46.21995900000002 |
| latency_p95 | 415.0830829999977 | 297.8423750000002 |

| Paired (OFF vs ON) | n | b (OFF only) | c (ON only) | delta pp | exact McNemar p |
|---|---|---|---|---|---|
| recall5 | 77 | 0 | 0 | +0.0 | 1.000 |
| hit1 | 77 | 0 | 0 | +0.0 | 1.000 |
| hit6 | 77 | 0 | 0 | +0.0 | 1.000 |
| answer_correct | not measured | | | | |
| citation_correct | not measured | | | | |
| refusal | not measured | | | | |
