# MVP Gap Analysis — 2026-04-15

**Baseline vision:** `./2026-04-15-mira-manufacturing-gaps.md` (12 problems from the 4.0 Solutions ProveIt! fireside chat)

**Codebase state:** `main` @ `978dc19` + PR #298 (activation-path hardening) merging next

**Overall alignment:** 3/10. Marketing claims 12 problems solved; code backs ~3 of them at partial fidelity.

## Vocabulary presence (load-bearing terms from the vision doc)

These are the proof-words. If they don't appear in `src/`, the corresponding claim is vapor. Baseline taken 2026-04-15 on `main` (excluding `docs/`, `wiki/`, `PRDS/`, `node_modules`, `.git`, `.claude/worktrees`):

| Term | Count in src | Target |
|---|---|---|
| `ISA-95` / `isa_95` / `isa95` | 0 | ≥1 (schema column + path library) |
| `SM Profile` / `sm_profile` | 0 | ≥1 (profile schema + CRUD + registry) |
| `MIRA Connect` / `mira-connect` | 0 | ≥1 (service/module name) |
| `I3X` / `i3x` | 0 | ≥1 (API server module) |
| `FewShotTrainer` / `few_shot` | 0 | ≥1 (trainer class + confidence boost) |
| `tribal_knowledge` | 0 | ≥1 (`data_type` enum value) |
| `OPC UA` / `opcua` | 0 | ≥1 (discovery/connect module) |
| `CESMII` / `SM Marketplace` | 0 | ≥1 (publish target) |
| `data_type` as knowledge column | 0 | 1 (column) |
| Quality fields (`engineeringUnit`, `normalRangeMin/Max`, `alarmHigh/Low`, `quality`) | 0 | 5 (all on telemetry schema) |
| Relationship edges (`partOf`, `adjacentTo`, `monitoredBy`, `feedsInto`) | 0 | 4 (on SM Profile relationships JSON) |

Every row at 0 is a build item, not a naming item — the terms should appear because real code uses them, not because we sprinkled them into comments.

## The 12 problems — current state vs MVP definition

| # | Problem (vision doc) | MVP definition (what "solved" means for MIRA) | Current state | Delta (rough size) |
|---|---|---|---|---|
| 1 | AI doesn't remember / just-in-time memory | pgvector `knowledge_entries` gains columns: `isa95_path`, `equipment_id`, `data_type` (enum). 4-stage retrieval scopes to path. | `knowledge_entries` has only `(tenant_id, manufacturer, model_number, equipment_type, source_url, source_page, metadata)`. No hierarchy, no data_type. | Schema migration + retrieval rewrite. **~1 week** |
| 2 | Tribal knowledge trapped in heads | RESOLVED state in GSD engine writes a `data_type=tribal_knowledge` vector keyed to the equipment path. No separate capture UX. | FSM reaches RESOLVED but writes nothing back to the KB. | Engine hook + embed pipeline + ISA-95 pathing from #1. **~3 days** after #1. |
| 3 | No industrial AI harness | Write-action FSM gate: any physical-system action (work order, setpoint recommend, alarm escalate) enters a `PENDING_APPROVAL` state and requires a technician sign-off event before execution. Audit trail logged. | FSM is `IDLE → Q1/Q2/Q3 → DIAGNOSIS → FIX_STEP → RESOLVED`. PLCWorker is a stub. No approval state. | New FSM state + audit table + every write-path rewrite. **~1 week** |
| 4 | No semantic structure — agents can't navigate data | SM Profile schema: typed nodes (`ZoneHeater`, `ConveyorDrive`, `CentrifugalPump`, etc.) with versioned JSON schemas, stored in NeonDB. Relationships table with typed edges. | Zero SM Profile. Zero typed nodes. Zero edges. | New schema + profile loader + 3-5 seed profiles. **~2 weeks** |
| 5 | Raw tag data is untrustworthy | Every SM Profile property carries `engineeringUnit`, `normalRangeMin`, `normalRangeMax`, `alarmHigh`, `alarmLow`, `quality`, `timestamp`. RAG pipeline converts to natural-language context. | No telemetry layer at all. | Depends on #4 + OPC UA (#7). **~1 week** after #4. |
| 6 | No feedback loop — AI doesn't compound | `FewShotTrainer` class tracks confirmation counts per (vendor, model, mapping). Confidence score = base model confidence × log(confirmations + 1). | Heuristic regex scoring in `gsd_engine.py:41-50`. Active-learning loop writes eval fixtures but doesn't boost confidence. | New trainer module + wire into intent/vendor classification. **~1 week** |
| 7 | Brownfield — factories aren't connected | `mira-connect/` new module: OPC UA endpoint auto-discovery on local network, Modbus/EtherNet/IP detection, tablet-friendly web UI for tag mapping, Tailscale sidecar for secure cloud sync. 30-min onboarding target. | Zero. Currently deferred by Hard Constraint #9 (Config 4). | This is the biggest item. **~6 weeks**. Unblocks #1, #2, #5. |
| 8 | Wrong first step — headcount reduction | Positioning + UX: tech is the expert, MIRA confirms. `/activated` flow treats tech as authority. | Partially backed — Telegram/Slack UX is tech-facing, system prompts frame MIRA as copilot. Enough for messaging. | **Already shipped at messaging level.** Architectural reinforcement comes via #3. |
| 9 | Trusted delegation doesn't exist | Every MIRA recommendation returns a structured citation block: telemetry reading (with quality), historical precedent, OEM manual excerpt (source_url + source_page), prior tech confirmation IDs. Exposed in chat UI. | Partially backed — RAG citations exist (source_url/page). No quality-tagged telemetry, no historical precedent lookup, no confirmation linkage. | Needs #1 + #5 + #6. **Rolled into those.** |
| 10 | Knowledge graph node/edge design unsolved | Same as #4 — SM Profile as typed node, typed relationships as valid edges. Query API that traverses up/down the hierarchy. | Zero. | Part of #4. |
| 11 | Capture must feel natural | Tech never opens a "document your knowledge" tool. Every chat turn's resolution is the capture event. Plain-English confirmation prompts ("This register looks like temperature — does that look right?"). | Partially backed — chat itself is the capture surface and `/good`/`/bad` feedback feeds active-learning. But nothing writes a tribal_knowledge vector on resolution (#2). | Completed by #2. |
| 12 | Scale beyond individual pilots | Template library at `mira-connect/templates/` — SM Profile seed files for PowerFlex, G120, FC302, etc. Vendor-neutral. CESMII SM Marketplace publishing script. | Zero templates. Zero CESMII integration. Crawler is vendor-specific per run. | **~2 weeks** after #4. CESMII publish is a separate ~1 week. |

