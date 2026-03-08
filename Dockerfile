# Build stage
FROM node:20-alpine AS builder
WORKDIR /app

COPY package.json ./
RUN npm install

COPY . .
RUN npm run build

# Runtime stage
FROM nginx:alpine

COPY docker-res/update-config.sh /docker-entrypoint.d/update-config.sh
COPY --from=builder /app/dist /usr/share/nginx/html

RUN chmod +x /docker-entrypoint.d/update-config.sh \
    && chmod 666 /usr/share/nginx/html/config.js
