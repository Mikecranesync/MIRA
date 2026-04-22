FROM python:3.12.13-slim

RUN apt-get update && apt-get upgrade -y && apt-get install -y --no-install-recommends tesseract-ocr && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY mira-bots/telegram/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY mira-bots/shared/ ./shared/
COPY mira-bots/prompts/ ./prompts/
COPY mira-bots/telegram/bot.py mira-bots/telegram/chat_adapter.py mira-bots/telegram/renderers.py ./
COPY VERSION .

ENV PYTHONUNBUFFERED=1
CMD ["python", "bot.py"]
