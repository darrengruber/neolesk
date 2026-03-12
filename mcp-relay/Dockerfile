FROM node:20-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY standalone.ts tsconfig.standalone.json ./
RUN npx tsc -p tsconfig.standalone.json

FROM node:20-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY --from=builder /app/dist ./dist
CMD ["node", "dist/standalone.js"]
EXPOSE 3001
