# Consent is a first-run choice, and export splits by format

ADR 0001 makes a remote render something the user agrees to, per render server,
remembered. That agreement has to exist before the first heavy renderer loads,
because D2 and PlantUML are large enough that we render on the server while the
local renderer downloads in the background — which puts a remote render inside
someone's first minute. So consent is asked once at first launch: render locally
only, use neolesk's own renderer, or use kroki.io.

Export splits on the same line. SVG is already in the browser's memory, so
downloading it is a Blob and stays local. PNG, JPEG and PDF happen in the cell,
where the `foreignObject` canvas-tainting problem that breaks client-side export
for Mermaid and PlantUML simply does not exist.

## Consequences

- An interstitial stands between a first-time visitor and the editor. It is the
  price of never sending anything before being told to.
- `canvg` and `jsPDF` leave the client bundle.
- Raster and PDF export become network round-trips covered by the same consent.
