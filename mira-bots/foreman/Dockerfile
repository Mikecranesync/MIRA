FROM python:3.11-slim

WORKDIR /app

# Install dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy bot code
COPY bot.py .

# Run as non-root
RUN useradd -m -u 1000 foreman && chown -R foreman:foreman /app
USER foreman

# Start bot
CMD ["python", "-u", "bot.py"]
