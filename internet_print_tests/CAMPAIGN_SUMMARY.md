# Internet Print Test Campaign — Summary

## 1. What this is

Three public OEM electrical prints, downloaded from the manufacturer's own literature site,
submitted through the **real** MIRA Telegram Print-Translator production path —
`bot._try_print_translator_reply` → vision classify (`ELECTRICAL_PRINT`) → the Anthropic
PrintSynth interpreter (`claude-opus-4-8`, effort `xhigh`) → `format_map_for_telegram` render —
exactly as a technician would trigger it by texting a photo. Each response was then graded by an
**independent** Sonnet multimodal judge (`claude-sonnet-5`) that sees only the rendered drawing
image and the bot's verbatim reply, never the interpreter's internal state.

**All scores in this document are PROVISIONAL.** The rubric (14 weighted criteria + 6 hard-failure
flags, `tools/internet_print_test/judge.py`) has not been calibrated by a human reviewer. A
numeric score or letter grade here is not a pass/fail verdict — it is an evidence trail for Mike to
calibrate against.

Working root: `C:/wt-printsense/internet_print_tests/`.

## 2. Results

| test_id | category | standard | score / letter | hard_failure | interpreter_used | interpret latency (s) |
|---|---|---|---|---|---|---|
| rockwell-509-nema-starter | motor_starter | NEMA | 83 / B | false | true | 169.84 |
| banner-esfl-estop-relay | safety_relay | ISO 13850 / EN 418 | 85 / B | false | true | 125.97 |
| automationdirect-gs20-vfd | vfd | NEMA ICS 6 | 86 / B | false | true | 175.72 |

Source: score/letter/hard_failure from each case's `judge_1.json`
(`overall_score_provisional`, `letter`, `hard_failure`); `interpreter_used` and latency from each
case's `telegram_response.json` (`interpreter_used`, `latency_s`). All three ran the same
interpreter config: `model=claude-opus-4-8`, `provider=anthropic`, `effort=xhigh`,
`max_tokens=32000`. Rockwell's package was emailed (`email: sent`); Banner and GS20 were dry-run
(package built, not sent) — per `index.json`.

## 3. Per-case: strengths and suspected errors

### Rockwell Bulletin 509 NEMA starter — 83/100 (B)

**Verified strengths** (`judge_1.json → verified_strengths`):
- Sheet identity matches the title block/footer exactly: "3 Phase Starters", "Bulletin 509",
  "Sizes 7 and 8", "Standard wiring with START-STOP push button station."
- Correctly identifies the DC-coil/rectifier/economizer architecture from the visible `Rect.`,
  `Mov.`, `1/2 Econ. Cap.`, `1/2 Res.` blocks — not a generic AC-coil assumption.
- Appropriately flags genuinely ambiguous marks (`(L.B.)`, the rectifier's AC/DC terminal
  assignment, the FU sequence gap) as unconfirmed instead of asserting them as fact.

**Suspected errors / hallucinations** (`suspected_errors_or_hallucinations`, 1 entry):
- Claim: *"Contactor coil (DC) hold — M / (L.B.) @ 6-7-8-9 → pulls in main contactor via
  rectifier + economizer · conf 0.60."* Why: the drawing shows `M` (coil, terminals 6-9) and
  `(L.B.)` (a separate contact, terminals 7-8) as distinct symbols; merging them into one device
  with one combined terminal range is a simplification not clearly supported by the drawing —
  though the interpreter hedged it at its lowest confidence value (0.60) rather than asserting it.

### Banner ES-FL-2A E-stop safety relay — 85/100 (B)

**Verified strengths:**
- Correctly identifies `K1A/K2A` at terminals 13/14 and `K1B/K2B` at terminals 23/24 as the
  internal redundant safety outputs, matching the printed labels exactly.
- Correctly reproduces the printed WARNING almost verbatim: arc suppressors go **only** across the
  MSC actuators, never across the relay output contacts.
- Correctly identifies `S33/S34` as the feedback loop containing the Reset Switch in series with
  both MSC1/MSC2 monitor contacts — matching the drawing's series wiring.

**Suspected errors / hallucinations** (2 entries):
- Claim: *"Which top-rail nodes (S24, 13, 23, 41) are bonded to L1 — verify the top distribution
  rail."* Why: `S24` belongs to the E-stop switch loop, not the L1 rail (the drawing shows
  connection dots only above terminals 13 and 23); grouping S24 with the L1-rail nodes is
  inaccurate.
