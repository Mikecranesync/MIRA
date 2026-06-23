.PHONY: demo-preflight observe observe-down observe-logs discovery-phase0 context-phase1 causality-phase2 explainability-phase3

discovery-phase0:  ## Run the Phase 0 discovery gate (interrogate synthetic fixture -> report -> pytest)
	python discovery_corpus/run_phase0.py

context-phase1:  ## Run the Phase 1 contextualizer gate (Phase 0 -> FactoryModel + UNS draft -> report -> pytest)
	python factory_context/run_phase1.py

causality-phase2:  ## Run the Phase 2 causality gate (Phase 1 -> failure modes -> Ask-MIRA explanation -> pytest)
	python causality/run_phase2.py

explainability-phase3:  ## Run the Phase 3 explainability gate (Phase 2 -> evidence graph -> auditable answer -> pytest)
	python evidence_graph/run_phase3.py

demo-preflight:
	doppler run --project factorylm --config prd -- bash scripts/demo-preflight.sh

observe:
	doppler run --project factorylm --config prd -- \
	  docker compose -f docker-compose.yml -f docker-compose.observability.yml \
	  up -d --no-deps flower redisinsight prometheus grafana
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
