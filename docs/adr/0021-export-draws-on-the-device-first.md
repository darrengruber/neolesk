---
status: accepted
supersedes: ADR-0010 in part
---
# Export draws on the device first, and the server is the fallback

ADR 0010 sent every PNG, JPEG and PDF to the server, because a canvas cannot
export SVG with HTML labels. That made someone who renders locally unable to
export a PNG of a Graphviz diagram their own device drew. We measured where the
canvas really fails before changing it. Across the 116 examples, in Chromium and
WebKit, 107 SVGs drew onto a canvas and exported. The 9 that failed were exactly
the 9 with `<foreignObject>`: Mermaid 6, D2 2, diagrams.net 1. Every one threw a
`SecurityError` from the tainted canvas; nothing else failed.

So export now draws on the device whenever it can, and asks the render server
only when it cannot:

- **The preview's SVG is the source.** The preview is an `<img>` of that SVG, so
  a canvas draws exactly what the person sees. `src/export/localExport.ts`
  checks for the two things that stop it: HTML labels, and images or fonts
  linked from another site (an SVG drawn as an image cannot load them).
- **Mermaid draws its labels as SVG text for export.** With `htmlLabels: false`
  8 of the 9 Mermaid examples export locally; the user journey diagram keeps
  HTML labels and falls back. `mermaid.initialize` resets its config on every
  render, so the preview keeps its HTML labels.
- **PNG and JPEG are drawn at twice the CSS size.** JPEG gets a white background.
- **PDF is a one-page file we write ourselves:** the diagram drawn at three times
  its CSS size (216 dots per inch), stored losslessly with FlateDecode from the
  browser's `CompressionStream`, on a page of the diagram's size in points. It is
  a picture, not vector drawing. No PDF library returns to the bundle.
- **The server is the fallback, and only with consent.** A diagram the device
  cannot draw goes to the session cell or the render server as before. Without
  consent the export says why: "PNG export of this diagram needs a render
  server, because it uses HTML labels".

## Considered and not chosen

- **A vector PDF in the browser** (svg2pdf with jsPDF). It supports neither
  `foreignObject` nor CSS, and it embeds only the 14 standard PDF fonts, so text
  in any other font would be measured wrongly. The browser's own print dialog
  already makes a vector PDF from our print styles.
- **Drawing in the session cell** (resvg in WebAssembly) for MCP exports. The
  cell has no system fonts, so text would vanish unless we bundle fonts for
  every renderer. MCP binary export stays on the render server.

## Consequences

- PNG, JPEG and PDF work with no render server for every diagram the device can
  draw, including formats the server does not make for that language (a D2 PNG).
- A local PDF is a high-resolution picture; the server's PDF, where the language
  has one, was vector. Local wins, as for every other format.
- The Share sheet says where the file is made: "Every format is made on this
  device. Nothing leaves it." or which formats the server makes and why.