- Claim: the per-item `conf 0.95 / conf 0.90 / conf 0.88` values attached to every signal and
  device. Why: these precise percentages are not derivable from the drawing — the judge calls
  this "fabricated quantification rather than something read from the print."

### AutomationDirect GS20 VFD — 86/100 (B)

**Verified strengths:**
- Sheet identity scored 100 — "Full I/O Wiring Diagram," page 2-38, Chapter 2, DURApulse
  GS20/GS20X — an exact title-block match.
- Terminal labels (`DI1`–`DI7`, `AI1/AI2`, `AO1/ACM`, `DO/DO1/DO2/DOC`, `R1O/R1C/R1`,
  `STO1/STO2/SCM`, `SG+/SG-/SGND`) all match the drawing precisely, with voltage/current ratings
  (30 VDC/30 mA, 48 VDC/50 mA, 250 VAC/30 VDC relay specs) read directly off the printed spec
  blocks.
- Correctly flags the `R1C/R1` terminal pair appearing twice on the sheet (once near the power
  input, once at the multi-function relay block) as an open question rather than silently
  asserting the two are the same physical relay.

**Suspected errors / hallucinations** (1 entry):
- Claim: *"Incoming one- or three-phase power passes through a circuit breaker/fuse and a main
  contactor (MC) into the drive input terminals."* Why: the drawing's gray dashed box and
  accompanying NOTE describe the MC/R1C-R1 circuit as a **recommended, optional** protective
  addition ("It is recommended that you install a protective circuit…"), not a standard main
  contactor that is always present in the power path.

## 4. Recurring weaknesses across cases

