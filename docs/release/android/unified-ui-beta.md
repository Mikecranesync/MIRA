# Unified FactoryLM interface (beta) on Android — how to test it

**What it is.** The shared FactoryLM shell (FLM-UI-4000 Tasks 1–8) rendering your real
notebook conversation inside the existing FactoryLM Android app. Same sign-in, same
notebooks, same send path, same cited answers and safety stops as the current
conversation screen; only the shell changes (Ask/Work switch, machine chip, project
drawer, source viewer). It ships **over the air** — no new APK.

## 1. Install the app (once)

Plug the Pixel into the laptop (USB debugging on, accept the prompt) and run:

```
powershell -ExecutionPolicy Bypass -File tools\android\install-latest.ps1    # Windows
bash tools/android/install-latest.sh                                          # macOS/Linux
```

It downloads the latest signed APK from updates.factorylm.com, verifies the sha256 that
`latest.json` declares, installs with `adb install -r` (keeps your data), and launches the
app. Or open **https://updates.factorylm.com/download** on the phone and tap Download →
Install (allow installs from Chrome once). You need versionCode **10** (1.1.0) or later.

## 2. Sign in, then switch the update channel

Sign in first — updates are only served to a signed-in app (a signed-out app shows
"Update server error (401)", which is correct behaviour). Then **More → About & updates →
channel: canary** (production once we promote). Tap **Check now** → *Update ready* →
**Restart**. About & updates shows the running bundle (`1.1.2-…` carries the unified UI).

## 3. Turn the unified interface on

**More → Chat style → "Try the unified interface (beta)".** Open any notebook. The
Notebook tab now shows the shared shell. To go back: More → Chat style → "Use classic
chat" (one tap, no release needed).

## 4. What to try, and what to send back

- Ask a question on a machine notebook; check the machine chip (confirmed vs unconfirmed)
  and the evidence pill above the answer.
- Tap a citation chip — the existing source viewer opens at the cited page.
- Try a safety phrase ("bypass the interlock") — the answer must be a red **Stop** alert
  with no citation chrome.
- Attach a photo / PDF with **+** (the existing flows run).
- Hardware Back with the drawer open must close the drawer, not leave the notebook.
- Enter sends; Shift+Enter (Gboard) inserts a newline.

Report: a screenshot, the notebook name, what you did, what you expected. Fixes ship OTA:
open the app → Check now → Restart.

## Known limits in this build

- Pending attachments are informational in the composer; photo/PDF go through the existing
  flows, which upload and ask themselves.
- The composer's machine control does not scan on this surface; the notebook binding owns
  the machine (Assets tab still scans).
- Work mode has no live diagnostic run yet.
