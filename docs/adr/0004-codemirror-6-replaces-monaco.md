# CodeMirror 6 replaces Monaco

Monaco is not supported in mobile browsers — cursor placement, virtual keyboard
behaviour and touch selection are all broken — and mobile is a first-class target
for the redesign. CodeMirror 6 was rebuilt around native `contenteditable`
specifically to support touch, is far smaller, and is much easier to theme toward
Apple typography.

## Consequences

- The diagram language registry, syntax highlighting and validation added in
  73d9173 must be ported from Monaco's language services to CodeMirror's
  Lezer/StreamLanguage equivalents.
- It also makes the CRDT binding easier: `y-codemirror.next`-style bindings exist
  for CodeMirror 6, whereas collaborative Monaco is a fight.
