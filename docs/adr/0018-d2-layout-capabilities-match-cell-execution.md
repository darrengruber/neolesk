# D2 layout capabilities match cell execution

D2 upstream contains both Dagre and ELK layout backends, but its ELK distribution
requires another multi-megabyte JavaScript runtime. The browser and session cell
must expose the same renderer options: advertising ELK only in the browser makes
an agent render leave the cell, and silently sending the source to Kroki violates
the local-render boundary in ADR 0008.

We expose Dagre as D2's layout option in both environments. ELK is not advertised
until its no-eval runtime can execute inside a celld cell while the complete
ordinary Worker bundle remains deployable. Unsupported or stale ELK options are
rejected instead of becoming an implicit remote-render request.

## Consequences

- D2 source renders in the browser and session cell through the same upstream D2
  package and the same declared option surface.
- Adding ELK later requires a Workerd integration probe and a bundle-size gate,
  not only a browser test.
- The renderer model still represents layout as an explicit renderer option, so
  adding the second backend does not require another architecture change.
