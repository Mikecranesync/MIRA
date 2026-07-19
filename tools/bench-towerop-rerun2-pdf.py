#!/usr/bin/env python3
"""Tower OP RERUN2 report PDF — modeled on tools/bench-runbook-pdf.py house style.
Renders the 2026-07-19 post-#2713/#2805 re-benchmark verdict, per-case/per-class
tables, and the code-confirmed next-round levers (L1-L7); companion to
tools/internet_print_test/benchmarks/2026-07-18-towerop/RERUN2-2026-07-19-post-2713-2805.md.

Output: tools/internet_print_test/benchmarks/2026-07-18-towerop/TowerOP-RERUN2-Report-2026-07-19.pdf
Usage:  python tools/bench-towerop-rerun2-pdf.py
"""
from pathlib import Path

from fpdf import FPDF

NAVY = (28, 45, 79)
RED = (180, 40, 40)
ORANGE = (200, 110, 30)
AMBER = (190, 150, 30)
GRAY = (110, 110, 110)
LIGHT = (238, 240, 244)
GREEN = (40, 130, 70)
BLUE = (40, 80, 160)

CHIP_COLOR = {
    "FIXED": GREEN, "TRIVIAL": GREEN, "SMALL": BLUE, "KNOB": GREEN,
    "PERSISTS": RED, "NEW": ORANGE, "MUTATED": AMBER, "UNCHANGED": GRAY,
    "MIKE": ORANGE, "PACK": BLUE, "RULE": BLUE, "TRUTH": GRAY,
    "P0": RED, "P1": ORANGE, "$0": GREEN,
}


def s(t: str) -> str:
    """latin-1 sanitize (fpdf core fonts)."""
    repl = {
        "—": "-", "–": "-", "→": "->", "←": "<-",
        "≥": ">=", "≤": "<=", "×": "x", "·": " - ",
        "“": '"', "”": '"', "‘": "'", "’": "'",
        "…": "...", "✓": "OK", "❌": "X", "⇒": "=>",
        "≈": "~",
    }
    for k, v in repl.items():
        t = t.replace(k, v)
    return t.encode("latin-1", "replace").decode("latin-1")


