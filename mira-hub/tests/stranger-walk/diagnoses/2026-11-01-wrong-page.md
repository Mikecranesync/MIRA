# Stranger Walk WRONG_PAGE diagnosis — 2026-11-01 (CHARLIE, $0, offline)

> **Outcome:** the owner chose to accept evidence-backed further pages, including on safety-relevant
> questions. Shipped as answer key v2 in #5096 (merged `046572926`, issue #5095). The real retrieval
> misses below remain open under #4513. Results summary: #5096 comment 6564670561.

**Inputs:** 5 historical walk runs. These are the 10-18 runs sw-full and sw-full2, and the 10-21-lexical runs off, run1 and run2. Across them there were 41 WRONG_PAGE occurrences, which reduce to 29 distinct (question, cited page) cases (machine-readable cases kept on CHARLIE in `.planning/2026-11-01-wrong-page-diagnosis/wrong-page-cases.json`). I read each cited page's text from the frozen PDFs with `pdftotext` and judged it against the question. There were no LLM calls and no staging DB access.
**Not covered:** BRAVO's 11-01 after-fix walk (13/49 WRONG_PAGE). Its per-question rows are not available yet, so re-run this on that set when they arrive.

## Result (by occurrence, n=41)

| Judgment | Occurrences | Share | What it means |
|---|---|---|---|
| VALID — the cited page answers the question | 18 | 44% | The answer key accepts only one page, but the manual repeats the fact on another page. This is a grading error, not a product error. |
| PARTIAL — the cited page is on topic but incomplete | 7 | 17% | Stays a miss. Do not accept it. |
| MISS — the cited page does not answer the question | 16 | 39% | A real retrieval failure. |

**Gate check (score.ts):** for an answer that otherwise passes, the page is the only gate between WRONG_PAGE and CORRECT (`METRIC`: "The answer's wording is not graded"). An accepted page therefore does become CORRECT.

**Strict vs lenient split of the 18 VALID occurrences:**
- **Strict, recommended: 14 (34%).** Non-safety questions only.
- **Debatable, safety-relevant: 4.**
  - micro820-um-q4 p27, ×3. This is a general explosion-hazard warning, not USB-specific, and is a judgment call.
  - pf40-q2 p12, ×1. Same capacitor-discharge sentence.
- **Decision (owner, 2026-11-01):** accept both, safety rows included. Their notice is still graded separately as a red line.

Extraction is not the cause: every cited page has text, and every anchor is present on its expected page.

## Clusters

1. **Repeated-fact undercount (VALID).** The answer key has one `expectedPage`, with a tolerance of ±1 (`score.ts` lines 97, 146 and 218). Large AB manuals state the same fact in a summary table, in a description section and in a troubleshooting table. Examples: SMC-50 SCR Overtemp appears on p127, p213 and the expected page. E3 Plus Phase Loss appears in the p89 trip table. ML1100 FAULT LED appears on p133 and p135. No existing issue covers this.
2. **Large-manual lexical ranking (MISS).** The misses concentrate in E3 Plus and SMC-50, which are the 250+ page manuals. The search lands on a chapter intro, a parameter index, an object-attribute table, a preface, or a neighbouring fault code (gs10 b4GF vs GFF). This matches open **#4513** (OR-fallback `ts_rank_cd` buries the answer page) and **#3334** (a catalog outranking the fault table).
3. **Partial pages.** The search finds the right topic but the wrong section, for example a definition page without its corrective steps. This is the same ranking cause as cluster 2, in a milder form.

