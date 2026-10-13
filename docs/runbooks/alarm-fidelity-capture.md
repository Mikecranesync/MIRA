# Alarm-card fidelity run — capture sheet (for Mike)

**What this is for.** The alarm card only ships if MIRA's photo step copies alarm text off a
screen exactly: tags character for character, cut-off fields left cut off, and wrapped lines
kept together. This run measures that on a **made-up** alarm screen, so no real plant data is
involved. Spec: `docs/superpowers/specs/2026-10-12-alarm-reasoning-design.md` §2 and §9.

**Cost:** about 10 photo reads with `gpt-5.4-mini`, a few cents in total. The declared cap is
**$1.00**. The session reads the actual spend afterwards from the turn records.

**When:** after the alarm-card PR (PR B) is deployed to **staging**. Do not use production.

## Steps

1. On a laptop, open `tools/alarm-fidelity/alarm-page.html` in a browser and go full screen
   (F11). It shows a red alarm list.
2. On the Pixel, open the FactoryLM app on **staging** and make a test notebook named
   `alarm fidelity 2026`.
3. Take **10 photos** with the in-app camera (the LOOK photo button), one per message. Send
   each one with **no question**, or with "what does this alarm mean":
   - 4 photos of the default screen (the fail-safe list):
     - 2 straight on;
     - 1 angled about 30°;
     - 1 with an overhead light glaring on the screen.
   - Add `#rtd` to the end of the address to switch screens. 3 photos of that screen:
     - 1 straight on;
     - 1 angled;
     - 1 from about 1.5 m away.
   - Change the ending to `#history` for the alarm-history screen (one line per alarm, coloured
     rows, readings in brackets). 3 photos of that screen:
     - 1 straight on;
     - 1 angled;
     - 1 from about 1.5 m away.
   - In every photo the screen must fill at least half the frame.
4. Do not delete or retake any photo once it is sent. Every photo counts, including bad ones.
5. Tell the session the notebook name. It scores the photos and posts the result on the
   alarm-card PR.

## What "pass" means

Across all 10 photos, all three must hold:

- **Exact tags:** at least 90 % of the tags (`=y.CTL+07-K4.1-2`, …) are copied exactly.
- **No invented characters:** a cut-off field such as `08:14:3…` is never filled in (for
  example `08:14:35`). Even one is a fail.
- **Lines kept together:** at least 90 % of the alarms are grouped back into the right entry.

If it fails, the session (not MIRA on its own) runs the same 10 photos through MIRA's OCR
reader as a manual step. You do not need to take new photos. The session reports both results
with a recommendation; nothing switches over automatically.

## For the session (scoring)

1. Read each photo's stored `screen_text_lines` with a **read-only staging** query. Never query
   production. The lines are in `evidence_item.capture_meta`, on the visual sessions whose
   `metadata->>'notebook_id'` is the test notebook.
2. Write them to `run.json` as
   `{"photos":[{"id":"p1","screen":"failsafe"|"rtd"|"history","lines":[...]}]}`.
3. Run `cd mira-hub && npx vite-node ../tools/alarm-fidelity/score-run.ts run.json`. It exits
   0 on a pass and 1 on a fail.
4. Post the printed table on the alarm-card PR.