class R(FPDF):
    def footer(self):
        self.set_y(-12)
        self.set_font("Helvetica", "", 7)
        self.set_text_color(*GRAY)
        self.cell(0, 6, s(f"Tower OP re-benchmark #2 - 2026-07-19 - main 2ff4e78e1 (v3.174.0) - $0.00 inference - page {self.page_no()}"), align="C")

    def h1(self, txt):
        self.set_fill_color(*NAVY)
        self.set_text_color(255, 255, 255)
        self.set_font("Helvetica", "B", 13)
        self.cell(0, 9, s(f"  {txt}"), new_x="LMARGIN", new_y="NEXT", fill=True)
        self.ln(2)
        self.set_text_color(0, 0, 0)

    def h2(self, txt):
        self.ln(1)
        self.set_text_color(*NAVY)
        self.set_font("Helvetica", "B", 11)
        self.cell(0, 7, s(txt), new_x="LMARGIN", new_y="NEXT")
        self.set_text_color(0, 0, 0)

    def body(self, txt, size=9.5, style=""):
        self.set_font("Helvetica", style, size)
        self.set_text_color(20, 20, 20)
        self.set_x(self.l_margin)
        self.multi_cell(self.epw, 4.8, s(txt))
        self.ln(0.6)

    def mono(self, txt):
        self.set_font("Courier", "", 8.3)
        self.set_fill_color(245, 245, 245)
        self.set_text_color(20, 20, 20)
        self.set_x(self.l_margin)
        self.multi_cell(self.epw, 4.4, s(txt), fill=True)
        self.ln(1)

    def chip(self, label):
        self.set_font("Helvetica", "B", 8)
        self.set_fill_color(*CHIP_COLOR.get(label, GRAY))
        self.set_text_color(255, 255, 255)
        self.cell(self.get_string_width(s(label)) + 6, 5.5, s(label), align="C", fill=True)
        self.set_text_color(0, 0, 0)
        self.cell(2, 5.5, "")

    def lever(self, tag, chips, title, mech, fix, effect):
        if self.get_y() > 240:
            self.add_page()
        self.set_font("Helvetica", "B", 10.5)
        self.set_text_color(*NAVY)
        self.cell(self.get_string_width(s(tag)) + 2, 6, s(tag))
        for c in chips:
            self.chip(c)
        self.set_text_color(0, 0, 0)
        self.set_font("Helvetica", "B", 10)
        self.cell(0, 6, s("  " + title), new_x="LMARGIN", new_y="NEXT")
        self.set_font("Helvetica", "", 9)
        for lbl, txt in (("Mechanism (verified)", mech), ("Fix", fix), ("Effect", effect)):
            self.set_font("Helvetica", "B", 8.7)
            self.set_x(self.l_margin + 3)
            self.cell(34, 4.6, s(lbl + ":"))
            self.set_font("Helvetica", "", 8.7)
            self.multi_cell(self.epw - 37, 4.6, s(txt))
        self.ln(2.2)

    def table(self, headers, widths, rows, size=8.2, row_h=4.5):
        self.set_font("Helvetica", "B", size)
        self.set_fill_color(*NAVY)
        self.set_text_color(255, 255, 255)
        for h_, w in zip(headers, widths):
            self.cell(w, 5.5, s(h_), fill=True, align="L")
        self.ln()
        self.set_text_color(20, 20, 20)
        fill = False
        for row in rows:
            self.set_font("Helvetica", "", size)
            self.set_fill_color(*(LIGHT if fill else (255, 255, 255)))
            # wrap on the last (widest) column
            lines = max(1, len(self.multi_cell(widths[-1], row_h, s(row[-1]), dry_run=True, output="LINES")))
            h = lines * row_h
            if self.get_y() + h > 280:
                self.add_page()
            y0 = self.get_y()
            x = self.l_margin
            for i, (cell, w) in enumerate(zip(row, widths)):
                self.set_xy(x, y0)
                if i == len(row) - 1:
                    self.multi_cell(w, row_h, s(cell), fill=True)
                else:
                    self.multi_cell(w, h, s(cell), fill=True, max_line_height=row_h)
                x += w
            self.set_y(y0 + h)
            fill = not fill


pdf = R(format="A4")
pdf.set_auto_page_break(True, margin=16)
pdf.set_margins(12, 12, 12)
pdf.add_page()

# ---------- Cover / verdict ----------
pdf.set_fill_color(*NAVY)
pdf.set_text_color(255, 255, 255)
pdf.set_font("Helvetica", "B", 17)
pdf.cell(0, 12, s("  TOWER OP RE-BENCHMARK #2 - post-#2713 / #2805"), new_x="LMARGIN", new_y="NEXT", fill=True)
pdf.set_font("Helvetica", "", 9.5)
pdf.cell(0, 6.5, s("  Heege Tower OP print set - 12 sha256-verified photos - REAL Telegram print-translator path - 2026-07-19"), new_x="LMARGIN", new_y="NEXT", fill=True)
pdf.set_text_color(0, 0, 0)
pdf.ln(3)

pdf.body("Run: CHARLIE worktree @ main 2ff4e78e1 (v3.174.0 - full overnight train #2800/#2801/#2802/#2804/#2805/#2713/#2806 + #2803), "
         "this PR's parents[4] driver, Doppler stg scoped 5-var process-env only, $0.00 total inference (every LLM_CALL = "
         "together/gemma-3n-E4B-it; OpenAI interpreter 429 quota-dead, identical to both priors). "
         "Judged per pack protocol: 12 independent adversarial vision judges, blind to prior verdicts, + 2 full-reply corrections.", 9)

