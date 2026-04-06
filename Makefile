.PHONY: observe observe-down observe-logs

observe:
	doppler run --project factorylm --config prd -- \
	  docker compose -f docker-compose.yml -f docker-compose.observability.yml \
	  up -d flower redisinsight prometheus grafana
	@echo ""
	@echo "Observability stack running:"
	@echo "   Flower (Celery)  -> http://localhost:5555  (admin / mira2026)"
	@echo "   RedisInsight     -> http://localhost:5540"
	@echo "   Prometheus       -> http://localhost:9090"
	@echo "   Grafana          -> http://localhost:3001  (admin / mira2026)"
	@echo ""

observe-down:
	docker compose -f docker-compose.yml -f docker-compose.observability.yml \
	  down flower redisinsight prometheus grafana

observe-logs:
	docker compose -f docker-compose.yml -f docker-compose.observability.yml \
	  logs -f flower grafana prometheus
