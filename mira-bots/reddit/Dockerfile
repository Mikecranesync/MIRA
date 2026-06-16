FROM python:3.12.13-slim

WORKDIR /app

COPY reddit/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY shared/ ./shared/
COPY prompts/ ./prompts/
COPY reddit/bot.py reddit/reddit_client.py reddit/post_filter.py ./

ENV PYTHONUNBUFFERED=1
CMD ["python", "bot.py"]
