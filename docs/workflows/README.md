# docs/workflows/ — End-to-End Feature Flows

Each doc traces ONE feature from front door to database, with exact `file:line`, function names, and tables. Read the relevant flow before changing code in that path.

| Flow | What it traces | Start here in code |
|---|---|---|
| [pdf-upload-flow.md](pdf-upload-flow.md) | PDF upload → Hub route → mira-ingest → Open WebUI KB → `knowledge_entries` (+ the known "not citable" gap) | `mira-core/mira-ingest/`, `mira-crawler/ingest/` |
| [diagnostic-engine-flow.md](diagnostic-engine-flow.md) | Question → intent classifier → UNS gate → RAG retrieval → cascade inference → grounded answer → citation compliance | `mira-bots/shared/engine.py` `process()` |
| [tag-ingestion-flow.md](tag-ingestion-flow.md) | Ignition → HMAC batch → relay → `tag_events` → `live_signal_cache` freshness → Command Center | `mira-relay/relay_server.py`, `tag_ingest.py` |
| [cmms-sync-flow.md](cmms-sync-flow.md) | Atlas CMMS ↔ NeonDB sync → work orders / PM → Hub display | `mira-hub/scripts/cmms-sync-worker.ts` |
| [connector-import-flow.md](connector-import-flow.md) | External system → connector import → normalize → canonical → proposals → review (adapters are **mocks**) | `mira-connectors/mira_connectors/` |
| [knowledge-graph-flow.md](knowledge-graph-flow.md) | Entity/edge creation → proposals → evidence → admin approval → verified graph → traversal tools | `mira-crawler/ingest/kg_writer.py` |
| [lead-discovery-flow.md](lead-discovery-flow.md) | Cron → city rotation → web search → HubSpot dedup → create company → enrichment (**real** prospects) | `tools/lead-hunter/` |
| [self-healer-flow.md](self-healer-flow.md) | Cron → check containers → detect → restart/recreate → Telegram alert (+ recreate-gap bug) | `mira-crawler/agents/self_healer.py` |

**See also:** [../architecture/](../architecture/) for the static system map (container-map, database-map, real-vs-simulated), and [../runbooks/](../runbooks/) for operational procedures.
