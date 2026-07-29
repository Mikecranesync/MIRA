# Drive-Pack Grading Report — powerflex_525

Generated: unknown

## Trust status: **BETA**

- schema + domain + cite-integrity all pass
- diagnostic-critical precision 100%, fault recall 100%
- overall fault recall 96% >= 90%
- residuals declared: ['fault->param link recall gap: extractor did not link F100/F109 -> P053 (non-diagnostic-critical)', 'page 98 analog-output block (t088-t090) deferred: multi-column layout parses with bleed/duplicate; not diagnostic-critical, none in gold', 'PROMOTED TO LIVE 2026-07-06 by human approval (Mike): manual-cited-only scope waiver — no bench live_decode; trust status remains beta (deployed as a manual-cited pack, read-only)']
- automated ceiling is 'beta' — promotion to 'trusted' requires a recorded human sign-off (runbook-pr-b-acceptance.md), never automatic

## Pack
- pack_id: `powerflex_525`
- manufacturer / series: Rockwell Automation / PowerFlex 525
- schema_version: 2
- fault count: 48
- parameter count: 45
- bench-verified live_decode: False

## Source manual
- path: <local path> sha256: b9445a63c78865037d22238ddedbb785b4309c9798da9da35029d628658636a6
- extractor commit: fe2ae714
- extraction command: `grade.py --pack powerflex_525 --gold ../gold/powerflex_525/gold.json --manual <local manual pdf> --packs-dir <local path> --out grading_out --residual fault->param link recall gap: extractor did not link F100/F109 -> P053 (non-diagnostic-critical) --residual page 98 analog-output block (t088-t090) deferred: multi-column layout parses with bleed/duplicate; not diagnostic-critical, none in gold --residual PROMOTED TO LIVE 2026-07-06 by human approval (Mike): manual-cited-only scope waiver — no bench live_decode; trust status remains beta (deployed as a manual-cited pack, read-only)`

## Layers
### schema — PASS
schema OK (schema_version=2) — 48 fault codes, 45 parameters

metrics: fault_count=48, param_count=45, schema_version=2

### cite_integrity — PASS
cite-integrity: 93 verified, 0 unverifiable

metrics: verified_count=93, unverifiable_count=0, dropped_diagnostic_critical=[]

### gold_score — PASS
gold score: overall recall=97% precision=100%; diagnostic-critical recall=100% precision=100%; fault recall=96% (diagnostic-critical fault recall=100%)

- fault F100 -> param P053 link MISSING (param 'P053'.related_faults should contain 'F100')
- fault F109 -> param P053 link MISSING (param 'P053'.related_faults should contain 'F109')
- edge_case comma_group_skip:P046,P048,P050: PASS — correctly skipped
- edge_case multi_id_shared_desc:C129,C130,C131,C132: PASS — each id present with a distinct, non-empty name
- edge_case related_parameters_not_faults:t094: PASS — no related_parameters entries leaked into related_faults

metrics: total_gold=73, matched_gold=71, overall_recall=0.9726027397260274, overall_precision=1.0, diagnostic_critical_recall=1.0, diagnostic_critical_precision=1.0, overall_fault_recall=0.9629629629629629, diagnostic_critical_fault_recall=1.0, fabrication_detected=False, edge_case_results={'comma_group_skip:P046,P048,P050': 'pass', 'multi_id_shared_desc:C129,C130,C131,C132': 'pass', 'related_parameters_not_faults:t094': 'pass'}

### domain_rules — PASS
domain rules: clean

metrics: (none)

## Residuals (declared)
- fault->param link recall gap: extractor did not link F100/F109 -> P053 (non-diagnostic-critical)
- page 98 analog-output block (t088-t090) deferred: multi-column layout parses with bleed/duplicate; not diagnostic-critical, none in gold
- PROMOTED TO LIVE 2026-07-06 by human approval (Mike): manual-cited-only scope waiver — no bench live_decode; trust status remains beta (deployed as a manual-cited pack, read-only)
