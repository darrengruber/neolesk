#!/usr/bin/env bash
# The publish step of scripts/deploy-preview-through-alicit.sh. It runs as the
# consumer of the approved Alicit operation, so CLOUDFLARE_API_TOKEN exists only
# in this process. Do not run it by hand.
set -euo pipefail

project="${1:?project}"
production_branch="${2:?production branch}"
preview="${3:?preview name}"
sha="${4:?commit sha}"

if [ -z "${CLOUDFLARE_API_TOKEN:-}" ]; then
  echo "ERROR: no approved Cloudflare token; run scripts/deploy-preview-through-alicit.sh." >&2
  exit 1
fi
if [ "$preview" = "$production_branch" ]; then
  echo "ERROR: refusing to deploy to the production branch of $project." >&2
  exit 1
fi

# The wrangler version is locked by package-lock.json.
wrangler="node_modules/.bin/wrangler"

# The first preview creates the project. Its production branch never receives a
# deploy.
if ! "$wrangler" pages project list 2>/dev/null | grep -Eq "(^|[[:space:]│|])${project}([[:space:]│|]|$)"; then
  "$wrangler" pages project create "$project" --production-branch="$production_branch"
fi

"$wrangler" pages deploy dist \
  --project-name="$project" \
  --branch="$preview" \
  --commit-hash="$sha" \
  --commit-dirty=false
