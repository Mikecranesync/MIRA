# Platform Alignment — Evidence Storage (Audit Area 4)

**Phase 4.5 audit, read-only. 2026-06-23.**
**Question:** can `evidence_graph` references point to existing Hub evidence, or is a duplicate citation store emerging?

**Verdict:** **DUPLICATION RISK — the spine's synthetic manual/history fixtures duplicate `knowledge_entries` + `cmms_*`.** The real stores exist; the spine should point at them. The only true gap is a bots-side retrieval column omission.

## The real evidence stores (already exist)

| Spine citation type | Real store | Columns that give `{doc, page, section, snippet}` |
|---|---|---|
| **Manual** | `knowledge_entries` (mig 001 + **045**) | `source_url`=doc, `content`=snippet, `metadata.title`/`section_path`=section, **`page_start`/`page_end`=real PDF page** (mig 045; legacy `source_page`=chunk_index, a known quirk), `doc_id`=grouping. |
| **Tag** | `tag_evidence` (in `decision_traces`) + `live_signal_cache`/`live_signal_events` | per-turn tag readings keyed to `uns_path`. |
| **Asset** | `kg_entities` / `cmms_equipment` | the asset + KG-edge facts. |
| **Procedure** | `component_templates.troubleshooting_steps` (JSONB) | per-model step lists. |
| **History / corrective action** | `cmms_*` work orders (Atlas) via `mira-mcp/server.py` (`get_fault_history` L187, `cmms_list_work_orders` L327, `cmms_complete_work_order` feedback L337) | past faults + completion feedback. |

The **canonical typed-Manual-citation shape already exists**: `mira-hub/src/lib/manual-rag.ts` `ManualSource {index, title, url, page}` + `chunksToSources` (stable `[n]`↔chip numbering), which reads `page_start`/`section_path` (mig 045). The per-explanation evidence record already exists: `decision_traces.manual_evidence` = `{chunk_id, doc, page, score}` (`_manual_evidence_from_sources`).

## Mapping verdicts

- **Spine Manual citation (synthetic `maintenance_knowledge.json`) → DUPLICATION RISK.** It re-invents `{doc, page, section, snippet}` that `knowledge_entries` already provides. **Point spine Manual citations at `knowledge_entries` via the `manual-rag.ts ManualSource` shape.**
- **Spine Historical evidence (synthetic `maintenance_history.json`) → belongs in `cmms_*`.** `historical_event` + `corrective_action` map onto Atlas work orders + completion feedback, surfaced through existing MCP tools. **No new history store.**
- **Spine Procedure fixture → `component_templates.troubleshooting_steps`.**
- **The one real gap:** bots-side `mira-bots/shared/neon_recall.py recall_knowledge()` selects only `source_url, source_page, metadata` — **not `page_start`/`section_path`** — and `format_source_label` (`rag_worker.py` L40) omits page on purpose. So the *bots* path can't yet emit `{doc, page, section}` even though the Hub path can. **Extend `recall_knowledge` + `format_source_label` to surface `page_start`/`section_path`** — close the bots/Hub locator gap, don't fork a citation table.

## Why the spine looked like it needed its own store

The synthetic fixtures were the **right call for the offline brain-side proof** (Phases 0–4 had no DB by design). They are Evidence-class-3 stand-ins. The integration step is to swap the fixture loaders for `knowledge_entries` / `cmms_*` reads behind the same citation interface — the spine's `citations.py` types (Tag/Asset/Manual/Procedure/History) already match the five real stores 1:1.

## Conclusion

**A duplicate citation store is emerging only if the synthetic fixtures ship as the runtime source.** They must not. Every citation type has a real home; the Hub already has the canonical typed-Manual shape (`manual-rag.ts`) and the per-explanation evidence record (`decision_traces`). The work is: (1) point Manual→`knowledge_entries`, History→`cmms_*`, Procedure→`component_templates`; (2) extend the bots-side recall to select the mig-045 anchor columns. No new evidence/citation table.
