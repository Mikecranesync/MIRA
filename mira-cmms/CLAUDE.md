# mira-cmms — Atlas CMMS for MIRA

Free, self-hosted CMMS (Computerized Maintenance Management System) giving technicians and managers work order tracking, PM scheduling, equipment registries, and parts inventory.

## Architecture

- **Atlas CMMS** (https://github.com/Teptac/Atlas_CMMS) — GPL-3.0, 4 containers
- MIRA integrates via REST API only (no Frappe/Atlas code imported — clean license boundary)
- `atlas-api` is on both `cmms-net` and `core-net` so mira-mcp can reach it

## Containers

| Container | Image | Host Port | Purpose |
|-----------|-------|-----------|---------|
| atlas-db | postgres:16-alpine | 5433 | PostgreSQL database |
| atlas-api | intelloop/atlas-cmms-backend:v1.5.0 | 8088 | Spring Boot REST API |
| atlas-frontend | intelloop/atlas-cmms-frontend:v1.5.0 | 3100 | React web UI |
| atlas-minio | minio/minio:RELEASE.2025-04-22T22-12-26Z | 9000, 9001 | File/image storage |

## Port Map (avoids MIRA conflicts)

| Service | Atlas Default | MIRA Remap | Reason |
|---------|--------------|------------|--------|
| Frontend | 3000 | 3100 | 3000 = mira-core (Open WebUI) |
| API | 8080 | 8088 | 8080 = mira-core internal |
| PostgreSQL | 5432 | 5433 | Standard port avoidance |
| MinIO API | 9000 | 9000 | No conflict |
| MinIO Console | 9001 | 9001 | No conflict |

## Networks

- `cmms-net` — internal Atlas communication (db, minio, api, frontend)
- `core-net` — shared with MIRA core (atlas-api exposed here for mira-mcp integration)

## Secrets (Doppler: factorylm/prd)

| Var | Purpose |
|-----|---------|
| `ATLAS_DB_PASSWORD` | PostgreSQL password |
| `ATLAS_JWT_SECRET` | JWT signing key |
| `ATLAS_MINIO_PASSWORD` | MinIO root password |

## API Integration Points (for mira-mcp)

Atlas CMMS REST API at `http://atlas-api:8080` (internal) or `http://localhost:8088` (host):

```
POST   /api/auth/signin         — Get JWT token
GET    /api/work-orders         — List work orders
POST   /api/work-orders         — Create work order
PATCH  /api/work-orders/{id}    — Update work order
GET    /api/assets              — List equipment assets
POST   /api/assets              — Register new asset
GET    /api/preventive-maintenances — List PM schedules
POST   /api/preventive-maintenances — Create PM schedule
GET    /api/parts               — List spare parts
```

Auth: JWT Bearer token from `/api/auth/signin` with username/password.

## First-Time Setup

1. Start containers: `doppler run -- docker compose up -d`
2. Open `http://localhost:3100` in browser
3. Create admin account (first user becomes admin)
4. Create company, locations, asset categories
5. Register equipment assets matching MIRA's equipment IDs
