# Drive Commander — Architecture Map

**Verified:** 2026-07-20 against `origin/main` (`5fa32cb8`, v3.178.1) by a 4-agent read-only recon +
a 137-test offline baseline. Every path is repo-real; file:line refs are to `origin/main`.
Companion docs: `DRIVE_COMMANDER_CAPABILITY_MATRIX.md`, `..._BENCHMARK_SPEC.md`, `..._BASELINE_REPORT.md`,
`..._ZTA_CODIFICATION_PLAN.md`.

> **One-line truth:** Drive Commander is a **100 % deterministic, offline, read-only** pack-lookup
> engine (no LLM anywhere in the answer path). A model is used **only** in the photo *pre-stage*
> (vision description / OCR / nameplate extraction) to produce the text the deterministic core then
> looks up. It serves **3 drive families** (GS10, PowerFlex 40, PowerFlex 525).

---

## 1. Where it lives

| Layer | Path | Deterministic / Model |
|---|---|---|
| **Pack core** (schema, load, resolve, answer, cards) | `mira-bots/shared/drive_packs/` | **Deterministic** |
| Pack DATA (3 live packs) | `mira-bots/shared/drive_packs/packs/{durapulse_gs10,powerflex_40,powerflex_525}/pack.json` | data |
| GS10 causes/checks intel | `mira-bots/shared/drive_fault_intel.py` (`GS10_FAULT_INTEL`, 9 codes) | Deterministic (in-repo constant) |
| Photo→fault bridge | `mira-bots/shared/engine.py:2862-2916` (in `process_full`) | Deterministic (over OCR text) |
| Text fast-path | `mira-bots/shared/engine.py:2398-2469` | Deterministic |
| HTTP surface | `mira-bots/ask_api/{app.py,drive_pack.py,readonly_guard.py,gate_state.py,machine_context.py}` | `/drive-pack/ask` Deterministic; `/ask` Model (full engine) |
| Telegram hooks | `mira-bots/telegram/bot.py` (`_try_nameplate_drive_pack_reply` b810, `_try_drive_pack_followup` b578, `/drive` b1807) | Deterministic answer; Model nameplate extract |
| Adapter-agnostic parity | `mira-bots/shared/chat/fast_paths.py::try_fast_paths` | Deterministic ("never invoke the LLM") |
| Photo pre-stage (the only model calls) | `mira-bots/shared/workers/vision_worker.py`, `nameplate_worker.py` | **Model** (InferenceRouter cascade) |
| Live-telemetry decode | `mira-bots/shared/live_snapshot.py` | Deterministic |
| Manual→candidate bridge | `mira-crawler/drive_pack_bridge.py` (+ `cron/kb_growth_cron.py`) | Deterministic (SHA-256 + registry) |
| Extractor / grader / registry | `tools/drive-pack-extract/` (`extractor.py`, `grading/`, `registry/`, `generate_pf{40,525}_pack.py`) | Deterministic (pdfplumber) |
| Public SEO funnel | `mira-web/src/lib/drive-commander-renderer.ts` + `src/data/drive-packs/*.json` | data |
| **Dormant** rich photo→answer | `mira-bots/shared/visual/` (`equipment.py`, `session_service.py`, `answer_composer.py`) | Deterministic + optional model — **NOT wired to any shipping surface** |

---

## 2. Runtime flow

