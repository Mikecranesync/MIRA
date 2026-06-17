# Packaging — standalone Windows executable

The MIRA PLC Parser CLI is **stdlib-only** (no LLM, no network, zero runtime dependencies), so it
packages into a single self-contained Windows `.exe` that runs on a machine with **no Python
installed**. We use [PyInstaller](https://pyinstaller.org/).

## Build (on Windows)

```powershell
# from mira-plc-parser/
pip install -e ".[packaging]"        # installs the parser + PyInstaller
pyinstaller mira-plc-parser.spec     # reproducible build from the checked-in spec
```

The result is `dist\mira-plc-parser.exe` — copy it anywhere; it needs nothing else.

One-liner equivalent (no spec file) if you ever need it:

```powershell
pyinstaller --onefile --console --name mira-plc-parser mira_plc_parser/__main__.py
```

## Why it packages cleanly

- **Stdlib-only.** The parser uses only `xml.etree`, `re`, `json`, `argparse`, `pathlib` — no
  third-party runtime deps, so there are **no hidden imports** to declare and no native libraries to
  bundle.
- **One bundled data file.** The CSV parser reuses the gateway's single-source
  `ignition/webdev/FactoryLM/api/diagnose/tag_csv.py` (zero-import, dual-Py) by path instead of
  duplicating it. The spec ships that one file as bundled data under `vendor_tag_csv/`, and
  `parsers/csv_tags._tag_csv_path()` resolves it from `sys._MEIPASS` when frozen — so the exe stays
  portable without forking the parser. No other data files.
- **`--onefile`** therefore yields one small, portable executable.

> **Entry point note.** The spec builds from `mira_plc_parser/__main__.py`, which uses an
> **absolute** import (`from mira_plc_parser.cli import main`). PyInstaller runs the entry script as
> a package-less top-level `__main__`, so a relative import (`from .cli import …`) raises
> "attempted relative import with no known parent package". The absolute import works in both the
> frozen exe and `python -m mira_plc_parser`.

## Using the built executable

```powershell
mira-plc-parser.exe analyze C:\path\to\export.L5X --out C:\reports
mira-plc-parser.exe analyze C:\path\to\tags.csv --format json --out C:\reports
```

It writes `<stem>.report.md` and/or `<stem>.report.json` into `--out`. Exit codes:
`0` parsed · `3` closed vendor project file (prints export instructions) · `1` unrecognized / error.

## Notes

- **PyInstaller is not a cross-compiler.** Build the Windows `.exe` *on* Windows, the Linux binary
  *on* Linux, etc. CI that targets Windows artifacts must run on a Windows runner.
- The built `.exe` is a per-platform binary and is **not committed** to the repo — only the spec and
  these instructions are. Build it in CI or locally on demand.
- `dist/`, `build/`, and `*.spec`-generated artifacts are build output; keep them out of commits.
