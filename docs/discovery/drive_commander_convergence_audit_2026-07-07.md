# Drive Commander / DriveSense — Product Convergence Audit

**Date:** 2026-07-07
**Method:** repo-wide read-only archaeology (5 parallel agents) against **`origin/main`** (VERSION ~3.101.0). The local checkout is on the stale `feat/hub-live-signal-polish` branch (3.58.x) — **do all work against `origin/main`; the working tree lacks most of the drive-pack stack.**
**Governing decision:** ADR-0025 (`docs/adr/0025-drive-intelligence-packs-and-drive-commander.md`) — one sellable product = read-only VFD diagnostic tool; the sellable atom is a per-family **drive pack** (OEM manual → cited, structured diagnostic layer). GTM-renamed **DriveSense** (docs on unmerged branches).

---

## 1. Executive summary

**The product is ~80% built and merged — the gaps are wiring, not green-field.** The whole pack pipeline (extractor → scientific grader → registry → discovery-bridge → loader/resolver/`ask.py` → Telegram `/drive` → engine fast-path) is on `main`, tested, with a deliberate human-gated promotion boundary. Live telemetry fusion works on the Ignition/kiosk surfaces. Nameplate photo → structured JSON works.

What's missing is **six connective bridges** between finished pieces, plus one dead-letter and two "second, weaker" duplicate systems that should converge:

1. **OCR dead-letter** — scanned drive manuals are quarantined (`needs_ocr`) and never processed → they can never become a pack.
2. **Hub asset-chat can't answer from packs** — the customer-facing "train + chat" web surface is the *only* surface the pack fast-path doesn't reach, and it runs a separate, weaker TS answer brain.
3. **Telegram→Hub evidence intake is a verified dead-end** (auth + shape + env all broken).
4. **Slack PDF intake writes to a non-citable store** (a second ingestion system).
5. **Hub candidate-review "accept" doesn't build/grade a pack** (status-only).
6. **`tag_entities.expected_envelope` empty & unwired** — the seam between pack and live analog assessment (Stage 5), and ADR-0025's flagship `assess_snapshots` isn't in main.

Closing #1 and #2 delivers the smallest cohesive end-to-end Drive Commander product on the surfaces customers actually use.

---

## 2. Inventory table (condensed — full detail in agent transcripts)

