# docs/architecture/ — System Reference

Static reference for how MIRA is built. For *flows* (how a feature executes) see [../workflows/](../workflows/); for *procedures* see [../runbooks/](../runbooks/); for *doctrine* see [../THEORY_OF_OPERATIONS.md](../THEORY_OF_OPERATIONS.md).

## Reference set (comprehensive, 2026-06-07)

| Doc | Answers |
|---|---|
| [container-map.md](container-map.md) | Every container: port, network, compose file, mem limit, what it does (prod vs dev) |
| [database-map.md](database-map.md) | Every NeonDB table: who writes it, who reads it, which Hub page displays it |
| [real-vs-simulated.md](real-vs-simulated.md) | **Demo credibility** — what's real production data, what's mock, what's bench-only |
| [environment-quick-ref.md](environment-quick-ref.md) | dev/staging/prod quick card (Doppler, Neon branch, bot token, VPS) |
| [branch-and-pr-status.md](branch-and-pr-status.md) | Snapshot of main + open PRs by theme (**regenerate before trusting**) |

## Existing deep references
- **System & C4:** `SYSTEM_OVERVIEW.md`, `c4-context.md`, `c4-containers.md`, `c4-components.md`, `c4-deployment.md`, `c4-dynamic-fault-flow.md`
- **Engine & RAG:** `ENGINE_REFERENCE.md`, `rag-pipeline.md`, `open-webui-routing.md`
- **Ingest:** `INGEST_PIPELINES.md`, `photo-kb-pipeline.md`
- **Data tier:** `FactoryLM_Data_Tier_Architecture.md`
- **Ignition / MES:** `mira-ignition-module-architecture.md`, `mira-flowfuse-ignition-application.md`, `node-red-ignition-bidirectional-patterns.md`, `mes-stack-diagram.md`
- **Known issues:** `KNOWN_ISSUES.md`
