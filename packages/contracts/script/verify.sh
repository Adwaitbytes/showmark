#!/usr/bin/env bash
# Verifies every Showmark contract on QIE's Blockscout explorer, reading addresses and constructor inputs
# from deployments/{chainId}.json written by script/Deploy.s.sol.
#
#   script/verify.sh 1983           verify on testnet
#   script/verify.sh 1990           verify on mainnet
#   DRY_RUN=1 script/verify.sh 1983 print the forge commands instead of running them
#   DEPLOYMENTS_DIR=dir             read {dir}/{chainId}.json instead of deployments/{chainId}.json
set -euo pipefail
cd "$(dirname "$0")/.."

CHAIN_ID="${1:?usage: script/verify.sh <1990|1983>}"
case "$CHAIN_ID" in
  1990) VERIFIER_URL="https://mainnet.qie.digital/api/" ;;
  1983) VERIFIER_URL="https://testnet.qie.digital/api/" ;;
  *) echo "unsupported chain id $CHAIN_ID (expected 1990 or 1983)" >&2; exit 1 ;;
esac

FILE="${DEPLOYMENTS_DIR:-deployments}/$CHAIN_ID.json"
[ -f "$FILE" ] || { echo "no deployments file at $FILE; run script/Deploy.s.sol first" >&2; exit 1; }
command -v jq >/dev/null || { echo "jq is required" >&2; exit 1; }

field() { jq -er --arg k "$1" '.[$k]' "$FILE"; }

DEPLOYER=$(field deployer)
REGISTRY=$(field registry)
STAMP=$(field stamp)
VAULT=$(field vault)
BOND=$(field bond)
LENS=$(field lens)
QIE_ID_CHECK=$(field qieIdCheck)
NAME_REGISTRY=$(field nameRegistry)
QUSDC=$(field qusdc)
ORACLE=$(field oracle)
ORACLE_MAX_AGE=$(field oracleMaxAge)
FEE_BPS=$(field feeBps)
FEE_RECIPIENT=$(field feeRecipient)
BASE_URI=$(jq -r '.stampBaseURI' "$FILE")
TESTNET_MOCKS=$(field testnetMocks)

verify() {
  local address=$1 target=$2 args=${3:-}
  local cmd=(forge verify-contract --chain-id "$CHAIN_ID" --verifier blockscout --verifier-url "$VERIFIER_URL"
    --watch "$address" "$target")
  [ -n "$args" ] && cmd+=(--constructor-args "$args")
  if [ "${DRY_RUN:-0}" = "1" ]; then
    printf '%q ' "${cmd[@]}"
    echo
  else
    echo "verifying $target at $address"
    # Keep going: Blockscout can lag on contracts created inside another constructor (PresenceStamp).
    "${cmd[@]}" || { echo "FAILED to verify $target at $address; rerun this script later" >&2; FAILED=1; }
  fi
}
FAILED=0

verify "$QIE_ID_CHECK" src/QieIdCheck.sol:QieIdCheck \
  "$(cast abi-encode 'constructor(address)' "$NAME_REGISTRY")"
verify "$REGISTRY" src/ShowmarkRegistry.sol:ShowmarkRegistry \
  "$(cast abi-encode 'constructor(address,string)' "$DEPLOYER" "$BASE_URI")"
verify "$STAMP" src/PresenceStamp.sol:PresenceStamp \
  "$(cast abi-encode 'constructor(address,address,string)' "$REGISTRY" "$DEPLOYER" "$BASE_URI")"
verify "$BOND" src/OrganizerBond.sol:OrganizerBond \
  "$(cast abi-encode 'constructor(address)' "$DEPLOYER")"
verify "$VAULT" src/CampaignVault.sol:CampaignVault \
  "$(cast abi-encode 'constructor(address,address,address,address,uint256,address,address,uint16)' \
    "$REGISTRY" "$QIE_ID_CHECK" "$ORACLE" "$BOND" "$ORACLE_MAX_AGE" "$DEPLOYER" "$FEE_RECIPIENT" "$FEE_BPS")"
verify "$LENS" src/PresenceLens.sol:PresenceLens \
  "$(cast abi-encode 'constructor(address)' "$REGISTRY")"

if [ "$TESTNET_MOCKS" = "true" ]; then
  verify "$QUSDC" src/testnet/TestnetQUSDC.sol:TestnetQUSDC
  verify "$NAME_REGISTRY" src/testnet/TestnetNameRegistry.sol:TestnetNameRegistry
  verify "$ORACLE" src/testnet/TestnetAggregator.sol:TestnetAggregator \
    "$(cast abi-encode 'constructor(address,int256)' "$DEPLOYER" "$(field testnetInitialPrice)")"
fi

exit "$FAILED"
