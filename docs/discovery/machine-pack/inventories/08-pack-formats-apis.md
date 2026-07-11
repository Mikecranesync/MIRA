# Machine-Pack-Like Artifact Formats / Versioning / API Surfaces — Discovery

**⚠️ Local checkout stale** (feat/hub-live-signal-polish). All drive-pack findings read from origin/main (`d3109c2a`, 2026-07-10).

## 1. THE existing schema — Drive Pack (`mira-bots/shared/drive_packs/`)
**~80% of "design ONE Machine Pack schema" already done.** Governed by ADR-0025 + `docs/discovery/drive_commander_convergence_audit_2026-07-07.md`.

- `schema.py` — frozen dataclasses: DrivePack{pack_id, schema_version, family, nameplate, live_decode, envelope, knowledge, provenance, parameters[], keypad_navigation[]}
- `loader.py` — pure read-only, fail-closed validation, no fieldbus/network/DB I/O
- `resolver.py` — signal-priority resolver, ambiguity-aware, never raises
- `cards.py` — DiagnosticCard{fault_or_symptom, meaning, likely_causes[], first_checks[], citations[], confidence, provenance_tier} derived at query time; TemplateReader protocol seam into KB/KG (unimplemented by design)
- packs: durapulse_gs10 (v2 bench-verified gold), powerflex_40/525 (manual_cited)
- `packs/README.md` = field-by-field schema doc — read first when designing unified schema

Schema versioning: `schema_version` int on every pack; loader accepts {1,2}, unknown = hard error. v1 loads under v2 loader (additive-only). This IS the pack format's migration discipline.

### Grading / trust pipeline
- `tools/drive-pack-extract/extractor.py` + `cite_integrity.py` (PR-A: manual → candidate)
- `grading/{schema_check,cite_check,gold_score,domain_rules,report}.py` + GRADING_SPEC.md (PR-B: 5-layer) → trust status `rejected < internal_only < beta < trusted` (worst-wins, fail-closed; trusted = human sign-off only)
- `registry/{registry.py,update_candidate.py,drain_build_requests.py}` — hash-change → CANDIDATE, never auto-promotes
- `docs/drive-commander/drive-pack-trust-doctrine.md`
- Provenance/confidence/approval at 3 levels: pack `provenance.items` (bench_verified/manual_cited), card `provenance_tier`+`confidence_tier` (low/med/high), pipeline `trust_status`. Fully worked CANDIDATE-vs-trusted state machine — reuse verbatim.