pdf.h1("VERDICT")
pdf.body("1.  #2713 DELIVERED - THE ROUTING WALL IS BROKEN. 4 of the 5 cases that died before vision in both prior runs "
         "(c06, c08 caption-gate; c11, c12 table misclass) now enter the pipeline and produce real answers. 11/12 reach "
         "vision classification (was 7/12).", 9.5, "B")
pdf.body("2.  #2805 DELIVERED DETECTION, NOT PREVENTION. The new false_absence_claim autoeval rule fired live 4x in-run "
         "(P1 on c01/c07; inside P0s on c06/c09) - the exact class that had no rule before. The prompt-side contract did "
         "not change gemma's behavior.", 9.5, "B")
pdf.body("3.  SYNTHESIS IS NOW THE ISOLATED BOTTLENECK. Corrected mean 1.0/10 - exactly flat vs rerun1 - with 10/12 cases "
         "graded on real answers instead of 7/12. Every remaining point is owned by the free vision model's synthesis: "
         "fabricated tags, wrong-row lookups, laundered OCR. This is the strongest empirical case for PR-F yet.", 9.5, "B")

pdf.h2("Scorecard (three runs, same photos, same protocol)")
pdf.table(
    ["Run", "Mean /10", "Corrected", "Clean", "Reach vision", "Cost", "Notes"],
    [34, 18, 20, 14, 24, 12, 64],
    [
        ["Baseline 07-18", "1.7", "-", "0/12", "7/12", "$0", "evidence spine inert (0 OCR items everywhere)"],
        ["Rerun1 (post-#2800)", "1.0", "-", "0/12", "7/12", "$0", "evidence flows (18-75 items) but answers flat"],
        ["RERUN2 (this run)", "0.5", "1.0", "0/12", "11/12", "$0", "routing fixed; harness split-reply artifact corrected; judges punished wrong-row lookups hard"],
    ],
)
pdf.ln(2)
pdf.body("The corrected mean applies the two full-reply re-grades (c06, c09) after discovering final_text captured only the "
         "last Telegram chunk of split replies (see H-fixes). Protocol-lane numbers kept for comparability.", 8.3)

# ---------- Per-case ----------
pdf.add_page()
pdf.h1("PER-CASE (baseline -> rerun1 -> RERUN2)")
pdf.table(
    ["Case", "Base", "R1", "R2", "What happened this run"],
    [30, 16, 16, 20, 104],
    [
        ["c01 K1 coords", "F 1", "F 1", "F 0", "Never names K1; generic theory template; invents F3, S1-S5 as 'Evidence'. Autoeval P1 fired."],
        ["c02 motor ratings", "F 1", "F 0", "F 0 honest", "Theory call lost at Together 30s timeout -> honest fallback. ZERO fabrication (rerun1: ~236 invented tags). 2.2kW/4.95A absent from OCR (small font)."],
        ["c03 K4.1-4.4 role", "P 5.5", "P 4", "F 2", "Misses printed 'torque limitation (R1)/braking relay' headers; launders '12-G122' (real: Q1.2-Q12.2); invents F4."],
        ["c04 TDC switch", "F 2", "F 1", "F 0 NEW DROP", "handled=false, no classify: wiring carve-out claims the caption pre-vision (L1). Judge's correct answer: S7.1 -> I6.1 @ X5.2.3."],
        ["c05 sensor P/Ns", "F 2", "F 0", "F 0 honest", "Theory timeout -> honest fallback. Garbled fragments of BOTH correct part numbers sit in its own ocr_items (xSi-MErHO <- XS1-N18PC410)."],
        ["c06 pawl switches", "0 gate", "0 gate", "F 0/1 ANSWERS", "ROUTES NOW (86 items). Reply fabricates pawl attribution + K1-K96 enumeration; S21/S22 genuinely NOT on this sheet -> honest absence was the right answer (L7). P0 fired."],
        ["c07 S19 meaning", "F 1", "F 1", "F 1", "False-absence persists ('not explicitly labeled' under the printed 'rope control' header); invents K1/F1/Q1. P1 caught it in-run."],
        ["c08 pretension relays", "0 gate", "0 gate", "F 2 ANSWERS", "ROUTES NOW (53 items). Reads header + car columns correctly, then fabricates K1-K4 for the printed K5.1-K5.4; self-contradicts."],
        ["c09 supply feeds", "P 6", "P 5", "F 0 / P 5 full", "Main chunk had the CORRECT 480V+240V answer verbatim - buried in ~80 fabricated tags across 4 degenerate enumerations; tail chunk (graded lane) = laundered glare-OCR. P0 fired."],
        ["c10 FF LED", "0 gate", "0 gate", "F 0 mutated", "Caption gate now passes; vision says NAMEPLATE 0.67 (unit-vocab V/Hz native to LED tables) -> declined. 170 OCR items incl. answer fragments (L2)."],
        ["c11 IG 1Hz flash", "0 misclass", "0 misclass", "F 1 ANSWERS", "ROUTES NOW (184 items). Wrong-row lookup: quotes X4.3 LED1's row for X4.4 LED5; the correct row IS in its own OCR."],
        ["c12 X6.3 elem 5-8", "F 0", "0 misclass", "F 0 ANSWERS", "ROUTES NOW (156 items). Cross-module substitution: real X6.1/X6.2 text presented as X6.3; 0/4 on a safety-interlock table."],
    ],
)

