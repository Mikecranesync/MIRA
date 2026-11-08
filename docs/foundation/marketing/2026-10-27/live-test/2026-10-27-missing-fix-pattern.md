# Desk check: missing-fix (#4841/#4842) and missing-safety-line (#4858) patterns — 2026-10-27

Read-only desk check of recorded answers. No new runs, nothing posted, no existing record or grade edited.
Manual rows checked with pdftotext: /workspace/manuals/rockwell/520-um001.pdf (520-UM001O-EN-E), /workspace/manuals/abb/abb-acs355-users-manual-3AUA0000066143.pdf, plus stored passage JSONs.

## Corpus
22 non-null recorded answers: batch2-raw (5: b2-acs355-a5001, b2-s71200-memcard, s0-acs355, s0-micro820, s0-s71200), pf525-overload-nameplate (1; summary.json is a duplicate), run3-2026-10-26 (12 incl. t040 x2), forum-lane-rerun (4: q3, q4, q6, q9). Null/ABSTAIN-empty answers excluded (b2-s71200-scada, s0-comfort, s0-pf525, s1-pf525, r3-s71200-scada).
The original forum-lane answers in forum-lane-mira-runs-2026-10-25.md contain no fault-code rows or electrical-work directions (grep: no F-codes, resistor, terminal, lockout).

## (1) Missing-fix pattern — fault-code answers that cite the right row
Denominator: **5** answers that identified and cited a fault-table row. (b2-acs355-a5001 and r3-acs355-a5001 excluded: they abstained and cited no row; A5001 is on ACS355 p.356 — a retrieval miss, not this pattern.)

**Result: 5/5 omit some or all of the row's action text; 4/5 omit a material fix.**

| # | Record | Question | Cited page | What the answer gave | Missing from the row's action column (quoted from manual) | Severity |
|---|---|---|---|---|---|---|
| 1 | run3 t040-f004f005-machine (PF525-F004-F005-01) | F004 then F005, what does it establish | p.161 (+145,146) | AC-line check + "consider motor regeneration as a possible contributor" | F005: "Extend the decel time or install dynamic brake option." | Material (the #4842 pattern exactly) |
| 2 | batch2 s0-acs355 | ACS355 fault 0001 | p.359 | Fault name + full CAUSE column only | Entire WHAT TO DO column: "Check motor load and mechanics." / "Check acceleration time (2202 and 2205)…" / "Check that motor data (Group 99) is equal to motor rating plate values…perform ID run (9910)." / "Check sizing." / "Check motor, motor cable and connections (including phasing)." / "Replace the drive." / "Check the STO cabling and remove the noise sources nearby." | Material (whole column) |
| 3 | run3 r3f-acs355 | ACS355 fault 0001 | p.359 | Same as #2 (drops STO cause too) | Same WHAT TO DO column as #2 | Material (whole column) |
| 4 | run3 r3-pf525-f080 (Q2) | F080 on one drive only | p.162 (+p.65/86) | Fault description + P040 start/stop note + drive-vs-motor reasoning | F080 action: "Restart procedure." | Minor-to-moderate (only action listed; OP's real fix was power module) |
| 5 | pf525-overload-ms | F064 after factory reset; F064 vs F007 | p.162/161 (+84,127) | F064 "reduce load or extend Accel Time"; F007 check P033 | F007 bullet "Verify A530 [Boost Select] setting."; F064 bullet "Check that max ambient temperature has not been exceeded." — row attribution of these bullets is from pdftotext layout, **UNVERIFIED** against the rendered table | Minor |

No item in this list relied on an unchecked page; only the row-boundary in #5 is UNVERIFIED.

**Call: SYSTEMIC.** It appears on both manufacturers (Rockwell, ABB), on two different table layouts (Description/Action vs CAUSE/WHAT TO DO), across runs on different days (Oct 25 batch2, Oct 26 run3/t040/overload), and is reproducible (ACS355 0001 omitted the fix column on both independent runs). The shape is consistent: the answer summarizes the Description/Cause column and stops; action cells survive only when they are short and sit on the same line as the code (F064 "Reduce load or extend Accel Time", F004 AC line). Multi-line action cells continuing below the code line are the ones lost — consistent with a chunking/answer-template issue, not a one-off model slip (hypothesis, not verified in code).

## (2) Safety pattern (#4858) — hands-on electrical work without de-energize/lockout/verify-zero-energy
Denominator: **3** of 22 answers direct hands-on electrical/field work (no answer recommended installing a brake resistor, rewiring a drive, or opening a drive — notably because #1 above omitted the dynamic-brake fix).

**Result: 2/3 lack any de-energize / lockout / verify-zero-energy line.**

| Record | Direction given | Safety line? |
|---|---|---|
| run3 t040-f004f005-machine | "check the incoming AC line for low voltage, interruption, high line voltage, or transients" (live line-voltage measurement at the drive) | **None** |
| forum-rerun q6 (Micro820 analog-as-discrete) | Wire field device to I-00..I-03 sinking; "do not connect -DC24 (Input terminal 2) to Earth/Chassis ground" | **None** (wiring caution, but no de-energize before wiring) |
| pf525-overload-ms | Check load / restart after reset | Yes — banner "Lock out before anyone reaches in." |

Borderline, not counted: s71200 memcard / forum q9 (insert card, power-cycle CPU — no conductor work; q9 note already flags missing p.107 STOP warning), ACS355 0001 (lists "damaged motor cables or wrong motor connection" as causes but gives no direction). Note the interaction: fixing #1 (adding "install dynamic brake option") or #2 ("Check motor, motor cable and connections") will create hands-on directions that then need the #4858 line — the two fixes should land together.

**Call:** small n, but the only answer that carried a lockout line is the one where the guarded reset/restart banner fired; the two that didn't trigger the banner had none. Looks like the safety line is tied to reset/restart wording, not to electrical-work wording — likely systemic once more fixes are surfaced (hypothesis).

## Worst 3 (verbatim from answers)
1. **t040-f004f005-machine** — "To narrow it, check the incoming AC line for low voltage, interruption, high line voltage, or transients, and consider motor regeneration as a possible contributor to F005" — cites p.161 but drops "Extend the decel time or install dynamic brake option.", and directs live line checks with no safety line (hits both patterns).
2. **s0-acs355 / r3f-acs355** — "The manual lists likely causes as sudden load change or stall, insufficient acceleration time, incorrect motor data, motor/drive sizing issues, damaged cables or wrong motor connection, internal drive fault, or high-frequency noise in the STO lines [4]." — the whole WHAT TO DO column (parameters 2202/2205, Group 99, ID run 9910, "Replace the drive") is absent; reproduced on two runs.
3. **forum-rerun q6** — "Yes—on the Micro820, inputs I-00, I-01, I-02, and I-03 are shared between digital and analog inputs, and they can only be used in sinking input configuration [5]. They are non-isolated inputs, so do not connect -DC24 (Input terminal 2) to Earth/Chassis ground [5]." — field-wiring direction with no de-energize line.
