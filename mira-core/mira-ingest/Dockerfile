FROM python:3.12.13-slim

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY main.py crawl_verifier.py route_fallback.py crawl_routes.yaml ./
COPY db/ db/

ENV PYTHONUNBUFFERED=1
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8001"]
