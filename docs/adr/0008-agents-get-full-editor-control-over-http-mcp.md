# Agents get full editor control over an HTTP MCP endpoint

The Worker serves streamable-HTTP MCP at a route on `diagrams.darrengruber.com`,
scoped by session link, so an agent needs nothing installed — point it at a URL
and it can open and edit a session. The tool set is full editor control: session
lifecycle, source, language, renderer options, render, export and view settings,
with structured render diagnostics so an agent can iterate without a human.

Renders for an agent happen inside the session cell. celld cells run V8 with no
DOM, which is enough for Graphviz, PlantUML, D2, Pikchr and Svgbob — the same
code the browser runs, not a second implementation. Mermaid and bpmn-js need a
DOM, so those and the 15 unported languages fall through to the in-cluster Kroki,
which already draws all 29. No headless browser anywhere.

## Consequences

- Full editor control means the app's view state must be an addressable,
  documented model rather than scattered `useState` calls.
- The endpoint is publicly reachable and authenticated only by the session link,
  so agent activity is made legible instead of prevented: presence shows that an
  agent is connected and what it changed, writes are rate-limited per session,
  and every agent write is undoable — which Loro's history gives us.
