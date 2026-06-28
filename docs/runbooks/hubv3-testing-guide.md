# HubV3 Testing Guide

How to test what HubV3 shipped (prod `v3.29.0`, 2026-06-20): **upload evidence → Hub stages it → human reviews → approve → it goes live.** Three ingest surfaces (offline app, Hub, Telegram) + the automated suite.

Companion runbooks: `hubv3-rollback.md` (when it breaks), `garage-conveyor-demo.md` (the scripted P8 demo). PRD: `docs/plans/2026-06-20-hubv3-contextualization-intake-prd.md`.

> **Verified status at ship:** Test A (offline app + extraction) and Test D (the suite) were run directly. Tests B and C need an authed Hub session — execute them, they are not yet confirmed-passing on prod.

---

## TEST A — Offline Contextualizer (local desktop app)

Start it (the venv carries the PDF/OCR deps):
```
cd /c/Users/hharp/Documents/MIRA-pr2068/mira-contextualizer && .venv/Scripts/python.exe -m mira_contextualizer
```
An Edge app-window opens on localhost.

| Step | Do | Expect |
|---|---|---|
| A1 | File → New profile → "Garage Demo / Micro820 Conveyor" | empty profile + identity editor |
| A2 | Import Files → `MIRA\plc\Micro820_v4.1.9_Program.st` | status **done**, ~62 signals in Extracted Signals |
| A3 | Import Files → `MIRA\plc\MbSrvConf_v4.xml` | Modbus tags added, no dup of A2 |
| A4 | Import Files → `Downloads\gs10usermanual.pdf` | **done** (not "error") — wait ~1 min, 453 pages |
| A5 | Click UNS Map / Fault Catalog (ISO 14224) / Parameters (UCUM) / Scorecard | populated, not empty |
| A6 | **Export Bundle** (full) | `machine_context_bundle.zip` downloads |
| A7 | **Export Bundle** → sanitized mode | smaller zip; opening it shows **no `documents/*.json`** raw payloads, but `evidence.json` + `uns.json` present |

**Pass = A4 done (not error) + A6/A7 both produce zips + A7 has no raw docs.**

Common failures: A4 "error: No module named 'pdfminer'" → the app was launched without the `[docs]` extra; use the venv path above. CCW `.ccwsln` imports as "other" with 0 signals → that's a solution-pointer file; import the `.st` / `MbSrvConf.xml` instead.

---

## TEST B — Hub import → review → approve (the core "Hub owns truth" flow)

On **https://app.factorylm.com/hub** (logged in):

| Step | Do | Expect |
|---|---|---|
| B1 | Find **Contextualization** / **Import Review** in the sidebar | nav link present (P7) |
| B2 | Import the `machine_context_bundle.zip` from A6 | creates an **import batch**, status `proposed` |
| B3 | Open the **Review Queue** | staged signals / UNS / faults / params, all **pending**, shared labels (Sources, Evidence, Extracted Signals, Fault Catalog, Parameters, UNS Map, Scorecard) |
| B4 | Re-import the **same** zip | **no duplicate** sources (sha256 dedup) |
| B5 | **Approve** the batch | staged items publish; `kg_entities` `proposed → verified`, available to MIRA |
| B6 | Re-import after approve | does **not overwrite** approved data — skip reason shown, not silent |

**Pass = B2 creates a batch, B4 no dup, B5 publishes, B6 no overwrite.** This is the whole product thesis.

---

## TEST C — the guarantees ("train before deploy")

- **Nothing auto-promotes:** between B2 and B5, everything reads `proposed` — MIRA cannot answer from it yet.
- **Asset matching:** existing conveyor asset in your tenant → B2 stages **under it** (strong match); brand-new machine → **draft asset proposal**; ambiguous → **needs confirmation**.
- **Telegram (if wired):** send a nameplate photo + caption to the bot → lands in the **same Review Queue** as `proposed` (ingest_route=telegram), does **not** bypass to the KB.

---

## TEST D — automated proof (fast, no UI)

The §6 acceptance matrix (re-run anytime):
```
cd /c/Users/hharp/Documents/MIRA-pr2068/mira-hub && bun run test src/lib/contextualization/
```
Expect green: asset-matcher (11), acceptance-matrix (11), approval (12), intake-contract (8), bundle-import (5), promote (6), routes.

Scripted end-to-end demo: **`docs/runbooks/garage-conveyor-demo.md`**.

---

## What "broken" looks like → rollback

| Symptom | Layer | Action |
|---|---|---|
| `/hub/api/contextualization` **500s** (not 401) | DB / migration | runbook **ROLLBACK B** (`056` down-SQL or Neon `br-square-cake-ah54ijqu`) |
| Hub won't load / bad bundle after deploy | deploy | **ROLLBACK A** — redeploy `checkpoint/pre-hubv3-2026-06-20` |
| Code must leave main | git | **ROLLBACK C** — revert the merge |

Full procedure: `docs/runbooks/hubv3-rollback.md`. A healthy prod returns **401** on `/hub/api/contextualization` (alive + auth-gated, tables present).
