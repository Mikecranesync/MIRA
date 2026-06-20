# Packaging — FactoryLM Contextualizer (offline Windows app)

Two artifacts: a **PyInstaller onedir** (the runnable app tree) and an **Inno Setup installer** (a
real Windows program with shortcuts + file associations). Everything runs offline.

## 1. Build the app (PyInstaller, onedir)

From `mira-contextualizer/`:

```
py -3.12 -m venv .venv && .venv\Scripts\activate
pip install -e ".[docs,packaging]"        # doc-extraction stack + pyinstaller
pyinstaller MIRA-Contextualizer.spec
```

Output: `dist\FactoryLM-Contextualizer\FactoryLM-Contextualizer.exe` (double-click → chromeless
Edge app window on 127.0.0.1; per-user SQLite at `%LOCALAPPDATA%\MiraContextualizer\store.db`).

The spec bundles: the GUI (`gui/` → `_MEIPASS/gui`), the sibling `mira_plc_parser` engine, and the
document stack (pdfminer.six, pypdfium2, Pillow, python-docx, openpyxl, pytesseract).

### Onedir, not onefile
The native libs + (optional) OCR models extract slowly under onefile and the installer lays the tree
down once anyway. Keep `COLLECT` (onedir).

## 2. OCR engine (optional — scanned PDFs / images)

Digital PDF/Word/Excel/CSV/text extraction needs no OCR. To read **scanned** pages and **images**,
bundle a portable Tesseract before building:

1. Get a portable Tesseract (Apache-2.0) — `tesseract.exe` + `tessdata\eng.traineddata`.
2. Place it at `mira-contextualizer\vendor\tesseract\` (so `vendor\tesseract\tesseract.exe`).
3. Rebuild. The spec copies it to `<app>\tesseract\`; `app._configure_bundled_tesseract()` points
   pytesseract at it on launch. Without it, OCR degrades gracefully (a warning, no crash).

## 3. Build the installer (Inno Setup)

```
ISCC.exe installer.iss      # -> Output\FactoryLM-Contextualizer-Setup.exe
```

Gives Start-menu + desktop shortcuts, a per-user "Open with" association for `.l5x`, and an
uninstaller. Per-user install (`PrivilegesRequired=lowest`) — no admin needed on locked-down plant
laptops.

## 4. Frozen verification (do NOT skip — see memory pyinstaller-frozen-path-gotchas)

The source tests cannot catch frozen-only failures. After building, on a **clean machine/dir with no
Python and no repo**:

```
FactoryLM-Contextualizer.exe --version          # entry import works
FactoryLM-Contextualizer.exe                     # window opens; create a project
```

Then in the app: upload a PLC `.L5X` (tags appear) and a PDF (chars/candidates appear), accept a few,
**Export Bundle** → confirm a valid `*-context-bundle.zip`. `tests/test_packaging.py` pins the
frozen-path resolution (gui dest name + absolute entry import) as a build-time guard.
