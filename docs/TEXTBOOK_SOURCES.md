# TEXTBOOK_SOURCES.md
*MIRA v0.5.3 | Created: 2026-03-28 | Status: Planning — No code changes*

---

## Purpose

This document defines the strategy for adding generic industrial maintenance textbooks
into MIRA's NeonDB RAG pipeline **without polluting OEM manual retrieval**.

Textbooks serve as **domain priors** — they wrap manufacturer manuals, they do not replace them.
They exist to answer "how does a VFD work in general?" not "what does F4 mean on a PowerFlex 40?"

---

## 1. Current Domain Source Inventory

> **ACTION REQUIRED (Claude Code):** Run these queries against NeonDB before ingest begins:
>
> ```sql
> -- a) What source_types currently exist?
> SELECT source_type, COUNT(*) FROM knowledge_entries
> WHERE tenant_id = '<your_tenant_id>'
> GROUP BY source_type;
>
> -- b) What equipment_types currently exist?
> SELECT equipment_type, COUNT(*) FROM knowledge_entries
> WHERE tenant_id = '<your_tenant_id>'
> GROUP BY equipment_type;
> ```
>
> Document results here and confirm that ALL rows came from the new sentence-aware
> pipeline (chunk_quality = 'sentence_split' in metadata) before adding textbooks.

**Known source_types as of v0.5.3 architecture doc:**
- `manual` — OEM PDFs (Rockwell, Siemens, ABB, Eaton, etc.)
- `gdrive` — Google Drive documents
- `seed` — curated seed content
- `gphotos` — equipment photos (vision ingest)

**Textbooks will introduce:** `source_type = 'textbook'` (new — does not exist yet)

---

## 2. Textbook Metadata Strategy

### New `source_type` value
```
source_type = 'textbook'
```

### New `equipment_type` values (proposed)
These are intentionally non-overlapping with product-specific types:

| equipment_type value       | Meaning                                            |
|----------------------------|----------------------------------------------------|
| `general_maintenance`      | Broad multi-system maintenance, PM, troubleshooting|
| `general_mechatronics`     | Mechanical + electrical + controls integration     |
| `general_electrical`       | Motor control, interlocks, contactors, overloads   |

### Candidate Textbook → Metadata Mapping

| Textbook                                                                   | source_type | equipment_type          | Notes                                      |
|----------------------------------------------------------------------------|-------------|-------------------------|--------------------------------------------|
| Maintenance Engineering Handbook (McGraw-Hill, Higgins)                    | textbook    | general_maintenance     | Reliability, PM, engineering-level theory  |
| Industrial Maintenance and Troubleshooting, 4th ed. (ATP Learning)         | textbook    | general_maintenance     | Multi-system, strong on troubleshooting    |
| Industrial Maintenance and Mechatronics (Goodheart-Willcox)                | textbook    | general_mechatronics    | Mechanical + electrical + controls unified |
| Industrial Motor Control / Motor Controls for Integrated Systems (Alerich) | textbook    | general_electrical      | Deep on contactors, overloads, VFD basics  |

### Additional metadata fields to set on ingest
```python
metadata = {
    "source_type": "textbook",
    "equipment_type": "general_maintenance",  # or general_electrical / general_mechatronics
    "manufacturer": None,        # explicitly null — textbooks have no OEM
    "model_number": None,        # explicitly null
    "chunk_quality": "sentence_split",  # enforce new pipeline only
    "ingest_policy": "excerpt_only"     # or "full_ingest_ok" — see Section 4
}
```

---

## 3. Retrieval Guardrails

*Proposed changes to `mira-bots/shared/workers/rag_worker.py` and the retrieval logic.
**No code changes in this step.***

### Problem
Stage 1 vector search (pgvector cosine) has **no source_type filter**. A textbook chunk
like "overcurrent protection opens when motor draws excessive current" will score highly
against a query about PowerFlex 40 OC1 fault — and it **should not win** over the actual
PowerFlex 40 manual chunk.

### Proposed Rule: Manufacturer/Model Detection Gates Textbook Access

**Step 1: Detect manufacturer/model presence in query**

`neon_recall.py` already has `_PRODUCT_NAME_RE` (matches PowerFlex 40, Micro820, GS10, etc.)
and `_FAULT_CODE_RE`. These are the gates.

**Gate logic (plain English):**

```
IF query matches _PRODUCT_NAME_RE OR _FAULT_CODE_RE:
    → Stage 1 SQL adds: AND source_type IN ('manual', 'gdrive', 'seed')
    → Textbook chunks EXCLUDED from all stages
    → Only fall back to textbooks if Stage 1 + Stage 3 combined return < 3 chunks

ELSE (no product name, no fault code detected):
    → Stage 1 runs without source_type filter (textbooks allowed in candidate pool)
    → Textbooks compete on cosine similarity only
    → source_type='textbook' chunks get a score penalty of -0.05 applied post-retrieval
      to break ties in favor of verified OEM content
```

**Threshold for fallback:** `N = 3` chunks minimum from manual/gdrive/seed before
textbooks are ever considered on a product-specific query.

### SQL sketch (Stage 1 with gate applied)

```sql
-- When product/fault detected:
SELECT content, manufacturer, model_number, equipment_type, source_type,
       1 - (embedding <=> cast(:emb AS vector)) AS similarity
FROM knowledge_entries
WHERE tenant_id = :tid
  AND embedding IS NOT NULL
  AND source_type IN ('manual', 'gdrive', 'seed')   -- << textbook exclusion gate
ORDER BY embedding <=> cast(:emb AS vector)
LIMIT :lim;

-- When no product/fault detected (general query):
SELECT content, manufacturer, model_number, equipment_type, source_type,
       1 - (embedding <=> cast(:emb AS vector)) AS similarity
FROM knowledge_entries
WHERE tenant_id = :tid
  AND embedding IS NOT NULL
ORDER BY embedding <=> cast(:emb AS vector)
LIMIT :lim;
```

