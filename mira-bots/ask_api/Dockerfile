# MIRA Ask API — FastAPI micro-service exposing Supervisor.process() over HTTP.
# Modeled on mira-bots/whatsapp/Dockerfile (same base image + FastAPI/uvicorn stack
# + shared engine), but COPYs ask_api/ instead of whatsapp/ so ask_api/app.py and
# shared/ both land in the image. Build context is ./mira-bots (see compose).
FROM python:3.12.13-slim

WORKDIR /app

# Reuse the whatsapp bot's requirements — it is a known-good superset that
# installs uvicorn + fastapi + the shared-engine deps (httpx, PyYAML, sqlalchemy,
# psycopg2-binary, langfuse, Pillow). ask_api imports shared.engine.Supervisor,
# the same engine the whatsapp bot constructs.
COPY whatsapp/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY shared/ ./shared/
COPY prompts/ ./prompts/
COPY ask_api/ ./ask_api/

CMD ["uvicorn", "ask_api.app:app", "--host", "0.0.0.0", "--port", "8011"]
