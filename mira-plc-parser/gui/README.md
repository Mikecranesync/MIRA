# MIRA Tag Mapper — desktop-style GUI (proof)

A self-contained, **offline** front end for the MIRA PLC Parser. It reads a `*.report.json`
produced by `mira-plc-parser analyze` and presents the classic two-pane mapper:

```
Customer tags  (left)   ⇄   Analyzer roles  (right)
                 swap        auto-suggestions highlighted yellow
```

- **Left pane** — the customer's tags (`tag_dictionary` from the report).
- **Right pane** — the analyzer's signal roles (Output frequency, Output current, Fault code, …).
- **Yellow rows** — the parser's auto-suggestions (`vfd_signal_candidates`), pre-linked for the
  user to confirm or change. "Accept all suggestions" confirms them in one click.
- **Map ⇄** — select a tag and a role, then map them by hand.

## Run it

It's a single static file — no build, no server, no network, no LLM.

```
# just open it:
start gui/index.html            # Windows
# or serve locally if your browser blocks file:// JSON loads:
python -m http.server -d gui 8901   # then open http://127.0.0.1:8901/index.html
```

It boots with a small embedded sample so the window works immediately. Use **File ▸ Open
report.json…** (or the toolbar button) to load a real report you generated with:

```
mira-plc-parser analyze C:\path\to\export.L5X --out C:\reports --format json
```

## Styling

The window chrome (beveled gray panels, title bar, resizable frame, sunken list fields) is an
**original CSS implementation** of the classic desktop look — no third-party or proprietary
stylesheet is copied, and nothing is fetched from the network. If you'd rather use a ready-made
classic skin, the MIT-licensed `98.css` / `7.css` libraries are drop-in alternatives; this proof
keeps its own CSS so it stays dependency-free.

## Contract with the parser

The GUI consumes a stable subset of the report JSON: `tag_dictionary[].{name,data_type}`,
`vfd_signal_candidates[].{name,detail}`, and `controller` / `vendor`. That contract is guarded by
`tests/test_gui_contract.py` so a parser change can't silently break the GUI.

## Toward a real Windows window

This proof runs in a browser. To ship it as an actual resizable OS window with no browser visible,
wrap this same HTML in a thin shell — e.g. **pywebview** (MIT, pure-Python) or **Tauri** — both load
the local file and give a native, resizable, minimize/maximize window. The HTML/CSS/JS does not
change; only the host does. That packaging step is the next phase (sibling to the CLI's PyInstaller
`.exe` foundation in `../PACKAGING.md`).