## What IS defensibly real today (the 3/10)

- **RAG over OEM manuals.** Apify/Firecrawl discovery → Docling extraction → sentence+table chunker with 2000-token cap → Ollama `nomic-embed-text` embedding → NeonDB pgvector → 4-stage retrieval (vector + fault code + ILIKE + product). 25K rows. Actually works.
- **Multi-channel diagnostic bot (Telegram + Slack).** FSM-driven conversations, 21-keyword safety-STOP, cross-model LLM-as-judge eval on 51 fixtures, active-learning loop mining `/bad` feedback into nightly draft PRs.
- **Photo → diagnosis.** Nameplate upload → `qwen2.5vl:7b` or Gemini vision → vendor/model extraction → RAG on that equipment. 3,694 photos in the confirmed corpus.
- **Inference cascade.** Gemini → Groq → Cerebras → Claude fallback. PII sanitization. Cross-model judge routing (ADR-0010).
- **Beta funnel.** factorylm.com + app.factorylm.com + $97/mo Stripe + activation hardening (PR #298, shipped today).

These stay. They are **Phase 0** — the foundation on top of which the 12-problem MVP gets built. The Stripe funnel continues to collect real users and real `/bad` feedback during the build.

## Build order (recommended)

Sequencing: unblock the most dependencies first.

1. **#1 + #2** — ISA-95 schema + tribal_knowledge write on RESOLVED. Cheap, high signal. ~2 weeks.
2. **#4 + #10** — SM Profile + relationships. Unblocks #5, #9, #12. ~2 weeks.
3. **#3** — Approval FSM + audit trail. Unlocks the "trusted delegation" story. ~1 week.
4. **#6** — FewShotTrainer, wired to existing active-learning data. ~1 week.
5. **#5** — Quality metadata on telemetry objects. ~1 week (needs #4).
6. **#12** — Template library + vendor-neutral seed profiles. ~2 weeks.
7. **#7** — MIRA Connect OPC UA wizard. The biggest item, kept last because it unblocks real production use but is ~6 weeks of work.
8. **CESMII publish** — once #4 + #12 are real. ~1 week.

Total critical-path engineering: **~15–18 weeks** for a complete 12/12 implementation. If we want a public "we back the doc" moment, items 1–6 (~8 weeks) get us to ~7/10 alignment — enough for honest marketing against the current claims, minus the field-deployment story (#7).

## Measurement

Re-run the vocabulary grep quarterly. Every term in the presence table should go from 0 to ≥1 with a real code reference. When a term moves from 0 to 1, update this file.

Definition of MVP "done": every row in the per-problem table reads "Backed" with a path:line citation. That is the date MIRA can defensibly claim every problem in the vision doc is solved.
