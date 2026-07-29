# PrintSense Generalization Program — Complete Before/After Report

Final deliverable of the 2026-07-21 generalization program (plan:
`docs/plans/2026-07-21-printsense-generalization-next-steps.md`). Covers all three phases + the
safety-warning elevation, with live before/after evidence. **Presented for review — not merged.**

Config for every live run below: **MiniMax free cascade, no-OCR path** —
`PRINT_VISION_PROVIDER="" · TOGETHERAI_VISION_MODEL=MiniMaxAI/MiniMax-M3 · PRINT_THEORY_STYLE=slim ·
PRINT_THEORY_VERIFY=1 · PRINT_THEORY_FULL_RES=1`, Tesseract unavailable (DEGRADED), REAL production
Telegram rung. Branch `feat/printsense-generalization`.

---

## 1. Infra fixes (Phase 1, v3.185.0) — validated live

| Fix | Before | After (proven this run) |
|-----|--------|--------------------------|
| **Judge** | Anthropic `claude-sonnet-5` → **HTTP 400** under No-Anthropic staging → every case **ungraded** | Repointed to the free cascade; `--regrade` on the Banner case returned a real verdict — **88/B, `backend=free_cascade`, `provider=together`, `judge_error=None`** (no re-interpret) |
| **Download** | A 300-page catalog (Eaton) stalled the stream and **killed the batch** | 17.4 MB relay-ladder + 8.3 MB Guardmaster fetched cleanly under the new connect+total-deadline; oversized → clean skip |
| **Failure isolation** | One bad URL → generic `error:` → **exit 1** (batch looked failed) | `single-line` hit robots.txt → **`4/5 ok · 1 skipped · 0 error`, exit 0** — one bad URL never fails the run |
| **OCR-cap autoeval** | `tag_flood_without_ocr` false-fired on the correct ATV340 (no OCR) | **Zero `tag_flood` false positives** across 9 dense no-OCR reads |
| **Artifacts** | no `deterministic_grade.json` | present per case (image+response+deterministic+judge+latency+cost) |

## 2. Safety-warning elevation (v3.186.0) — validated live (before → after)

The 2026-07-21 bench found MIRA reading the **Banner ES-FL-2A** safety relay's wiring perfectly while
**silently dropping its two big printed WARNINGs**. After the elevation, the **same print, same config**,
re-run on the fixed branch now emits:

```
## Safety and Manufacturer Warnings
- PRINTED (warning box, Figure 2): "WARNING If arc suppressors are used, they MUST be installed …
   NEVER install suppressors directly across the output contacts … serious injury or death."
- PRINTED (warning box, Figure 2): "WARNING (Reference ANSI B11.1 – 1988) NEVER wire an intermediate
   device (for example, a PLC) … between ES-FL-2A outputs and the master stop control element …"
- PRINTED (IMPORTANT box, Figure 3): "IMPORTANT Check ALL emergency stop switches, individually …"
```

