# syntax=docker/dockerfile:1.7

# Build stage
FROM node:20-alpine AS builder
WORKDIR /app

ARG NEOLESK_KROKI_ENGINE

COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts

COPY .env* ./
COPY index.html tsconfig.json vite.config.mjs ./
COPY public ./public
COPY scripts ./scripts
COPY src ./src
RUN --mount=type=cache,id=neolesk-example-cache,target=/app/public/cache \
    _KROKI_ARG="$NEOLESK_KROKI_ENGINE" && \
    if [ -f .env ]; then \
      set -a && . .env && set +a; \
    fi && \
    if [ -n "$_KROKI_ARG" ]; then \
      export NEOLESK_KROKI_ENGINE="$_KROKI_ARG"; \
    fi && \
    npm run build

# Runtime stage
FROM caddy:latest

ENV XDG_CONFIG_HOME=/tmp \
    XDG_DATA_HOME=/tmp

COPY deploy/Caddyfile /etc/caddy/Caddyfile
COPY --from=builder /app/dist /usr/share/caddy