### 2a. Text question (Telegram `/drive`, kiosk, engine fast-path)
```
question ──▶ resolve_pack(text)            [DET, family from aliases/keywords]
          └▶ answer_question(pack_id, q)   [DET, param + GS10-mnemonic fault]
             or answer_fault_code(id,tok)  [DET, numeric + mnemonic fault]
          ──▶ DrivePackAnswer{answer, citations[], answer_source∈{drive_pack,none},
                              fallback_used=False, live_telemetry=False, read_only=True}
          miss ──▶ falls through to normal RAG/engine   [MODEL]  (never fabricates in the pack path)
```
- Engine placement (`engine.py:2398`): **after** the safety short-circuit (safety always wins),
  strips context preambles before `[QUESTION]` / `[END LIVE TAGS]` so the kiosk `MACHINE_CONTEXT`
  fault table can't hijack the match. `dispatch_kind="drive_pack"` ∈ `_TRUSTED_DISPATCH_KINDS`
  (`engine.py:340`) → bypasses the n-gram quality gate (templated pack text won't trip it).

### 2b. Photo (nameplate or fault display)
```
photo ─▶ VisionWorker.process / NameplateWorker.extract   [MODEL, cost logged]
       └▶ ocr_items[] (HYBRID: Tesseract floor + optional model-OCR lane)
       ─▶ resolve_pack(asset_identity)      [DET — family from the ASSET, never from the code¹]
       ─▶ extract_pack_fault_codes(pack, ocr_text)   [DET — conservative gate]
       ─▶ answer_fault_code(pack_id, code)  [DET, cited]
          match ─▶ "I read fault code X off the photo" + cited answer, dispatch_kind="drive_pack"
          miss  ─▶ RAG auto-diagnose   [MODEL]
```
¹ A bare fault code is ambiguous across vendors, so the family is resolved from the nameplate/asset,
never inferred from the code (`engine.py:2864`).

### 2c. HTTP surfaces (`mira-ask`, PROD-only via `docker-compose.saas.yml`)
- `POST /drive-pack/ask {question, pack_id?, drive?}` → pure deterministic fast-path, never 500s,
  every error → `_UNRESOLVED`. No Supervisor built.
- `POST /ask {question,…}` → full `Supervisor.process()` (MODEL) wrapped in
  `enforce_readonly_kiosk_reply` (the output write-guard).
- Consumed by the Hub customer asset-chat as a pre-check (`mira-hub/.../assets/[id]/chat/route.ts`
  → `POST ${MIRA_ASK_URL}/drive-pack/ask`, #2527).

---

## 3. Deterministic ↔ model boundary (the load-bearing line)

**Everything that produces the ANSWER is deterministic.** `answer_question`, `answer_fault_code`,
`extract_pack_fault_codes`, `resolve_pack`, `resolve_service_pack`, `resolve_pack_from_vision`,
`resolve_equipment`, `build_cards`, `load_pack` — pure dict/regex over on-disk pack JSON. No socket,
no DB, no network, no LLM (proven by `test_drive_diagnostic.py` running socket-blocked).

**Model calls exist only in the photo pre-stage**, all via `shared/inference/router.py`
(Groq→Cerebras→Together cascade, the shared router — no provider side-path):
| Call | File:line | Cost logged? |
|---|---|---|
| Vision description | `vision_worker.py:539` | Yes (`log_usage`, :541) |
| Model-OCR lane (gated by `OCR_MODEL_LANE`) | `vision_worker.py:592` | **No — usage discarded** (cost-accounting gap) |
| Nameplate extract | `nameplate_worker.py:159` | Yes (:161) |

---

## 4. Deployment surfaces

| Surface | Deployed where | Gate |
|---|---|---|
| Engine text + photo fast-path | **every bot image** (dev/staging/prod compose) | always-on |
| Telegram nameplate/`/drive`/follow-up | bot image (all envs) | photo-classification |
| `/drive-pack/ask` + `/ask` (`mira-ask`) | **PROD only** (`docker-compose.saas.yml`, `:8011` Tailscale) | optional `ASK_API_KEY` |
| Hub customer asset-chat pre-check | **PROD only** (saas) | `MIRA_ASK_URL`+`ASK_API_KEY` |
| Public `/drive-commander/*` SEO funnel | mira-web deploy | freemium |
| Manual→candidate bridge | prod cron (`MIRA_DRIVE_PACK_BRIDGE=1` in prd Doppler) | candidate-creation only, never answers |

**No feature flag gates the runtime answer** — it's always-on wherever the bot/`mira-ask` runs.

---

## 5. Read-only safety enforcement (ADR-0025)

Three independent layers, all present on main:
1. **Static (CI):** `test_drive_packs_readonly.py` — AST scan of `drive_packs/*.py`: no write-call names,
   no fieldbus/socket imports (`pymodbus`/`pycomm3`/`snap7`/`opcua`/`socket`), no write-shaped defs, no
   Modbus write function-code literal (FC5/6/15/16), pack.json = pure data (10 allowed top-level keys).
   Teeth-proven (13 synthetic bad fixtures must fail). **Scope caveat in its own docstring: it proves
   the pack/loader surface is pure — it does NOT cover a future Drive Commander *desktop connector*
   (none exists yet); when built, that connector must be added to this gate.**
2. **Structural (runtime):** every answer is `read_only=True`, `live_telemetry=False`,
   `fallback_used=False` (cite-or-refuse, never a generic LLM guess); first-checks prefixed
   "VIEW-ONLY — do not change any setting"; keypad steps always carry a loader-enforced non-empty
   `view_only_warning`.
3. **Output (kiosk):** `enforce_readonly_kiosk_reply` regex-replaces any reply containing a
   register/param write, Modbus write FC, reset+write phrasing, or `set Pxx.xx`.

There is **no explicit LOTO/arc-flash keyword layer** inside pack answers — the safety posture is
structural (no writes, no live values, view-only, cited-or-refuse). *(See the benchmark spec's safety
gate for where this is and isn't sufficient.)*

---

## 6. Feedback / continuous-codification wiring

**Real capture + human-gated flywheel — never auto-updates a served pack.** Two capture loops
converge on one human accept path:
- **Manual-change (hash):** `kb_growth_cron` → `drive_pack_bridge` (PDF hash new/changed for a
  *registered* family) → review-only candidate → `ai_suggestions(suggestion_type='drive_pack_update')`
  (migration 062).
- **Answer-gap (question):** drive-pack **misses** → `conversation_eval(meta.surface='drive_pack',
  matched=false)` → `tools/drive-pack-extract/gap_report.py` ranks recurring unanswered tokens →
  `gap_suggestion.py` raises a review item over threshold.
- **Accept:** `markDrivePackBuildRequested` → `drain_build_requests.py` (`*/15` cron) →
  `update_candidate.py` (extractor + 5-layer grader) → **staged** `candidates/<family>/` + grading
  report → **a human promotes to `packs/`** (no `promote.py`; 100 % manual by trust doctrine).

The loop captures **misses**, not thumbs-up on good answers, and re-extracts from the **same manual**;
technician corrections never edit a pack directly.

---

## 7. What is NOT here (so the matrix isn't inflated)

- **Siemens G120** — exists **only** as a public-web cited page (`mira-web/src/data/drive-packs/
  siemens_g120.json`); **not** a runtime pack. (It was fabricated once — F30001 wrong, F30006–10 +
  5 params invented — then rebuilt from a hash-pinned manual, 28/28 re-verified. Cautionary case for
  hard-gate #1.)
- **Magnetek IMPULSE G+ Mini** — a **staged candidate** (`tools/drive-pack-extract/candidates/`),
  invisible to `resolve_pack`. It is the *only* true mnemonic-keyed (v3 `fault_entries`) dataset.
- **DURApulse GS20** — a failed extraction (0 faults/0 params); the resolver explicitly refuses GS23N.
- **PowerFlex 400** — RAG/KB corpus chunks only; no pack.
- **The `shared/visual/` VisualSession path** — the richest photo→answer engine (multi-signal
  RESOLVED/AMBIGUOUS/CONFLICTING/NONE conflict detection + evidence-state composition + manual
  retrieval), fully built and tested, but **wired to nothing** (only `demo.py`/tests reach it).
