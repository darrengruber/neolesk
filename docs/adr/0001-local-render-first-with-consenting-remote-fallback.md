# Local render first, with a visible and consenting remote fallback

neolesk renders 7 of its 29 diagram languages in the browser today and silently
sends the other 22 to kroki.io. We decided to render locally whenever a browser
renderer exists, and to treat a remote render as an action the user sees and
agrees to, rather than an invisible default.

## Considered options

- **Silent remote fallback (today's behaviour).** Rejected: the user cannot tell
  that their diagram source left the device, which is the wrong default for a
  tool people paste private architecture into.
- **Drop every language with no browser renderer.** Rejected: it removes about
  half the catalogue, including the whole blockdiag family, for a purity gain
  the visible-fallback option also delivers.
- **Ship with remote rendering disabled and require the user to turn it on.**
  Rejected: it makes half the language picker dead on first run.

## Consequences

- Render provenance becomes part of the user interface, not an implementation
  detail. Any redesign must have somewhere to show it.
- The share URL cannot keep being a kroki.io URL for a locally rendered diagram,
  because opening that URL would send the source to kroki.io without consent.
  That is a separate open decision.
