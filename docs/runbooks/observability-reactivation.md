# Runbook: Re-enable Observability Stack

**When**: DAU > 10 or when real-time monitoring is needed.

## Steps

1. Move files back from `archives/`:
   ```bash
   git mv archives/mira-ops mira-ops
   git mv archives/observability observability
   git mv archives/docker-compose.observability.yml docker-compose.observability.yml
   ```

2. Re-add `mira-ops/docker-compose.yml` to root `docker-compose.yml` includes:
   ```yaml
   include:
     # ... existing includes ...
     - mira-ops/docker-compose.yml
   ```

3. Restore Makefile observe targets:
   ```makefile
   .PHONY: observe observe-down observe-logs

   observe:
   	doppler run --project factorylm --config prd -- \
   	  docker compose -f docker-compose.yml -f docker-compose.observability.yml \
   	  up -d --no-deps flower redisinsight prometheus grafana

   observe-down:
   	docker compose -f docker-compose.yml -f docker-compose.observability.yml \
   	  down flower redisinsight prometheus grafana

   observe-logs:
   	docker compose -f docker-compose.yml -f docker-compose.observability.yml \
   	  logs -f flower grafana prometheus
   ```

4. Verify:
   ```bash
   make observe
   curl -s http://localhost:9090/-/healthy   # Prometheus
   curl -s http://localhost:3001/api/health  # Grafana
   curl -s http://localhost:5555/api/workers # Flower
   ```

## Context

Archived in GH #262 (April 2026). Observability for a product with zero traffic is premature optimization.
