# Containerized Print of the Day — pinned, reproducible, provenance-labelled.
# ADR-0031 PR 6 / CLF POTD surface.
#
# Build (records the git SHA as both an OCI label and IMAGE_REVISION):
#   SHA=$(git rev-parse HEAD)
#   docker build -f tools/print_of_day/Dockerfile \
#     --build-arg GIT_SHA=$SHA --build-arg VERSION=$(cat VERSION) \
#     --label org.opencontainers.image.revision=$SHA \
#     -t mira-print-of-day:$SHA .
#
# The runtime refuses to start (provenance gate) when the running code's git
# SHA does not match IMAGE_REVISION — a container that is not the image it
# claims to be is not reproducible.

FROM python:3.12.13-slim

# Tesseract is a REQUIRED capability for POTD (fail-closed readiness). No git:
# a built container has no live git; its identity is the baked IMAGE_REVISION.
RUN apt-get update && apt-get upgrade -y \
    && apt-get install -y --no-install-recommends tesseract-ocr \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
ENV PYTHONUNBUFFERED=1

# Minimal, pinned runtime deps (httpx + pydantic for interpret/grade/judge/mailer,
# Pillow for preprocess, pytesseract for the required OCR floor).
COPY tools/print_of_day/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# The reused stages + the provider hardening (registry / readiness / codes /
# approved policy) + the vision canary fixture.
COPY printsense/ ./printsense/
COPY factorylm_ai/ ./factorylm_ai/
COPY config/providers/ ./config/providers/
COPY materialized_evidence/ ./materialized_evidence/
COPY tools/internet_print_test/ ./tools/internet_print_test/
COPY tools/print_of_day/ ./tools/print_of_day/
COPY tools/canary_fixtures/ ./tools/canary_fixtures/
COPY VERSION .
# No .git in the image: a built container has no live git. Its identity is the
# baked IMAGE_REVISION (below), which the provenance gate treats as the
# authoritative, immutable SHA — the reproducible production path.

# Provenance: the git SHA the image was built from, recorded as OCI labels AND
# an env var the runtime asserts against the live code.
ARG GIT_SHA=unknown
ARG VERSION=unknown
ARG REPO=https://github.com/Mikecranesync/MIRA
LABEL org.opencontainers.image.revision=$GIT_SHA \
      org.opencontainers.image.source=$REPO \
      org.opencontainers.image.version=$VERSION \
      org.opencontainers.image.title="mira-print-of-day"
ENV IMAGE_REVISION=$GIT_SHA \
    IMAGE_VERSION=$VERSION \
    OCR_REQUIRE_TESSERACT=1 \
    PRINT_VISION_PROVIDER=together \
    PRINT_VISION_MODEL=MiniMaxAI/MiniMax-M3 \
    PRINT_PROVIDER_POLICY=strict

# Default: readiness self-check. The real run is invoked with args by the
# scheduler; production activation is NOT part of this image's default entry.
ENTRYPOINT ["python", "-m", "tools.print_of_day.run"]
CMD ["--help"]