### Flagged deliberate duplicate
`mira-hub/src/lib/drive-packs/gs10-pack.json` = byte-for-byte copy of canonical pack (Hub Docker build context can't reach outside ./mira-hub); `test_drive_pack_hub_copy_sync.py` = drift guard. KEEP pattern; don't merge.

### Surfaces reached / not
- Reaches: Telegram /drive, engine fast-path, Ignition/kiosk live fusion.
- Does NOT reach Hub asset-chat (`assets/[id]/chat/route.ts` = separate weaker BM25-only TS brain) — top-ranked gap.
- `062_ai_suggestions_drive_pack_update.sql` + `drive-pack-suggestion.ts` — Hub review-queue candidate surfacing, decide-only (doesn't trigger build/grade).
- `mira-crawler/drive_pack_bridge.py` — KB-ingest → candidate bridge, default-OFF (MIRA_DRIVE_PACK_BRIDGE), writes only to ~/.mira/drive-pack-candidates/ — correct trust-boundary pattern to copy.

## 2. Other artifact/IR formats (different domains, no overlap)
| Path | What | Verdict |
|---|---|---|
| `mira-contextualizer/mira_contextualizer/profile.py` (+store.py) | `.miraprofile` — portable machine-profile document (identity, source inventory w/ fingerprints, extracted IR, extraction+review decisions, export history). `SCHEMA = "mira-contextualizer/profile@1"` | **Reuse as the "machine profile" concept** — a Drive Pack could be one of several things a .miraprofile bundles |
| `mira-plc-parser/mira_plc_parser/ir.py` | Vendor-neutral PLC IR; `Provenance{source_file,source_format,locator,confidence:HIGH/MEDIUM/LOW/REVIEW}` — 4-tier scale richer than drive-pack binary | **Reuse Provenance dataclass shape** as candidate unified provenance vocabulary |
| `docs/plans/2026-07-03-ignition-collector-resource-pack.md` | Ignition project-export .zip = DEPLOYMENT artifact, different lifecycle | Do not conflate with Machine Pack; separate track |
| `demo/factory_difference_engine/fault_bundle.py` + `fault_dictionary.py` | Fault Intelligence Bundle — fault→evidence join with `corroboration` state (corroborated/uncorroborated/no_referenced_tags/fault_not_found), SimLab-only demo | Prior art for "corroboration" concept; drive_packs cards.py is the production-track version — fold/retire, don't promote |
| `mira-hub/db/migrations/016_component_templates.sql` (+017 installed_component_instances) | Component Templates — shared catalog: common_failure_modes, troubleshooting_steps, diagnostic_indicators, expected_signals, pinout, safety_notes, pm_checks, power_specs, input_output_specs JSONB; verification_status IN (proposed,verified,rejected) | Layer 2 of ADR-0025's 3-layer model — already the generalized "any component" store. Reuse, don't re-hold |

## 3. Versioning + migration systems
- `tools/migration_drift.py` + tests (origin/main only) — read-only drift detector: two migration sets (mira-hub + mira-core/mira-ingest) vs one `schema_migrations` ledger (keyed on filename). **Reuse as model** for pack-file-vs-deployed drift detection.
- `048_schema_migrations_ledger.sql` — legacy table adopted as canonical ledger.
- `.claude/rules/mira-hub-migrations.md` — never rewrite applied migration; transferable to "never rewrite a promoted pack.json — new schema_version".
- `proposal_transition.py` / `proposal-transition.ts` + **ADR-0017** — three status enums, one documented mapping, centralized-write enforcement. **GAP: no ADR-0017-equivalent maps pack trust_status ↔ ai_suggestions.status ↔ component_templates.verification_status — write that ADR before generalizing.**

## 4. API surfaces for agents/thin clients
- `mira-mcp/server.py` — ~20 @mcp.tool fns (get_equipment_status, list_active_faults, get_fault_history, get_maintenance_notes, kg_maintenance_context, kg_impact_analysis, kg_root_cause_chain, kg_traverse_chain, kg_flag_pm_mismatches, mira_browse_namespace, mira_get_equipment, kg_extract_schematic). No drive-pack tool yet — adding resolve_service_pack/ask_drive_pack as MCP tools = natural agent bridge.
- `mira-mcp/factorylm_external_ai/` — 9 scoped read-only tools with READ_ONLY_ANNOTATIONS baked in; strict output schema requiring approval_status/confidence/warnings on EVERY response. **Gold-standard shape for future factorylm_ask_drive_pack tool.**
- `docs/external-ai/customer-enterprise-connector-backlog.md` — P0–P2 (OAuth2.1, audit logging, admin-approved config, rate limiting); explicit Defer list: PLC writes, start/stop/reset, tag writes, broad exports.
- `mira-connect/mira_connect/drivers/` — driver-based connector package; check whether it's the chassis for Drive Commander desktop's direct read-only EtherNet/IP/Modbus-TCP connection (ADR-0025 §3). Needs follow-up.

## 5. Direction-setting docs
ADR-0025 (3-layer manifest: Document / Extracted-intelligence / Diagnostic-reasoning); convergence audit 2026-07-07 (§2 inventory, §9 anti-patterns: NO third ingestion system or third answer brain); mira_single_product_research.md (the why); drive-pack-trust-doctrine.md (10-step acceptance, extend verbatim to any pack type).

## Net recommendation
**Don't design from scratch — generalize `drive_packs/schema.py`.** Gaps for generalizing:
1. live_decode/envelope are VFD-shaped → generic "signal decode" block (reconcile with component_templates' power_specs/input_output_specs/signal_behavior JSONB).
2. Write the ADR-0017-style mapping for trust_status ↔ ai_suggestions.status ↔ verification_status FIRST.
3. Extend migration_drift.py pattern to pack files vs a promoted-packs ledger if packs multiply.
