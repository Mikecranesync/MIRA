FROM python:3.12.13-slim

RUN apt-get update && apt-get upgrade -y && apt-get install -y --no-install-recommends tesseract-ocr && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY mira-bots/telegram/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY mira-bots/shared/ ./shared/
COPY mira-bots/prompts/ ./prompts/
# Ops-agent runners invoked via `docker exec … python3 /app/agents/*.py` from the
# install_crons.sh crontab (morning_brief 09:00, safety_alert 10:00, pm_escalation
# 12:00 UTC). They import from /app/shared, so they must ship in this image —
# without this COPY the crons fail "No such file" every run (fixed 2026-07-09).
COPY mira-bots/agents/ ./agents/
COPY mira-bots/telegram/bot.py mira-bots/telegram/chat_adapter.py mira-bots/telegram/renderers.py mira-bots/telegram/voice_transcription.py mira-bots/telegram/admin_commands.py mira-bots/telegram/start_command.py ./
COPY VERSION .

ENV PYTHONUNBUFFERED=1
CMD ["python", "bot.py"]