### Merge priority impact
The existing `_merge_results()` priority order remains unchanged:
1. `structured_fault_results` (fault_codes table, sim=0.95) — always first
2. `product_results` (product-name CTE)
3. `vector_results`
4. `like_results`

Textbook chunks can only appear in position 3 (vector_results), and only when
the gate above allows them. They **never** enter positions 1 or 2.

---

## 4. Safety & License Check

### Candidate Status

| Textbook                                          | Status                 | Rationale                                                                 |
|---------------------------------------------------|------------------------|---------------------------------------------------------------------------|
| Maintenance Engineering Handbook (McGraw-Hill)    | Excerpt-only, internal | Commercial reference. Publisher (McGraw-Hill) does not offer free PDF.    |
| Industrial Maintenance & Troubleshooting (ATP)    | Excerpt-only, internal | ATP Learning is a commercial vocational publisher. No free full-text.     |
| Industrial Maintenance and Mechatronics (GW)      | Excerpt-only, internal | Goodheart-Willcox is commercial. No free full-text.                       |
| Industrial Motor Control (Alerich / Delmar)       | Excerpt-only, internal | Commercial textbook (Cengage/Delmar). No free full-text.                  |
| OSHA/NFPA 70E safety excerpts                     | Full ingest OK         | Government/NFPA standards have specific public-use provisions.            |
| V-TECS Guide for Industrial Maintenance           | Full ingest OK         | Government-produced vocational curriculum — public domain.                |
| Industrial Maintenance Technology (state guides)  | Full ingest OK         | State vocational education materials — typically public domain.           |

### Ingest Policy

**Full ingest OK:**
- V-TECS Guide for Industrial Maintenance (vocational, public domain)
- OSHA 29 CFR 1910 maintenance-relevant sections
- State-published industrial maintenance curriculum guides

**Excerpt-only, internal use:**
- All commercial textbooks listed above
- Ingest limit: ≤ 15% of any single work, non-sequential chapters
- Label in metadata: `"ingest_policy": "excerpt_only"`
- These chunks are for internal MIRA use only — never surfaced verbatim to end users
  without proper attribution handling

> **NOTE:** Before ingesting any commercial textbook content, confirm with FactoryLM's
> legal/compliance posture. This is an internal tool, not a redistribution platform,
> which supports fair use framing — but document the decision explicitly.

---

## 5. Graph RAG Readiness

### Which sources are best suited for knowledge graph nodes

| Source                                  | Graph Fit | Best Node Types                                      |
|-----------------------------------------|-----------|------------------------------------------------------|
| Maintenance Engineering Handbook        | HIGH      | Failure modes, maintenance strategies, RCM concepts  |
| Industrial Maintenance & Troubleshooting| HIGH      | Troubleshooting procedures, decision trees           |
| Industrial Motor Control (Alerich)      | HIGH      | Component → failure mode → action chains             |
| Industrial Maintenance & Mechatronics   | MEDIUM    | System integration relationships                    |
| OEM Manuals (existing)                  | HIGHEST   | Fault → cause → action (already structured in fault_codes table) |

### Relationship types to extract

For Graph RAG, the priority extraction relationships from textbook content are:

```
fault        → has_cause        → cause
fault        → requires_action  → maintenance_action
component    → has_failure_mode → failure_mode
failure_mode → caused_by        → root_cause
procedure    → requires_tool    → tool
procedure    → precondition     → safety_check
system       → contains         → component
component    → interacts_with   → component
```

### Why textbooks are actually good graph source material

OEM manuals are great for **product-specific** fault→cause→action chains.
Textbooks are better for **generic component→failure_mode** relationships that apply
across products — e.g., "motor bearings" → "overheating" → "check lubrication interval"
is a relationship valid for any motor regardless of manufacturer.

This makes textbooks the ideal source for the **generic relationship layer** of a future
knowledge graph, while OEM manuals supply the **product-specific leaf nodes**.

### Recommended first graph extraction target

**Industrial Motor Control (Alerich)** chapters on:
- Overload relay operation and failure modes
- Contactor failure modes (welded contacts, coil burnout)
- VFD fault categories (overcurrent, undervoltage, overvoltage, ground fault)

These map directly to the fault codes MIRA already has in `fault_codes` table and would
create the first cross-product relationship layer.

---

## Key Decisions Summary

| Decision | Choice | Rationale |
|----------|--------|-----------|
| New source_type | `textbook` | Clean separation from OEM sources |
| Manufacturer/model gate | Hard exclude textbooks when product detected | Prevents contamination |
| Fallback threshold | N=3 manual chunks before textbook fallback | Conservative; adjust after eval |
| License policy | Excerpt-only for commercial books | Risk mitigation |
| Free ingest candidates | V-TECS guide, OSHA, state vocational guides | Public domain, no risk |
| Graph RAG first target | Motor control component→failure_mode layer | Bridges generic + OEM specific |

---

## Next Steps

1. **Run inventory queries** (Section 1) — confirm clean baseline before adding textbooks
2. **Source V-TECS guide and OSHA excerpts** — these can be ingested immediately
3. **Obtain commercial excerpts** — identify specific chapters/sections, document decision
4. **Update `neon_recall.py`** — implement product-name gate (separate PR)
5. **Update `ingest_manuals.py`** — add `source_type='textbook'` support and metadata fields

*Do not modify Python or SQL until Step 1 inventory is confirmed clean.*
