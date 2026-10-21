# Benchmark acceptance scorecard: **NO-GO**

- Failed gates: P1, Q1, Q2
- Not measured: Q3, Q4, Q5, S1, S2, S3, S4, S5
- Approved exceptions: none
- Input sha256: `68a64474170dfacf4f5a419b4e4a1e00d75632b33bcf9df482c594ea4735718f`

| Gate | Status | Detail |
|---|---|---|
| V1_integrity | PASS | complete pairs |
| V1_sample | FAIL | n=77 kinds={'answerable': 77} (need 100/20/20) |
| Q1 | FAIL | Recall@5 0.857 vs >= 0.9 |
| Q2 | FAIL | MRR@10 0.664 vs >= 0.85 |
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
| P1 | NEEDS_APPROVAL | p95 187 -> 685 ms (+266.2%) |

| Metric | OFF | ON |
|---|---|---|
| recall5 | 48/77 = 0.623 [0.512, 0.723] | 66/77 = 0.857 [0.762, 0.918] |
| hit1 | 31/77 = 0.403 [0.300, 0.514] | 41/77 = 0.532 [0.422, 0.640] |
| hit6 | 52/77 = 0.675 [0.565, 0.769] | 69/77 = 0.896 [0.808, 0.946] |
| mrr10 | /77 = 0.492 [0.395, 0.589] | /77 = 0.664 [0.581, 0.749] |
| answer_correct | not measured | not measured |
| citation_correct | not measured | not measured |
| refusal | not measured | not measured |
| s1_4572 | not measured | not measured |
| fabrication_free | not measured | not measured |
| safety_warning | not measured | not measured |
| unsupported_claims | not measured | not measured |
| latency_p50 | 21.50433300000077 | 71.47245800000019 |
| latency_p95 | 186.94279199999983 | 684.5095829999991 |

| Paired (OFF vs ON) | n | b (OFF only) | c (ON only) | delta pp | exact McNemar p |
|---|---|---|---|---|---|
| recall5 | 77 | 4 | 22 | +23.4 | 0.001 |
| hit1 | 77 | 9 | 19 | +13.0 | 0.087 |
| hit6 | 77 | 3 | 20 | +22.1 | 0.000 |
| answer_correct | not measured | | | | |
| citation_correct | not measured | | | | |
| refusal | not measured | | | | |
