FROM python:3.12.13-slim

# Pull Debian security updates at build time (catches HIGH/CRITICAL CVEs
# with upstream fixes — e.g. openssl DoS CVE-2026-28390). Does not affect
# runtime behavior; kept in a single RUN layer to minimize image size.
RUN apt-get update && apt-get upgrade -y && rm -rf /var/lib/apt/lists/*

# BUILD CONTEXT IS THE REPO ROOT (see docker-compose.saas.yml
# mira-ingest.build.context). Required so the stdlib-only `mira_plc_parser`
# package (repo-root/mira-plc-parser/) can be copied in to power
# POST /ingest/plc-parse. All COPY sources below are therefore repo-root-relative.
# A repo-root .dockerignore keeps node_modules/.git/.next out of the context.
# This image still uses an explicit COPY allow-list — new top-level mira-ingest
# *.py modules must be added here or they won't ship.
WORKDIR /app
COPY mira-core/mira-ingest/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY mira-core/mira-ingest/main.py \
     mira-core/mira-ingest/crawl_verifier.py \
     mira-core/mira-ingest/route_fallback.py \
     mira-core/mira-ingest/asset_tag.py \
     mira-core/mira-ingest/relevance.py \
     mira-core/mira-ingest/crawl_routes.yaml ./
COPY mira-core/mira-ingest/db/ db/

# PLC parser package (no third-party deps — stdlib only). Imported lazily by the
# /ingest/plc-parse endpoint; with it present the endpoint returns 200 instead of
# the 503 it served while unwired.
COPY mira-plc-parser/mira_plc_parser/ ./mira_plc_parser/

# The CSV tag-export parser (mira_plc_parser/parsers/csv_tags.py) reuses the pure,
# self-contained tag_csv.py from the Ignition tree by path. That tree is NOT in this
# image (we COPY only the package), so bundle the one file and point the parser at it
# via MIRA_TAG_CSV_PATH — otherwise CSV uploads 500 with FileNotFoundError.
COPY ignition/webdev/FactoryLM/api/diagnose/tag_csv.py ./vendor/tag_csv.py
ENV MIRA_TAG_CSV_PATH=/app/vendor/tag_csv.py

RUN addgroup --system --gid 1001 mira && \
    adduser --system --uid 1001 --ingroup mira mira

USER mira

ENV PYTHONUNBUFFERED=1
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8001"]
