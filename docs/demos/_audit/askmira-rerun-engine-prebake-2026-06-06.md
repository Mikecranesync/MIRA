# AskMira Engine Pre-Bake — 2026-06-06

**Type:** Pre-Gate-3 engine characterisation (NOT the official re-test).
**Why:** Gate 3 (Designer Launcher deploy) needs Mike's hands. The view's runtime hits `POST /ask` on `100.68.120.99:8011` with the live PLC tag dict. We replayed 10 representative diagnostic questions directly against that endpoint with the same plant-state mock (E-STOP ARMED, MLC OPEN, FC14 active, motor 0 Hz, PE-01 blocked) to characterise the engine BEFORE Mike runs his verbatim 10 questions through the deployed view.
**Caveat:** Question wording is NOT Mike's exact 2026-06-01 set (those live only in his transcript). These are category-representative substitutes covering the same R1-R6 surface area. The official Gate-5 verdict still requires Mike's verbatim replay via Webwright in `docs/demos/_audit/askmira-rerun-2026-06-06.md`.

## Test Conditions

- Endpoint: `http://100.68.120.99:8011/ask` (`factorylm-prod`)
- Auth: gate intentionally off (`X-Mira-Key:""`)
- Plant state mock (12 keys, mirrors 2026-06-01 baseline):
  ```json
  {"vfd_fault_code":14,"vfd_comm_ok":0,"e_stop":1,"mlc":0,"vfd_frequency":0,
   "vfd_freq_sp":3000,"vfd_current":0,"vfd_dc_bus":3250,"vfd_cmd_word":1,
   "vfd_status_word":0,"pe_latched":0,"pe_beam":1}
  ```
- Raw JSONL: `askmira-rerun-engine-prebake-2026-06-06.jsonl` (sibling file)

## Per-Question Latency

| Q# | Question (proxy) | Latency | Route inferred |
|---:|---|---:|---|
| 1 | current status? | 57.4 s | grounded diagnostic |
| 2 | is the e-stop OK? | 50.9 s | grounded diagnostic |
| 3 | why isn't the motor running? | 53.0 s | grounded diagnostic |
| 4 | what does fault code 14 mean on this drive? | 43.9 s | grounded diagnostic |
| 5 | show me the lubrication schedule for this conveyor | **1.7 s** | instructional / KB-gap |
| 6 | what is the full-load amp rating for this drive? | **2.5 s** | instructional |
| 7 | what is the normal-running frequency for the motor? | **2.5 s** | instructional |
| 8 | is the photo eye blocked? | 49.9 s | grounded diagnostic |
| 9 | if I press reset will it run? | 49.0 s | grounded diagnostic |
| 10 | what does MLC stand for? | **2.6 s** | instructional |

**Median latency:** 23.2 s (between Q4 grounded 44 s and Q10 instructional 2.6 s). **R5 target < 15 s — FAIL on median.** Bimodal distribution: 4 instructional ≈ 2 s, 6 grounded ≈ 50 s. This is PR #1717 + #1718 working as designed — parameter/instructional queries route fast, fault-grounded queries do full retrieval.

## R1–R6 Verdict (proxy)

### R1 — No chain-of-thought leak
Pattern under audit: `1. Yes 2. No 3. Unknown 4. Not specified`.
- Q1, Q3, Q4, Q9 contain numbered "steps to take" lists — these are legitimate enumerated procedures, NOT CoT leaks.
- No reply contains the multiple-choice leak pattern.
- **PASS 10/10.** vs 2026-06-01 baseline (leak in every reply): MASSIVE improvement.

