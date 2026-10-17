# Alarm-card fidelity run — capture sheet (for Mike)

**What this is for.** The alarm card only ships if MIRA's photo step copies alarm text off a
screen exactly: tags character for character, cut-off fields left cut off, and wrapped lines
kept together. This run measures that on a **made-up** alarm screen, so no real plant data is
involved. Spec: `docs/superpowers/specs/2026-10-12-alarm-reasoning-design.md` §2 and §9.

**Cost:** about 10 photo reads with `gpt-5.4-mini`, a few cents in total. The declared cap is
**$1.00**. The turn records hold the provider and model for each photo but **not** its tokens or
cost, because the photo step stores those as empty (#4398). Until that is fixed, the session reports
the number of reads and the model, not a dollar figure.

**When:** after the alarm-card PR (PR B) is deployed to **staging**. Do not use production.

## Steps

1. On a laptop, open `tools/alarm-fidelity/alarm-page.html` in a browser and go full screen
   (F11). It shows a red alarm list. **The whole list must be on screen.** The bottom line should
   end `=y.CTL+07-K4.1-6.` If it is cut off, zoom out (Ctrl and minus, or Cmd and minus on a
   Mac) until that line is fully visible; check by eye, since screen size, browser bars and zoom
   differ between laptops. (In the 2026-10-13 rehearsal the fail-safe list was about 970 pixels
   tall and a 900-pixel-tall screen cut off its last alarm; one zoom step fixed it on that laptop.)
   A cut-off alarm counts as a miss even when MIRA reads everything visible correctly,
   and on its own it drops the tag score to about 89 %, below the 90 % pass mark. Check the same
   on the `#rtd` and `#history` screens.
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
     rows, readings in parentheses). 3 photos of that screen:
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

## Scoring another reader the same way (for example, a general AI chat)

To compare MIRA with another reader on the same synthetic screens:

1. Give the other reader the same photo of `alarm-page.html` and ask it to "transcribe this alarm
   list exactly, one screen line per line". Use the synthetic page only, never a real plant
   screen.
2. Save each reply as a text file named `<id>.<screen>.txt`, where `<screen>` is `failsafe`,
   `rtd` or `history` (for example `chatgpt-1.failsafe.txt`), all in one folder. Paste the whole
   reply. If the reply puts the list in a code block, only the lines inside the block are scored,
   so a sentence before or after it does no harm.
3. Run `cd mira-hub && npx vite-node ../tools/alarm-fidelity/transcripts-to-run.ts <folder> > run.json`,
   then `npx vite-node ../tools/alarm-fidelity/score-run.ts run.json`. The same three measures
   apply: exact tags, invented characters in cut-off fields, and correct grouping.
