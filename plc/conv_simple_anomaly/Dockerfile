FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY engine.py rules.py config.yaml ./
CMD ["python", "-u", "engine.py"]
