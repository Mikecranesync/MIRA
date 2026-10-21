| run | variant | onnx sha256 | app sha256 | ort | machine | load ms | cold first ms | pool | n | p50 ms | p95 ms | max ms | failures |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | fp32 | 5d3e70fd0c9f | fcafe4619061 | 1.23.2 | aarch64 | 316 | 1097 | 24 | 42 | 1122 | 1549 | 2798 | 0 |
| 1 | fp32 | 5d3e70fd0c9f | fcafe4619061 | 1.23.2 | aarch64 | 316 | 1097 | 50 | 39 | 2262 | 3723 | 4146 | 0 |
| 2 | int8-avx2 | c80a8b34256e | fcafe4619061 | 1.23.2 | aarch64 | 250 | 459 | 24 | 42 | 547 | 786 | 1142 | 0 |
| 2 | int8-avx2 | c80a8b34256e | fcafe4619061 | 1.23.2 | aarch64 | 250 | 459 | 50 | 39 | 1084 | 1736 | 1771 | 0 |
| 3 | int8-avx2 | c80a8b34256e | fcafe4619061 | 1.23.2 | aarch64 | 258 | 497 | 24 | 42 | 552 | 734 | 1172 | 0 |
| 3 | int8-avx2 | c80a8b34256e | fcafe4619061 | 1.23.2 | aarch64 | 258 | 497 | 50 | 39 | 1104 | 1734 | 1833 | 0 |
| 4 | fp32 | 5d3e70fd0c9f | fcafe4619061 | 1.23.2 | aarch64 | 295 | 1097 | 24 | 42 | 1115 | 1455 | 2374 | 0 |
| 4 | fp32 | 5d3e70fd0c9f | fcafe4619061 | 1.23.2 | aarch64 | 295 | 1097 | 50 | 39 | 2300 | 3418 | 3454 | 0 |

pool 24: top-6 identical order 14/42; mean top-6 set overlap 0.952 (min 0.667); mean Spearman 0.9903 (min 0.9122); max |score diff| 0.941

pool 50: top-6 identical order 14/39; mean top-6 set overlap 0.966 (min 0.833); mean Spearman 0.9950 (min 0.9892); max |score diff| 1.076
fp32: run-to-run max |score diff| 0.00e+00
int8-avx2: run-to-run max |score diff| 0.00e+00
