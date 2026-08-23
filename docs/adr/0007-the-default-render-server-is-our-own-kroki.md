# The default render server is our own Kroki, not kroki.io

Once neolesk is served from the etcdrich cluster it shares an origin with the
Kroki instance already running there, which the build already uses to render
example thumbnails. We decided the runtime default render server is that
instance, not public kroki.io.

## Consequences

- It closes the split documented in `.github/workflows/deploy-pages.yaml`: build
  thumbnails and runtime renders finally come from the same engine, so a
  `diagramsnet` example stops showing a correct cached thumbnail and then failing
  to render live.
- Consent under ADR 0001 becomes a much easier ask — "send this to neolesk's own
  renderer" rather than "send this to a third party" — but it is still consent,
  because the source still leaves the device.
- The cluster now carries public render load, and its CORS allowlist must widen.
