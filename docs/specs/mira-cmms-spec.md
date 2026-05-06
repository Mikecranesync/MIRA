# mira-cmms (Atlas CMMS) Specification
**Version:** 1.0
**Last Updated:** 2026-05-05
**Owner:** Mike Harper / FactoryLM

## Purpose
Free, self-hosted **Computerized Maintenance Management System** that gives technicians and managers work-order tracking, preventive-maintenance scheduling, equipment registry, parts inventory, and file/image storage. Sourced from upstream **Atlas CMMS** (`Teptac/Atlas_CMMS`, GPL-3.0). MIRA integrates **REST-only** — no Atlas/Frappe code is imported, so MIRA's MIT/Apache 2.0 licensing is preserved.

## Scope
**IN scope**
- 4 Atlas containers: `atlas-db`, `atlas-api`, `atlas-frontend`, `atlas-minio`
- Compose files: `docker-compose.yml`, `docker-compose.local.yml`
- Smoke test (`smoke_test.sh`)
- Network mapping (`atlas-api` exposed on `core-net` for `mira-mcp`)

**OUT of scope**
- Custom code inside Atlas (we run upstream images, no patches)
- Direct UI access for end users — they hit the Hub or marketing site, which use Atlas only via the `mira-mcp` REST proxy

## Architecture
- **Layer:** Infrastructure
- **Networks:** `cmms-net` (internal), `core-net` (`atlas-api` only)

| Container | Image | Host Port | Purpose |
|---|---|---|---|
| `atlas-db` | `postgres:16-alpine` | 5433 | PostgreSQL DB |
| `atlas-api` | `intelloop/atlas-cmms-backend:v1.5.0` | 8088 | Spring Boot REST API |
| `atlas-frontend` | `intelloop/atlas-cmms-frontend:v1.5.0` | 3100 | React UI |
| `atlas-minio` | `minio/minio:RELEASE.2025-04-22T22-12-26Z` | 9000, 9001 | File/image storage |

Port remap rationale (collisions with MIRA defaults):
| Service | Atlas default | MIRA remap | Reason |
|---|---|---|---|
| Frontend | 3000 | 3100 | 3000 = mira-core (Open WebUI) |
| API | 8080 | 8088 | 8080 = mira-core internal |
| Postgres | 5432 | 5433 | Standard avoidance |

## API Contract
Atlas CMMS REST API at `http://atlas-api:8080` (internal) / `http://localhost:8088` (host). JWT bearer obtained via `/api/auth/signin`.

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/auth/signin` | `{username,password}` → `{token}` |
| GET | `/api/work-orders` | List |
| POST | `/api/work-orders` | Create |
| PATCH | `/api/work-orders/{id}` | Update |
| GET | `/api/assets` | List |
| POST | `/api/assets` | Register |
| GET | `/api/preventive-maintenances` | List |
| POST | `/api/preventive-maintenances` | Create |
| GET | `/api/parts` | List |

All MIRA usage goes through `mira-mcp` (REST + MCP tools); never call Atlas directly from `mira-web`/`mira-hub` to keep auth and tenancy translation in one place.

## Configuration
| Var | Purpose |
|---|---|
| `ATLAS_DB_PASSWORD` | Postgres password |
| `ATLAS_JWT_SECRET` | JWT signing key |
| `ATLAS_MINIO_PASSWORD` | MinIO root password |
| `ATLAS_PUBLIC_API_URL` | Public URL hint (e.g. `http://bravo:8088`) |
| `ATLAS_PUBLIC_FRONT_URL` | Public frontend URL |
| `ATLAS_PUBLIC_MINIO_URL` | Public MinIO URL |

## Quality Standards
| Metric | Current | Target |
|---|---|---|
| Tests | 0 in this repo | At least one smoke test ⇒ done; add MaintainX/Limble-style integration coverage in `mira-mcp` |
| MTTR after Atlas restart | unmeasured | ≤ 60 s to reach `/api/auth/signin` 200 |
| Backup cadence | not configured | nightly Postgres dump + MinIO sync |

Domain grade: **F** (no MIRA-side tests; we rely on upstream image quality).

## Acceptance Criteria
1. **Smoke test:** `bash mira-cmms/smoke_test.sh` exits 0 and verifies all 4 containers are healthy.
2. **Auth round-trip:** `POST /api/auth/signin` with the seeded admin returns a JWT; subsequent calls with the JWT succeed.
3. **Work-order create:** `POST /api/work-orders` from `mira-mcp` succeeds and is visible in `/api/work-orders`.
4. **License boundary:** No Atlas/Frappe Python or Java imports inside MIRA repo (`grep -ri "from atlas\|import atlas" mira-*`).
5. **Image storage:** Uploading an image to a WO via the API persists into MinIO and is retrievable via the public URL.
6. **First-time setup:** Following the runbook (`docs/runbooks/cmms-onboarding.md`) results in a working admin account and first asset.

## Known Issues
- Upstream image is GPL-3.0 — strict no-code-import policy.
- Default ports collide with MIRA; only the documented remaps are supported.

## Change Log
- 2026-04 — Multi-provider abstraction (`CMMS_PROVIDER`) added in `mira-mcp`; Atlas remains default.
