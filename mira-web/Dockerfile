FROM oven/bun:1.2.9-slim AS base
WORKDIR /app

# Build arguments for version/identity tracking
ARG MIRA_GIT_SHA=unknown
ARG MIRA_APP_VERSION=unknown
ARG MIRA_BUILD_TIME=unknown
ENV MIRA_GIT_SHA=$MIRA_GIT_SHA
ENV MIRA_APP_VERSION=$MIRA_APP_VERSION
ENV MIRA_BUILD_TIME=$MIRA_BUILD_TIME

# Install curl for healthcheck
RUN apt-get update && apt-get install -y --no-install-recommends curl && rm -rf /var/lib/apt/lists/*

# Install deps
COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile 2>/dev/null || bun install

# Copy source
COPY tsconfig.json ./
COPY src/ ./src/
COPY public/ ./public/
COPY emails/ ./emails/

EXPOSE 3000

CMD ["bun", "run", "src/server.ts"]
