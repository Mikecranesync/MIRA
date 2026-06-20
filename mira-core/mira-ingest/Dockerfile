FROM python:3.12.13-slim

# Pull Debian security updates at build time (catches HIGH/CRITICAL CVEs
# with upstream fixes — e.g. openssl DoS CVE-2026-28390). Does not affect
# runtime behavior; kept in a single RUN layer to minimize image size.
RUN apt-get update && apt-get upgrade -y && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY main.py crawl_verifier.py route_fallback.py asset_tag.py crawl_routes.yaml ./
COPY db/ db/

# DEPLOY WIRING (follow-up): the /ingest/plc-parse endpoint imports the stdlib-only
# `mira_plc_parser` package (repo-root/mira-plc-parser/). It is NOT yet on this image, so the
# endpoint returns HTTP 503 until wired. To enable it, change this service's build context to the
# repo root (docker-compose `build: { context: ., dockerfile: mira-core/mira-ingest/Dockerfile }`),
# then add: `COPY mira-plc-parser/mira_plc_parser/ ./mira_plc_parser/`. The package has no
# third-party deps (stdlib only), so nothing else changes. Verify on staging before prod.

RUN addgroup --system --gid 1001 mira && \
    adduser --system --uid 1001 --ingroup mira mira

USER mira

ENV PYTHONUNBUFFERED=1
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8001"]
