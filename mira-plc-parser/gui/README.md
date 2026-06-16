# MIRA Namespace Builder — desktop-style GUI

A self-contained, **offline** front end for the MIRA PLC Parser. It reads a `*.report.json` produced
by `mira-plc-parser analyze` and helps you turn a customer's raw PLC tags into a **standardized UNS /
ISA-95 namespace** — and export it toward the CESMII **i3X** API shape.

```
Namespace:  enterprise / site / area / line  /  asset / signal   (set the top, the parse fills the rest)

  PLC tag         Type   Proposed UNS path                                   Conf.
  VFD_Frequency   REAL   enterprise/site1/area1/conveyorcell/vfd/frequency   HIGH   <- yellow
  Motor_Run       BOOL   enterprise/site1/area1/conveyorcell/motor/motor_run MEDIUM <- yellow
  Start_PB        BOOL   enterprise/site1/area1/conveyorcell/start_pb        LOW
```

- **Namespace prefix** (top) — type your Enterprise / Site / Area / Line **once**; every path
  recomputes live (and is slugged to UNS segments as you type).
- **Per-tag path** — the parser fills the lower levels it can see: the `asset` (from asset candidates
  / tag-name prefixes) and a standardized `signal` leaf (from VFD signal roles, else the slugged tag).
- **Yellow rows** — the parser's confident proposals (HIGH = standardized signal **and** an asset
  matched; MEDIUM = one of the two). LOW rows sit directly under the line for you to refine.
- **Export** — UNS JSON (tag → path + segments), **i3X JSON** (CESMII `objectInstances` with a
  `parentId` hierarchy + the `objectTypes` they reference), or CSV. All client-side; nothing leaves
  the machine.

## Run it

Single static file — no build, no server, no network, no LLM.

```
start gui/index.html                       # Windows: just open it
python -m http.server -d gui 8902          # or serve locally, then open http://127.0.0.1:8902/index.html
```

It boots with an embedded sample so the window works immediately. **File ▸ Open report.json…** loads a
real report you generated with:

```
mira-plc-parser analyze C:\path\to\export.L5X --out C:\reports --format json
```

The packaged desktop app (`MIRA-Tag-Mapper.exe`, see `../MIRA-Tag-Mapper.spec` + `PACKAGING.md`) opens
this same page in a chromeless window.

## Standards

- **UNS / ISA-95** — `enterprise/site/area/line/asset/signal`, lowercase slugged segments.
- **CESMII i3X** (https://www.i3x.dev, https://github.com/cesmii/API) — the i3X export emits
  `objectInstances` (each ISA-95 level a container, each tag a leaf) linked by `parentId`, plus the
  minimal `objectTypes` they reference. Field names follow the public i3X OpenAPI for interoperability;
  the backend equivalents live in `mira_plc_parser/uns.py` and `mira_plc_parser/i3x.py`.

## Styling

The window chrome (beveled gray panels, title bar, resizable frame, sunken fields) is an **original
CSS implementation** of the classic desktop look — no third-party or proprietary stylesheet is copied,
and nothing is fetched from the network. If you'd rather use a ready-made classic skin, the
MIT-licensed `98.css` / `7.css` libraries are drop-in alternatives; this keeps its own CSS so it stays
dependency-free.

## Contract with the parser

The GUI consumes a stable subset of the report JSON: `uns_prefix`, `uns_candidates[].{tag, data_type,
asset, signal, confidence, segments}`, plus `controller` / `vendor`. That contract is guarded by
`tests/test_gui_contract.py` so a parser change can't silently break the GUI.
