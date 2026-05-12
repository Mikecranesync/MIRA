# MIRA Scan — Marketplace Screenshot Shotlist

5 PNGs at 1280×800 (Monday's listing requirement). Capture from the live deployed app inside a real monday.com workspace, NOT mockups. Save into this directory as `01-...png` through `05-...png`.

## Shot 01 — `01-panel-idle.png`
- **Composition:** monday.com item view, MIRA Scan panel visible on the right side, panel showing the **Scan plate** + **Upload photo** buttons, no scan yet.
- **Decoration:** the item title should be a recognizable industrial equipment name (e.g., "Conveyor Drive Motor — Line 2"). Some other columns visible (location, status, technician) populated to make the board look real.
- **Why:** the marketplace tile pulls this as the hero. First impression = "this lives inside monday."

## Shot 02 — `02-scan-in-progress.png`
- **Composition:** phone-camera capture overlay over a real industrial nameplate. iPhone-style camera UI is fine.
- **Decoration:** the nameplate visible in the camera frame — recommend Yaskawa GA500 or Allen-Bradley PowerFlex 525. Use Mike's actual scans from the test corpus.
- **Why:** shows the scan moment. This is the "magic" frame.

## Shot 03 — `03-asset-card-populated.png`
- **Composition:** the AssetCard component populated post-scan with: Make=Yaskawa, Model=GA500, Voltage=480V, HP=10, RPM=1750, Hz=60, Frame=NEMA 4. Confidence badge visible, a couple of fields highlighted yellow (low confidence) to demonstrate the "review before save" UX.
- **Why:** shows what comes back from the AI. Demonstrates the editable + review-able UX (vs blind auto-write).

## Shot 04 — `04-mira-chat-with-citation.png`
- **Composition:** the MiraChat panel with a question + answer. Question: "What does fault F004 mean on this drive?" Answer: a 2-sentence reply followed by a `[Source: Yaskawa GA500 — §6.4 Overcurrent]` citation. Asset card still visible at top.
- **Why:** shows the grounded-chat differentiator. The citation is the trust signal.

## Shot 05 — `05-saved-to-monday.png`
- **Composition:** monday.com item with the columns now populated. Toast/banner visible: "Saved 7 fields to monday.com item ✓". Asset card faded/dismissed in background.
- **Why:** closes the demo loop. Shows the "money shot" — your monday data is now better.

## Capture process

```bash
# From the mira-scan-monday/ root, with the dev frontend + backend running:
cd frontend && npm install && npm run dev
# In another terminal:
cd backend && uvicorn main:app --reload

# Use Playwright (per Mike's Windows-friendly Chrome screenshot pattern,
# from feedback memory):
chrome --headless=new --window-size=1280,800 \
  --screenshot=../marketplace/monday/screenshots/01-panel-idle.png \
  http://localhost:5173/

# Or: capture from the real production iframe inside a monday.com test
# board. Phone shots (Shot 02) require an actual phone — recommend
# iPhone 15 with Mike's standard demo bench setup.
```

## Decoration / brand consistency

- Use FactoryLM's blue accent (#0066FF) for any in-app highlights
- Keep the MIRA glyph / logo in panel header on every shot
- monday.com chrome should be visible (panel pane edges, board name) so reviewers can tell it's an embedded app
- Avoid: bright fluorescent factory backgrounds, cluttered desks, anything off-brand
