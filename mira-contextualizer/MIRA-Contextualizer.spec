# PyInstaller spec — FactoryLM Contextualizer (offline Windows desktop app).
#
# ONEDIR (not onefile): the document stack (pypdfium2 native lib, Pillow, pdfminer) plus an optional
# bundled Tesseract engine + tessdata are large and extract slowly under onefile. Onedir also lets the
# Inno installer lay the tree down once. Build from the mira-contextualizer/ directory:
#
#     pip install -e ".[docs,packaging]"      # in mira-contextualizer/ (pulls pyinstaller + doc deps)
#     pyinstaller MIRA-Contextualizer.spec
#     dist\FactoryLM-Contextualizer\FactoryLM-Contextualizer.exe
#
# OCR engine (optional, for scanned PDFs / images): drop a portable Tesseract install at
#     mira-contextualizer/vendor/tesseract/{tesseract.exe, tessdata/...}
# before building; the spec bundles it to <app>/tesseract/ and app.py wires pytesseract to it. Without
# it, OCR degrades gracefully (digital PDF/Word/Excel/text still work). See PACKAGING.md.
#
# Frozen-path notes (see memory pyinstaller-frozen-path-gotchas):
#  - entry app.py uses ABSOLUTE imports; __main__ uses `from mira_contextualizer.app import main`.
#  - gui/ is shipped as data and resolved from sys._MEIPASS at runtime (dest name "gui").
import os

from PyInstaller.utils.hooks import collect_all, collect_submodules

HERE = os.path.abspath(os.getcwd())
PARSER_ROOT = os.path.normpath(os.path.join(HERE, "..", "mira-plc-parser"))
VENDOR_TESS = os.path.join(HERE, "vendor", "tesseract")

datas = [("mira_contextualizer/gui", "gui")]
binaries = []
hiddenimports = collect_submodules("mira_plc_parser")

for pkg in ("pdfminer", "pypdfium2", "PIL", "openpyxl", "docx", "pytesseract", "et_xmlfile"):
    try:
        d, b, h = collect_all(pkg)
        datas += d
        binaries += b
        hiddenimports += h
    except Exception:  # a doc lib may be absent on the build host; OCR/format degrades gracefully
        pass

# Bundle a portable Tesseract engine if the builder dropped one into vendor/tesseract/.
if os.path.isdir(VENDOR_TESS):
    datas.append((VENDOR_TESS, "tesseract"))

a = Analysis(
    ["mira_contextualizer/app.py"],
    pathex=[HERE, PARSER_ROOT],
    binaries=binaries,
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    runtime_hooks=[],
    excludes=["tkinter", "numpy.tests"],
    noarchive=False,
)
pyz = PYZ(a.pure, a.zipped_data)

exe = EXE(
    pyz, a.scripts, [],
    exclude_binaries=True,
    name="FactoryLM-Contextualizer",
    console=False,
    disable_windowed_traceback=False,
)
coll = COLLECT(exe, a.binaries, a.zipfiles, a.datas, name="FactoryLM-Contextualizer")
