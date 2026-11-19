#!/usr/bin/env bash
# Run before every push. Scans every commit and any uncommitted tracked change for secrets.
# Gitignored files such as .env.local are never committed, so they are out of scope by design.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
gitleaks git --no-banner --redact .
gitleaks git --no-banner --redact --pre-commit .
