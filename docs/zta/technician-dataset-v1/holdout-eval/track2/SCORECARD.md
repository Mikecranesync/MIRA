# Technician v1 — Track 2 Blinded Hold-out Eval Scorecard (evidence-in-prompt, 2026-07-28)

**Formal verdict (plan §7: tuned ≥ base with correct citations on ≥20/25): NOT MET —
judged tuned 10 / base 14 / tie 1.**

## Run integrity

- Same 25 reserved PF40 records as Track 1 (prompt-set identity `fe5eb9ab…b991c37e`), with
  each record's withheld evidence APPENDED to the user turn in the trained Pattern-A shape
  (`--evidence-in-prompt`, Track-2 request hash `5749dc59…` bound into its own single-use
  authorization).
- Run 1 burned its eval auth on an httpx ReadTimeout in the base-serverless phase ($0 —
  no deployment created); transport errors now retry like 500s. Run 2 valid:
  50 calls, deployment `dep_CdVDVXBRb3mwTZco24afj` `stopped_verified=True` (benign 409
  cascade), blinded outputs `sha256:0db27ce2…b025dbca`.
- Judge protocol frozen BEFORE generation: `judge_panel_protocol_track2.md`
  sha256 `3587002e…37b11fba`. Panel scores locked BEFORE unsealing:
  sha256 `b20e066e…235a29e9`. Tuned side in the blind: left 13 / right 12.
- Authorizations consumed: `techv1-t2-eval-20260728-0cfb` (run 1, burned),
  `techv1-t2-eval-20260728-run2-6b87` (run 2), `techv1-t2-ep-20260728-4510` (endpoint).

## Result

| Axis | tuned | base | tie |
|---|---|---|---|
| **Panel majority (final)** | 10 | **14** | 1 |
| Judge 1 — cited-lookup accuracy | 9 | **16** | 0 |
| Judge 2 — no-overreach beyond evidence | **23** | 1 | 1 |
| Judge 3 — safety doctrine | 5 | **17** | 3 |

## Reading

The two tracks tell ONE coherent story about what $4 of v1 training bought:

- **The discipline transferred almost perfectly.** With evidence in the prompt, the tuned
  model restates the governing fact exactly and adds NOTHING — 23/25 wins on the
  no-overreach lens. The base model padded 23+ records with firmware-variation caveats,
  invented causes (DC-bus capacitor failure, mechanical obstruction), and unsupported
  signal specifics.
- **But it answers bare.** The tuned answers typically drop the explicit citation wrapper
  ("per the pack, p.93") and the safety/next-step elaboration. Judges rewarded base's
  attributed, LOTO-framed answers on the cited-lookup and safety lenses even while it
  overreached — richness beat purity 2 lenses to 1.
- **Combined v1 lesson (both tracks):** the evidence contract taught *what not to say*
  flawlessly (Track 1 grounding 18-0-7; Track 2 no-overreach 23-1-1) but the training
  answers are too terse to win on usefulness/citation/safety framing. The v2 recipe is
  concrete: keep the contract, make every answer carry (1) the explicit citation phrase,
  (2) the safety floor sentence, (3) the what-to-do-next line — in BOTH the A and B
  patterns. That's a dataset-shape edit, not new architecture.

## Spend

Track 2: ~5-min dedicated deployment + 25 serverless base calls (< $1 actual; $5-cap
declaration, teardown verified both runs, zero orphans).
