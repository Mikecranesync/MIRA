FROM python:3.12.13-slim

# Pull Debian security updates at build time (catches fixable HIGH/CRITICAL CVEs).
RUN apt-get update && apt-get upgrade -y && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY server.py .
COPY atlas_client.py .
COPY tenant_resolver.py .
COPY cmms/ ./cmms/
COPY context/ ./context/

CMD ["python", "server.py"]
