# neolesk

A browser diagram editor. The user writes diagram source as text and sees it
rendered. This context covers the vocabulary of rendering, of the render
boundary between the browser and a remote server, and of agent control.

## Language

### Diagrams

**Diagram language**:
A textual notation that describes a diagram, such as PlantUML, Mermaid or D2.
_Avoid_: diagram type, format, dialect

**Diagram source**:
The text the user writes in a diagram language.
_Avoid_: code, content, input, diagram text

**Renderer**:
A program that turns diagram source into an image. One renderer can serve more
than one diagram language, and one diagram language can have more than one
renderer.
_Avoid_: engine, graphing engine, backend

### The render boundary

**Local render**:
A render that a renderer performs inside the user's browser. The diagram source
does not leave the device.
_Avoid_: client-side render, offline render, frontend render

**Remote render**:
A render that a render server performs. The diagram source leaves the device.
_Avoid_: server-side render, Kroki render

**Render server**:
A Kroki-compatible HTTP service that performs remote renders. The public
kroki.io instance and a self-hosted instance are both render servers.
_Avoid_: Kroki, backend, API

**Render provenance**:
Whether a rendered diagram came from a local render or a remote render, and
which render server was used. Provenance is shown to the user, not inferred.
_Avoid_: render source, origin, mode

**Consent**:
The user's explicit agreement to send a specific diagram source to a specific
render server. Absent consent, no remote render happens.
_Avoid_: permission, opt-in, approval

### Sessions

**Session**:
A named, mutable diagram document that a human and an agent can both open and
edit at the same time. It lives on the server and survives a tab closing.
_Avoid_: room, workspace, document, project

**Session link**:
The unguessable URL that grants access to a session. Holding the link is the
only credential.
_Avoid_: invite, share link, token

**Snapshot link**:
The self-contained URL that carries the whole diagram source in its hash. It is
immutable, needs no server, and works offline.
_Avoid_: share URL, permalink, hash link

**Cell**:
One celld actor. Exactly one cell holds one session.
_Avoid_: durable object, actor, room, instance

### Agent control

**Tool**:
A named, schema-described action an agent can invoke against neolesk, such as
setting a session's diagram source or asking for a render.
_Avoid_: command, function, endpoint, action

**Agent**:
A program that edits a session through neolesk's tools rather than through the
interface. Its presence and its changes are visible to the human in the session.
_Avoid_: bot, assistant, client, AI
