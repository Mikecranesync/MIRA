# PrintSense degraded-mode program — implementation plan (2026-07-16)

**Goal:** make PrintSense useful and production-safe while frontier vision
inference is unavailable. No fake A-band reconstruction: deterministic and
low-cost work runs now, evidence is durable, frontier-model jobs are prepared
compactly for later. Fail closed everywhere.

**Context (verified on main, v3.150.x):** Phases A–C merged (systemgraph,
pageset, xrefnorm, typed contradictions, grounding hard-fails, designation
decoder, identity_graph, package_scope); deterministic graders frozen and
CI-gated; the 2026-07-16 provider bake-off showed every reachable non-frontier
vision model emits ZERO cross-references on the identical harness (five of ten
B7 lanes are xref-fed), while device inventory is reachable (one provider
scored 1.0/1.0 on a complete-truth rack sheet). Privacy bundles are in open
PRs (#2729 merged; #2730/#2731/#2732 open).

## Architecture & reuse findings (do NOT rebuild)

| Need | Reuse | Where |
|---|---|---|
| Durable / resumable / idempotent steps | `WorkflowRun` (+ `workflow_runs` table, Hub mig 044; statuses running/ok/degraded/failed; `idempotency_key`; fail-open) | `mira-bots/shared/workflow.py` |
| Content-addressed intake + state machine | drop-watcher pattern: sha256 ledger, inbox→processing→done/failed, lock TTL, retry backoff, status sidecars | `tools/mira-drop-watcher/main.py` |
| PDF text extraction / chunk / dedup | pdfplumber→pypdf fallback, section-aware chunker, dedup store | `mira-crawler/ingest/{converter,pdf_extract,chunker,dedup}.py` |
| Queue | existing Celery+Redis app (acks_late, reject-on-lost, per-queue routes) | `mira-crawler/celery_app.py` |
| Schema discipline | Pydantic v2 `PrintSynthGraph` et al.; `model_json_schema()` round-trip | `printsense/models.py` |
| Grounding/contradiction/graph contracts | pageset → systemgraph → identity_graph → package_scope; typed contradictions; B7 scorers | `printsense/*.py` |
| Tenancy | `tenant_id` column convention (no per-tenant FS exists) | store/workflow patterns |

**Greenfield (unavoidable):** page-image rasterization (add `pypdfium2`,
Apache-2.0) and coordinate OCR (`pytesseract.image_to_data` — pytesseract is
already a dependency; Tesseract binary exists in bot/Tika containers, NOT on
the dev box → OCR stages must skip-with-status locally and run in-container).

## Runtime modes (Phase 2)

- **one_off_page** — existing CLI/interpret path, unchanged capability set;
  output header states single-page scope; never claims system reconstruction.
- **package_scout** — the new pipeline below; result banner (verbatim):
  *"Preliminary package inventory — full system reconstruction has not been
  performed."*
- **full_reconstruction** — HARD gate: requires a provider whose capability
  record shows `cross_reference_extraction: qualified` AND
  `system_reconstruction: qualified`; otherwise queue the packet and return
  `{"state": "advanced_reasoning_unavailable"}`. No silent fallback; Scout
  output is never labeled reconstruction.

## Provider capability registry (Phase 1)

`printsense/providers/capabilities.json` (committed, human-signed) + loader.
Capability keys: `device_inventory`, `schema_reliability`,
`cross_reference_extraction`, `system_reconstruction`. Values:
`qualified | disqualified | untested` with probe evidence refs + dates.
`select_provider(capability)` fails closed on anything but `qualified`.
Permanent qualification harness = 3 probes: (1) committed SYNTHETIC
obvious-xref sheet; (2) real xref-heavy B7 production gate (runtime path,
local corpus); (3) complete-truth rack sheet for device inventory (runtime
path). Router-side enforcement test: assigning an unqualified capability
raises.

## Deterministic xref extractor (Phase 3) — `xref_extractor_v1`

OCR tokens + geometry → typed evidence records (fields exactly as specified:
raw_reference, source/target page+anchor, relationship, evidence_bbox,
confidence + deterministic reasons, status=machine_proposed,
extractor_version). Lexical layer (pattern table: sheet.col/device refs like
`25.1 / K011`, coil-column refs `/7.6`, page-anchor refs `DA6.1`, `+EXT/…`
externals, cable/wire continuations, from/to-sheet phrases, IEC/German
conventions; NFPA grid refs) is SEPARATE from graph resolution (resolves
against the package page index; emits resolved | ambiguous | missing_target |
contradictory; never invents targets; convention numbers are never devices —
reuses `designations/` + `xrefnorm` + feeds `systemgraph` edge classes).
Tests: synthetic fixtures per syntax (committed) + corpus-backed runtime
tests (local-only paths, skip when absent).

## Package pipeline (Phase 5) + CAS (Phase 8)

`upload → CAS store → split (pypdfium2, page-streamed) → page hash → dedup →
OCR(image_to_data) → classify → inventory → xref extraction → graph proposal
→ unresolved-work queue`, each stage a `WorkflowRun` step keyed by
`(package_sha, page_sha, stage, algo_version)`; per-page/per-stage status
sidecars (drop-watcher pattern); resume = skip completed keys; retry = failed
stages only; page identity = content hash (survives reordering); reupload
detected by package/page hashes; tenant_id threaded; logs carry hashes, never
content. CAS keys include source hash + algorithm/prompt versions; approved
interpretations are never re-bought unless source/extractor/prompt version
changes or the user forces reanalysis.

## Human confirmation (Phase 4)

Compact review contract (question, candidates w/ confidence, allowed_actions:
confirm_candidate | mark_unknown | enter_correct_target). Decisions are
durable evidence records (reviewer, timestamp, machine proposal, selected
target, source crop ref, source doc hash, status, audit trail); a confirmed
edge is cache-pinned against (source hash, extractor version).

## Deliverables (Phase 6/7)

Scout reports (ToC, device/motor-drive/PLC-IO/terminal/cable registers,
page-device index, missing/duplicate/unreadable reports, subsystem clusters,
xref + contradiction reports — every row links page-level evidence) and
content-addressed, provider-neutral, schema-validated frontier packets
(subsystem-scoped pages/crops/ocr excerpts + requested_outputs), small enough
for bounded inference.

## PR boundaries (all open-PR-only; nothing merges without approval)

| PR | Scope | Tests |
|---|---|---|
| A | capability registry + 3-probe harness + fail-closed selector | unit + enforcement + synthetic probe |
| B | runtime modes + degraded messaging + full_reconstruction gate | mode contract + gate fail-closed |
| C | xref_extractor_v1 lexical layer | per-syntax synthetic fixtures |
| D | xref resolution + systemgraph/contradiction integration | resolution classes + corpus-runtime |
| E | review contract + durable decisions + cache pinning | review lifecycle + no-recompute |
| F | package pipeline + CAS + resume/idempotency (pypdfium2 dep) | resume, idempotency, reupload, tenancy, fail-closed |
| G | Scout reports + frontier packets | report evidence-links + packet determinism/content-addressing |

## Migration impact

None in v1: `workflow_runs` exists (mig 044); pipeline state is file-based
(CAS dir + sidecars). A later DB-backed review queue would be a new
next-numbered Hub migration (TEXT-vs-UUID rules per `.claude/rules/`).

## Risks

Tesseract absent on dev (OCR stages skip-with-status locally; CI/container
run them); Windows path/encoding traps (byte-safe reads, utf-8 writes);
corpus privacy (runtime-path corpus tests only; committed fixtures synthetic —
enforced by existing privacy guards + new marker tests); provider drift
(capability registry is dated + probe-refreshable); large-PDF memory
(pypdfium2 page streaming; bounded batches).

## Acceptance criteria

Exactly the operator's 14 (one-off preserved; incremental+resumable ingest;
evidence-backed Scout reports; gated reconstruction; typed grounded xrefs;
review queue; permanent evidence reuse; compact neutral packets;
capability routing enforced by tests; no customer material in fixtures/logs;
existing tests green; new unit/integration/privacy/migration/resume/
idempotency/fail-closed tests; B7 gate intact; no unqualified provider
integration).
