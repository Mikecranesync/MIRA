FROM python:3.12.13-slim

WORKDIR /app
COPY pyproject.toml .
RUN pip install --no-cache-dir starlette uvicorn[standard] sqlalchemy psycopg2-binary
# Copy ALL relay modules. relay_server.py imports historian + historian_postgres
# (the Historian Query API, #2350) on top of auth/tag_ingest/ingest_contract;
# enumerating files individually silently dropped historian.py when #2350 landed
# and crash-looped the relay (ModuleNotFoundError: No module named 'historian').
# `*.py` is top-level only — tests/ stays out of the image.
COPY *.py ./

RUN addgroup --system --gid 1001 mira && \
    adduser --system --uid 1001 --ingroup mira mira

USER mira

EXPOSE 8765
CMD ["python", "relay_server.py"]
