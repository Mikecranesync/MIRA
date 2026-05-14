# MIRA MCP Plan

This directory specifies which MCP servers Claude Code should reach for when working on MIRA, and proposes 5 custom MIRA-specific MCP servers.

> Custom MCPs MUST start **read-only**. Write tools — especially anything touching live plant data, MQTT topics, or work-order creation — are gated behind explicit admin/technician approval. See each spec.

## Already useful (existing, generic MCPs)

| Server | Why it helps MIRA |
|---|---|
| **GitHub** | PR review, issue triage, commit history, branch ops. Use `gh` CLI when MCP is unavailable. |
| **Postgres** | Direct NeonDB inspection — `kg_entities`, `kg_relationships`, `cmms_equipment`, migrations. Read-only by default. |
| **Filesystem** | Cross-module reads — manuals in `mira-crawler/`, tag exports in `ignition/`, fixtures in `mira-core/data/`. |
| **Slack** | Read/post in technician channels — useful for replaying a real Slack thread into the engine for debugging. Restricted to debug channels. |
| **Google Drive** | Customer-uploaded manuals land in Drive before ingestion. Skim manifests before `mira-crawler` picks them up. |
| **Playwright** | Browser automation for `web-review` skill, screenshot capture (replaces ad-hoc Chrome headless), CMMS UI testing. Configured in `.mcp.json` as of 2026-05-14. |

## Proposed custom MIRA MCPs

Five servers, each scoped to one product surface. Read-only first.

| Spec | Surface | Read-only tools | Write tools (gated) |
|---|---|---|---|
| `mira-uns-mcp-spec.md` | Unified Namespace lookup | `search_namespace`, `get_asset`, `list_children`, `get_related_components`, `get_live_tags`, `resolve_location_hint`, `get_candidate_contexts` | none (read-only) |
| `mira-component-graph-mcp-spec.md` | Component knowledge graph | `find_component`, `search_components`, `get_relationships` | `propose_relationship`, `mark_relationship_verified`, `mark_relationship_rejected` (admin-gated) |
| `mira-doc-ingestion-mcp-spec.md` | Manuals / docs | `list_documents`, `search_documents`, `extract_manual_sections`, `get_document_chunks`, `extract_maintenance_schedule`, `extract_troubleshooting_table` | `link_document_to_component` (admin-gated) |
| `mira-work-order-mcp-spec.md` | Work orders / CMMS | `search_work_orders`, `get_failure_history`, `get_common_fixes`, `get_repeat_failures` | `create_draft_work_order` (draft only — explicit approval to commit) |
| `mira-plc-map-mcp-spec.md` | PLC tag map | `list_plcs`, `search_tags`, `get_tag`, `find_tags_by_component`, `get_logic_references` | `propose_tag_component_mapping` (proposed status, requires confirmation) |

## Cross-cutting safety rules

1. **No live-write to MQTT, PLCs, or SCADA from any MCP server.** That's a different system and out of MIRA's scope.
2. **No auto-verify.** Every write tool that proposes a relationship/mapping persists with status `proposed`. Promotion to `verified` is a separate admin action.
3. **Evidence + confidence in every return.** Read tools return `{result, evidence: [...], confidence: low|medium|high}`. Consumers can decide whether the response is good enough.
4. **Tenant isolation.** Every tool takes (or infers from auth) a `tenant_id`; cross-tenant reads are rejected.
5. **PII / sanitization.** Tag values, work-order notes, technician messages may contain PII or IPs. Pass through `mira-bots/shared/inference/router.py:sanitize_context` before logging.

## Implementation notes

- The existing `mira-mcp/server.py` (FastMCP 3.2) already implements a subset — `cmms_create_work_order`, `cmms_get_asset`, equipment diagnostics. The custom MCPs above are organized by **product surface**, not 1:1 with code modules. Consolidate into `mira-mcp/` rather than spawning new repos unless there's a strong reason.
- Start every new MCP server as a sub-module under `mira-mcp/` with its own tool registration block. Share auth + tenant resolution.
- Each MCP spec in this directory defines: tool name, signature, semantics, evidence/confidence shape, safety notes.
