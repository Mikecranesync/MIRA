FROM python:3.12.13-slim

WORKDIR /app

COPY whatsapp/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY shared/ ./shared/
COPY whatsapp/bot.py ./

CMD ["uvicorn", "bot:app", "--host", "0.0.0.0", "--port", "8010"]
