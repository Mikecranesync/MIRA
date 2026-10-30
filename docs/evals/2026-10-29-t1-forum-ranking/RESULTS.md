# Results — T-1 forum ranking fix (2026-10-29)

**Verdict on the pre-registered bar (fresh set, Wilson 95% lower bound ≥ 70%): FAIL.**
Fresh set candidate 11/29 (LB 22.7%); baseline 11/29 (LB 22.7%).
The pilot stays NO-GO on T-1.

- Baseline `d9cc1135860c6e36daa03eb7a3fb7bcf3b8cf03b` (main at handoff). Candidate `5f2f91e5edd27edd639a20aee4639dd491005b40` (branch `fix/t1-forum-ranking`).
- Harness: pinned IMIB `retrieval_rank.ts`, production flags (lexical-v2 / hybrid / rerank off), local `pgvector/pgvector:pg16`, zero tokens.
- Repeats: k10 ×3 and k6 ×3 per arm per set — rows identical across repeats: forum-new base True, cand True; forum-fresh base True, cand True.
- Pre-registration: `PREREGISTRATION.md` (written before the fresh set was collected; the fresh set was run once, after the code froze, and never tuned against).

## Headline

| Set | Measure | Baseline | Candidate | Gained / lost |
|---|---|---|---|---|
| forum-new 19 (dev set, the original T-1 set) | top-5 | 8/19 (LB 23.1%) | 11/19 (LB 36.3%) | see per-case |
| forum-new 19 | top-1 | 2 | 6 | |
| **forum-fresh 29 (held out)** | **top-5** | **11/29 (LB 22.7%)** | **11/29 (LB 22.7%)** | see per-case |
| forum-fresh 29 | top-1 | 3 | 6 | |
| t4-77 real questions | top-5 | 46/77 | 69/77 | +23 / −0 |
| t4-77 | top-6 / top-1 | 52 / 32 | 69 / 46 | +17 / −0 / +14 / −0 |
| oem-fault 174 | top-5 | 99 | 137 | +38 / −0 |
| oem-index clean 116 | top-5 | 59 | 87 | +30 / −2 |
| robust 1,264 | top-5 | 692 | 979 | +292 / −5 |

Lost ids: t4-77 top-5 []; oem-fault top-5 []; oem-index top-5 ['oi-ml1100-93c7bf1f', 'oi-se-premium-serial-8205c556']; robust top-5 ['of-acs355-d5153a8e~code', 'of-micro820-um-0878878d~code', 'micro820-in-q2~chatter', 'tq-04~alias', 'tq-06~alias'].

## Reading

The fix is a large, regression-free improvement on well-formed technician questions (t4-77, oem-fault, robust) and on
index-style questions, and a net gain on the original 19 forum posts. On the **held-out** forum posts it is neutral:
11 right before and after (2 gained, 2 lost). Lexical ranking — even rarity-aware — does not move
real forum wording to the 70% bar; the remaining misses are vocabulary/semantic (the post and the page share few
words). The next layer is the hybrid vector lane that already exists behind `NOTEBOOK_HYBRID_RETRIEVAL` (off in
production; needs an embedder in the production path).

## forum-fresh per case (k10 run 1)

| id | accepted | baseline top-5 | candidate top-5 | base | cand |
|---|---|---|---|---|---|
| fr-pf40-00 | [93] | [33, 27, 49, 58, 97] | [33, 49, 27, 58, 97] | ❌ | ❌ |
| fr-pf40-01 | [47] | [109, 123, 76, 131, 125] | [109, 156, 123, 41, 2] | ❌ | ❌ |
| fr-pf4m-04 | [100] | [6, 99, 100, 100, 101] | [101, 99, 6, 101, 104] | ✅ | ❌ |
| fr-acs355-06 | [359] | [363, 359, 363, 354, 425] | [359, 360, 363, 363, 64] | ✅ | ✅ |
| fr-acs355-07 | [363] | [363, 255, 354, 363, 362] | [363, 255, 363, 359, 360] | ✅ | ✅ |
| fr-acs355-08 | [103] | [102, 84, 102, 198, 374] | [102, 102, 84, 103, 198] | ❌ | ✅ |
| fr-acs355-09 | [356] | [286, 356, 185, 328, 374] | [286, 356, 185, 363, 99] | ✅ | ✅ |
| fr-micro820-um-12 | [131] | [131, 130, 129, 132, 137] | [137, 129, 131, 130, 128] | ✅ | ✅ |
| fr-micro820-in-14 | [12] | [10, 5, 5, 5, 20] | [13, 10, 5, 5, 15] | ❌ | ❌ |
| fr-ml1100-17 | [161] | [145, 152, 52, 14, 145] | [160, 160, 159, 152, 159] | ❌ | ❌ |
| fr-ml1100-18 | [144] | [145, 152, 154, 14, 148] | [159, 145, 156, 152, 154] | ❌ | ❌ |
| fr-smcflex-20 | [83] | [22, 18, 83, 84, 84] | [18, 15, 83, 22, 84] | ✅ | ✅ |
| fr-smcflex-21 | [101] | [95, 5, 100, 7, 94] | [95, 94, 5, 7, 100] | ❌ | ❌ |
| fr-e3plus-22 | [218] | [53, 55, 52, 257, 4] | [269, 223, 223, 219, 45] | ❌ | ❌ |
| fr-e3plus-23 | [248] | [208, 27, 223, 237, 209] | [201, 237, 193, 195, 201] | ❌ | ❌ |
| fr-smc50-24 | [196] | [24, 194, 10, 10, 5] | [10, 10, 217, 261, 191] | ❌ | ❌ |
| fr-smc50-25 | [72] | [210, 224, 67, 99, 219] | [214, 210, 215, 210, 211] | ❌ | ❌ |
| fr-micro810-26 | [66] | [78, 101, 47, 103, 79] | [103, 80, 95, 67, 101] | ❌ | ❌ |
| fr-micro810-28 | [29] | [57, 9, 16, 124, 17] | [31, 9, 57, 16, 124] | ❌ | ❌ |
| fr-micro810-29 | [59] | [34, 74, 13, 43, 13] | [43, 34, 30, 74, 13] | ❌ | ❌ |
| fr-gs4-ch2-30 | [19] | [34, 27, 19, 7, 22] | [19, 22, 34, 19, 27] | ✅ | ✅ |
| fr-gs4-ch2-31 | [16] | [2, 7, 22, 6, 14] | [15, 2, 2, 22, 7] | ❌ | ❌ |
| fr-gs4-ch6-33 | [22] | [8, 8, 14, 22, 9] | [22, 8, 8, 14, 15] | ✅ | ✅ |
| fr-gs4-ch6-34 | [19] | [16, 20, 20, 18, 22] | [2, 20, 19, 20, 26] | ❌ | ✅ |
| fr-se-canopen-hw-35 | [34] | [61, 53, 7, 16, 34] | [32, 61, 12, 33, 38] | ✅ | ❌ |
| fr-se-lxm32a-canopen-37 | [26] | [111, 87, 46, 49, 34] | [21, 74, 111, 97, 106] | ❌ | ❌ |
| fr-se-m171-38 | [93] | [28, 76, 82, 130, 74] | [28, 130, 76, 82, 74] | ❌ | ❌ |
| fr-se-m172-40 | [89] | [89, 68, 157, 58, 69] | [89, 68, 26, 72, 80] | ✅ | ✅ |
| fr-se-premium-serial-44 | [54] | [50, 52, 55, 54, 197] | [54, 197, 50, 52, 41] | ✅ | ✅ |

