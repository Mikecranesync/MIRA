# Drive-Pack Grading Report — powerflex_40

Generated: 2026-07-07

## Trust status: **BETA**

- schema + domain + cite-integrity all pass
- diagnostic-critical precision 100%, fault recall 100%
- overall fault recall 100% >= 90%
- no undeclared residuals
- automated ceiling is 'beta' — promotion to 'trusted' requires a recorded human sign-off (runbook-pr-b-acceptance.md), never automatic

## Pack
- pack_id: `powerflex_40`
- manufacturer / series: Rockwell Automation / PowerFlex 40
- schema_version: 2
- fault count: 26
- parameter count: 9
- bench-verified live_decode: False

## Source manual
- path: 22b-um001.pdf
- sha256: 15c10c6420379e8d286ee4c8a210b11683e97e727b39b592e6a9e0dfd023cae9
- extractor commit: 974e79df
- extraction command: `grading/grade.py --pack powerflex_40 --gold gold/powerflex_40/gold.json --manual 22b-um001.pdf --generated-at 2026-07-07 --out candidates/powerflex_40`

## Layers
### schema — PASS
schema OK (schema_version=2) — 26 fault codes, 9 parameters

metrics: fault_count=26, param_count=9, schema_version=2

### cite_integrity — PASS
cite-integrity: 35 verified, 0 unverifiable

metrics: verified_count=35, unverifiable_count=0, dropped_diagnostic_critical=[]

### gold_score — PASS
gold score: overall recall=100% precision=100%; diagnostic-critical recall=100% precision=100%; fault recall=100% (diagnostic-critical fault recall=100%)

- edge_case related_parameters_not_faults:A105,A106,P033,P034: PASS — no related_parameters entries leaked into related_faults

metrics: total_gold=39, matched_gold=39, overall_recall=1.0, overall_precision=1.0, diagnostic_critical_recall=1.0, diagnostic_critical_precision=1.0, overall_fault_recall=1.0, diagnostic_critical_fault_recall=1.0, fabrication_detected=False, edge_case_results={'related_parameters_not_faults:A105,A106,P033,P034': 'pass'}

### domain_rules — PASS
domain rules: clean

metrics: (none)

## Residuals (declared)
(none declared)
