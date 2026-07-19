FROM python:3.12.13-slim

RUN apt-get update && apt-get upgrade -y && apt-get install -y --no-install-recommends tesseract-ocr && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY mira-bots/slack/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY mira-bots/shared/ ./shared/
# Ship the same isolated PrintSense print-vision framework as Telegram. It is
# inert unless PRINT_VISION_PROVIDER plus the active provider key are set; when
# unset, the engine falls back to the free OCR/cascade path.
COPY printsense/ ./printsense/
COPY mira-bots/prompts/ ./prompts/
COPY mira-bots/slack/bot.py mira-bots/slack/chat_adapter.py mira-bots/slack/pdf_handler.py mira-bots/slack/doctor.py ./
COPY VERSION .

ENV PYTHONUNBUFFERED=1
CMD ["python", "bot.py"]
