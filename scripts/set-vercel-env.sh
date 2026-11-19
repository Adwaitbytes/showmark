#!/usr/bin/env bash
# Points the Vercel project at a Showmark deployment: reads packages/contracts/deployments/{chainId}.json and
# sets the public contract addresses for production, preview and development. Usage: scripts/set-vercel-env.sh 1983
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
CHAIN_ID="${1:?usage: scripts/set-vercel-env.sh <1983|1990>}"
FILE="packages/contracts/deployments/$CHAIN_ID.json"
[ -f "$FILE" ] || { echo "missing $FILE" >&2; exit 1; }

set_var() {
  local name=$1 value=$2
  for env in production preview development; do
    printf '%s' "$value" | vercel env add "$name" "$env" --force >/dev/null 2>&1 || { echo "failed to set $name for $env" >&2; exit 1; }
  done
  echo "set $name"
}

set_var NEXT_PUBLIC_CHAIN_ID "$CHAIN_ID"
set_var NEXT_PUBLIC_SITE_URL "https://showmark.vercel.app"
set_var NEXT_PUBLIC_REGISTRY_ADDRESS "$(jq -r .registry "$FILE")"
set_var NEXT_PUBLIC_STAMP_ADDRESS "$(jq -r .stamp "$FILE")"
set_var NEXT_PUBLIC_VAULT_ADDRESS "$(jq -r .vault "$FILE")"
set_var NEXT_PUBLIC_BOND_ADDRESS "$(jq -r .bond "$FILE")"
set_var NEXT_PUBLIC_LENS_ADDRESS "$(jq -r .lens "$FILE")"
set_var NEXT_PUBLIC_QIE_ID_CHECK_ADDRESS "$(jq -r .qieIdCheck "$FILE")"
set_var NEXT_PUBLIC_DEPLOY_BLOCK "$(jq -r .deployBlock "$FILE")"
if [ "$(jq -r '.testnetMocks // false' "$FILE")" = "true" ]; then
  set_var NEXT_PUBLIC_QUSDC_ADDRESS "$(jq -r .qusdc "$FILE")"
  set_var NEXT_PUBLIC_ORACLE_ADDRESS "$(jq -r .oracle "$FILE")"
  set_var NEXT_PUBLIC_QIE_NAME_REGISTRY_ADDRESS "$(jq -r .nameRegistry "$FILE")"
  set_var QIE_NAME_REGISTRY_ADDRESS "$(jq -r .nameRegistry "$FILE")"
fi
echo "done; redeploy to apply"
