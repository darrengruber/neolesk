# Niolesk

Niolesk is a Vite + React + TypeScript editor for Kroki diagrams.

## Development

```bash
npm install
npm run start
```

For Docker-based local development with hot reload:

```bash
docker compose up
```

The compose setup runs the Vite dev server on `http://localhost:5173` with the repo bind-mounted into the container and polling enabled for reliable file watching.

## Commands

```bash
npm run build
npm run preview
npm run test
npm run typecheck
```

## Runtime config

The app falls back to its built-in default Kroki endpoint when `/config.js` is absent.

In the Docker image, `NEOLESK_KROKI_ENGINE` is baked into the image with a Docker build arg and written to `/config.js` during the image build. The runtime container no longer mutates files at startup; Caddy serves the built static assets directly.
