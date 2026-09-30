# #4143 photo provenance: A/B on the production answer model

**Question:** does the PHOTO LABEL TEXT note make a photo identification say what it read off the label, and stop inventing a device type?

## Method
- **Model:** Groq `openai/gpt-oss-120b`, called exactly as the notebook chat route calls it (`temperature 0.3`, `max_tokens 800`, `reasoning_effort low`). Free tier; no paid inference.
- **System prompt:** captured from the real route composition in a general (no manual) turn, through the route test seams. Arm A is that prompt with the note removed; arm B is the full prompt. That is the only difference between arms (asserted in `ab.py`).
- **Prompt capture:** `prompts.json` holds the exact system prompts the route produced at this PR's head, captured through the route test seams (the `systemPromptFor` harness in `mira-hub/src/capabilities/__tests__/photo-provenance.route.test.ts`, with the two observations below). `ab.py` builds arm A by removing the note block and asserts that is the only difference.
- **User message:** built exactly as `buildManualUserContent` does with a photo observation and no chunks.
- **Observations:** transcribed from the two fixture photos. The fixture text does not appear in the note.
- **Reps:** 2 cases × 2 arms × 5 reps = 20 calls.

## Result (`rescore-strict.json`, scored by script; see the scorer note below)

| case | metric | A (main) | B (note) |
|---|---|---|---|
| TP700 nameplate | answer says what the label reads ("The nameplate reads/shows …") | 0/5 | **5/5** |
| TP700 nameplate | wrong device type on the first line (drive, terminal block, controller, PLC, inverter, relay) | 5/5 | **2/5** |
| bearing box label | states 32906X | 5/5 | 5/5 |
| bearing box label | attributes it to the label | 5/5 | 5/5 (quotes the label text verbatim) |

**The pass bar was declared before the run:** B attribution ≥ 9/10, TP700 "controller" ≤ 1/5, and no regression on 32906X. Against the raw answers, it is met.
- **Scorer note, first scorer (`ab-results.json` `score`):** it over-credited arm A. "(the "1P" code on the nameplate)" counted as attribution, and it counted only the word "controller", which missed arm A's "drive" and "terminal block".
- **Scorer note, strict rescore:** it under-credits "The label prints the text: …" on the bearing, which is explicit attribution. The table above uses the strict score for TP700 and the verified raw answers for the bearing.

**Residual:** the device type is still wrong in 2/5 TP700 answers ("controller", "terminal block"). The note reduces invented device types; it does not eliminate them.

**Caveat:** the observation text here is a clean transcription. Production observation text comes from the LOOK vision pass and may differ, so the staging re-run after deploy is the real check.
