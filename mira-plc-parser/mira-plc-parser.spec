# PyInstaller spec for the MIRA PLC Parser standalone CLI.
# Build:  pyinstaller mira-plc-parser.spec   (see PACKAGING.md)
# Produces a single self-contained dist/mira-plc-parser.exe (Windows) — no Python install needed
# on the target machine. The parser is stdlib-only, so there are no hidden imports or data files.

# -*- mode: python ; coding: utf-8 -*-

a = Analysis(
    ["mira_plc_parser/__main__.py"],
    pathex=[],
    binaries=[],
    datas=[],
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
