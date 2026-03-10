# syntax=docker/dockerfile:1.7

# Build stage
FROM node:20-alpine AS builder
WORKDIR /app

ARG NIOLESK_KROKI_ENGINE=https://kroki.io/

COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts

COPY index.html tsconfig.json vite.config.mjs ./
COPY public ./public
COPY scripts ./scripts
COPY src ./src
RUN --mount=type=cache,id=niolesk-example-cache,target=/app/public/cache \
    NIOLESK_KROKI_ENGINE="$NIOLESK_KROKI_ENGINE" npm run build

# Runtime stage
FROM caddy:latest

ENV XDG_CONFIG_HOME=/tmp \
    XDG_DATA_HOME=/tmp

COPY deploy/Caddyfile /etc/caddy/Caddyfile
COPY --from=builder /app/dist /usr/share/caddy
