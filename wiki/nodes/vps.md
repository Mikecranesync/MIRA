---
title: VPS — DigitalOcean (factorylm-prod)
type: node
updated: 2026-04-08
tags: [vps, production, digitalocean, nginx, tls]
---

# VPS — DigitalOcean (factorylm-prod)

**Tailscale IP:** 100.68.120.99
**Public IP:** 165.245.138.91
**SSH:** `ssh vps` or `root@100.68.120.99` (Tailscale)
**OS:** Ubuntu 24.04.3 LTS, 4 vCPU, 7.8 GB RAM, 154 GB disk
**Domain:** factorylm.com (A record -> 165.245.138.91)

## Docker Stacks (as of 2026-04-03)

| Stack | Containers | Purpose |
|-------|-----------|---------|
| `mira` | 4 | MIRA SaaS v1 |
| `factorylm-cmms` | 4 | Atlas CMMS |
| `infra` | 2 | Shared Postgres + Redis |

**Stopped (2026-04-03):** Plane (11 containers), Flowise, n8n, master_of_puppets — freed 2.5 GB swap.

## Nginx Virtual Hosts

| Domain | Target |
|--------|--------|
| factorylm.com | Marketing site (mira-web) |
| app.factorylm.com | MIRA SaaS app |
| cmms.factorylm.ai | Atlas CMMS |
| plane.factorylm.com | Stopped |

## TLS

Certs at `/etc/letsencrypt/live/factorylm.com/` and `/etc/letsencrypt/live/app.factorylm.com/`. Managed by Certbot.

## Firewall (ufw)

| Port | Rule |
|------|------|
| 22 | ALLOW |
| 80, 443 | ALLOW |
| 8070 | ALLOW |
| Postgres, Redis, MkDocs, Jarvis | DENY from public |
| Tailscale | All traffic allowed |

## Ollama

Installed on host (CPU-only). `nomic-embed-text` pulled. Reachable from Docker at `http://172.17.0.1:11434`.

## Doppler

Service token scoped to `/opt/mira`, token-storage file mode. (Working — unlike [[nodes/bravo]] and [[nodes/charlie]].)
