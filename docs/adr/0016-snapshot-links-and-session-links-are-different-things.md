# Snapshot links and session links are different things, and both survive

neolesk shares diagrams by encoding the whole source into the URL hash. Sessions
introduce a second kind of link. We decided to keep both, because they mean
different things: a snapshot link is a self-contained, immutable artefact that
needs no server and works offline, while a session link points at a live mutable
document.

## Consequences

- A snapshot link never triggers a remote render on open without consent, which
  is what makes it safe to paste anywhere. That resolves the open question left
  by ADR 0001.
- The hash format does not change, so every link ever shared keeps working —
  which is also why the Cloudflare Pages project stays deployed as a frozen build
  rather than being retired.
- A session is a working surface, not storage. The durable artefact is always the
  snapshot link, which is why best-effort backup is enough (ADR 0006).
