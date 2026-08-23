---
status: superseded by ADR-0009 in part
---

# Agents reach neolesk over MCP, not WebMCP

We want agents to drive neolesk's renderers. WebMCP is the natural fit, but as
of August 2026 it is a W3C Community Group draft that only Chrome 146 implements
behind a flag, and Firefox and Safari have given no timeline. We decided to ship
an MCP surface that works everywhere first.

ADR 0009 supersedes the second half of this decision: WebMCP is dropped rather
than deferred. ADR 0008 records what the MCP surface actually is.
