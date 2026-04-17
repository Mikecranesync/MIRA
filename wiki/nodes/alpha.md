---
title: Alpha — Mac Mini (Orchestrator)
type: node
updated: 2026-04-17
tags: [alpha, orchestrator, celery, docker, tailscale]
---

# Alpha — Mac Mini (Orchestrator)

**Hostname:** Michaels-Mac-mini-2.local
**Tailscale IP:** 100.107.140.12
**LAN IP:** 192.168.4.28 (different subnet from Bravo/Charlie — Tailscale only for cross-node)
**SSH user:** factorylm
**SSH:** `ssh alpha` from [[nodes/bravo|Bravo]] or [[nodes/charlie|Charlie]]

## Role

Dedicated Celery orchestrator in the 3-node swarm. Runs the task queue (worker + beat), observability stack, and Docker Desktop. Does NOT run MIRA core services — those live on [[nodes/charlie|Charlie]].

Commissioning PRD: `~/Downloads/alpha-node-setup-prd.md`

## Service Layout

```
/Users/factorylm/Documents/mira/           ← MIRA repo (main branch)
├── mira-crawler/                           ← Celery tasks, LinkedIn drafter
└── observability/                          ← Grafana, Prometheus config

Docker containers (when running):
├── mira-redis          (6379)              ← Celery broker
├── mira-celery-worker                      ← Task execution
├── mira-celery-beat                        ← Periodic scheduler
├── mira-flower         (5555)              ← Celery monitoring UI
├── mira-prometheus     (9090)              ← Metrics collection
├── mira-grafana        (3001)              ← Dashboards
└── mira-redisinsight   (5540)              ← Redis browser
```

## Start / Stop

```bash
cd ~/Documents/mira
doppler run --project factorylm --config prd -- \
  docker compose -f docker-compose.yml -f docker-compose.observability.yml up -d \
  mira-redis mira-celery-worker mira-celery-beat flower prometheus grafana redisinsight
```

## SSH Connectivity

| To | Command | Transport |
|----|---------|-----------|
| Bravo | `ssh bravo` | Tailscale (100.86.236.11) |
| Charlie | `ssh charlie` | Tailscale (100.70.49.126) |

LAN (192.168.1.x) is NOT reachable from Alpha (different subnet 192.168.4.x). Tailscale is the only path.

## SSH Keys

- **Pubkey:** `ssh-ed25519 AAAAC3...nuD9 macaroni@michaels-mac-mini`
- **Fingerprint:** SHA256:V7RlFNOQbo6Rq7Ky3/QDEhrRIy4IH/CsuCx9GBvMBQA
- **Doppler backup:** `SSH_ALPHA_PRIVATE_KEY`, `SSH_ALPHA_PUBLIC_KEY`, `SSH_ALPHA_CONFIG`, `SSH_ALPHA_AUTHORIZED_KEYS`
- **Cross-authorized:** Bravo and Charlie pubkeys in `~/.ssh/authorized_keys`

## Sleep Hardening

PRD says to set `sudo pmset -a sleep 0 disksleep 0 displaysleep 0 womp 1` for always-on operation. Currently sleep is prevented passively by caffeinate, not hardened via pmset. Should be fixed for production reliability.

## What Lives Here

- Celery task queue (discovery, ingest, foundational KB, LinkedIn draft generation)
- Observability stack (Flower, Prometheus, Grafana, RedisInsight)
- LinkedIn draft output: `~/drafts/linkedin/drafts/` (volume-mounted into worker)
- Network topology canonical file: `deployment/network.yml`

## Known Issues

- Sleep not hardened (caffeinate only, not pmset)
- Tailscale installed as macOS App Store build — `tailscale ssh` subcommand unavailable
- `/opt/master_of_puppets` from Alpha PRD never deployed — Docker-based Celery from mira-crawler/ used instead
