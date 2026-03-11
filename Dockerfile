# syntax=docker/dockerfile:1.7

# Build stage
FROM node:20-alpine AS builder
WORKDIR /app

ARG NEOLESK_KROKI_ENGINE=https://kroki.io/

COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts

COPY .env* ./
COPY index.html tsconfig.json vite.config.mjs ./
COPY public ./public
COPY scripts ./scripts
COPY src ./src
RUN --mount=type=cache,id=neolesk-example-cache,target=/app/public/cache \
    if [ -z "$NEOLESK_KROKI_ENGINE" ] && [ -f .env ]; then \
      export $(grep -v '^#' .env | xargs); \
    fi && \
    npm run build

# Runtime stage
FROM caddy:latest

ENV XDG_CONFIG_HOME=/tmp \
    XDG_DATA_HOME=/tmp

COPY deploy/Caddyfile /etc/caddy/Caddyfile
COPY --from=builder /app/dist /usr/share/caddy