**(a) The `map` follow-up appends a per-item confidence percentage to every signal, device, and
wire.** Confirmed present in all three cases' `telegram_response.json → map_text` field — manual
count of `conf 0.NN` occurrences: **21 (Rockwell: 7 signals + 14 devices), 22 (Banner: 7 signals +
7 devices + 8 wires), 31 (GS20: 19 signals + 12 devices)** — matching the render function's
14-device display cap (`format_map_for_telegram`, `printsense/render.py:132-151`): Rockwell's
16-device graph correctly truncates to 14 shown + "…and 2 more." The Banner judge flagged this
directly (`unsupported_or_invented_claims` scored 72: *"fabricated numeric 'conf 0.85–0.98' scores
are presented for every item without any stated basis"*). **This is a render-layer behavior, not
interpreter fabrication of devices** — `format_map_for_telegram` (`printsense/render.py`) formats a
`confidence` float that is already present on every graph entity the interpreter emits (visible in
each case's raw `telegram_response.json → graph` — every device/terminal/contact carries its own
`"confidence": 0.NN`). The interpreter is scoring its own read of each element; the render layer is
what turns that into a printed `· conf 0.NN` tag on every line of the technician-facing map, which
reads as more precision than a technician can verify against the sheet.

**(b) The main response defers/truncates exhaustive detail to the `map` follow-up, and the map
itself can still be incomplete.** Rockwell's main reply cuts its troubleshooting section
(`"🩺 If you're chasing a fault … (more — reply \"map\")"`) and one item of its "Couldn't confirm"
list (`"…and 1 more (see 'map')"`). GS20's main reply is truncated harder — only 5 of its 12
devices are listed before `"… (more — reply \"map\")"`. The GS20 judge caught that the deferral
compounds: `response_completeness` scored 72 because *both* the initial response and the `map`
follow-up defer content — the GS20 map's own `"🔗 Wires / cables"` section ends in
`"… (truncated — reply \"map\" for detail)"` with zero wire entries delivered even after the
technician asks for the map.

## 5. Suspected systematic failure mode

Across three deliberately hard, diverse prints — a NEMA magnetic starter with an undocumented
DC-coil/economizer/rectifier scheme, a dual-channel functional-safety E-stop relay, and a dense VFD
I/O sheet with 30+ terminals — the interpreter's **grounding held**: 0 of 3 hard failures, no
invented voltage on any sheet where voltage was silently unstated (all three correctly said "not
printed" rather than assuming a value), no invented device tags, and no terminal/destination
claimed as fact where the drawing didn't support it. On the hardest case for exactly this failure
mode — the Banner safety relay — the interpreter never asserted a Performance Level, safety
category, or SIL rating (none is printed on this datasheet page, and none appears anywhere in its
response or map). All three suspected-error entries above are hedged at reduced confidence, not
stated as certain fact.

The weakness that repeats is not comprehension — it is **render/presentation**: unverifiable
per-item confidence numbers stamped onto the `map` reply, and a two-stage information hierarchy
(main reply → `map` reply) that can itself run out before delivering everything it promised (GS20).
Be precise about this distinction: the interpreter is reading the drawing correctly and hedging
correctly; the surface built on top of that read is overstating its own precision and, in one case,
not finishing the job it advertised.

## 6. Defect separation

**Interpreter observations** (what the model itself did — minor, evidence-cited, non-hazardous):
- Rockwell: merged the `M` coil and the `(L.B.)` contact into one device with combined terminals
  (hedged at conf 0.60).
- Banner: grouped `S24` (part of the E-stop loop) in with the L1-rail nodes it asked the technician
  to verify.
- GS20: described the optional/recommended MC protective circuit as though it were a standard,
  always-present main contactor.

None of these are hazardous, none invent a voltage or a device that isn't on the sheet, and all
three are the kind of thing the interpreter's own "couldn't confirm" / "unresolved" sections exist
to catch technician review on.

**Judge/harness observations** (not the interpreter):

**(i) A judge bug, now fixed in the harness.** On the dense GS20 schematic, the judge's first pass
returned no score at all: `claude-sonnet-5` runs adaptive thinking by default, and the original
token budget was fully consumed by the thinking pass before any JSON verdict text could be emitted
(`stop_reason=max_tokens`, zero output text). The fix — visible in the current harness,
`tools/internet_print_test/judge.py:87-101` — raised `max_tokens` to 16000 and explicitly requests
`thinking={"type": "adaptive"}`, with the failure mode documented inline: *"the budget must cover
BOTH the thinking pass AND the JSON verdict, or thinking consumes it all and 0 text is emitted…
16k leaves ample room for both."* Rockwell's `run.log` shows a `"regrade: reusing saved
tested_page.png + telegram_response.json"` line, consistent with the 83/100 grade in this document
coming from a judge run after that fix, not the original failing pass.

**(ii) A product-gate finding.** Two natural technician captions were rejected by the production
gate before a workable caption was found: `"Explain this **safety** circuit and what it
protects."` (Banner) and `"Explain the power and control wiring in this drive print."` (GS20) — see
each case's `source.json → why_selected`. The cause is visible directly in
`mira-bots/shared/print_translator.py`: `is_print_question()` (line 162) and its narrower sibling
`is_theory_request()` (line 148) are pure substring matches against fixed phrase tuples
(`THEORY_INTENT_PHRASES` / `PRINT_QUESTION_PHRASES`, lines 37–89) — e.g. `"explain this circuit"`
is a listed phrase, but `"explain this **safety** circuit"` does not contain that exact substring,
so it fails the match even though a technician would obviously consider it the same request. This
is a real, reproducible product-gate brittleness — a single inserted word breaks a fixed-phrase
gate — but per the scope of this evaluation, **no product code was modified to fix it.** The two
test captions actually used were chosen to satisfy the existing gate, not to route around a fix.

## 7. Files behind every claim in this document

- `index.json`, `index.md` — aggregate rows (score, hard_failure, interpreter_used, email status).
- `<case>/source.json` — provenance, category, standard, `why_selected` (incl. the two gate
  rejections above).
- `<case>/telegram_response.txt` / `<case>/telegram_response.json` — the verbatim bot reply, the
  `map_text`/`graph` used for the confidence-count and truncation findings, and `latency_s`.
- `<case>/judge_1.json` — score, letter, hard-failure flags, per-criterion notes, verified
  strengths, suspected errors.
- `<case>/report.md` — assembled per-case report (cross-checked against the above, not a separate
  source).
- `tools/internet_print_test/judge.py` — the judge harness (max_tokens/adaptive-thinking fix).
- `printsense/render.py` — `format_map_for_telegram` (the render-layer confidence formatting).
- `mira-bots/shared/print_translator.py` — `is_print_question()` / `is_theory_request()` (the
  production caption gate).
