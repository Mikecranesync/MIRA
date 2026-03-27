FROM python:3.12.13-slim

WORKDIR /app

COPY teams/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY shared/ ./shared/
COPY prompts/ ./prompts/
COPY teams/bot.py ./

CMD ["python", "bot.py"]
