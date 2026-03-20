FROM python:3.12.13-slim

RUN apt-get update && apt-get install -y --no-install-recommends tesseract-ocr && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY telegram/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY shared/ ./shared/
COPY telegram/bot.py ./

ENV PYTHONUNBUFFERED=1
CMD ["python", "bot.py"]
