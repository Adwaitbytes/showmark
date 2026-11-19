#!/usr/bin/env bash
# Opens the Judges' desk on a network with a fresh server-held door key, then points Vercel at it.
# Usage: scripts/judges-desk.sh <1990|1983> [poolQie]
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
set -a; . ./.env.local; set +a
CHAIN_ID="${1:?usage: scripts/judges-desk.sh <1990|1983> [poolQie]}"
JUDGES_DOOR_KEY=$(cast wallet new --json | jq -r '.data[0].private_key')
export JUDGES_DOOR_KEY
printf '# Judges desk door key for chain %s\nJUDGES_DOOR_KEY_%s=%s\n' "$CHAIN_ID" "$CHAIN_ID" "$JUDGES_DOOR_KEY" >> .env.local
out=$(NODE_PATH=apps/web/node_modules node scripts/judges-desk.mjs "$CHAIN_ID" "${2:-2}")
echo "$out"
EVENT_ID=$(echo "$out" | sed -n 's/^EVENT_ID=//p')
for env in production preview development; do
  printf '%s' "$JUDGES_DOOR_KEY" | vercel env add JUDGES_DOOR_KEY "$env" --force >/dev/null 2>&1
  printf '%s' "$EVENT_ID" | vercel env add NEXT_PUBLIC_JUDGES_DESK_EVENT_ID "$env" --force >/dev/null 2>&1
done
echo "Judges' desk is event $EVENT_ID; redeploy to apply"
