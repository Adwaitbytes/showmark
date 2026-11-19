#!/usr/bin/env bash
# Clears the indexed copy of chain data so the indexer starts again from the configured deploy block.
# Use after pointing the app at a new deployment (testnet redeploy, or the switch to mainnet).
# Mirrors resetIndex() in apps/web/src/server/indexer/sync.ts. Keeps door_queue. Usage: scripts/reset-index.sh
set -euo pipefail
cd "$(git rev-parse --show-toplevel)/apps/web"
set -a; . ./.env.local; set +a
psql "${DATABASE_URL_UNPOOLED:?DATABASE_URL_UNPOOLED is not set}" -v ON_ERROR_STOP=1 <<'SQL'
BEGIN;
DELETE FROM presences; DELETE FROM events; DELETE FROM series; DELETE FROM links; DELETE FROM campaigns;
DELETE FROM campaign_events; DELETE FROM settlements; DELETE FROM settlement_skips; DELETE FROM fundings;
DELETE FROM refunds; DELETE FROM withdrawals; DELETE FROM transactions; DELETE FROM profiles; DELETE FROM sync_state;
COMMIT;
SQL
echo "index cleared"