## forum-new per case (k10 run 1)

| id | accepted | baseline top-5 | candidate top-5 | base | cand |
|---|---|---|---|---|---|
| fn-pf40-1 | [94] | [94, 109, 123, 144, 144] | [94, 109, 123, 152, 156] | ✅ | ✅ |
| fn-pf40-2 | [43, 92] | [94, 91, 92, 43, 92] | [94, 128, 110, 156, 93] | ✅ | ❌ |
| fn-pf40-3 | [94, 76] | [46, 55, 76, 89, 94] | [76, 94, 125, 89, 46] | ✅ | ✅ |
| fn-pf40-4 | [94] | [123, 76, 131, 125, 109] | [76, 94, 151, 151, 131] | ❌ | ✅ |
| fn-pf40-5 | [33, 27] | [40, 41, 134, 84, 60] | [17, 96, 40, 41, 73] | ❌ | ❌ |
| fn-pf40-6 | [33] | [30, 26, 96, 34, 26] | [96, 34, 49, 33, 58] | ❌ | ✅ |
| fn-micro820-1 | [150] | [17, 14, 99, 155, 54] | [150, 17, 151, 108, 115] | ❌ | ✅ |
| fn-ml1100-1 | [113] | [13, 147, 58, 11, 113] | [13, 147, 29, 33, 58] | ✅ | ❌ |
| fn-ml1100-2 | [74, 72] | [163, 7, 91, 9, 82] | [163, 7, 81, 102, 143] | ❌ | ❌ |
| fn-ml1100-3 | [14, 154] | [9, 14, 51, 56, 145] | [154, 51, 14, 56, 145] | ✅ | ✅ |
| fn-e3plus-1 | [52, 53] | [55, 37, 137, 53, 55] | [137, 53, 55, 54, 218] | ✅ | ✅ |
| fn-e3plus-2 | [100] | [222, 235, 129, 222, 223] | [108, 100, 206, 260, 222] | ❌ | ✅ |
| fn-e3plus-3 | [217, 218] | [65, 205, 215, 132, 217] | [65, 215, 206, 64, 217] | ✅ | ✅ |
| fn-lxm32a-1 | [70] | [70, 14, 23, 16, 34] | [70, 14, 40, 34, 59] | ✅ | ✅ |
| fn-x80-1 | [256] | [306, 244, 70, 89, 317] | [244, 317, 306, 70, 89] | ❌ | ❌ |
| fn-micro810-1 | [9] | [53, 51, 52, 74, 11] | [96, 53, 51, 74, 30] | ❌ | ❌ |
| fn-ml1100-8 | [160] | [145, 152, 52, 14, 145] | [160, 145, 159, 161, 152] | ❌ | ✅ |
| fn-smcflex-1 | [101] | [104, 105, 104, 105, 106] | [104, 105, 106, 104, 104] | ❌ | ❌ |
| fn-se-m172-2 | [192] | [181, 16, 179, 106, 180] | [181, 16, 106, 132, 180] | ❌ | ❌ |

## Files

- `raw/` — every row file, `rows.sha256`, `inputs.sha256` (harness + question-set hashes).
- `questions/forum-fresh-questions.json` — the 29 admitted fresh questions with URL, forum, verbatim post, expected page(s), evidence quote, blind-label pages; `forum-fresh-dropped.json` — the 19 dropped, with reasons.
- `score.py`, `compare.py` — the scorers used here; `run_proof.sh` — the proof recipe.

Inputs:
```
12ced03b922e1947cb2e0a5dd8f8a412738cda70a5a0bca0242538f262ca5f07  tools/bench4589/retrieval_rank.ts
7933cb8b0ad63814f9c34dccd546f03e62c920c2ad57a188a9b0f85f98102a29  tools/bench4589/forum-new-questions.json
251aa8ea86ce7f71369eb267710dbc48beb17e3782192c089a2f5df249215f3b  tools/bench4589/forum-fresh-questions.json
```