# ---------- Per-class ----------
pdf.h1("PER-CLASS (the comparison that matters)")
pdf.table(
    ["Failure class", "Base", "R1", "R2", "Call"],
    [52, 22, 26, 30, 56],
    [
        ["Caption-gate drops (R1)", "c06 c08 c10", "same 3", "0 of class", "FIXED as a class; c10 re-drops on NAMEPLATE (mutated)"],
        ["Table-page misclass (R2)", "c11 c12", "same 2", "0", "FIXED - both answer at 0.80/0.76 conf"],
        ["Residual/new routing", "-", "-", "c10, c04", "NEW: NAMEPLATE escape (L2) + wiring carve-out (L1)"],
        ["Fabricated device tags", "c02 c09", "c01 c02 c07 c09", "c01 c03 c06 c07 c08 c11", "PERSISTS - but the 2 worst floods now die honestly at timeout"],
        ["'Not labeled' false absence", "c05 c07", "c05 c07 c09", "c07 (+c06 full)", "REDUCED surface; now DETECTED live by the #2805 rule"],
        ["Garbled-OCR laundering", "-", "c03 c05 c09", "c03 c09", "PERSISTS (prompt contract doesn't stop it)"],
        ["Degenerate enumeration", "c02", "c02 c09", "c06 c09 (full)", "PERSISTS, moved cases; both P0-flagged live"],
        ["Wrong coordinate convention", "c01", "c01", "c01", "PERSISTS/WORSE (question ignored entirely)"],
        ["Wrong-row / cross-module lookup", "-", "-", "c11 c12", "NEW CLASS unmasked by routing fix - confident wrong safety facts; invisible to false_absence_claim (L5)"],
        ["Theory-timeout honest fallback", "-", "-", "c02 c05", "NEW CLASS - 30s Together ceiling; honest > fabrication but 2/10 answers lost (L3)"],
    ],
)

# ---------- Levers ----------
pdf.add_page()
pdf.h1("NEXT ROUND - CONFIRMED LEVERS (code-verified, not hypotheses)")
pdf.body("Every mechanism below was verified against main 2ff4e78e1 on 2026-07-19: the run's evidence names the failure, the code "
         "names the cause. Ordered by effect per unit of work. L1-L4 alone make round 3 a 12/12, honestly-measured, pure "
         "synthesis benchmark.", 9)

