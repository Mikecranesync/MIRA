# SimLab — the deterministic juice-bottling line behind the public FactoryLM demo.
#
# Read-only by construction: the simulator holds its whole world in memory, has
# no database, no volume, and no write path to anything outside the container.
# A restart is a clean line. That is why there is no persistence here and none
# is wanted — the demo's contract is "a healthy line, a jam you inject, a reset".
#
# It is deployed ONLY in public-demo mode (`SIMLAB_PUBLIC_ONLY=1`), which serves
# the eleven read/control paths the visitor flow needs and 404s everything else.
# SimLab is both the machine AND the grader, and the grading half — rubric,
# evidence packet, eval scorecard, approval gate, engineer dashboard — must
# never be reachable from a public origin, or the demo's claim that MIRA was not
# told the answer is falsifiable with curl. See `PUBLIC_DEMO_PATHS` in
# `simlab/api.py` and `tests/simlab/test_public_only_mode.py`.

FROM python:3.12.13-slim

WORKDIR /app

# Only what the API surface needs. No DB driver, no HTTP client, no broker
# client: this container talks to nothing outbound.
RUN pip install --no-cache-dir \
      "fastapi==0.115.6" \
      "uvicorn[standard]==0.34.0"

# The simulator package only. Tests, docs, and the rest of the monorepo stay
# out of the image — a smaller image is also a smaller thing to get wrong.
COPY simlab/ ./simlab/

RUN addgroup --system --gid 1001 mira && \
    adduser --system --uid 1001 --ingroup mira mira
USER mira

EXPOSE 8099

# Bind all interfaces INSIDE the container; the compose file publishes it to
# loopback only, so the host never exposes this port to the network directly.
ENV SIMLAB_PUBLIC_ONLY=1 \
    PYTHONUNBUFFERED=1

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8099/simlab/healthz', timeout=3).status == 200 else 1)"

CMD ["python", "-m", "simlab", "--host", "0.0.0.0", "--port", "8099"]
