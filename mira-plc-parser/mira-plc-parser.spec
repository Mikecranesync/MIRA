# PyInstaller spec for the MIRA PLC Parser standalone CLI.
# Build:  pyinstaller mira-plc-parser.spec   (see PACKAGING.md)
# Produces a single self-contained dist/mira-plc-parser.exe (Windows) — no Python install needed
# on the target machine. The parser is stdlib-only; the one bundled data file is the reused,
# single-source CSV tag parser from the gateway tree (loaded by path, not duplicated in git).

# -*- mode: python ; coding: utf-8 -*-

import os

# The CSV parser reuses the gateway's tag_csv.py (zero-import, dual-Py) by path instead of
# duplicating it. Ship that single source as bundled data so the onefile exe stays portable;
# csv_tags._tag_csv_path() resolves it from sys._MEIPASS/vendor_tag_csv/ when frozen.
_tag_csv_src = os.path.join(
    SPECPATH, "..", "ignition", "webdev", "FactoryLM", "api", "diagnose", "tag_csv.py"
)

a = Analysis(
    ["mira_plc_parser/__main__.py"],
    pathex=[],
    binaries=[],
    datas=[(_tag_csv_src, "vendor_tag_csv")],
    hiddenimports=[],
    hookspath=[],
    runtime_hooks=[],
    excludes=[],
    noarchive=False,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.datas,
    [],
    name="mira-plc-parser",
    console=True,        # CLI tool — keep the console window
    onefile=True,        # one self-contained executable
    upx=False,
    strip=False,
)
