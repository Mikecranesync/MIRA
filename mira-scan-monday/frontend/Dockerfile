FROM node:20-alpine AS build
WORKDIR /app

ARG VITE_API_BASE_URL=""
ARG VITE_FACTORYLM_SIGNUP_URL="https://app.factorylm.com/signup"
ARG VITE_BASE_PATH="/"
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL
ENV VITE_FACTORYLM_SIGNUP_URL=$VITE_FACTORYLM_SIGNUP_URL
ENV VITE_BASE_PATH=$VITE_BASE_PATH

COPY package.json ./
RUN npm install --no-audit --no-fund
COPY . .
RUN npm run build

FROM nginx:1.27-alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD wget -q -O - http://127.0.0.1/ >/dev/null || exit 1