## Case table
| q | expected | cited | runs | judgment | evidence on cited page |
|---|---|---|---|---|---|
| e3plus-q1 | 214 | 54 | 1 | **VALID** | states a ground-fault trip flashes a red 4-blink pattern |
| e3plus-q2 | 113 | 45 | 1 | **MISS** | chapter intro, no Trip Class |
| e3plus-q2 | 113 | 47 | 1 | **MISS** | CT ratio table |
| e3plus-q2 | 113 | 89 | 1 | **PARTIAL** | trip summary table gives range 5…30 and default 10, not what it sets |
| e3plus-q3 | 115 | 89 | 3 | **VALID** | trip summary table: Phase Loss default trip delay 1.0 s |
| e3plus-q4 | 217 | 107 | 2 | **MISS** | parameter index only |
| e3plus-q4 | 217 | 249 | 1 | **MISS** | DeviceNet object attributes |
| gs10-ch6-q3 | 19 | 36 | 3 | **MISS** | b4GF, a different (pre-run) ground fault, not GFF |
| micro820-um-q3 | 118 | 13 | 1 | **MISS** | I/O table |
| micro820-um-q3 | 118 | 123 | 1 | **VALID** | "Restore project from backup" at power-up from the microSD card |
| micro820-um-q4 | 35 | 27 | 3 | **VALID** | explosion hazard: do not connect equipment unless power is off (general, not USB-specific; judgment call) |
| ml1100-q1 | 135 | 133 | 2 | **VALID** | status table: flashing red FAULT = application fault, consistent with p.135 |
| ml1100-q3 | 141 | 143 | 2 | **VALID** | "Use ControlFLASH to Upgrade Your Operating System" procedure |
| ml1100-q4 | 131 | 22 | 1 | **MISS** | battery install, no disposal |
| pf40-q2 | 9 | 12 | 1 | **VALID** | "wait three minutes for capacitors to discharge" |
| pf4m-q3 | 76 | 33 | 1 | **MISS** | start-up chapter intro |
| smc50-q1 | 211 | 125 | 1 | **MISS** | power factor faults |
| smc50-q1 | 211 | 126 | 1 | **PARTIAL** | explains the fault and parameter 128, no corrective steps |
| smc50-q1 | 211 | 205 | 1 | **PARTIAL** | fault code overview table |
| smc50-q2 | 210 | 127 | 2 | **VALID** | "SCR Overtemperature Fault (Code 10)" description |
| smc50-q2 | 210 | 213 | 1 | **VALID** | troubleshooting table: SCR Overtemp 60 or 10, causes and solutions |
| smc50-q4 | 212 | 122 | 2 | **VALID** | "Motor Over Power Reactive Positive Fault (Code 46)" description |
| smc50-q5 | 215 | 7 | 1 | **MISS** | preface |
| smc50-q5 | 215 | 211 | 1 | **MISS** | other fault codes |
| smc50-q5 | 215 | 251 | 1 | **MISS** | option modules |
| smcflex-q1 | 104 | 101 | 2 | **PARTIAL** | defines Shorted SCR, no causes/fixes |
| smcflex-q2 | 106 | 10 | 1 | **PARTIAL** | explains initial torque and ramp time are adjustable |
| smcflex-q2 | 106 | 85 | 1 | **PARTIAL** | Ramp Time parameter |
| smcflex-q4 | 17 | 32 | 1 | **MISS** | overload protection text, no class list |
## Fix options

| # | Fix | Risk class | Needs a paid walk? | Status / effect |
|---|---|---|---|---|
| 1 | Answer-key correction: add an `acceptedPages` list per question in `corpus.json`, backed by quoted page evidence, and have `classify`/`predict` accept any page in that list | R2 (eval fixture/grader, a truth-set change) | **No.** Re-score existing runs offline for $0 | **Done, #5096.** 10 pages on 9 questions; the committed 10-31 partial run re-scores 20/24 → 21/24 |
| 2 | Large-manual ranking: work under #4513, e.g. favour fault and troubleshooting tables, and apply an AND before the OR fallback | R3 (retrieval, product behaviour) | **Yes.** Prove offline on bench-4791 first, then use the last $4.50 walk under the cap | **Open, #4513.** Targets the 39% of real misses and the 17% partials |

Rules applied in option 1: accept only pages whose text contains the asked fact. Never accept PARTIAL pages. Safety-relevant pages were accepted only where the page carries the full warning sentence. Option 1 changes the measuring stick, so it must not be reported as a product improvement.

## Caveats

- The five runs predate the current build, so the VALID/MISS mix on the current build may differ. BRAVO's 11-01 after-fix walk (13/49 WRONG_PAGE) will be re-scored under v2 when its per-question rows are available.
- `stranger-walk.yml` has been `disabled_manually` since 2026-10-31, so the walk unit tests for #5096 ran locally (184/184, 7 mutations red) and not in PR CI.
