FROM python:3.12.13-slim

WORKDIR /app
COPY pyproject.toml .
RUN pip install --no-cache-dir starlette uvicorn[standard] sqlalchemy psycopg2-binary
COPY relay_server.py .
COPY auth.py .
COPY ingest_contract.py .
COPY tag_ingest.py .

RUN addgroup --system --gid 1001 mira && \
    adduser --system --uid 1001 --ingroup mira mira

USER mira

EXPOSE 8765
CMD ["python", "relay_server.py"]
