# PrintSense — Path from D (43%) to A (≥90%)

Synthesis of 5 parallel research agents (2026-07-12). Ranked by **accuracy-lift ÷ effort**.
Grade + ground truth for the driving case: `printsense/benchmarks/scu2_sheet20_opto.md`.

## What "A" means (make it a number — Agent 4)

A 100-pt rubric graded by a **deterministic** grader (`printsense/grader.py`, no LLM):
package id 10 · structure 10 · device/terminal tags 20 · wire/cable 15 · cross-ref/power/PE 15 ·
grounding+honesty 30 (`20 − 5×confident_misreads + 10×unresolved_recall`; trust violation ⇒ 0).

**A = overall ≥ 90 AND confident_misreads == 0 AND package id = 10/10 AND device-tag F1 ≥ 0.85 AND wire-tag F1 ≥ 0.85 AND zero trust violations.** A single confident misread caps the grade at C — no matter the total.

## 🔴 The surprise: the image is crushed to 1024 px *before Claude ever sees it*

`mira-bots/telegram/bot.py::_resize_for_vision()` caps **every** photo to `MAX_VISION_PX` (default **1024 px**) — tuned for the *local qwen2.5vl* encoder — and that same crushed `vision_bytes` is what flows to `interpret_print`. So the D-grade was scored on a **1024 px** image, and Claude Opus 4.8's **2576 px / 4784-token high-res budget is never used**. `raw_bytes` (full Telegram resolution) is already in scope. **This is the single biggest unlock and it is a one-line routing fix.** (Agent 1, code-verified.)

## Phase 0 — free / near-free, do first (hours, mostly reuse)

| # | Change | Fixes | Effort |
|---|---|---|---|
| 0.1 | **Route the print path off the 1024 px cap** — feed `interpret_print` from `raw_bytes` (or new `PRINT_VISION_MAX_PX`) | everything (unlocks real resolution) | 1 line |
| 0.2 | **Auto-rotate** (Tesseract OSD, already shipped): `img.rotate(-osd["rotate"], expand=True)` — **negate** (Tesseract=CW+, PIL=CCW+); gate on `orientation_conf`; OSD on a downscaled probe, apply to full-res | the 90° root cause | ~30 min, reuse |
| 0.3 | **Prompt hardening** in `_SYSTEM`: read char-by-char; never pattern-complete a partial tag (→ `UNREADABLE`); **DIN/IEC 81346 tag-grammar table** (`-W`+digits *never* `-WK`; cross-ref `\d+\.\d+` exact; device `-{sheet}/{Class}{n}`; off-page `+{LOC}` verbatim); German glossary (LWL/POF/Opto-Koppler/belegt) | WK902 misread, missed tags, package id | free (prompt) |
| 0.4 | **Effort `high` → `xhigh`** (`PRINT_VISION_EFFORT`) — the "verifies its own visual output" case | reading accuracy | env var |
| 0.5 | **Structural confidence gate**: any entity `confidence < 0.55` → force `tag=UNREADABLE`, `trust=unresolved`, guess demoted to `evidence` | confident low-conf guesses | cheap code |

*Agents 1/2/3/5 independently converged on 0.2–0.3.*

## Phase 1 — measurement (parallel; you can't *claim* A without it — Agent 4)

