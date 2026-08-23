# A renderer is not a diagram language

`src/engines/index.ts` registers one factory per diagram language and calls it an
engine. That 1:1 assumption is already wrong and gets worse as we add renderers:
PlantUML renders both `plantuml` and `c4plantuml`, Graphviz is a language *and*
the layout dependency inside PlantUML, ERD and WireViz, and D2 has two layout
backends that produce different output from the same source. We decided a
renderer declares which languages and options it supports, and a language
resolves to a renderer.

## Consequences

- "Which renderer drew this, with which options" becomes answerable. That is
  exactly what a session's tool arguments need to address, so this refactor is a
  prerequisite for ADR 0002's tool contract, not a tidy-up.
