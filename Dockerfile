# syntax=docker/dockerfile:1.7

# Build stage – Expo web app
FROM node:20-alpine AS builder
WORKDIR /app

ARG EXPO_PUBLIC_KROKI_ENGINE=https://kroki.io/

COPY expo-app/package.json expo-app/package-lock.json ./
RUN npm ci --ignore-scripts

COPY expo-app/ ./
RUN --mount=type=cache,id=neolesk-expo-cache,target=/app/public/cache \
    EXPO_PUBLIC_KROKI_ENGINE="${EXPO_PUBLIC_KROKI_ENGINE}" \
    npm run examples:cache && \
    npx expo export --platform web

# Runtime stage
FROM caddy:latest

ENV XDG_CONFIG_HOME=/tmp \
    XDG_DATA_HOME=/tmp

COPY deploy/Caddyfile /etc/caddy/Caddyfile
COPY --from=builder /app/dist /usr/share/caddy
