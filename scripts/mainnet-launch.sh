#!/usr/bin/env bash
# One-shot mainnet launch for Showmark. Every step is checked before the next one runs.
#   1. Preflight: Safe exists on chain 1990, deployer and relayer are funded, tests pass.
#   2. Deploy the audited contracts with the Safe as pending owner and fee recipient.
#   3. Verify every contract on mainnet.qie.digital.
#   4. Write the Safe Transaction Builder batch that accepts ownership of the four contracts.
#   5. Point the Vercel app at mainnet, clear the testnet index, redeploy.
# Secrets come only from .env.local. Usage: scripts/mainnet-launch.sh
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
set -a; . ./.env.local; set +a

RPC=https://rpc1mainnet.qie.digital
need() { [ -n "${!1:-}" ] || { echo "missing $1 in .env.local" >&2; exit 1; }; }
need DEPLOYER_PRIVATE_KEY; need DEPLOYER_ADDRESS; need RELAYER_ADDRESS; need SAFE_ADDRESS

echo "== preflight"
[ "$(cast chain-id --rpc-url $RPC)" = "1990" ] || { echo "RPC is not chain 1990" >&2; exit 1; }
[ "$(cast codesize "$SAFE_ADDRESS" --rpc-url $RPC)" -gt 0 ] || { echo "SAFE_ADDRESS has no code on mainnet; create the Safe first" >&2; exit 1; }
cast call "$SAFE_ADDRESS" "getOwners()(address[])" --rpc-url $RPC
cast call "$SAFE_ADDRESS" "getThreshold()(uint256)" --rpc-url $RPC
deployer_wei=$(cast balance "$DEPLOYER_ADDRESS" --rpc-url $RPC)
relayer_wei=$(cast balance "$RELAYER_ADDRESS" --rpc-url $RPC)
echo "deployer $(cast from-wei "$deployer_wei") QIE, relayer $(cast from-wei "$relayer_wei") QIE"
[ "$deployer_wei" -ge 5000000000000000000 ] || { echo "deployer needs at least 5 QIE" >&2; exit 1; }
[ "$relayer_wei" -ge 5000000000000000000 ] || { echo "relayer needs at least 5 QIE" >&2; exit 1; }
(cd packages/contracts && forge test >/dev/null) && echo "forge test: pass"

echo "== deploy"
(
  cd packages/contracts
  # Fees go straight to the protocol Safe (D-042).
  FEE_RECIPIENT="$SAFE_ADDRESS" FEE_BPS="${FEE_BPS:-100}" STAMP_BASE_URI=https://showmark.vercel.app/api/stamp/ ORACLE_MAX_AGE=172800 \
    forge script script/Deploy.s.sol --rpc-url $RPC --broadcast --slow
)
DEP=packages/contracts/deployments/1990.json
jq . "$DEP"

echo "== verify"
sleep 20
(cd packages/contracts && ./script/verify.sh 1990) || echo "some verifications failed; rerun packages/contracts/script/verify.sh 1990"

echo "== Safe batch to accept ownership"
out=docs/safe/accept-ownership-1990.json
mkdir -p docs/safe
selector=$(cast sig "acceptOwnership()")
jq -n --arg safe "$SAFE_ADDRESS" --arg data "$selector" \
  --arg registry "$(jq -r .registry "$DEP")" --arg stamp "$(jq -r .stamp "$DEP")" \
  --arg vault "$(jq -r .vault "$DEP")" --arg bond "$(jq -r .bond "$DEP")" \
  --arg now "$(date +%s)000" '{
    version: "1.0", chainId: "1990", createdAt: ($now|tonumber),
    meta: { name: "Showmark: accept ownership", description: "Accept ownership of the four Showmark contracts", createdFromSafeAddress: $safe },
    transactions: [ $registry, $stamp, $vault, $bond ] | map({ to: ., value: "0", data: $data, contractMethod: null, contractInputsValues: null })
  }' > "$out"
echo "wrote $out: load it in safe.qie.digital > Apps > Transaction Builder, then the owners sign once"

echo "== point the app at mainnet"
./scripts/set-vercel-env.sh 1990
./scripts/reset-index.sh
git add "$DEP" packages/contracts/broadcast/Deploy.s.sol/1990 "$out"
git commit -m "Deploy Showmark to QIE Mainnet and prepare the Safe ownership batch" -- "$DEP" packages/contracts/broadcast/Deploy.s.sol/1990 "$out"
./scripts/push.sh
echo "== done. Next: Safe owners accept ownership; then create the mainnet Judges' desk (scripts/judges-desk.sh 1990)."