| # | Piece | Path(s) | Status | Reuse | Stage |
|---|---|---|---|---|---|
| **CORE (built, merged on main)** |
| C1 | Pack schema/loader/resolver/cards/ask | `mira-bots/shared/drive_packs/` | ✅ active | reuse as-is | 1,3,4 |
| C2 | Manual→JSON extractor (#2503) | `tools/drive-pack-extract/extractor.py` + `cite_integrity.py` | ✅ active | reuse | 1 |
| C3 | Scientific grader (#2505/#2515) | `tools/drive-pack-extract/grading/` | ✅ active (CI gate) | reuse | 1 |
| C4 | Manual source registry + update-candidate (#2507) | `tools/drive-pack-extract/registry/` | ✅ active | reuse | 1 |
| C5 | Discovery→candidate bridge | `mira-crawler/drive_pack_bridge.py` | ✅ active (default-OFF `MIRA_DRIVE_PACK_BRIDGE`) | reuse | 1→pack |
| C6 | Hub candidate-review queue (mig 062) | `mira-hub/src/lib/drive-pack-suggestion.ts`, `/api/suggestions/drive-pack-candidate` | ✅ active but decide=status-only | **repair** | 3 |
| C7 | Packs shipped | `packs/durapulse_gs10` (v2), `packs/powerflex_525` | ✅ | reuse | 1 |
| **INTAKE** |
| I1 | Golden citable ingest | `mira-hub/src/lib/local-upload.ts` → v2 Inbox → `knowledge_entries` | ✅ active | reuse (the destination) | 2 |
| I2 | Headless token door | `POST /api/uploads/folder` | ✅ active | reuse | 2 |
| I3 | MiraDrop watcher | `tools/mira-drop-watcher/` | ✅ active | reuse/wrap | 2 |
| I4 | Telegram media/PDF intake | `mira-bots/telegram/bot.py` (+ `contextualization_intake.py`) | ⚠️ half-built dead-end; dark in prod | **repair** | 2 |
| I5 | Slack PDF intake | `mira-bots/slack/pdf_handler.py` | ⚠️ writes to OW KB (non-citable) | **replace** | 2 |
| I6 | Nameplate/photo vision+OCR | `mira-bots/shared/workers/{vision,nameplate}_worker.py` | ✅ active (chat-only) | reuse/wrap | 2 |
| I7 | Photo ingest API + proposal | `mira-core/mira-ingest/`, `photo_ingest_worker.propose_from_nameplate` | ✅ active | reuse | 2 |
| **EXTRACTION / OCR** |
| E1 | Local PDF→text | `mira-crawler/ingest/pdf_extract.py` (pdfplumber→pypdf, #2514) | ✅ active; no OCR by design | reuse | 1 |
| E2 | Tika-OCR extractor (unwired) | `mira-crawler/ingest/converter.py::extract_from_tika` / `extract_from_pdf_with_fallback` | ⚠️ dormant; `mira-tika` not in prod ingest path | **wrap/repair** | 1,2 |
| E3 | Ingest pipeline | `mira-crawler/tasks/full_ingest_pipeline.py` | ✅ active (main) | reuse | 1 |
| E4 | kb_growth cron + `needs_ocr` quarantine (#2532) | `mira-crawler/cron/kb_growth_cron.py` | ✅ detection; **NO drain worker** | **repair** | 1↔2 |
| E5 | Docling | `mira-docling/` (empty), `mira-core/scripts/docling_adapter.py` | ❌ dead (removed 2026-06-06) | ignore/replace | — |
| **ANSWER / LIVE** |
| A1 | Supervisor engine + pack fast-path | `mira-bots/shared/engine.py::process()` | ✅ engine active; fast-path on branch | reuse + **merge** | 4 |
| A2 | Python RAG | `mira-bots/shared/neon_recall.py::recall_knowledge` | ✅ active | reuse | 4 |
| A3 | Python citation enforcement (H4) | `mira-bots/shared/citation_compliance.py` | ✅ strong | reuse | 4 |
| A4 | Hub TS answer brain | `mira-hub/.../assets/[id]/chat/route.ts`, `manual-rag.ts`, `llm/cascade.ts` | ✅ active; **no pack path, weak grounding** | **repair/replace** | 4 |
| A5 | Live snapshot decode/fusion | `mira-bots/shared/live_snapshot.py`, `ask_api/`, `mira-pipeline/ignition_chat.py` | ✅ active | reuse; extract tables→packs | 5 |
| A6 | Machine-memory bridge (3 impls) | `ask_api` block, `ignition_chat` preamble, Hub `machine-memory.ts` | ✅ active (3 separate paths) | reuse but **converge** | 5 |
| A7 | `assess_snapshots` (ADR flagship) | cited in ADR-0025; **absent from main** `live_snapshot.py` | ❌ missing/unmerged | **build/verify** | 5 |

---

## 3. Product-stage map (existing code per ADR-0025 stages)

- **Stage 1 — Manual Pack Builder:** ✅ COMPLETE on main. E1/E3 (text) → C2 (extract) → C3 (grade) → C4 (registry/update) → manual promote to `packs/`.
- **Stage 2 — Asset Intake:** 🟡 PARTIAL. Citable door (I1/I2/I3) + nameplate vision (I6/I7) exist, but Telegram (I4) and Slack (I5) intake are broken/divergent, and **scanned PDFs dead-end (E4)**.
- **Stage 3 — Service Pack Resolver:** ✅ mostly. `resolve_pack` (text) + `resolve_pack_from_vision` (photo) work. Hub review "accept" (C6) doesn't trigger build.
- **Stage 4 — Technician Chat:** 🟡 PARTIAL. Pack answers reach Telegram/Slack/kiosk/Ignition but **NOT Hub asset-chat (A4)**; Hub grounding is weak by default.
- **Stage 5 — Live Drive Commander:** 🟡 PARTIAL. Live fusion works (A5), but 3 duplicate impls (A6), triplicated decode tables, empty `expected_envelope`, and missing `assess_snapshots` (A7).

---

## 4. Reuse / repair / replace decision table

| Decision | Items |
|---|---|
| **Reuse as-is** | C1–C5, C7, I1–I3, I6, I7, E1, E3, A1(engine), A2, A3, A5 |
| **Repair (small wire)** | C6 (accept→build), I4 (repoint Telegram to `/api/uploads/folder`), E2/E4 (OCR bridge), A4 (Hub cite-or-gap + pack path) |
| **Replace / converge** | I5 (Slack→citable path), A6 (3 machine-memory impls→1), triplicated decode tables → pack data |
| **Build / verify** | A7 (`assess_snapshots`), `tag_entities.expected_envelope` population |
| **Ignore / delete** | E5 (docling), `manualslib_scraper` OCR, `/api/documents/upload` demo stub |

---

## 5. Smallest viable end-to-end Drive Commander flow

The prompt's target flow **already works today on Telegram** (all on main):
`upload manual → candidate JSON (C2) → grade (C3) → human-promote → /drive question → cited answer`.

The smallest flow that closes the **highest-value gap** is to make that same answer reachable on the **customer-facing Hub**:

```
Manual already promoted to packs/  →  Hub asset-chat question about that drive
   →  route.ts pack pre-check (resolve_pack + answer_question)
   →  cited deterministic pack card  (fallback to RAG only if no pack match)
```

Second smallest, unblocking intake breadth:
```
Scanned drive manual  →  0-char extract  →  Tika/vision OCR  →  text  →  candidate pack
```

---

## 6. Missing bridges (the "gaps" — ranked)

1. **OCR bridge** (E4↔E2): `needs_ocr` is a terminal dead-letter with no drain. Parts exist (`extract_from_tika`, `vision_worker` Tesseract); `mira-tika` isn't in the prod ingest path. **Scanned VFD manuals can never become packs.**
2. **Hub asset-chat → pack answer** (A4): the pack fast-path reaches every surface *except* the one customers use to train + chat. Requires either merging the fast-path branch AND adding a TS→pack call, or delegating Hub chat to the Python engine.
3. **Two answer brains** (A1 vs A4): Python (Together, strong H4 grounding) vs Hub TS (Gemini, BM25-only, H4 off by default). The customer-facing brain is the weaker one — a beta-trust risk.
4. **Telegram intake dead-end** (I4): session-vs-bearer auth mismatch + expects a zip not a raw file + `HUB_IMPORT_URL/TOKEN` unset in prod. Fix = repoint at `/api/uploads/folder`.
5. **Slack duplicate ingestion** (I5): PDFs land in Open WebUI collections (non-citable per tenant-scoping rule) instead of the system-of-record.
6. **Hub candidate accept ≠ build** (C6): accepting an `ai_suggestions` drive_pack_update only records intent; the extract/grade is a separate CLI run.
7. **`expected_envelope` empty + `assess_snapshots` missing** (A7): the pack↔live-analog seam. Most-cited technical gap across 3 docs; ADR-0025's isolation-diagnosis logic isn't in main.
8. **Triplicated decode tables**: Python `live_snapshot.py`, TS `gs10-display.ts`, Ignition WebDev. ADR-0025 wants tables → pack data (one source).
9. **Hub inline citation chips** dropped in `AssetChat.tsx` (only the trace panel renders `sources`).

*Deliberate non-gap:* promotion candidate→live is 100% manual (no `promote.py`) — by design (trust doctrine). Keep it.

---

## 7. Recommended PR sequence (small, reviewable, ordered)

1. **Merge the pack fast-path branch** `feat/gs10-hub-asset-chat-drivepack` → main (verify green). Gets deterministic pack answers on all *Python* surfaces.
2. **Close the OCR bridge**: on 0-char extract, fall through to `converter.extract_from_tika`; add `mira-tika` to the ingest path; add a small worker/cron to drain `needs_ocr` back through OCR. (This is also residual #2 from the ops-hardening round.)
3. **Repoint Telegram intake** off the dead §2 envelope onto `/api/uploads/folder` (token auth, raw file, citable). Removes a duplicate ingestion path.
4. **Wire Hub asset-chat → pack answer**: smallest bridge is a pack pre-check in `route.ts` (a thin read-only `resolve_pack`+`answer_question` — either a small Python endpoint or a TS reader over the same `pack.json`). Decide: delegate vs port.
5. **Enforce cite-or-gap on Hub by default** (H4 parity) — flip/replace `MIRA_ENFORCE_APPROVED_ASK` default or delegate to the engine. Beta-trust blocker.
6. **Converge Slack intake** onto the Hub citable path (drop the OW-direct write).
7. **Wire Hub candidate accept → run extractor+grader** (or document the CLI handoff explicitly in the review UI).
8. **Stage 5**: populate `tag_entities.expected_envelope`; build/verify `assess_snapshots`; dedupe decode tables into pack data.

---

## 8. Runbooks / workflows to create or update

- **New:** `docs/runbooks/ocr-needs-ocr-drain.md` — how scanned manuals get OCR'd and re-queued.
- **New:** `docs/runbooks/wire-a-surface-to-drive-packs.md` — the pattern for reaching pack answers from any surface (so the Hub wire is repeatable).
- **Update:** reconcile the **Drive Commander → DriveSense** naming across docs; commit ADR-0025 (currently untracked).
- **Update:** `mira_difference_engine_offering.md` — mark "any machine" framing as narrowed by ADR-0025.
- **Update:** Container Map + compose comments still list dead `mira-docling:5001`.

---

## 9. Risks & anti-patterns to avoid

- ❌ Building a **third ingestion system** or **third answer brain** — converge onto the citable path (I1/I2) and one engine.
- ❌ Auto-promoting packs — preserve the manual candidate→live gate (trust doctrine).
- ❌ Wiring Hub to the weaker brain — either delegate to Python or reach H4 + pack parity in TS.
- ❌ Depending on `assess_snapshots` before it's verified in main (doc-vs-build gap).
- ❌ Working in the stale local branch — everything real is on `origin/main`; the `.claude/worktrees/drivepack-*` copies are pre-merge snapshots.
- ❌ Reintroducing docling. Use Tika for OCR.
- ⚠️ The discovery→candidate bridge (C5) is **default-OFF** and depends on the (recently-fragile) prod manual-ingest path — verify it's actually producing candidates before relying on it.

---

## 10. Exact next PR prompt

> On `origin/main`, close the OCR dead-letter so scanned drive manuals can become packs. In `mira-crawler/cron/kb_growth_cron.py`, when `_is_zero_char_extraction` fires, do NOT terminally quarantine as `needs_ocr` — instead route the PDF through `mira-crawler/ingest/converter.py::extract_from_tika` (add a running `mira-tika` service to the ingest path), and only quarantine if Tika also returns <N chars. Add a small drain for existing `needs_ocr` entries. Preserve all existing behavior for text-layer PDFs and genuine download/transient failures. Add tests mirroring `test_kb_growth_zero_char_quarantine.py` for the new OCR-success and OCR-still-empty branches. Keep it read-only, no fieldbus, bump VERSION above main, add a CHANGELOG entry. Do NOT touch the promotion boundary or the pack schema.

---

*Agent transcripts (full evidence) retained in the session task outputs. Every claim above cites a verified `origin/main` path.*
