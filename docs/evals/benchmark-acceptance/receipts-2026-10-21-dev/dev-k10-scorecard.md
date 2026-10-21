# Benchmark acceptance scorecard: **NO-GO**

- Failed gates: P1, Q1, Q2
- Not measured: Q3, Q4, Q5, S1, S2, S3, S4, S5
- Approved exceptions: none
- Input sha256: `1646b3535e65cff06006dc160cff8f06ceb95354e61e950d1d2f5a35b856dbdc`

| Gate | Status | Detail |
|---|---|---|
| V1_integrity | PASS | complete pairs |
| V1_sample | FAIL | n=77 kinds={'answerable': 77} (need 100/20/20) |
| Q1 | FAIL | Recall@5 0.831 vs >= 0.9 |
| Q2 | FAIL | MRR@10 0.668 vs >= 0.85 |
| Q3 | NOT_MEASURED | answer correctness not measured |
| Q4 | NOT_MEASURED | citation accuracy not measured |
| Q5 | NOT_MEASURED | not measured |
| Q6 | PASS | Recall@5 +23.4 pp (target, not a release gate) |
| Q7 | PASS | no secondary regression > 2 pp |
| S1 | NOT_MEASURED | no #4572 rows |
| S2 | NOT_MEASURED | refusal rate not measured |
| S3 | NOT_MEASURED | fabrication-free safety answers not measured |
| S4 | NOT_MEASURED | safety warning placed before hazard not measured |
| S5 | NOT_MEASURED | no paired refusal/safety rows |
| P1 | NEEDS_APPROVAL | p95 257 -> 315 ms (+22.5%) |

| Metric | OFF | ON |
|---|---|---|
| recall5 | 46/77 = 0.597 [0.486, 0.700] | 64/77 = 0.831 [0.732, 0.899] |
| hit1 | 31/77 = 0.403 [0.300, 0.514] | 42/77 = 0.545 [0.435, 0.652] |
| hit6 | 51/77 = 0.662 [0.551, 0.758] | 66/77 = 0.857 [0.762, 0.918] |
| mrr10 | /77 = 0.487 [0.389, 0.585] | /77 = 0.668 [0.582, 0.756] |
| answer_correct | not measured | not measured |
| citation_correct | not measured | not measured |
| refusal | not measured | not measured |
| s1_4572 | not measured | not measured |
| fabrication_free | not measured | not measured |
| safety_warning | not measured | not measured |
| unsupported_claims | not measured | not measured |
| latency_p50 | 35.51566599999933 | 48.42037500000151 |
| latency_p95 | 257.0271250000005 | 314.79491699999926 |

| Paired (OFF vs ON) | n | b (OFF only) | c (ON only) | delta pp | exact McNemar p |
|---|---|---|---|---|---|
| recall5 | 77 | 2 | 20 | +23.4 | 0.000 |
| hit1 | 77 | 8 | 19 | +14.3 | 0.052 |
| hit6 | 77 | 3 | 18 | +19.5 | 0.001 |
| answer_correct | not measured | | | | |
| citation_correct | not measured | | | | |
| refusal | not measured | | | | |
