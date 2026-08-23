# PlantUML renders from the MIT browser build, with the server on failure

`@plantuml/core` is the official TeaVM build of PlantUML, published from the
PlantUML repository under the MIT licence flavour. That flavour is produced by
removing code that cannot be released under MIT — it draws every UML diagram but
drops GPL-only extras, notably the ditaa integration. Our Kroki runs the complete
GPL build.

We decided the browser build is authoritative for PlantUML: local render is the
default, and Kroki is used only when the WASM load fails or the MIT build rejects
the source. PlantUML is neolesk's most-used language, so routing it permanently
to the server would undercut the local-first position ADR 0001 establishes, for
features almost nobody writes.

## Consequences

- `@plantuml/core` carries its own Graphviz as `viz-global.js`, so PlantUML's
  layout does not depend on the separately adopted Graphviz renderer.
- The package has published only two versions and was last updated in June 2026.
  It is official but thinly exercised.
