# Neolesk session MCP contract

Read this reference when the bundled client is unavailable, the server reports a changed contract, or raw JSON-RPC behavior needs diagnosis.

## Endpoint and protocol

A live session has three capability URLs on the same origin:

- `/s/<id>` is the live human editor.
- `/mcp/<id>` is the Streamable HTTP MCP endpoint.
- `/api/sessions/<id>/connect` is the Loro/WebSocket transport.

The identifier authorizes access. Handle every live-session URL like a bearer secret.

Send JSON-RPC 2.0 requests with `Content-Type: application/json` and the protocol version negotiated by `initialize`. The current implementation advertises `2025-11-25`. Use `tools/list` rather than assuming the tool set.

## Shared and participant-local state

Diagram source and language are shared Loro CRDT state. Human and agent renderer options, panel selection, theme, zoom, split, and scroll positions are separate participant state. Agent writes are visible in session activity and are undoable.

## Current tools

| Tool | Purpose | State effect |
| --- | --- | --- |
| `get_session` | Read language, source, and edit history | Read-only |
| `set_source` | Replace shared diagram source | Shared, undoable write |
| `set_language` | Change shared language | Shared, undoable write |
| `set_renderer_options` | Set options for the agent renderer | Agent-local write |
| `get_view_settings` | Read the agent view | Read-only |
| `set_view_settings` | Change agent panel, theme, zoom, split, or scroll | Agent-local write |
| `render` | Render SVG with provenance and diagnostics | Read-only, bounded |
| `export` | Return SVG, PNG, JPEG, or PDF data | Read-only, bounded |
| `create_snapshot_link` | Create an immutable hash URL from current state | Read-only |
| `undo_last_agent_write` | Restore the state preceding the latest agent write | Shared write |
| `close_session` | Permanently close the working session | Destructive |

`render` accepts SVG. `export` accepts `svg`, `png`, `jpeg`, or `pdf`. SVG is returned as structured text; PNG and JPEG are MCP image content; PDF is an embedded resource.

## Response handling

A successful JSON-RPC envelope can still contain a tool result with `isError: true`. Prefer `structuredContent` when present; otherwise decode the first text content item as JSON. For binary exports, decode the image `data` or resource `blob` from base64.

Rendering includes provenance so callers can distinguish a local worker engine from private Kroki fallback. It may also include structured diagnostics. A useful workflow renders, inspects those fields, revises the source, and renders again rather than treating a successful HTTP status as visual success.

## Supported languages

The current editor supports ActDiag, BlockDiag, BPMN, Bytefield, C4 PlantUML, D2, DBML, diagrams.net, Ditaa, Erd, Excalidraw, Graphviz, Mermaid, Nomnoml, NwDiag, PacketDiag, Pikchr, PlantUML, RackDiag, SeqDiag, Structurizr, Svgbob, Symbolator, TikZ, UMLet, Vega, Vega-Lite, WaveDrom, and WireViz.

Browser-local support and Worker-local support are not identical. The session render tool handles Worker-local engines directly and privately falls back to the configured Kroki service for other languages.
