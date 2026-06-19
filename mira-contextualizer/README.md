# mira-contextualizer

Offline-first Windows desktop app that ingests **any** document and **deterministically**
contextualizes a factory — proposing UNS paths, roles, and i3X objects — then exports a portable
bundle for import into MIRA Hub. **No internet, no LLM** in the reasoning path.

Plan: `C:\Users\hharp\.claude\plans\offline-factory-contextualizer.md`. Composes the stdlib-only
`mira-plc-parser` engine.

## Status — P0 (scaffold) ✅
- Local **SQLite** store mirroring the Hub contextualization schema (`store.py`).
- Stdlib **HTTP API** mirroring the Hub routes (`server.py`): projects, sources, extractions,
  decisions, UNS export.
- **Engine adapter** (`engine.py`) running the deterministic PLC pipeline (same call the Hub worker
  makes) — PLC exports (L5X/CSV) extract today; document formats land in **P1**.
- **Desktop launcher** (`app.py`) — Edge app-mode window on `127.0.0.1`, per-user SQLite DB.
- Unified **GUI** (`gui/index.html`) — two modes (PLC Tag Mapper / Documents), project list,
  upload, accept/reject review, UNS export.

## Run from source
```
python -m mira_contextualizer        # opens the desktop window (needs sibling mira-plc-parser/)
```

## Test
```
python -m pytest mira-contextualizer/tests -q
```

## Roadmap
P1 heavy doc extraction (PDF/Word/Excel/scan OCR → Document IR) · P2 deterministic contextualization
rules · P3 Mode-B review GUI · P4 portable Factory Context Bundle · P5 PyInstaller onedir + Inno
installer · P6 Hub `POST /api/contextualization/import`.
