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

# Nameplate text-DETECTION stack (ask_api/nameplate_detect.py, feature-flagged
# by NAMEPLATE_DETECT_ENABLED — default off, nothing loads at startup).
# System libs: python-slim lacks libgomp (paddle core) and libGL/glib (the
# opencv-contrib-python that paddlex hard-requires BY NAME — swapping in
# opencv-python-headless breaks paddlex's dependency check, verified on the
# 2026-08-16 VPS probe). Versions pinned to the probe-qualified pair.
# License note: libgomp1 (GPL w/ runtime exception), libgl1/libglib2.0-0 (LGPL)
# are dynamically-linked Debian SYSTEM libraries inside the container image —
# not source dependencies of MIRA code. The PRD §4 Apache/MIT-only rule governs
# code dependencies; the base image already ships glibc (LGPL) on the same
# terms. paddlepaddle + paddleocr are Apache-2.0.
RUN apt-get update -qq \
    && apt-get install -y -qq --no-install-recommends libgomp1 libgl1 libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/* \
    && pip install --no-cache-dir paddlepaddle==3.3.1 paddleocr==3.7.0

COPY shared/ ./shared/
COPY prompts/ ./prompts/
COPY ask_api/ ./ask_api/

CMD ["uvicorn", "ask_api.app:app", "--host", "0.0.0.0", "--port", "8011"]
