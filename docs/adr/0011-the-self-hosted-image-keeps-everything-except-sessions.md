# The self-hosted image keeps everything except sessions

neolesk ships a Caddy static image, and `src/runtimeConfig.ts` exists purely so a
deployment can repoint the render server without rebuilding. celld cannot run in
that image. We decided to keep publishing it as the local-first editor — every
browser renderer, snapshot links, SVG export, a configurable render server — with
sessions and the MCP endpoint absent, and the UI saying so rather than failing
quietly.

## Consequences

- Session support is a property of the deployment, not of the app, so the client
  must discover whether a session backend exists rather than assume one.
- Raster and PDF export live in the cell (ADR 0010), so the static image either
  loses them or falls back to its configured render server. That has to be
  decided when the image is rebuilt.