- `printsense/grader.py` (deterministic P/R/F1 + **confident-misread count**: substitution vs fabrication; tag-normalize but do NOT fuzzy-collapse digits — digit drift *is* the error).
- Corpus `printsense/benchmarks/<case>/` (images as-delivered + upright, `ground_truth.graph.json`, **frozen** `responses/`, `grades/`, `BASELINE.sha256`). Seed with sheet 20 + promote `fixtures/scu2/`.
- **New CI job `printsense-grader-gate`** modeled on `simlab-gate`: unit-test grader on injected-error fixtures + re-run vs committed snapshots — **no `anthropic` SDK in CI** (structurally can't call the paid API). Real runs happen off-CI and are deliberately promoted.

## Phase 2 — structural accuracy (days)

- **Tiling (biggest single lever after Phase 0 — Agent 1):** split the upright/cropped sheet into a ~2×2 (phone) overlapping grid (~15–20% overlap, each tile ≤2576 px, no downscale) **+ one overview**, sent as multiple labelled `image` blocks in one request. Save PNG or JPEG q≥95 (never Pillow's lossy 75). Pillow-only.
- **Forced non-strict tool call** for guaranteed JSON (Agent 2) — *not* full Structured Outputs (`strict:true` needs `additionalProperties:false`, which breaks our load-bearing `extra="allow"`). Add `cache_control` on the system/schema block.
- **Catalog + few-shot** (Agent 5): `printsense/catalog/` (mirror `device-profiles/_schema.yaml`; seed `intrasys.yaml` ITS.*, `beckhoff.yaml` EK/EL from `fixtures/scu2`) injected via `package_context`; 3–5 curated one-per-pattern exemplars (not the 81 KB fixture).

## Phase 3 — verification backstop (drives confident-misreads → ~0 — Agent 3)

`interpret → [NEW verify] → render` (render.py untouched). `printsense/verify.py`, modeled on
`citation_compliance.py::enforce_citation_via_rewrite` (narrow ask → strict validator → safe fallback):
- Add `Entity.region` bbox (reuse mig-063 `region_of_interest` shape) + `Entity.disputed_reading`.
- **Select** risky entities (0.55–0.85 conf, or in a `functional_path`/`off_page`, or single-occurrence) — ~5–15 of 25–80, not all.
- **Blind, batched reread** of each entity's zoomed 2–4× crop (never "confirm X" — anchors); deterministic decide: match → `machine_verified`; differ → `unresolved` + `UNREADABLE` (**and rename it everywhere it's referenced** — `sequence[]`/`connects[]`, or the stale tag leaks back). Never write `human_verified` (stays a tech action).
- Confidence = **triage only**, never the promotion gate (WK902 proves self-confidence is uncalibrated). Escalate N=2→N=3 only on "both confident but different."
- Then deskew/perspective-crop + CLAHE/bilateral (`opencv-python-headless`, new dep) — lower priority than tiling.

## Phase 4 — flywheel

Each `human_verified` fact → triage into **Glossary** | **Catalog** | **Exemplar** (Agent 5) + a regex backstop (`-W\d+$`, `\d+\.\d+`, `-X\d+\.\d+`, `-\d+/[A-Z]\d+`) flagging grammar violations `needs_review`. The corrected+verified sheet-20 becomes the first LWL/Opto-Koppler exemplar.

## Cost / latency tradeoff (flag)

A → requires spending: Phase 0 ≈ same (1 call, xhigh a bit slower). Phase 2 tiling ≈ **5× tokens** (grid+overview). Phase 3 verify ≈ **+1 batched call** (+30–50% latency). An A-grade interpretation may be ~5–6× the cost/latency of today's single call — acceptable for an async Telegram flow, worth stating.

## Recommended order

**Phase 0 (all 5 items) + Phase 1 grader → re-run sheet 20 → measure the jump.** Phase 0 alone (real resolution + upright + grammar + xhigh + conf-gate) should move D→B without any new deps or multi-pass. Then Phase 2 (tiling) and Phase 3 (verify) close to A. Build the grader early so every phase is measured, not asserted.

## 2026-07-14 case-study program (operator decision record: `docs/eval/2026-07-14-printsense-sheet20-case-study.md`)

Landed with / right after the decision record:

- ✅ **type_text rubric lane (§7)** — schematic tags vs catalog codes split; strict-A device gate
  = tags only. `grader.py` + sheet-20 rubric + regraded `response_b` (94.1/A, `is_A` true).
- ✅ **Cost benchmark** (`docs/eval/2026-07-14-printsense-cost-benchmark.md`) — effort=high holds
  A-band at 55% of xhigh cost; Batches −50%; caching ~12%.
- ✅ **Variance-study harness (§9/§12)** — `printsense/benchmarks/variance_study.py` (sibling PR),
  Batches API, ≥5 runs × opus xhigh/high/medium, decision-rule report. **Prod default stays xhigh
  until this study passes the §9 decision rule.**

Staged next (blocked on the #2698→#2701 merge queue, then the iterate-branch derivation of
F1 token-budget resize / F2 EXIF upright / F5 client-side PDF render / --enhance/--verify):

- **§8A port-aware graph** — DIG IN / DIG OUT / LWL IN / LWL OUT / 24VDC / GND as first-class
  port edges; no generic "opto-coupler" collapse. Schema (models.py) + prompt + grader checks.
- **§8B off-sheet cross-reference graph** — sheet refs, cable numbers, SCU identifiers,
  direction; enables deterministic "received from SCU3 / sent onward to SCU1" statements.
  (Also the systematic fix for the xref-F1 0.36–1.0 run variance — tiling overview+labels.)
- **§8C OCR reconciliation** — repeated-context normalization (the `Position Blt` class of
  error); raw OCR preserved separately; promote only on multi-clue agreement.
- **§8D/§8F observation-vs-inference + evidence-sensitive uncertainty** — visible fact / strong
  inference / unknown as explicit categories; a blurred model number reduces confidence in the
  model number only, never in traceable connectivity.
- **§8E technician response planner (overview-first)** — §4 ordering (whole-circuit function →
  purpose → flow → one-channel detail → fault meaning → troubleshooting → exact mapping →
  unknowns/safety) + §11 prose rubric (topology 25 / port-direction 20 / xref 15 / functional 15 /
  ordering 15 / honesty 10, field-ready ≥90, hard-fail on topology or direction).
- **§10 Bit 1–3 regression case** — needs the "Opto-Koppler, Bit 1–3" page image (`-20/A10…A12`,
  three modules) + verified truth; the current benchmark image is the two-module *belegt* page.
  Do NOT reuse the belegt rubric for it.
