FROM node:22-alpine AS base

FROM base AS deps
RUN apk add --no-cache libc6-compat
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm install --no-audit

FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
ARG NEXT_PUBLIC_BASE_PATH=/hub
ARG NEXT_PUBLIC_API_BASE=/hub
ARG NEXT_PUBLIC_PIPELINE_API_URL=https://app.factorylm.com
ENV NEXT_PUBLIC_BASE_PATH=$NEXT_PUBLIC_BASE_PATH
ENV NEXT_PUBLIC_API_BASE=$NEXT_PUBLIC_API_BASE
ENV NEXT_PUBLIC_PIPELINE_API_URL=$NEXT_PUBLIC_PIPELINE_API_URL
RUN npm run build

FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# Deploy identity (#2226) — baked at build time, read at runtime by /api/version
# and /api/health so a QA pass can confirm WHICH code is live. Default "unknown"
# keeps a local build (no build-args) working; deploy-vps.yml passes the real
# values via docker-compose build.args.
ARG MIRA_GIT_SHA=unknown
ARG MIRA_APP_VERSION=unknown
ARG MIRA_BUILD_TIME=unknown
ENV MIRA_GIT_SHA=$MIRA_GIT_SHA
ENV MIRA_APP_VERSION=$MIRA_APP_VERSION
ENV MIRA_BUILD_TIME=$MIRA_BUILD_TIME

RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs
EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/api/health/ || wget -qO- http://127.0.0.1:3000/hub/api/health/ || exit 1

CMD ["node", "server.js"]
