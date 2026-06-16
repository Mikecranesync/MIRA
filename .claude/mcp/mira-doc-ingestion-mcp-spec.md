# mira-doc-ingestion-mcp — Spec

MCP server exposing manual / document ingestion. Mostly read-only — `link_document_to_component` is the one write tool and is admin-gated.

**Status:** proposed.
**Underlying code:** `mira-crawler/ingest/` (`chunker.py`, `converter.py`, `embedder.py`, `kg_writer.py`, `dedup.py`).
**Auth:** tenant scope required.

## Tools

### `list_documents(asset_id?: str, tenant_id?: str, kind?: str) -> list[Document]`
List manuals / drawings / specs for an asset (or all). `kind` ∈ `manual|drawing|spec|datasheet|misc`.

```jsonc
{
  "id": "doc_...",
  "kind": "manual",
  "name": "Banner Q4X Datasheet",
  "asset_links": [...],
  "uns_paths": [...],
  "pages": 38,
  "source": "google_drive|upload|crawl",
  "ingested_at": "...",
  "confidence": "high"
}
```

### `search_documents(query: str, tenant_id?: str, limit?: int = 10) -> list[Hit]`
Hybrid vector + lexical search across ingested chunks.

```jsonc
{
  "doc_id": "...",
  "page": 12,
  "chunk_id": "...",
  "snippet": "...",
  "score": 0.83,
  "evidence_type": "manual_section"
}
```

### `extract_manual_sections(document_id: str) -> list[Section]`
Returns the structural outline (chapter → section → subsection) per `mira-crawler/ingest/chunker.py`. Useful before deciding what to extract.

### `get_document_chunks(document_id: str, topic?: str) -> list[Chunk]`
Topic filter (`troubleshooting|pm|wiring|safety|...`). Returns chunks tagged for that topic.

### `extract_maintenance_schedule(document_id: str) -> list[Task]`
Extracts the PM table (interval, task, target, tools). Calls `manual-ingestion-extractor` logic.

```jsonc
{
  "interval": "every 250h",
  "task": "Inspect chain tension",
  "target_component_hint": "Conveyor chain B16",
  "tools": ["torque wrench"],
  "source": {"doc_id": "...", "page": 17},
  "confidence": "high|medium|low"
}
```

### `extract_troubleshooting_table(document_id: str) -> list[Row]`
Symptom → cause → action rows.

```jsonc
{
  "symptom": "Sensor flickers",
  "possible_causes": ["misalignment", "dirty lens"],
  "actions": ["realign", "clean with isopropyl"],
  "source": {"doc_id": "...", "page": 22},
  "confidence": "medium"
}
```

### `link_document_to_component(document_id: str, component_id: str, evidence: list, tenant_id?: str) -> Link`
Write — admin-gated. Persists with status `proposed` if not admin; auto `verified` if admin context confirmed.

## Safety

- **Preserve source.** Every extraction includes `{doc_id, page}` (or section ref).
- **No invention.** Missing fields → `unknown`, not best-guess.
- **Flag ambiguity.** Low-confidence rows tagged with `confidence: low` and a `notes` field.
- **De-dup on insert.** Use `mira-crawler/ingest/dedup.py`.
- **UNS tagging.** Every chunk carries a `uns_path` per `.claude/rules/uns-compliance.md`.

## Cross-references

- `.claude/skills/manual-ingestion-extractor/SKILL.md`
- `.claude/skills/component-profile-builder/SKILL.md`
- `mira-crawler/ingest/uns.py` — path builders
- `docs/specs/uns-kg-unification-spec.md`