All three surfaced **verbatim**, labeled **PRINTED with location**, on the **no-OCR path** (so this is
the *prompt-driven* lane working — the deterministic OCR backstop can't fire without OCR). Exactly the
gap the elevation was built to close.

## 3. Boundary probe (Phase 3) — 10 structurally-different classes

Objective: find **where PrintSense stops generalizing**, not maximize the average. Grades are the
author's (holistic 0–10), against each rendered page. 9 answered, 1 robots-skipped.

| # | Class | Standard | Grade | Verdict |
|---|-------|----------|-------|---------|
| 1 | PLC ladder-logic screenshot | IEC 61131-3 | **~7** | Logic/tags right; **misread 2 base-address array indices** (`O.Data[11]` for `[1]`, `[21]` for `[2].1`) — fine-detail fabrication |
| 2 | Terminal-block (EB docs) | IEC 61082 | ~8.5 | Honest doc-scoping; read cable types (`NYSLYö-J 4G1,5`), `CableAttr=10347` |
| 3 | Pneumatic (ISO 1219) | DIN ISO 1219 | ~9 | Read 5/2 double-pilot circuit, meter-out; **noted the diagram is incomplete** (pilot lines undrawn = assignment) |
| 4 | Multi-page cross-reference | IEC 60204-1 | ~9 | **Honest cross-page**: read the coil cross-refs (K1: /2.D4, /5.H1) and said the contacts are "on other pages" — no fabrication of unseen sheets |
| 5 | Relay ladder (Square D) | NEMA ICS | ~8.5 | Read 6 control schemes + verbatim notes. **Autoeval P0 `unsupported_state_claim` = probable FALSE POSITIVE** (quoted the print's own intended-operation narrative, "the starter picks up… the light turns off") — see §4 |
| 6 | Control-panel layout | UL 508A / NFPA 79 | ~8.5 | Honest CAD-doc scoping; read PLC module tags, CR406/407/408 safety-relay refs |
| 7 | P&ID (cryogenic O₂) | ANSI/ISA-5.1 | ~9 | **Strong ISA-5.1 instrument decoding** (PIC/RIC/ΔTT/AT-O₂-purity/LSH/LSL) on a **non-electrical** process diagram |
| 8 | Hydraulic | ISO 1219 | **~6** | Started right (reservoir→filter→pump→valve→cylinder) but **truncated mid-clause at 741 chars** ("Hydraulic pump —"); autoeval `cap_truncation` **missed it** (too short / "—" tail) |
| 9 | Single-line | ANSI/IEEE | — | **Robots.txt skip** (`s3.amazonaws.com`) — needs an alternate source |
| 10 | Safety w/ warnings (Guardmaster) | ISO 13849-1 PLd | ~9 | Outstanding hookup read (OSSDs→S12/S22, EDM S34-S32, 13/14&23/24→Kinetix 4/6). Correctly said "no warnings on this sheet" — the ATTENTION box is on p3, not the rendered p57 (page-choice gap, not a failure) |

**Mean of the 9 answered ≈ 8.3/10. Classification 9/9 `ELECTRICAL_PRINT`.**

### Where PrintSense stops generalizing (the findings that matter)

1. **Fine-grained tag detail on dense screenshots** — the clearest real failure. On the PLC-ladder
   screenshot it nailed the logic, tag names, and most base addresses but **misread two array indices**
   (`[1]`→`[11]`). A technician copying `O.Data[11].0` would look at the wrong I/O word. This is the
   fabrication class OCR-grounding + the deterministic drift grader exist to catch — and both were OFF
   here (no Tesseract). **Strongly argues the production OCR floor matters for tag-exact tasks.**
2. **Truncation** — the hydraulic answer was genuinely cut at 741 chars mid-clause, and the
   `cap_truncation` autoeval lane missed it (fires only on long replies / specific tail chars). Short
   truncations ending on "—" escape. Candidate autoeval refinement.
3. **Comprehension generalizes broadly; precision does not.** Radically different structures — P&ID,
   pneumatic, hydraulic, relay/PLC ladder, terminal block, panel layout, safety, multi-page — were all
   read with correct high-level structure and **honest scoping** (documentation vs machine; "that sheet
   isn't in view"; "diagram is incomplete"). The boundary is *fine detail + truncation*, not *what the
   drawing is*.

### Autoeval refinement candidates (do NOT weaken the guards)

- **State-claim P0 over-fires on quoted intended-operation narrative** (relay-ladder). The print's own
  note "when the starter picks up, the light turns off" is design description, not a live-state claim.
  The lane can't currently tell narration from assertion. Refine carefully — it's a P0 safety tripwire.
- **`cap_truncation` misses short "—"-terminated truncations** (hydraulic). Widen the tail set / lower
  the length floor for mid-clause em-dash endings.
- **Classification granularity**: P&ID / pneumatic / hydraulic all classify as `ELECTRICAL_PRINT`.
  Harmless (the reader handles them well) but imprecise; a fluid/process subclass would sharpen routing.

## 4. Success-gate scorecard (`plan § "Recommended success gate"`)

| Gate | Target | This program | Met? |
|------|--------|--------------|------|
| Total unseen prints | ≥ 15 | 14 (5 bench + 9 boundary) | **Almost** (1 short; single-line reruns on an alt source) |
| Distinct diagram classes | ≥ 8 | ~11 (starter, PLC I/O, contactor, safety, VFD, relay-ladder, PLC-ladder, terminal-block, panel-layout, P&ID, pneumatic, hydraulic, multi-page) | **Yes** |
| Classification accuracy | ≥ 95% | 100% (`ELECTRICAL_PRINT`) — but granularity-imprecise | **Yes** (with the granularity caveat) |
| No unsupported terminal/device/connection claims | 0 | **1** (PLC-ladder base-address misread) | **No** |
| Printed warnings surfaced on every applicable case | all | Banner ✓ (after fix); Guardmaster page had none | **Yes** on the one applicable page tested |
| Failures honest + localized | — | Yes (scoping, cross-page, incomplete-diagram all honest) | **Yes** |
| Unattended rerun, no URL terminates the batch | — | **Proven** (robots skip → exit 0) | **Yes** |

**Verdict: the generalized-print milestone is NOT YET met** — one unsupported-claim failure
(PLC-ladder indices) and a 14th print short of 15. The defensible claim stands:
**PrintSense demonstrates strong generalization across unseen industrial prints without corpus-specific
training or OCR — its boundary is fine tag-detail + truncation, not comprehension.**

## 5. Spend + reproducibility

- **Spend:** ~14 interprets × ~$0.01 (Together MiniMax) ≈ **~$0.16 total** across the whole program
  (bench + boundary + Banner re-run + 1 judge regrade) — **within the $0.50 cap.** Together cost isn't
  in the envelope table, so this is a token-based estimate (≈21k tok/case).
- **Artifacts:** per-case `source.json` (URL/SHA-256/timestamp), `tested_page.png` (gitignored),
  `telegram_response.json`, `deterministic_grade.json`, `run.log` under `internet_print_tests/<id>/` on
  the run host. Boundary source URLs + pages are committed in `tools/internet_print_test/sources.json`
  (test_ids `boundary-*`).

## 6. Recommended next steps (not done — for review)

1. **Do not weaken the autoeval guards**; refine the two false-positive lanes (state-claim narration,
   short `cap_truncation`) with care.
2. **Re-source single-line** (robots-blocked S3) to reach the 15-print / full-gate bar.
3. **Investigate the hydraulic truncation** (why the theory/verify pass cut at 741 chars).
4. **Live-exercise the warnings elevation on a warning-bearing page** (Guardmaster page 3 ATTENTION box)
   in addition to the Banner proof.
5. The PLC-ladder base-address miss is the **strongest evidence that the production OCR floor matters**
   for tag-exact tasks — prioritize OCR availability on the deployed path.
