# Build stage
FROM node:20-alpine AS builder
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY index.html tsconfig.json vite.config.mjs ./
COPY public ./public
COPY scripts ./scripts
COPY src ./src
RUN npm run build

# Runtime stage
FROM caddy:latest

ARG NIOLESK_KROKI_ENGINE=https://kroki.io/

ENV XDG_CONFIG_HOME=/tmp \
    XDG_DATA_HOME=/tmp

COPY docker-res/Caddyfile /etc/caddy/Caddyfile
COPY --from=builder /app/dist /usr/share/caddy
RUN printf "window.config = {\n    krokiEngineUrl: '%s',\n};\n" "$NIOLESK_KROKI_ENGINE" > /usr/share/caddy/config.js
