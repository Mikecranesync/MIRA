# MIRA Tag Mapper — packaging the downloadable Windows app

The Tag Mapper ships as **one Windows executable** a customer downloads and double-clicks — no
Python, no install, no setup. It is the offline GUI (`index.html`) plus a stdlib launcher
(`desktop.py`) bundled by PyInstaller.

## What the customer gets

- A single file: **`MIRA-Tag-Mapper.exe`** (tens of MB).
- Double-click → a chromeless desktop window opens (Microsoft Edge "app" mode, which is built into
  Windows 10/11). No browser tabs, no address bar — it looks like a normal program.
- Fully **offline**: it serves its own files on a private `127.0.0.1` port and makes no network
  calls. No telemetry, no LLM, nothing leaves the machine.

## System requirements

- Windows 10 or 11 (x64). The Edge runtime that powers the app window is present by default.
- No Python and no other install required.
- (If Edge is somehow absent, the launcher falls back to the default browser.)

## Build it locally (on Windows)

```powershell
# from mira-plc-parser/
pip install pyinstaller
pyinstaller MIRA-Tag-Mapper.spec
# -> dist\MIRA-Tag-Mapper.exe
```

Run it: `dist\MIRA-Tag-Mapper.exe`. It boots with a sample; use **File ▸ Open report.json…** to
load a real report produced by `mira-plc-parser analyze ... --format json`.

Run from source without packaging:

```powershell
python gui/desktop.py      # from the mira-plc-parser/ directory
```

## Build it in CI (the downloadable release)

`.github/workflows/build-tag-mapper.yml` builds the exe on a Windows runner:

- **On demand:** Actions ▸ *Build MIRA Tag Mapper* ▸ Run workflow → download `MIRA-Tag-Mapper.exe`
  from the run's artifacts.
- **As a release:** push a tag `tag-mapper-v0.1.0` → the workflow builds the exe and **attaches it
  to the GitHub Release**, giving a public download URL anyone can fetch.

```powershell
git tag tag-mapper-v0.1.0 && git push origin tag-mapper-v0.1.0
```

PyInstaller is not a cross-compiler, so the Windows `.exe` is built on Windows (the workflow uses
`windows-latest`). The binary is **never committed** to the repo — only the spec, launcher, and
this doc are; the artifact comes from CI or a local build.

## Selling it ("anybody can buy it and download it")

The exe is the product; distribution + payment is a thin layer on top:

1. **Host the download** behind a purchase — e.g. a Gumroad / Lemon Squeezy / Stripe Payment-Link
   product whose delivery is the release `.exe` (or a private link to the CI artifact).
2. **License** — ship a short EULA next to the exe and pick the product license (this repo's code
   is MIT/Apache; a commercial EULA can wrap the distributed binary). Optional licensing/activation
   is a later add-on, not required to sell a download.
3. **Code-sign** the exe (an Authenticode cert) so Windows SmartScreen doesn't warn buyers — the
   single most worthwhile polish before charging money. The CI step that signs can be added when a
   cert is available.

## Notes / limitations

- The window currently shows the app's own classic chrome inside the Edge app frame; fine for v1.
- No auto-update yet (re-download to upgrade).
- macOS/Linux builds are possible from the same launcher (Edge/Chromium app mode exists there too)
  but are out of scope for this Windows-first milestone.
