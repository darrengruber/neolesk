# neolesk

neolesk is a local-first diagram workspace for people and coding agents. Write in
one of 29 text diagram languages, render live, share an immutable snapshot, or
open a live session where humans and MCP clients edit the same document.

The public editor lives at [diagrams.darrengruber.com](https://diagrams.darrengruber.com).
No account is required.

## Why neolesk

- Local rendering is preferred and the preview identifies where each result was
  produced.
- Diagram source is never sent to a render service until the user makes an
  explicit first-run choice. The choice remains editable in Settings.
- Snapshot links contain an immutable diagram state. Session links point to a
  live, expiring collaborative document; the UI keeps those concepts separate.
- Every live session exposes its own Streamable HTTP MCP endpoint. An agent can
  read, edit, render, export, inspect diagnostics, change view settings, create a
  snapshot link, and undo its latest write.
- CodeMirror 6 provides language-aware editing, completion, diagnostics, and
  Loro-backed collaborative text.
- The 116-example catalog is a committed golden-image regression suite.

## Rendering and privacy

The browser renders BPMN, Bytefield, D2, DBML, Graphviz, Mermaid, Nomnoml,
Pikchr, PlantUML/C4, Svgbob, Vega/Vega-Lite, WaveDrom, and several related
formats locally. Worker sessions also render Graphviz, PlantUML/C4, D2, Pikchr,
and Svgbob locally. Languages without a compatible local engine fall back only
to the render server the user selected.

`SVG` export uses the current preview in the browser. `PNG`, `JPEG`, and `PDF`
exports require the selected server. The default managed service uses neolesk's
own private [Kroki](https://kroki.io/) deployment; Kroki remains the engine and
ecosystem behind the server-rendered language set.

## Local development

Requirements: Node.js 24 and npm.

```bash
npm ci
npm start
```

The editor starts at `http://localhost:5173`. Useful checks:

```bash
npm run typecheck
npm test
npm run build
npm run test:corpus
```

The corpus test uses Playwright and a render service for the server-only
examples. Point it at a compatible service when necessary:

```bash
NEOLESK_KROKI_PROXY_TARGET=https://your-kroki.example/ npm run test:corpus
```

Use `npm run test:corpus:update` only after reviewing an intentional rendering
change; it rewrites the committed references.

## Deployments

The complete deployment is a celld module Worker with static assets, Durable
Object sessions, WebSockets, alarms, and MCP routes:

```bash
npm run build
npm run deploy
```

Deployment configuration is in `wrangler.jsonc`. celld reads credentials from
the standard AWS credential chain; production uses a bucket-scoped RustFS key.
At runtime `/config.json` advertises the public render and session endpoints.

The Docker image is deliberately static-only:

```bash
docker build -t neolesk .
docker run --rm -p 8080:80 neolesk
```

It keeps editing, local and consented remote rendering, snapshot links, and
exports. It displays a clear notice that sessions are unavailable. Override the
build-time render endpoint with `--build-arg NEOLESK_KROKI_ENGINE=...`, or serve
this runtime file alongside the static assets:

```json
{
  "renderServerUrl": "https://diagrams.example/render/"
}
```

## Session API

Starting a session produces three unguessable URLs:

- `/s/<id>` — the live human editor
- `/mcp/<id>` — the session-scoped Streamable HTTP MCP endpoint
- `/api/sessions/<id>/connect` — the Loro/WebSocket transport

Only source and language are shared CRDT state. View and renderer settings are
participant-local. Sessions enforce request limits, document-size limits, idle
expiry, and durable snapshots. The identifier is the access capability, so
handle a session URL like a bearer secret.

## Supported languages

ActDiag, BlockDiag, BPMN, Bytefield, C4 PlantUML, D2, DBML, diagrams.net,
Ditaa, Erd, Excalidraw, Graphviz, Mermaid, Nomnoml, NwDiag, PacketDiag, Pikchr,
PlantUML, RackDiag, SeqDiag, Structurizr, Svgbob, Symbolator, TikZ, UMLet, Vega,
Vega-Lite, WaveDrom, and WireViz.

## Credits and license

neolesk is a reimagining of [niolesk](https://github.com/gissehel/niolesk) by
gissehel. It uses Kroki-compatible protocols and renderers, the MIT browser
build of PlantUML, and the other open-source packages recorded in
`package-lock.json`.

[MIT](LICENSE)
