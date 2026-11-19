#!/usr/bin/env bash
# Pushes main to github.com/Adwaitbytes/showmark with that account's gh token, after a secret scan and a full
# production build, so a push can never ship a build Vercel would reject.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
./scripts/secret-scan.sh
pnpm --filter web typecheck
pnpm --filter web test
pnpm --filter "web..." build
TOKEN=$(gh auth token --user Adwaitbytes)
git -c credential.helper= -c "http.https://github.com/.extraheader=AUTHORIZATION: basic $(printf 'x-access-token:%s' "$TOKEN" | base64)" push origin main
