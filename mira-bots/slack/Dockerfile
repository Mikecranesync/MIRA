FROM python:3.12-slim

RUN apt-get update && apt-get install -y --no-install-recommends tesseract-ocr && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY slack/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY slack/bot.py slack/pdf_handler.py shared/gsd_engine.py ./

ENV PYTHONUNBUFFERED=1
CMD ["python", "bot.py"]
