
== By adapter ==
| adapter | correct | citation | errors | avg_lat_s | cost_usd |
|---|---|---|---|---|---|
| docling | 11/27 | 8/19 | 2 | 0.00 | 0.0000 |
| docling-scanned | 2/27 | 0/0 | 25 | 0.00 | 0.0000 |
| docling-tables | 10/27 | 10/19 | 2 | 0.00 | 0.0000 |
| factorylm-baseline | 8/27 | 5/19 | 2 | 0.01 | 0.0000 |
| gemini-native | 28/28 | 18/20 | 0 | 27.86 | 1.1713 |
| pymupdf | 12/27 | 10/19 | 0 | 0.00 | 0.0000 |
| pymupdf-tables | 12/27 | 9/19 | 0 | 0.00 | 0.0000 |
| textqa-docling | 18/28 | 9/20 | 0 | 1.26 | 0.0000 |

== By class x adapter (correct/total) ==
| class | docling | docling-scanne | docling-tables | factorylm-base | gemini-native | pymupdf | pymupdf-tables | textqa-docling |
|---|---|---|---|---|---|---|---|---|
| 10_sibling_leakage | 0/1 | 0/1 | 0/1 | 1/1 | 1/1 | 0/1 | 0/1 | 1/1 |
| 11_model_ambiguity | 0/2 | 0/2 | 1/2 | 1/2 | 2/2 | 1/2 | 1/2 | 1/2 |
| 12_revision | 1/1 | 0/1 | 1/1 | 1/1 | 1/1 | 1/1 | 1/1 | 1/1 |
| 13_multi_context | 1/2 | 0/2 | 1/2 | 0/2 | 2/2 | 1/2 | 1/2 | 0/2 |
| 14_lexical_ok | 0/1 | 0/1 | 0/1 | 0/1 | 1/1 | 0/1 | 0/1 | 1/1 |
| 15_structural_table | 1/1 | 0/1 | 0/1 | 0/1 | 1/1 | 0/1 | 0/1 | 1/1 |
| 1_exact_spec | 2/3 | 0/3 | 1/3 | 0/3 | 4/4 | 2/3 | 2/3 | 2/4 |
| 2_table_lookup | 1/4 | 0/4 | 0/4 | 2/4 | 4/4 | 1/4 | 1/4 | 0/4 |
| 3_units | 1/2 | 0/2 | 1/2 | 0/2 | 2/2 | 1/2 | 1/2 | 2/2 |
| 4_synonyms | 1/2 | 0/2 | 1/2 | 1/2 | 2/2 | 1/2 | 1/2 | 1/2 |
| 5_procedure | 1/2 | 0/2 | 2/2 | 2/2 | 2/2 | 2/2 | 2/2 | 2/2 |
| 6_warnings | 1/1 | 0/1 | 1/1 | 0/1 | 1/1 | 1/1 | 1/1 | 1/1 |
| 7_figure | 1/1 | 0/1 | 1/1 | 0/1 | 1/1 | 1/1 | 1/1 | 1/1 |
| 8_scanned | 0/2 | 2/2 | 0/2 | 0/2 | 2/2 | 0/2 | 0/2 | 2/2 |
| 9_absent | 0/2 | 0/2 | 0/2 | 0/2 | 2/2 | 0/2 | 0/2 | 2/2 |

== Repeatability (rep1 == rep2) ==
  gemini-native pf525-fault-f004: identical=True
  textqa-docling pf525-fault-f004: identical=False
