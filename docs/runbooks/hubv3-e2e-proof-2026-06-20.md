# HubV3 Offline→Hub — End-to-End Proof & Corrected Workflow (2026-06-20)

Investigation of "Review Queue does nothing." Root cause was an **empty export**, not a
Hub bug. This corrects `hubv3-testing-guide.md` (Test A/B) and `HubV3-User-Test-Sheet.pdf`,
both of which were wrong.

## What was actually wrong with the user's bundle

`machine_context_bundle.zip` (exported 17:24) had `counts.candidates=0`, grade **"Skeleton"** (9),
`review.json.decisions=[]`. Three compounding mistakes:

1. **Wrong import button.** The generic "Import Files" runs `extract.extract()` which only
   handles docs (`.pdf/.docx/.csv/.xlsx/.txt`). It returns `warnings:["unsupported document type: .st"]`
   for PLC files. PLC tags come from a **separate CCW path** (`ccw.parse_project`, route `_ccw_import`,
   accepts `.st/.stf/.iecst/.ccwmod/RmcVariables`).
2. **Wrong file.** A `.ccwsln` is a CCW *solution-pointer*, 0 signals. The real source is the
   `.st` program.
3. **Never accepted.** `build_bundle` only exports extractions with `status=="accepted"`. Importing
   gives `pending` candidates; you must Accept them before Export or the bundle ships empty.

Plus environment noise: two app windows were open — the one exported from was **system Python**
(`...Python312\pythonw.exe`) with no `[docs]`/parser deps, so the GS10 PDF errored.

## What was proven to work (real artifacts)

| Link | Method | Result |
|---|---|---|
| Offline CCW parse | `ccw.parse_project()` on `Micro820_v4.1.9_Program.st` | **63 signals** (controller `2080-LC20-20QBB`) |
| Offline CCW parse | + `MbSrvConf_v4.xml` | **+39 signals** (Modbus) |
| Offline export | accept all → `build_bundle` → `zip_bytes` | `machine_context_bundle_REAL.zip`, 102 accepted, **101 UNS**, scorecard 52 "Described" |
| **Hub contract** | Hub's `parseBundle()` (origin/main) on the real zip via bun | **102 extractions, 101 UNS — PASS** |

Real bundle: `C:\Users\hharp\Downloads\machine_context_bundle_REAL.zip`.
Build script: `%TEMP%\build_real_bundle.py`. Parse check: `%TEMP%\run_parse.ts` (bun).

## Architecture facts (origin/main; local tree is 201 behind — read prod via `git show origin/main:`)

- **Two ingest shapes** decided by content-type in `POST /api/contextualization/import`:
  - `multipart/form-data` (bundle zip) → `importFromBundle` → creates a **Project** +
    `ctx_sources` + `ctx_extractions`. **No batch row. Does NOT appear in the Review Queue.**
    Parses **inline** (no host-local worker dependency).
  - `application/json` (intake contract) → `importFromContract` → `upsertBatch` →
    `contextualization_batches` → **Review Queue**. Telegram uses this; offline-client migration to
    it is "P5-pending."
- **No UI calls `/import`.** The bundle-import button does not exist. Review Queue page
  (`review/page.tsx`) only *lists* `/batches`; its empty-state ("Import an offline bundle…") is a
  false promise — there's no control there.
- **The only contextualization upload UI** is the Project page "Upload source" (`/{id}/sources`),
  single files `.st/.xml/.pdf/.csv/.l5x/.aoi` — **not `.zip`** — and it spawns a **host-local**
  `workers/ctx_parse_worker.py` ("true for the demo: Hub+worker on the laptop"); may not run on prod VPS.
- **"Promote" stages, doesn't publish.** `/{id}/promote` writes `kg_entities`
  (`approval_state=proposed`) + a pending `ai_suggestions`. Go-live (`proposed→verified`) is a
  separate human approval. Refuses to overwrite already-`verified` rows.

## Corrected offline workflow (Test A, the right way)

1. Use ONE app window — the **venv** one: `MIRA-pr2068\mira-contextualizer\.venv\Scripts\pythonw.exe -m mira_contextualizer`.
2. New profile.
3. **CCW import** (not "Import Files") → `MIRA\plc\Micro820_v4.1.9_Program.st` → ~63 signals.
4. CCW import → `MIRA\plc\MbSrvConf_v4.xml` → +39.
5. **Accept** the signals (Extracted Signals → accept).
6. Export Bundle → now carries 102 accepted signals.

## Still unproven (needs prod Hub session)

- `POST /api/contextualization/import` (multipart) inserts + returns 201 on **prod**.
- `/promote` then human-approve actually flips `kg_entities` to `verified` on **prod**.
- Whether the bundle lands usefully given it creates a **Project**, not a Review-Queue batch.

## Open product gaps (separate from the user error)

1. No UI to import a bundle (API-only). Belongs on the **Projects** page (bundle → project), with a
   redirect to the new project's review.
2. Review Queue empty-state copy falsely promises bundle import — fix the string.
3. `hubv3-testing-guide.md` + `HubV3-User-Test-Sheet.pdf` Test A/B are wrong — correct them.