pdf.lever("L1", ["TRIVIAL", "FIXED"], "Narrow the wiring carve-out (restores c04)",
          "bot.py:1140 _try_print_translator_reply declines when wiring_intake.parse_wiring_intent(caption).kind != 'none' (line 1177). "
          "The parser returns THREE kinds (intake | question | none, wiring_intake.py:246-258); the carve-out was written for intake "
          "ownership (its own comment says 'an explicit wiring-intake command') but also fires on 'question'. c04's caption ('...which PLC "
          "input is the switch WIRED TO...') parses as a wiring question -> print rung declines pre-vision (capture: handled=false, no "
          "classification - first time ever; both priors answered c04).",
          "Decline only on kind == 'intake'. Regression test: c04's caption verbatim + print photo must classify.",
          "Wiring-phrased print questions - a large share of real technician phrasing - stop dying silently. +1 case enters.")

pdf.lever("L2", ["SMALL", "FIXED"], "Dense-table override must outrank NAMEPLATE unit-vocabulary (restores c10)",
          "vision_worker.py: NAMEPLATE_OCR_FIELDS (>=3 unit fields - hp/kW/Hz/volts - in OCR => NAMEPLATE 'regardless of vision "
          "description', ~line 103) is checked BEFORE DENSE_TABLE_OCR_THRESHOLD=50 (line 685). c10's LED-reference page carries "
          "'24 V', '10 Hz', '(25 Hz)', 'voltage' as NATIVE table content -> NAMEPLATE 0.67 with ~170 OCR items; the dense override "
          "never ran. #2713's adversarial probes protect real dense nameplates via exactly this precedence.",
          "Ratio-aware, not a blind reorder: at >=50 items, holding NAMEPLATE requires plate vocabulary proper (NAMEPLATE_KEYWORDS) "
          "or a unit-field RATIO (3 hits among 12 items = plate; 4 among 170 = table noise). Fixture: c10's capture from this run.",
          "With L1+L2: 12/12 pipeline entry. The last original routing survivor closes.")

pdf.lever("L3", ["KNOB", "TRIVIAL"], "Lift the Together vision timeout (stops losing computed answers)",
          "router.py:209 - the together provider hardcodes timeout=30.0 (dataclass default is 60.0 at line 152; no env knob). Vision/theory "
          "calls are Together-only - NO cascade fallback exists for vision. This run's successful theory calls measured 13.9-28.6s; "
          "2 of 10 (c02/c05) crossed 30s -> 'together timeout after 30s' -> 'All providers exhausted' -> honest fallback. #2804's "
          "2000-token budget + #2805's larger prompt consumed the old margin.",
          "TOGETHERAI_TIMEOUT env knob (default ~90s for the vision path) + compose mapping + docs/env-vars.md row (the enumerated "
          "compose env-block trap has bitten twice before).",
          "Recovers the 2-in-10 lost-answer class. SLOW_LLM_CALL warnings become the early ceiling indicator.")

pdf.lever("L4", ["PACK", "SMALL"], "Bench capture fixes (measurement honesty)",
          "(a) #2804-length replies now split at Telegram's limit; final_text captured only the TAIL chunk - c09's correct 480V/240V "
          "answer sat ungraded in the main chunk (laneA captures verified single-chunk: this is new drift). (b) c04 and c10 were "
          "indistinguishable in-capture (both handled=false, no reason). (c) provider/model fields record interpreter config, not the "
          "answering provider - misled judges in two consecutive runs.",
          "final_text := ordered concatenation of reply chunks (minus ack); add a decline_reason field; record the actual answering "
          "provider from the run's LLM_CALL telemetry.",
          "The bench grades what the technician actually saw. No more silent under-measurement of split replies.")

