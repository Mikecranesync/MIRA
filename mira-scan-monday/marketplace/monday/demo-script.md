# MIRA Scan — 90-Second Demo Video Script

For the marketplace listing video. Total length 80-95 seconds; YouTube unlisted, link supplied in the listing form. Voiceover written for a male/female in mid-30s; trim aggressively, no fluff.

## Hook (0:00 – 0:08)

**Visual:** Hands holding a phone, photographing a grimy nameplate on a factory pump motor. Tight close-up.
**Voiceover:** "Maintenance teams spend twenty minutes per asset typing nameplate data into their CMMS. Most of it gets fat-fingered."

## Problem (0:08 – 0:20)

**Visual:** Cut to a monday.com board with rows of partially-filled asset items. Empty cells in the voltage / HP / serial columns. A user typing slowly into a cell, autocorrect changing the model number to something nonsensical.
**Voiceover:** "And that's just the easy nameplates. The corroded ones, the ones in tight spots — those just stay blank. Forever."

## Reveal (0:20 – 0:35)

**Visual:** Cut back to the phone. Open monday.com mobile, a board item, then the MIRA Scan panel. Tap **Scan plate**.
**Voiceover:** "MIRA Scan turns the phone you already carry into a structured-data shortcut. Inside any monday.com item, tap one button."

**Visual:** Phone camera framing the nameplate. Tap to capture.

## Demo (0:35 – 1:05)

**Visual:** Beat — half a second of a small spinner. Then the AssetCard pops in with: Make=Yaskawa, Model=GA500, Voltage=480V, HP=10, RPM=1750. Confidence badge green. One field highlighted yellow (confidence flag).
**Voiceover:** "GPT-4o Vision reads the plate. Make, model, serial, voltage, horsepower, RPM, frame — structured fields, with a confidence score so you know where to double-check."

**Visual:** Pinch-tap the yellow field, fix it inline.
**Voiceover:** "Edit anything that looks off. We never write to your board until you tap save."

**Visual:** Tap **Save to monday item**. Brief animation, board reloads behind, columns now populated.
**Voiceover:** "One tap. Seven fields. Your asset registry just got better."

## Proof (1:05 – 1:20)

**Visual:** Switch to MiraChat panel below the asset card. Type "What does fault F004 mean on this drive?" Reply renders with a citation `[Source: Yaskawa GA500 — §6.4 Overcurrent]`.
**Voiceover:** "When MIRA recognizes the equipment, the panel turns into a Q&A on the actual OEM manual — cited answers, not hallucinated paragraphs."

**Visual:** Quick screen flash of the manual-not-found state finding a real OEM PDF, then a check appearing.
**Voiceover (faster):** "And when MIRA doesn't have your manual yet, it finds it on the open web — automatically."

## CTA (1:20 – 1:30)

**Visual:** Cut to the marketplace listing page. **Install** button highlighted.
**Voiceover:** "MIRA Scan. Free during beta. Install from the monday.com marketplace."

**End card:** factorylm.com/scan logo + "Try standalone at app.factorylm.com/scan/"

## Production notes

- **Length target:** 90 seconds. Hard cap 120.
- **Resolution:** 1920×1080, 30fps.
- **Audio:** music bed at -22 LUFS, voiceover at -14 LUFS, ducking automatic.
- **Captions:** burn in English captions at the bottom (Monday reviewers may watch muted).
- **B-roll style:** clean, modern, fast cuts (≤2s per shot during the demo block).
- **No claims that aren't true.** "Twenty minutes" must be backed by a real customer interview or replaced with our own measured baseline. "GPT-4o Vision" is true. "Cited answers" is true (we ship citations as of PR #418).
- **Voiceover script word count:** ~165 words. Read at ~120 wpm = 82 seconds, leaving room for visual beats.

## Hosting

- Upload to YouTube as **unlisted**.
- Title: `MIRA Scan — AI-extract equipment specs from a photo`
- Description: short version of the listing long description; link to `app.factorylm.com/scan/`.
- Thumbnail: Shot 03 (the populated AssetCard) with a phone hand entering frame from the right.
- Paste the unlisted URL into the Monday Developer Center listing form's "Demo video" field.
