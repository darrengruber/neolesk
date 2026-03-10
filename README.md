<div align="center">

# neolesk

**A modern diagram editor powered by [Kroki](https://kroki.io/)**

*Vibe coded reimagining of [niolesk](https://github.com/gissehel/niolesk)*

[![Live](https://img.shields.io/badge/neolesk.pages.dev-live-2563eb?style=for-the-badge)](https://neolesk.pages.dev)
[![Version](https://img.shields.io/badge/v2.0.0-orange?style=for-the-badge)](#)
[![License](https://img.shields.io/badge/MIT-green?style=for-the-badge)](LICENSE)

</div>

---

<!-- TODO: add screenshot or demo GIF -->
<!-- <p align="center">
  <img src="assets/demo.gif" alt="neolesk demo" width="800">
</p> -->

## What is neolesk?

Write diagrams as text, see them rendered live. Neolesk is a browser-based editor
that supports 28 diagram languages through [Kroki](https://kroki.io/) -- PlantUML,
Mermaid, Graphviz, D2, and many more. Everything runs client-side; no account needed.

## Features

- **28 diagram languages** -- PlantUML, Mermaid, Graphviz, D2, C4, Excalidraw, and more
- **Monaco Editor** -- the engine behind VS Code, with syntax awareness
- **Live preview** -- renders as you type
- **Client-side export** -- SVG, PNG, JPEG, PDF with no server round-trip
- **Shareable URLs** -- diagram state encoded in the URL hash
- **Built-in cheat sheets** -- syntax reference for every diagram type
- **Example gallery** -- searchable library with one-click import
- **Resizable split panes** -- vertical, horizontal, or preview-only
- **Mobile responsive** -- tab switching on small screens
- **Self-hostable** -- Docker + Caddy, or Cloudflare Pages

## Quick start

Visit **[neolesk.pages.dev](https://neolesk.pages.dev)** -- no install needed.

### Local development

```bash
npm install
npm start
```

### Docker

```bash
docker compose up
```

Dev server runs at `http://localhost:5173` with hot reload.

## Tech stack

<p align="center">

![React](https://img.shields.io/badge/React-20232A?style=for-the-badge&logo=react&logoColor=61DAFB)
![TypeScript](https://img.shields.io/badge/TypeScript-007ACC?style=for-the-badge&logo=typescript&logoColor=white)
![Vite](https://img.shields.io/badge/Vite-646CFF?style=for-the-badge&logo=vite&logoColor=white)
![Cloudflare Pages](https://img.shields.io/badge/Cloudflare_Pages-F38020?style=for-the-badge&logo=cloudflarepages&logoColor=white)

</p>

## Supported diagrams

<details>
<summary>All 28 diagram types</summary>

| Language | Description |
|----------|-------------|
| PlantUML | UML diagrams |
| Mermaid | Flowcharts, sequence diagrams, Gantt charts |
| Graphviz | Graph visualization |
| D2 | Modern declarative diagrams |
| C4 PlantUML | C4 architecture diagrams |
| Excalidraw | Hand-drawn style diagrams |
| BPMN | Business process models |
| ERD | Entity-relationship diagrams |
| DBML | Database markup language |
| BlockDiag | Block diagrams |
| SeqDiag | Sequence diagrams |
| ActDiag | Activity diagrams |
| NwDiag | Network diagrams |
| PacketDiag | Packet diagrams |
| RackDiag | Rack diagrams |
| Nomnoml | UML with a nice syntax |
| Svgbob | ASCII art to SVG |
| UMlet | UML tool diagrams |
| Vega | Visualization grammar |
| Vega-Lite | High-level visualization grammar |
| WaveDrom | Digital timing diagrams |
| Ditaa | ASCII art diagrams |
| Pikchr | PIC-like diagrams |
| Structurizr | Architecture diagrams |
| Bytefield | Byte field diagrams |
| WireViz | Wiring harness diagrams |
| Symbolator | HDL symbol diagrams |
| TikZ | LaTeX graphics |

</details>

## Build & deploy

```bash
npm run build       # production build
npm run preview     # preview locally
npm run test        # run tests
npm run typecheck   # type check
npm run deploy      # deploy to Cloudflare Pages
```

### Docker production image

```bash
docker build -t neolesk .
```

Set `NEOLESK_KROKI_ENGINE` build arg to use a custom Kroki server (defaults to `https://kroki.io/`).

## Configuration

The app uses the public Kroki instance by default. To point at a private Kroki
server, either set `NEOLESK_KROKI_ENGINE` at Docker build time or serve a
`/config.js` file alongside the static assets.

## Vibe coded

This project was vibe coded -- built through rapid iteration with AI, moving
fast and following the creative flow. The original
[niolesk](https://github.com/gissehel/niolesk) by gissehel provided the
foundation; neolesk is the modern reimagining.

## License

[MIT](LICENSE)

---

<div align="center">

**[neolesk.pages.dev](https://neolesk.pages.dev)**

</div>