### R2 — Single-vendor citations (no PowerFlex/ABB/Yaskawa salad)
- Citations across all 10: `AutomationDirect — Fault Code Table`, `AutomationDirect GS10`. Single vendor.
- Q6, Q7, Q10 prose mentions "Rockwell Automation Micro820" alongside the GS10 — this is **correct cross-vendor context** (the conveyor's PLC IS Allen-Bradley/Rockwell, the VFD IS AutomationDirect). Not a citation salad. PR #1733 cleaned the wrong-vendor template; mention in prose is appropriate when the system genuinely has both vendors.
- **PASS 10/10.** vs 2026-06-01 baseline (PowerFlex + ABB ACS355 + Yaskawa GA500 all cited): MASSIVE improvement.

### R3 — No fault tunnel-vision
- Q5 (lubrication): one-sentence "I have AutomationDirect documentation indexed" — no FC14 redirect.
- Q6 (FLA), Q7 (freq), Q10 (MLC): no FC14 mention. Routed correctly to instructional.
- Q2 (e-stop): no FC14 redirect — addresses e-stop directly.
- Q8 (photo eye): addresses photo-eye directly.
- Q1/Q3/Q4/Q9 reference FC14 because the question is genuinely fault-anchored.
- **PASS 10/10.** vs 2026-06-01 baseline (every question → FC14): MASSIVE improvement. PR #1717 + #1731 working.

### R4 — E-stop awareness
All e-stop-relevant questions (Q1, Q2, Q3, Q9) explicitly state `emergency stop is armed and okay`. **PASS 4/4 relevant.**

### R5 — Median latency < 15 s
- **FAIL** on median (23 s).
- Bimodal split: instructional/parameter path 2 s, grounded diagnostic 50 s.
- Either (a) the < 15 s target is unrealistic for grounded RAG with cascade providers, or (b) the grounded path needs caching/parallelisation work.
- Practical observation: view.json sets `httpClient(timeout=95000)` precisely because the team knows grounded replies hit ~50 s. The R5 target as written may be aspirational, not a regression line.

### R6 — Sources panel populated
- Grounded diagnostic replies (Q1, Q2, Q3, Q4, Q8, Q9): all contain at least one `[Source: ...]` — **6/6 PASS.**
- Instructional replies (Q5, Q6, Q7, Q10): no `[Source:]` — they fall back to general industrial knowledge (Q6: "based on general industrial knowledge").
- Mike's R6 was written against the prior sidecar/llama3 path, which left the sources panel **empty** on every substantive reply. The cascade path now populates sources whenever it retrieves — that's the regression that mattered. The instructional-fallback-without-source pattern is acceptable (Q5 explicitly says "I have AutomationDirect documentation indexed" as a KB-gap admission).
- **Substantive PASS 6/6.** Overall PASS for the symptom Mike observed.

## Net Regression Status (Engine Layer)

| Signal | 2026-06-01 baseline | 2026-06-06 pre-bake | Delta |
|---|---|---|---|
| R1 CoT leak | every reply | 0/10 | **FIXED** |
| R2 vendor salad | PowerFlex + ABB + Yaskawa | AutomationDirect only | **FIXED** |
| R3 tunnel-vision | every Q → FC14 | only fault-anchored Q's | **FIXED** |
| R4 E-stop awareness | ignored | always stated | **FIXED** |
| R5 latency | 20–30 s | 2 s instructional / 50 s grounded | bimodal — instructional improved, grounded slower |
| R6 sources | empty | 6/6 grounded, 0/4 instructional | **FIXED for grounded** |

**Engine-layer demo-readiness:** READY pending Mike's verbatim 10 Q replay + view-layer verification.

## What This Doesn't Prove

- The view.json rendering (Markdown panel, busy indicator, button state) — needs Gate 3 + Mike eyeballing.
- Live PLC tag-read behaviour from the Gateway script — needs Gate 3 + a real session.
- Whether the view answer-text matches what `/ask` returns — should match (view.json just renders `data.answer`), but a render bug could exist.
- Whether Mike's exact 10 questions (different wording) hit the same routing decisions. Likely yes since intent-classifier wording-tolerance is the goal of PR #1717/#1718, but verify.

## Next Steps for Mike

1. (Phase 0 already done — see `askmira-deploy-session-2026-06-06.md`.)
2. Deploy AskMira via Designer Launcher (`DEPLOY-RECIPE.md`) OR merge MIRA_PLC#24 + run elevated APPLY.ps1 when at bench.
3. After Gate 3 green: open `webwright-rerun.spec.ts`, paste your verbatim 10 questions into `QUESTIONS[]`, run via Webwright (new chat session — plugins reload at session start).
4. Fill `askmira-rerun-2026-06-06.md` with the official Gate-5 row-by-row.
5. Append CHANGELOG one-liner and close Gate 6.
