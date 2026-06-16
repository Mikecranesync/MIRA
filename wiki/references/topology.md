# MIRA Topology Reference

## Container Map

| Container | Port(s) | Network(s) |
|-----------|---------|------------|
| mira-core | 3000→8080 | core-net, bot-net |
| mira-pipeline | 9099 | core-net |
| mira-ingest | 8002→8001 | core-net |
| mira-mcp | 8000, 8001 | core-net |
| mira-docling | 5001 | core-net |
| mira-bridge | 1880 | core-net |
| mira-bot-telegram | — | bot-net, core-net |
| mira-bot-slack | — | bot-net, core-net |
| atlas-api | 8088→8080 | cmms-net, core-net |
| atlas-db | 5433 | cmms-net |
| mira-web | 3200→3000 | core-net, cmms-net |

## Node Map

| Node | Hostname | User | Role | Tailscale IP | LAN IP | Subnet |
|------|----------|------|------|-------------|--------|--------|
| Alpha | Michaels-Mac-mini-2 | factorylm | Orchestrator (Celery) | 100.107.140.12 | 192.168.4.28 | 192.168.4.x |
| Bravo | FactoryLM-Bravo | bravonode | Compute (Ollama) | 100.86.236.11 | 192.168.1.11 | 192.168.1.x |
| Charlie | CharlieNodes-Mac-mini | charlienode | KB Host (MIRA) | 100.70.49.126 | 192.168.1.12 | 192.168.1.x |

**Connectivity:** Alpha↔Bravo/Charlie via Tailscale only (different subnets). Bravo↔Charlie via LAN (same subnet) with Tailscale fallback.
**SSH keys:** stored in Doppler `factorylm/prd` as `SSH_{NODE}_{PRIVATE_KEY,PUBLIC_KEY,CONFIG,AUTHORIZED_KEYS}`.
**Canonical source:** `deployment/network.yml`