pdf.lever("L5", ["RULE", "NEW"], "New autoeval rule: wrong-row / cross-module table lookup",
          "c11 answered X4.3 LED1's row for X4.4 LED5; c12 presented X6.1/X6.2 row text as X6.3 elements 5-8 (0/4 on a safety-interlock "
          "table). Both quote VERBATIM-REAL print text from the WRONG cell - false_absence_claim structurally cannot see it (nothing is "
          "claimed absent), and it is worse than absence: confident wrong safety facts.",
          "Deterministic detection is feasible: the question names module+element; ocr_tokens carries line-grouped word boxes "
          "({text, bbox, line}) - when the reply's quoted row text matches a different module's line than asked, flag P1. "
          "Fixtures: c11/c12 captures from this run.",
          "The scariest new class gets a tripwire before any customer sees it.")

pdf.lever("L6", ["MIKE"], "PR-F paid interpreter - the empirical case is now clean",
          "With routing repaired and evidence attached, the free VL floor (gemma-3n-E4B - the ONLY serverless vision model this Together "
          "account can reach) scores 0.5-1.0/10 on synthesis alone: reads structure (c08's header+columns) then fabricates the tags "
          "beneath; drops its own correct detections; cannot do row-accurate lookups. c09-fullreply proves correct extraction happens "
          "and then drowns in degenerate enumeration.",
          "Blocked on: credits + printsense/interpret.py sign-off (never-calibrate guarded file). Run round 3 free-lane vs paid-lane "
          "side by side under the existing $-bounded bench guard.",
          "Directly attacks the fabrication, wrong-row and laundering classes that own every remaining point.")

pdf.lever("L7", ["TRUTH", "PACK"], "Truth-set maintenance: c06's pass condition = honest absence + redirect",
          "Judge verified against the photo: S21.x/S22.x pawl switches are NOT on c06's sheet (that page groups car No.3/No.4 inputs; "
          "the pawl tags live on the X6.3 table - c12's page). cases.json's expected implies findability; the only correct c06 answer "
          "is honest absence plus a redirect to the right sheet.",
          "Correct the case's expected per the never-weaken-truth discipline (primary-source verification is recorded in the verdict).",
          "Round 3's c06 rewards honesty instead of demanding an impossible lookup.")

# ---------- Close ----------
if pdf.get_y() > 200:
    pdf.add_page()
pdf.h1("WHAT ROUND 3 LOOKS LIKE IF L1-L4 LAND (zero model change)")
pdf.body("12/12 pipeline entry - ~12 graded real answers - honest full-reply measurement. The bench becomes a pure synthesis "
         "benchmark: every remaining point is the model, nothing else. L5 guards the scariest class; L6 (PR-F) is what moves the "
         "score. Structural wins already banked this round: OCR evidence 18-184 items on every classified case with tesseract "
         "provenance; classification confidence 0.76-0.95; the observability regime caught real garbage live (2x P0 + 2x P1, "
         "including the brand-new false_absence_claim rule on exactly its target class); honest failure now exists as a floor "
         "where fabrication floods used to be; $0.00 end-to-end, three runs in a row.", 9.5)

pdf.h2("Evidence & artifacts")
pdf.mono("Committed:  tools/internet_print_test/benchmarks/2026-07-18-towerop/RERUN2-2026-07-19-post-2713-2805.md  (PR #2808, b30b7b55d)\n"
         "Priors:     REPORT.md (baseline 1.7) + RERUN-2026-07-19-post-2800.md (rerun1 1.0), same pack\n"
         "Run truth:  CHARLIE ~/towerop/out-0719/*.json + ~/towerop/run2.log (LLM_CALL / PRINT_AUTOEVAL lines)\n"
         "Judging:    12 blind adversarial sonnet verdicts + 2 full-reply re-grades (session archive)\n"
         "Deploys:    prod green through 2ff4e78e1 (six deploy-vps successes overnight); staging 3.173.0 verified")

out = (Path(__file__).resolve().parents[1] / "tools" / "internet_print_test" / "benchmarks"
       / "2026-07-18-towerop" / "TowerOP-RERUN2-Report-2026-07-19.pdf")
pdf.output(str(out))
print("WROTE", out)
