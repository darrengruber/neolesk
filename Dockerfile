# syntax=docker/dockerfile:1.7

# Build stage
FROM node:20-alpine AS builder
WORKDIR /app

ARG NEOLESK_KROKI_ENGINE=https://diagrams.darrengruber.com/render/

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

# Static fallback image. Collaborative sessions and the MCP endpoint require
# the celld deployment; this image intentionally serves only the editor.
FROM caddy:2.10.2-alpine

ENV XDG_CONFIG_HOME=/tmp \
    XDG_DATA_HOME=/tmp

COPY --from=builder /app/dist /usr/share/caddy
