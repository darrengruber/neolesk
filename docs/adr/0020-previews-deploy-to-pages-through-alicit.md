# Previews deploy to Cloudflare Pages through Alicit, before production

A UI change had no place to be seen on a real phone before it reached
`diagrams.darrengruber.com`. We copied how alicit-ai/alicit deploys its site:
`scripts/deploy-preview-through-alicit.sh` builds the static app and deploys it
to Cloudflare Pages through one Alicit Provider operation. There is no standing
Cloudflare token. The Trusted Host asks Alicit for the `pages-neolesk` role's
short-lived token, an Operator approves the exact request on iPhone, and only
the publish step's environment receives it.

The preview goes to its own Pages project, `neolesk-preview`, at
`https://<branch>.neolesk-preview.pages.dev`. Production does not change: it is
celld on etcdrich (ADR 0006), shipped by moving the neolesk SHA pinned in
darren-iac/iac `apps/base/neolesk/docker-bake.hcl`, after which the image build
and Flux roll it out.

The order is: deploy the preview, run `npm run test:smoke` against it, look at
it on a phone, then push `main` and bump the pin.

## Constraints not visible in the code

- **The frozen `neolesk` Pages project is never a target.** It keeps old
  snapshot links working (ADR 0016) and still serves `interestingproblems.com`.
  A separate project means no mistake in a branch name can replace it.
- **Nothing deploys to the preview project's production branch** (`production`).
  The scripts refuse it and `main`.
- **`pages-neolesk` lives in Alicit's `cloudflare` mount, not in darren-iac/iac.**
  Like `pages-alicit-ai`, it was written live through an approved Provider
  operation: Pages Read and Write on the account, a 15-minute TTL and a
  30-minute maximum. It has no zone access, because `*.pages.dev` needs no DNS.
- **A preview is the static build.** It has no session backend and no MCP
  endpoint, as in the Docker image (ADR 0011). It renders remotely only through
  `https://diagrams.darrengruber.com/render/` after the viewer consents.
- **A preview has no access control.** Anyone with the URL can open it, so the
  script sends `X-Robots-Tag: noindex`.
- **No workflow runs it yet.** Alicit's deploy runs on its `alicit-release`
  runner, which serves only the alicit-ai organisation. Run the script on a
  Trusted Host with the enrolled `alicit` CLI.
