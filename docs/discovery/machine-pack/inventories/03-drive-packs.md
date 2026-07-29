# Drive Packs / Drive Commander — Discovery Report

**Critical environment fact:** the gs10-ask-tool worktree (branch `feat/hub-live-signal-polish`) is **stale by ~70 commits** — it has NO drive-pack code (`mira-bots/shared/drive_packs/` doesn't exist there). All real drive-pack work lives on **`origin/main`** (VERSION 3.128, `d3109c2a`). Prior audit: `docs/discovery/drive_commander_convergence_audit_2026-07-07.md`.

The 6 `worktree-drivepack-*` branches (gs10-gold, pf40-hardening, pf525-p053, scientific-grading, cite-pagelabels, grading-docs) are **pre-merge snapshots, all superseded** on origin/main. **Verdict: retire/ignore.**

## 1. Governing doc
- `docs/adr/0025-drive-intelligence-packs-and-drive-commander.md` — Accepted 2026-07-05. Product = read-only VFD diagnostic "Drive Commander" (GTM: **DriveSense**), sellable atom = per-family **drive pack**. Production doctrine, actively followed.

## 2. Pack schema (v1 + v2)
File: `mira-bots/shared/drive_packs/schema.py` (frozen dataclasses, pure data; validation in `loader.py`). Prose doc: `packs/README.md`.

Top-level `pack.json`:
- `pack_id`, `schema_version` (1|2)
- `family {manufacturer, series, aliases[]}`
- `nameplate {match_keywords[]}`
- `live_decode {status_bits, cmd_word, fault_codes, registers{addr, unit, scaling, datapoint}}` — `addr: null` = "not yet documented", never a guess
- `envelope {dc_bus/current/frequency: {nominal,min,max,rated,unit}}`
- `knowledge {kb_document_ids[], component_template_id, kg_entity_ids[]}` — pointer-only, reuse-don't-rehold
- `provenance {items: {dotted.path: tier}, sources[{doc,page,excerpt}]}` — tiers CLOSED: `bench_verified` | `manual_cited` only (never bare "verified" — reserved for kg_*.approval_state per ADR-0017)
- v2: `parameters[]` (ParameterCard: cited param decode, value_meanings, related_faults, source_citation, provenance_tier, confidence_tier) + `keypad_navigation[]` (view-only steps, mandatory non-empty view_only_warning enforced by loader)
- `live_decode`/`envelope` optional — manual-only packs (PF40/PF525) ship without them.
- Loader accepts schema_version {1,2}; unknown = hard error. v1 loads under v2-aware loader (additive-only).

## 3. Live packs (production, origin/main)
| Pack | Trust | live_decode/envelope |
|---|---|---|
| `durapulse_gs10` | gold reference — bench_verified + manual_cited | yes (bench) |
| `powerflex_525` | manual_cited, beta (+ PROVENANCE.md + grading_report) | no |
| `powerflex_40` | manual_cited, beta | no |
| `siemens_g120` | NOT built — backlog `docs/plans/2026-07-09-drive-commander-g120-execution-backlog.md` (DC-A…DC-N, from issue #2577; $197/yr wedge) | — |

Candidates staging: `tools/drive-pack-extract/candidates/` — structurally unreachable by loader (trust doctrine, by design).

## 4. Core runtime (`mira-bots/shared/drive_packs/`) — all production, all reuse
- `schema.py`, `loader.py` (load_pack/list_packs/resolve_pack, fail-closed, no I/O)
- `cards.py` — `build_cards()` → DiagnosticCard (fault→meaning/causes/checks/citations); `TemplateReader` Protocol = documented seam into component_templates/KG (not implemented yet)
- `nameplate.py` — vision output → pack
- `resolver.py` — `resolve_service_pack()` single entry (explicit id/drive name/question/asset make-model/nameplate → PackResolution, confidence band, honest refusal on ambiguity)
- `ask.py` — `answer_question(pack_id, question)` deterministic pack-grounded Q&A; CLI `python -m shared.drive_packs.ask`
- `asset_identity.py` (#2561/#2563) — RAW OCR vs INTERPRETED kept separate; approval_status starts "unreviewed", never auto-promoted
- All pure, no I/O, never raise, never guess.

Tests (green on main): test_drive_packs.py, _schema_v2, _readonly (no-write-FC gate), _cards, _nameplate, _gs10_v2_fixture, _ask, test_ask_api_drive_pack.py, test_engine_drive_pack_fastpath.py, test_drive_pack_hub_copy_sync.py. Fixture: `mira-bots/tests/fixtures/drive_packs/gs10_v2_pack.json`.

## 5. Surfaces (production)
- CLI proof-of-life (`docs/drive-commander/gs10-ask-from-home.md`)
- HTTP: `mira-bots/ask_api/drive_pack.py` — POST /drive-pack/ask (never 500s, UNRESOLVED shape on failure)
- Engine fast-path: pack answers BEFORE generic RAG, after safety short-circuit
- Telegram nameplate→pack (#2554, 3.110.0); engine-level UNS auto-fill backstop (PR #2551) REJECTED — documented why
- Hub asset-chat: **GAP** — TS `manual-rag.ts` doesn't call pack path (top-ranked gap in audit)
- Ignition Ask-MIRA panel: fault-card enrichment in Live Machine Evidence (#2482/#2484/#2485/#2487)
- Public SEO: `mira-web/src/lib/drive-commander-renderer.ts` + `drive-pack-data.ts`, `/drive-commander/:model[/faults/:code]`, freemium (#2594); G120 landing = DC-E

## 6. Extractor + grader (`tools/drive-pack-extract/`, PRs #2503/#2505)
- `extractor.py` + `cite_integrity.py` — PDF → fragment JSON; citation verify (integer-page pin vs chapter-section-label document check, #2522)
- `grading/` — 5-layer: (A) schema via REAL runtime loader, (B) citation integrity, (C) domain rules, (D) gold-set precision/recall, (E) scientific 0–100/A–F rubric (#2515) + CI promotion-gate design doc. Trust ceiling for manual_cited = **beta**, never trusted (needs bench).
- Gold sets: `gold/{durapulse_gs10,powerflex_40,powerflex_525}/gold.json`
- Reuse as-is for new families (G120 needs extractor dialect tuning, DC-B).

## 7. Manual-source registry / update-candidate (#2507)
- `registry/registry.py` — deterministic classifier NEW_MANUAL/UNCHANGED/CHANGED_BY_HASH/NEEDS_INITIAL_CANDIDATE on pdf_sha256 vs sources.json
- `update_candidate.py` — fail-closed `assert_not_live_packs` (physically cannot write live tree); promotion 100% human (no promote.py, deliberate)
- Also: `applicability.py`, `drain_build_requests.py`, `scorecard.py`, `gap_report.py`, `gap_suggestion.py`
- Trust states: rejected < internal_only < beta < trusted (worst-wins, fail-closed; trusted requires human sign-off)

## 8. Decode + Modbus + scaling
- **Pack is now single source of truth**: `mira-bots/shared/live_snapshot.py` loads `_GS10_PACK = load_pack("durapulse_gs10")` at import, derives _STATUS_BITS/_CMD_WORD/_FAULT_CODES/_REGISTERS (fails loudly if pack missing keys). `mira-hub/src/lib/gs10-display.ts` still mirrors in TS — **triplication flag** (Python/TS/Ignition WebDev) not yet converged.
- `DriveDiagnostic` dataclass (#2486) — surface-agnostic structured diagnosis (assessment, fault_card, related_parameters, keypad_navigation), rendered identically everywhere.
- Envelope-driven analog assessment: `_ANALOG_ENVELOPE_DATAPOINTS` maps vfd_dc_bus/current/frequency → pack Envelope bands. **Does NOT write tag_entities.expected_envelope** (open gap #7 in audit); `assess_snapshots` (ADR flagship isolation-diagnosis fn) absent from live_snapshot.py as of 07-07 audit — re-verify.
- Real table: `mira-hub/db/migrations/025_tag_entities.sql` (scaling JSONB); helper `mira-bots/shared/wire_scaling.py` (TagScaling, to_engineering). Local unmerged branches `feat/gs10-tag-scaling-seed`, `feat/gs10-pack-parameter-expansion` exist — check before reusing.

## 9. GS10 device profile (fieldbus-discovery, separate)
`device-profiles/gs10.yaml` — RS-485 fingerprint/discovery profile (plc/discover.py target), distinct from pack live_decode but must stay consistent (P09.04=8N2, cmd-word FWD+RUN=18/REV+RUN=20/STOP=1). Reuse; cross-check on new families. Note `device-profiles/_schema.yaml` has a `kind` discriminator field.

## 10. VFD Analyzer / auto-map (RESUME_2026-06-14)
Earlier product idea: Ignition Exchange resource (trend+decode+anomaly, freemium) + auto-map tag classification. Predates ADR-0025 by ~3 weeks. **Adjacent/possibly-superseded** — Drive Commander (direct read, no Ignition dep) is canonical; the auto-map tag→signal-role idea is valuable IP not folded into ADR-0025 — flag for reconciliation before a Machine Pack (second envelope/auto-classification concept could collide with tag_entities.expected_envelope).

## 11. Duplicates / risks
- Two answer brains: Python engine (strong H4 citation grounding) vs Hub TS manual-rag.ts (BM25-only, weaker, customer-facing)
- Triplicated decode tables: pack JSON (canonical) / gs10-display.ts / Ignition WebDev
- Three machine-memory-bridge implementations (ask_api, ignition_chat, Hub machine-memory.ts)
- OCR dead-letter: scanned manuals quarantined needs_ocr, no drain — could block G120 if scanned
- 6 worktree-drivepack-* branches = dead weight
- Hub byte-copy `mira-hub/src/lib/drive-packs/gs10-pack.json` is a GUARDED deliberate duplicate (Docker build context) with drift-guard test — keep pattern.

## 12. Bottom line for a Machine Pack
`DrivePack` schema is a solid template to generalize: family/nameplate/live_decode/knowledge/provenance/parameters/keypad_navigation is already domain-agnostic in shape — only live_decode field names are VFD-specific. Registry/extractor/grader/loader/resolver/ask pipeline fully reusable. A Machine Pack likely needs a `kind` discriminator alongside `vfd` and family-specific live_decode shape, WITHOUT touching trust doctrine, grading layers, or resolver contract.
