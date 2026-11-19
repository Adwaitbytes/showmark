#!/usr/bin/env bash
# Starts a second, isolated Next dev server for the organizer e2e tests, with test contract addresses baked in.
#
# Next 16 locks .next/dev, so a second `next dev` cannot run in apps/web while someone else's dev server is up.
# This copies the app (not node_modules) into a git-ignored folder at the repo root and runs it there on port 3210.
# Every chain and API call is mocked by the tests, so the addresses only need to be valid and non-zero.
#
#   apps/web/e2e/organizer/serve.sh           # then, in another shell:
#   pnpm --filter web exec playwright test -c e2e/organizer
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
web="$(cd "$here/../.." && pwd)"
root="$(cd "$web/../.." && pwd)"
copy="$root/.e2e-organizer-app"

mkdir -p "$copy"
printf '*\n' > "$copy/.gitignore"
rsync -a --delete \
  --exclude node_modules --exclude .next --exclude 'e2e/**/screenshots' --exclude test-results --exclude playwright-report \
  --exclude .gitignore --exclude '.env*' \
  "$web/" "$copy/"
ln -sfn ../apps/web/node_modules "$copy/node_modules"

cd "$copy"
export NEXT_PUBLIC_CHAIN_ID=1983
export NEXT_PUBLIC_REGISTRY_ADDRESS=0x5FbDB2315678afecb367f032d93F642f64180aa3
export NEXT_PUBLIC_VAULT_ADDRESS=0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512
export NEXT_PUBLIC_STAMP_ADDRESS=0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0
export NEXT_PUBLIC_SITE_URL=http://localhost:3210
exec ./node_modules/.bin/next dev --port "${PORT:-3210}"
