# Sessions run on self-hosted celld, and neolesk leaves Cloudflare Pages

A session is a live document that an agent and a human edit together, which
needs a stateful, per-document server. Cloudflare Durable Objects are the obvious
fit but are Workers-only and hosted. We chose celld — Deno's self-hosted,
distributed Durable Objects, v0.1.0, Apache 2.0 — running on the etcdrich Talos
cluster, with RustFS as the S3-compatible coordination and state store.

celld executes Cloudflare Worker bundles in V8 and can co-deploy static assets,
so all of neolesk moves there: the site leaves Cloudflare Pages for
`diagrams.darrengruber.com`, and ships by GitOps through Flux rather than the
ARC-runner deploy workflow that has never been able to run. Concurrent edits
reconcile through Loro. Only diagram source and language live in the shared
document; layout, theme and scroll position stay per-participant, so an agent
changing its own view never moves the human's screen.

Sessions are reached by an unguessable link with no accounts, expire after a
period with no connections, and are size-capped. They ride the cluster's normal
backup with no special guarantee — the durable artefact is always a snapshot
link.

## Consequences

- The public site now depends on the homelab. This is tolerable only because
  ADR 0001 keeps solo editing entirely local: with no session and no remote
  render, neolesk needs the server for nothing but the initial page load.
- celld is 18 days old at v0.1.0. The mitigation is that we write an ordinary
  Worker bundle, so the same code runs on Cloudflare Durable Objects unchanged
  if celld does not work out.
- **Credentials**: celld follows the standard AWS credential chain. We
  considered projecting the OpenBao RustFS engine's short lease through External
  Secrets Operator, which is already deployed on etcdrich, but it only works if
  celld re-reads its credentials file rather than caching at boot. We chose a
  long-lived RustFS key scoped to neolesk's bucket instead — certain to work, no
  renewal machinery. (baoyun-operator does not apply here: it syncs AWS Parameter
  Store *into* OpenBao, the opposite direction.)
- **Asset delivery**: Cloudflare's cache sits in front of the cluster, so the
  immutable hashed wasm bundles — roughly 40MB for D2 and PlantUML together —
  are served from the edge rather than a home uplink. Cloudflare is not removed
  from the picture by this move; it stops being the origin.
- Wrangler configuration stays relevant — celld consumes the checked-in
  `wrangler.jsonc` (celld rejects TOML configuration) — but
  `pages_build_output_dir` and the Pages deploy workflow do not. The existing
  Pages project stays deployed as a frozen build so old snapshot links keep
  working.
