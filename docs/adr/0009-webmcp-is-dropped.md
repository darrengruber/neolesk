---
status: accepted
supersedes: ADR-0002 in part
---

# WebMCP is dropped, not deferred

ADR 0002 deferred in-page WebMCP behind a headless surface. With ADR 0008's HTTP
MCP endpoint working in every browser today and offering the same full editor
control, an in-page `modelContext` registration adds only the convenience of not
pasting a link — for one browser, behind one flag, against a spec that is not on
the W3C standards track. We decided not to build it. Revisit if the spec reaches
more than one engine.
