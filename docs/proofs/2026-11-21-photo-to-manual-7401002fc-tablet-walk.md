# Photo-to-manual tablet walk on staging 7401002fc (2026-11-21)

**Build:** staging deploy run 44916396069, head 7401002fc (PR #5726 merged), created 2026-11-21T14:55:04Z. This was still the latest staging deploy after the walk.
**Device:** Samsung SM-X510 tablet, Chrome, app-staging.factorylm.com/v3, already signed in.
**Project:** "QA BRAVO 7401002fc walk Nov 21": General, no machine, 0 documents at creation. One project for the whole run, nothing deleted.
**Timings:** upper bounds taken from the screenshot waits, not measured latencies.

| Step | Prompt / action | Result | Screenshot |
|---|---|---|---|
| 1 | Attach the archived GS11N-20P2 nameplate photo (captured 2026-11-07T21:46:56Z) | Attached | `2026-11-21_photo-to-manual-7401002fc-photo-attached_android.png` |
| 2 | "Find me the manual" (sent 16:39:44Z) | Within 20 s, one confirmation: "Is this a AutomationDirect GS11N-20P2?" Buttons: Use its manuals / Not this. Model read correctly. | `...-one-confirmation_android.png` |
| 3 | Tap "Use its manuals" (16:40:11Z) | Within 30 s: "DURApulse GS10 Drive User Manual, Rev C is ready in Sources. PDF page 26 shows coverage for GS11N-20P2." plus a link. No second prompt. | `...-ready-line-link_android.png` |
| 4 | Tap the link | The source viewer opened MIRA's saved copy: gs10usermanual.pdf, page 26 of 454, file 6da4f531. That page is the 230V 1-phase table, which has a GS11N-20P2 column. | `...-viewer-page26_android.png` |
| 5 | New chat: "Find me the manual for AutomationDirect GS11N-20P2" (16:42:05Z) | Within 25 s: cites p. 26 and p. 385, plus the same ready line and link. The link opens p. 26. The project already held the manual, so this tested reuse, not a fresh lookup. | `...-typed-model-answer_android.png`, `...-typed-viewer-page26_android.png` |
| 6 | New chat: "Find me the manual for AutomationDirect GS11N-20P25" (16:43:49Z) | The answer is correct: the manual covers GS11N-20P2 and GS11N-20P5, but GS11N-20P25 is not listed, and MIRA asks which model was meant. The project-wide ready line for GS11N-20P2, with its link, still shows under this thread, and it survives a reload. | `...-lookalike-gs11n-20p25_android.png`, `...-lookalike-after-reload_android.png` |

## Why the ready line shows under the look-alike thread

The notebook detail route (`mira-hub/src/app/api/equipment-notebooks/[id]/route.ts`) computes `manualSearch` from the notebook's confirmed identity, not from the thread. The photo turn confirmed this project as GS11N-20P2, so the line names GS11N-20P2 in every thread of the project. Nothing matched GS11N-20P25 to the manual. Whether that line should be hidden under a thread about a different model is an open owner decision.

## Not exercised in this walk

- A GS11N-20P25 lookup in a fresh project with no sources (device etiquette allows one test project per run).
- The signed-out link path (#5744).
- A verified manual whose project copy cannot be searched (acceptance 3).
