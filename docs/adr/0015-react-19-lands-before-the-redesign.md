# React 19 lands before the redesign, not during it

The app runs React 17 with `@testing-library/react` 12 — three majors behind.
The redesign rewrites nearly every component, and CodeMirror 6 and the Loro
bindings both sit awkwardly against React 17's peer ranges. We decided to upgrade
to React 19 as a separate, reviewable change that lands first, so that React
breakage and design breakage are never diagnosed as each other, and so that no
component is written twice.
