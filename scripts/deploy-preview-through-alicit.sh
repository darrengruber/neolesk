#!/usr/bin/env bash
# Deploy a static preview of neolesk to the neolesk-preview Cloudflare Pages
# project through one Operator-approved Alicit Provider operation (ADR 0020).
#
# This mirrors alicit-ai/alicit scripts/deploy-site-through-alicit.sh. No
# standing Cloudflare token exists: this Trusted Host asks Alicit for the
# pages-neolesk role's short-lived token, an Operator approves the exact
# request on iPhone, and only the publish step's environment receives it.
#
# A preview is never production. Production is celld on etcdrich (ADR 0006),
# shipped by bumping the pinned SHA in darren-iac/iac. The frozen `neolesk`
# Pages project keeps old snapshot links alive and is never deployed to.
#
# Usage: scripts/deploy-preview-through-alicit.sh <commit-sha> [<preview-name>]
set -euo pipefail

sha="${1:?usage: deploy-preview-through-alicit.sh <commit-sha> [<preview-name>]}"
if [[ ! "$sha" =~ ^[0-9a-f]{40}$ ]]; then
  echo "ERROR: expected a full 40-character commit SHA, got: $sha" >&2
  exit 1
fi

repo_root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$repo_root"

# Build exactly the commit that the approval names.
if [ "$(git rev-parse HEAD)" != "$sha" ]; then
  echo "ERROR: HEAD is $(git rev-parse HEAD), not $sha; check out the commit you deploy." >&2
  exit 1
fi
if ! git diff --quiet HEAD --; then
  echo "ERROR: tracked files differ from $sha; commit or stash them before a preview." >&2
  exit 1
fi

project="neolesk-preview"
# The preview project's production branch. Nothing deploys to it, so the
# project's own pages.dev apex never serves anything.
production_branch="production"

# Pages turns a branch into a lowercase alias of at most 28 characters.
raw_name="${2:-$(git rev-parse --abbrev-ref HEAD)}"
preview="$(printf '%s' "$raw_name" | tr '[:upper:]' '[:lower:]' | sed -E 's/[^a-z0-9]+/-/g; s/^-+//; s/-+$//' | cut -c1-28 | sed -E 's/-+$//')"
if [ -z "$preview" ] || [ "$preview" = "$production_branch" ] || [ "$preview" = "main" ]; then
  echo "ERROR: '$raw_name' cannot be a preview name; choose a branch-like name." >&2
  exit 1
fi

alicit_bin="${ALICIT_BIN:-$HOME/.local/bin/alicit}"
if [ ! -f "$alicit_bin" ] || [ ! -x "$alicit_bin" ]; then
  echo "ERROR: enrolled Alicit CLI is not executable: $alicit_bin" >&2
  echo "Install and qualify Alicit on this host, or set ALICIT_BIN to its enrolled executable." >&2
  exit 1
fi
proposal_helper="${ALICIT_PROPOSAL_HELPER:-$HOME/.claude/skills/alicit/scripts/provider-proposal.py}"
if [ ! -f "$proposal_helper" ]; then
  echo "ERROR: Alicit provider-proposal helper not found: $proposal_helper" >&2
  echo "Install the alicit skill, or set ALICIT_PROPOSAL_HELPER to scripts/provider-proposal.py." >&2
  exit 1
fi

# The Pages account; an identifier, not a credential.
export CLOUDFLARE_ACCOUNT_ID="c6c0da6f79d5b4a62fe1d2eff2f108e5"

# The static build: every browser renderer and snapshot links. It has no
# session backend, as in the Docker image (ADR 0011). The explicit render
# server writes dist/config.json, so the runtime config is present, not a 404.
NEOLESK_CACHE_SKIP=1 NEOLESK_KROKI_ENGINE="https://diagrams.darrengruber.com/render/" npm run build
# A preview has no access control; keep it out of search results.
printf '/*\n  X-Robots-Tag: noindex\n' > dist/_headers

proposal="$(mktemp)"
trap 'rm -f "$proposal"' EXIT
cat > "$proposal" <<'JSON'
{"mount":"cloudflare","path":"creds/pages-neolesk","method":"GET","env":{"CLOUDFLARE_API_TOKEN":["data","token_value"]}}
JSON

python3 "$proposal_helper" "$proposal" \
  --alicit "$alicit_bin" \
  --justification "Deploy a static preview of darrengruber/neolesk at ${sha:0:7} to Pages project ${project}, branch ${preview}; never production, which ships through celld" \
  -- bash scripts/publish-pages-preview.sh "$project" "$production_branch" "$preview" "$sha"

echo "Preview: https://${preview}.${project}.pages.dev"
