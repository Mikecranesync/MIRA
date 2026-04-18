FROM python:3.12.13-slim

WORKDIR /app
COPY pyproject.toml .
RUN pip install --no-cache-dir starlette uvicorn[standard]
COPY relay_server.py .

EXPOSE 8765
CMD ["python", "relay_server.py"]
