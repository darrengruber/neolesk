---
name: neolesk-diagrams
description: Create, edit, validate, export, and share diagrams through live neolesk session MCP endpoints. Use this skill whenever a user supplies a diagrams.darrengruber.com/mcp URL or asks an agent to work in a neolesk live session, including architecture diagrams, diagram revisions, render troubleshooting, exports, snapshots, or live and agent link sharing.
compatibility: Requires Node.js 24 or newer with network access to the supplied neolesk MCP endpoint.
---

# Neolesk diagrams

Use neolesk as a shared working surface: the human and agent edit the same diagram, while each participant keeps independent renderer and view settings.

## Start safely

Treat the session identifier as a bearer capability. Do not repeat an agent URL in routine progress messages, commit it, or place it in a generated file. Return it only when the user explicitly asks for the agent link.

Use the bundled client from the repository root:

```bash
NEOLESK_CLIENT=.agents/skills/neolesk-diagrams/scripts/neolesk-mcp.mjs
node "$NEOLESK_CLIENT" "$NEOLESK_MCP_URL" tools
node "$NEOLESK_CLIENT" "$NEOLESK_MCP_URL" get
```

The first command discovers the live tool contract. The second reads the current source, language, and history. Discovery matters because the server may evolve independently of this skill.

If the helper is unavailable, read [references/mcp-contract.md](references/mcp-contract.md) before calling the JSON-RPC endpoint directly.

## Create or revise a diagram

1. Read the session before writing. Decide whether the user wants the existing diagram revised or replaced; an unrelated existing diagram is not automatically disposable.
2. Choose the smallest source language that expresses the idea clearly. Preserve the current language when editing unless a change materially improves the result or the user requested one.
3. Draft the source in a file rather than interpolating a large diagram into a shell command. This avoids quoting errors and keeps the write reviewable.
4. When changing both language and source, set the language and then immediately set the source without rendering the mismatched intermediate state.
5. Render after every meaningful write. Read structured diagnostics and provenance, fix errors, and render again until the result succeeds.
6. Keep the diagram legible: use a clear reading direction, meaningful boundaries, short labels, and only the detail needed to explain the system. Prefer a few well-labeled flows over a dense inventory of components.

```bash
node "$NEOLESK_CLIENT" "$NEOLESK_MCP_URL" set-language d2
node "$NEOLESK_CLIENT" "$NEOLESK_MCP_URL" set-source /path/to/diagram.d2
node "$NEOLESK_CLIENT" "$NEOLESK_MCP_URL" render --output /tmp/neolesk-preview.svg
```

Good defaults by intent:

- D2 for architecture, infrastructure, and polished system maps.
- Mermaid for common flowcharts, sequences, state diagrams, and broad portability.
- PlantUML or C4 PlantUML when the user asks for UML or C4 semantics.
- Graphviz for graph topology where rank and edge control matter most.
- Excalidraw only when the user specifically wants a hand-drawn canvas or the existing source is already Excalidraw JSON.

Neolesk supports more languages than this shortlist. Use the discovered contract and the application documentation when the task calls for BPMN, diagrams.net, Vega, WaveDrom, or another specialist format.

## Collaborate without disturbing the human

Source and language are shared. Agent view and renderer options are participant-local, so use them for inspection without moving the human viewport:

```bash
node "$NEOLESK_CLIENT" "$NEOLESK_MCP_URL" view
node "$NEOLESK_CLIENT" "$NEOLESK_MCP_URL" set-view '{"panel":"preview","theme":"dark","zoom":1}'
node "$NEOLESK_CLIENT" "$NEOLESK_MCP_URL" set-renderer-options '{}'
```

If a write was wrong, use `undo` promptly instead of attempting a speculative reconstruction. Undo restores the state before the latest agent write.

Never close a session unless the user explicitly asks to end it permanently. The helper requires `--confirm-close` as an additional guard.

## Export and share correctly

These outputs have different meanings:

- `snapshot` returns an immutable, self-contained URL. It is the durable, safe-to-share artifact and works without the live session.
- The live editor uses `/s/<capability>`. It is mutable and expires with the session.
- The agent endpoint uses `/mcp/<capability>`. It grants edit authority and should be treated like a secret.
- `export` returns SVG, PNG, JPEG, or PDF bytes to the MCP client. It does not create a hosted public download URL.

```bash
node "$NEOLESK_CLIENT" "$NEOLESK_MCP_URL" snapshot
node "$NEOLESK_CLIENT" "$NEOLESK_MCP_URL" export svg --output architecture.svg
node "$NEOLESK_CLIENT" "$NEOLESK_MCP_URL" export pdf --output architecture.pdf
```

When asked to share the result, prefer the immutable snapshot link. Also provide the live editor or agent link only when requested, with a concise warning that live links are capabilities.

## Recover from failures

- A tool-level `isError` is a failed operation even if the JSON-RPC request itself succeeded. Read its structured error before retrying.
- Fix syntax and renderer diagnostics in the source; do not hide them by switching formats.
- Respect rate-limit retry guidance. Do not loop aggressively on render or export.
- If the human edits concurrently, read the session again before replacing source so their newer work is not silently lost.
- Use `undo` after a harmful agent write. Do not use `close` as cleanup.

## Handoff

Lead with the completed outcome. State the language and successful render/export verification. Return only the links or files the user requested, explaining whether each is immutable, live, or edit-capable. Avoid pasting the full source unless it helps the user continue the work.
