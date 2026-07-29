# Drive-Pack Grading Report — powerflex_525

Generated: 2026-07-07

## Trust status: **BETA**

- schema + domain + cite-integrity all pass
- diagnostic-critical precision 100%, fault recall 100%
- overall fault recall 100% >= 90%
- no undeclared residuals
- automated ceiling is 'beta' — promotion to 'trusted' requires a recorded human sign-off (runbook-pr-b-acceptance.md), never automatic

## Pack
- pack_id: `powerflex_525`
- manufacturer / series: Rockwell Automation / PowerFlex 525
- schema_version: 2
- fault count: 48
- parameter count: 45
- bench-verified live_decode: False

## Source manual
- path: pf525_520-um001.pdf
- sha256: b9445a63c78865037d22238ddedbb785b4309c9798da9da35029d628658636a6
- extractor commit: 974e79df
- extraction command: `grading/grade.py --pack powerflex_525 --gold gold/powerflex_525/gold.json --manual pf525_520-um001.pdf --generated-at 2026-07-07 --out candidates/powerflex_525`

## Layers
### schema — PASS
schema OK (schema_version=2) — 48 fault codes, 45 parameters

metrics: fault_count=48, param_count=45, schema_version=2

### cite_integrity — PASS
cite-integrity: 93 verified, 0 unverifiable

metrics: verified_count=93, unverifiable_count=0, dropped_diagnostic_critical=[]

### gold_score — PASS
gold score: overall recall=100% precision=100%; diagnostic-critical recall=100% precision=100%; fault recall=100% (diagnostic-critical fault recall=100%)

- edge_case comma_group_skip:P046,P048,P050: PASS — correctly skipped
- edge_case multi_id_shared_desc:C129,C130,C131,C132: PASS — each id present with a distinct, non-empty name
- edge_case related_parameters_not_faults:t094: PASS — no related_parameters entries leaked into related_faults

metrics: total_gold=74, matched_gold=74, overall_recall=1.0, overall_precision=1.0, diagnostic_critical_recall=1.0, diagnostic_critical_precision=1.0, overall_fault_recall=1.0, diagnostic_critical_fault_recall=1.0, fabrication_detected=False, edge_case_results={'comma_group_skip:P046,P048,P050': 'pass', 'multi_id_shared_desc:C129,C130,C131,C132': 'pass', 'related_parameters_not_faults:t094': 'pass'}

### domain_rules — PASS
domain rules: clean

metrics: (none)

## Residuals (declared)
(none declared)
