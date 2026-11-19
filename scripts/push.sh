#!/usr/bin/env bash
# Pushes main to github.com/Adwaitbytes/showmark with that account's gh token, after a secret scan.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
./scripts/secret-scan.sh
TOKEN=$(gh auth token --user Adwaitbytes)
git -c credential.helper= -c "http.https://github.com/.extraheader=AUTHORIZATION: basic $(printf 'x-access-token:%s' "$TOKEN" | base64)" push origin main
