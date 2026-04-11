# mira-ops — Content & Social Fleet Dashboard

## What This Is
Operations dashboard for MIRA's automated marketing content pipeline.
Shows content/social items from NeonDB, approve/reject workflow, manual
task triggers, and Celery worker health. Paired with Celery Flower for
raw task monitoring.

## Stack
- **Runtime:** Python 3.12
- **Framework:** FastAPI + Jinja2 + htmx (server-rendered, no React)
- **Database:** NeonDB (content_items, social_items tables)
- **Task Queue:** Celery via Redis broker (shared with mira-crawler)
- **Monitoring:** Celery Flower (separate container)

## Ports
- mira-ops: 8500
- mira-flower: 5555

## Key Routes
| Method | Path | Purpose |
|--------|------|---------|
| GET | / | Dashboard overview (KPIs, recent content, fleet status) |
| GET | /content | Content items table with approve/reject |
| GET | /social | Social items table with platform badges |
| GET | /workers | Celery worker health + queue stats |
| POST | /generate/blog | Trigger manual blog post generation |
| POST | /generate/social | Trigger manual social batch |
| POST | /generate/video | Trigger manual video script |
| POST | /content/{id}/approve | Approve content item (htmx) |
| POST | /content/{id}/reject | Reject content item (htmx) |
| GET | /api/stats | JSON stats for htmx auto-refresh |
| GET | /api/health | Liveness probe |

## Key Env Vars
| Var | Purpose |
|-----|---------|
| `NEON_DATABASE_URL` | NeonDB connection string |
| `CELERY_BROKER_URL` | Redis broker (default: redis://mira-redis:6379/0) |
