FROM python:3.11-slim

WORKDIR /app

# Install dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy bot code. `specialists` is imported at module scope by bot.py, so the
# package and its definition files MUST ship or the container dies with
# ModuleNotFoundError before FOREMAN_ROUTING_CARD is ever read.
COPY bot.py specialists.py ./
COPY specialists/ ./specialists/

# Run as non-root
RUN useradd -m -u 1000 foreman && chown -R foreman:foreman /app
USER foreman

# Start bot
CMD ["python", "-u", "bot.py"]
