## Build context is the REPO ROOT (docker-compose.*.yml: context: ., dockerfile: mira-hub/Dockerfile).
## Hub mount PR 1 (#3839): the shared FactoryLM shell sources live in ../packages/factorylm-*
## and compile into the Hub bundle at build time. They resolve react / @assistant-ui through
## a symlinked node_modules that IS the Hub's, so there is exactly one React. Nothing from
## packages/ is needed at runtime; the runner stage is unchanged.
FROM node:22-alpine AS base

FROM base AS deps
RUN apk add --no-cache libc6-compat
WORKDIR /app/mira-hub
COPY mira-hub/package.json mira-hub/package-lock.json ./
RUN npm install --no-audit

FROM base AS builder
WORKDIR /app
COPY --from=deps /app/mira-hub/node_modules ./mira-hub/node_modules
COPY mira-hub ./mira-hub
COPY packages/factorylm-interaction ./packages/factorylm-interaction
COPY packages/factorylm-ui ./packages/factorylm-ui
COPY packages/factorylm-theme ./packages/factorylm-theme
RUN ln -s ../mira-hub/node_modules packages/node_modules
WORKDIR /app/mira-hub
ENV NEXT_TELEMETRY_DISABLED=1
ARG NEXT_PUBLIC_BASE_PATH=/hub
ARG NEXT_PUBLIC_API_BASE=/hub
ARG NEXT_PUBLIC_PIPELINE_API_URL=https://app.factorylm.com
ENV NEXT_PUBLIC_BASE_PATH=$NEXT_PUBLIC_BASE_PATH
ENV NEXT_PUBLIC_API_BASE=$NEXT_PUBLIC_API_BASE
ENV NEXT_PUBLIC_PIPELINE_API_URL=$NEXT_PUBLIC_PIPELINE_API_URL
RUN npm run build

FROM base AS runner
WORKDIR /app/mira-hub
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

# #3870: the node:22-alpine base ships its own npm CLI under
# /usr/local/lib/node_modules/npm, and npm's bundled tar 7.5.11 (CVE-2026-59873
# CRITICAL), pacote, sigstore and brace-expansion are what the image scan flags
# beyond next/sharp — they are not in the Hub's dependency tree at all. The
# runtime is `node server.js` and never invokes npm, so drop it from the image.
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx

# With the compiler root at the repo root, `.next/standalone` mirrors the repo layout:
# server.js + node_modules live under standalone/mira-hub/, and Turbopack's hashed
# server externals (`.next/node_modules/pg-<hash>`) are RELATIVE symlinks that assume
# that nesting. So the Hub subtree is copied to /app/mira-hub — never flattened to /app,
# which breaks those links and leaves the image unable to load `pg` (found the hard way).
# Only the Hub subtree is copied: the tracer's sibling pulls (wiki/, mira-web/, tools/)
# stay out of the image, and the runtime file set matches what shipped before.
COPY --from=builder /app/mira-hub/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/mira-hub/.next/standalone/mira-hub ./
COPY --from=builder --chown=nextjs:nodejs /app/mira-hub/.next/static ./.next/static

USER nextjs
EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/api/health/ || wget -qO- http://127.0.0.1:3000/hub/api/health/ || exit 1

CMD ["node", "server.js"]
