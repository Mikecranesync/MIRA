# PyInstaller spec for the MIRA Tag Mapper desktop app.
#
# Builds ONE windowed Windows executable (no console flash) that bundles the offline GUI
# (gui/index.html) and the stdlib launcher (gui/desktop.py). No third-party runtime deps, so
# there is nothing else to ship -- the .exe runs on a stock Windows 10/11 (which already has the
# Edge runtime the launcher uses for its app window).
#
# Build (on Windows):
#   pip install pyinstaller
#   pyinstaller MIRA-Tag-Mapper.spec
#   -> dist\MIRA-Tag-Mapper.exe   (copy anywhere; needs nothing installed)
#
# PyInstaller is not a cross-compiler: build the Windows .exe on Windows.

block_cipher = None

a = Analysis(
    ["gui/desktop.py"],
    pathex=[],
    binaries=[],
    datas=[("gui/index.html", "gui"),
           ("gui/factorylm-tokens.css", "gui")],   # -> _MEIPASS/gui/* (shared style tokens)
    hiddenimports=[],
    hookspath=[],
    runtime_hooks=[],
    excludes=[],
    cipher=block_cipher,
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.zipfiles,
    a.datas,
    [],
    name="MIRA-Tag-Mapper",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    runtime_tmpdir=None,
    console=False,          # windowed app -- no console window
    icon=None,
)
