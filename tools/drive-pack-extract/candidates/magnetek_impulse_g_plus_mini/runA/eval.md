# Drive Commander eval — IMPULSE G+ Mini — EMPTY — 0 entries extracted (generalization gap)

```
Drive Commander self-eval scout — 2026-07-14T02-02-06Z

Drive family : Magnetek IMPULSE G+ Mini  (pack_id: magnetek_impulse_g_plus_mini)
Source        : https://www.magnetekdrives.com/wp-content/uploads/sites/7/drives-g-mini-manual.pdf
Manual        : 2915657 bytes  sha256=56075883958090ed…
Fetch         : 0.8s
Extracted     : 0 fault codes, 0 parameters  (7.6s)
Status        : GRADED

Grade: B (85.7/100) — INCOMPLETE
Promotion: NOT PROMOTABLE (INCOMPLETE) — missing evidence prevents a full scientific grade; un-graded categories: ['fault_coverage_precision', 'fault_field_accuracy', 'parameter_coverage_precision', 'parameter_field_accuracy', 'relationship_accuracy']. Provide the missing evidence, then re-grade.

Interpretation: the extractor recovered NOTHING from this manual's layout. The numeric grade only reflects schema+domain checks on an empty pack — it is NOT a quality signal. The finding is a real generalization gap: the position-aware fault/parameter parser is tuned to the PowerFlex 520-series table shapes and does not yet recognise this family's tables. Next step: capture this manual's fault/parameter page ranges + header shape and extend the parser (or add a gold set) — same play as GS10.

Note: gold-independent grade (unseen family — schema + cite-integrity + domain layers only). Staged candidate; nothing promoted to the runtime resolver.
```
