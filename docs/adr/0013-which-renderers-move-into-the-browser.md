# Which renderers move into the browser, and which do not

neolesk renders 7 of its 29 diagram languages in the browser today: Bytefield,
DBML, Mermaid, Nomnoml, Vega, Vega-Lite and WaveDrom. We surveyed npm for the
other 22 and decided to adopt six more renderers now, covering eight further
languages and taking local coverage to 15 of 29 — including the three most-used
ones.

## Adopted

| Renderer | Languages | Package | Weight |
|---|---|---|---|
| Graphviz | graphviz | `@hpcc-js/wasm-graphviz` | ~2MB |
| PlantUML | plantuml, c4plantuml | `@plantuml/core` (TeaVM, MIT flavour) | ~10MB |
| D2 | d2 | `@terrastruct/d2` (WASM) | ~22MB wasm + 8MB JS |
| Pikchr | pikchr | `pikchr-wasm` | ~70KB |
| Svgbob | svgbob | `svgbob-wasm` | small |
| bpmn-js | bpmn | `bpmn-js` | ~1MB |

Every one is lazy-loaded, so nobody pays for a renderer they do not open.

## Rejected, and why

- **Excalidraw** — `@excalidraw/utils` has no stable release, only prereleases.
- **TikZ** — TikZJax is a full TeX distribution in WASM. Disproportionate.
- **blockdiag, seqdiag, actdiag, nwdiag, packetdiag, rackdiag, symbolator,
  wireviz** — Python. Only reachable through Pyodide.
- **ditaa, umlet** — Java. Only reachable through CheerpJ.
- **erd, structurizr, diagramsnet** — no usable JavaScript parser exists.

These 14 stay on the render server under ADR 0001. This list is the explicit
scope boundary: adding one of them is a new decision, not an oversight.
