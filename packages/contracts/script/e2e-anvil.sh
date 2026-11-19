#!/usr/bin/env bash
# End-to-end proof on a throwaway local chain with QIE testnet's chain id (1983):
#   1. deploy everything with script/Deploy.s.sol (testnet stand-ins included, ownership handed to a "Safe")
#   2. organizer creates an event and authorizes a door key; sponsor funds and approves a campaign
#   3. a relayer submits a real check-in signed with EIP-712 by the attendee pass, the door key and the rotation's
#      throwaway ticket key (cast signs, so this also proves the domain and types match standard tooling)
#   4. the relayer settles it; the organizer withdraws; the pass links a wallet; the relayer withdraws the
#      attendee's reward to that wallet
#   5. verify.sh prints the Blockscout verification commands for the deployment
# Only anvil's public default keys are used. Anvil is killed on exit.
set -euo pipefail
cd "$(dirname "$0")/.."

PORT="${ANVIL_PORT:-8547}"
RPC="http://127.0.0.1:$PORT"
WORK="$(mktemp -d)"
OUT="deployments/anvil"
NATIVE=0x0000000000000000000000000000000000000000

anvil --chain-id 1983 --port "$PORT" --config-out "$WORK/anvil.json" --silent &
ANVIL_PID=$!
trap 'kill "$ANVIL_PID" 2>/dev/null || true; rm -rf "$WORK"' EXIT
for _ in $(seq 50); do cast chain-id --rpc-url "$RPC" >/dev/null 2>&1 && break; sleep 0.2; done

key() { jq -r ".private_keys[$1]" "$WORK/anvil.json"; }
addr() { cast wallet address "$1"; }
DEPLOYER_KEY=$(key 0) ORG_KEY=$(key 1) DOOR_KEY=$(key 2) PASS_KEY=$(key 3)
SPONSOR_KEY=$(key 4) RELAYER_KEY=$(key 5) WALLET_KEY=$(key 6)
DEPLOYER=$(addr "$DEPLOYER_KEY") ORG=$(addr "$ORG_KEY") DOOR=$(addr "$DOOR_KEY") PASS=$(addr "$PASS_KEY")
WALLET=$(addr "$WALLET_KEY") SAFE=$(addr "$(key 7)")

step() { printf '\n== %s\n' "$*"; }
send() { # key, then cast send args; prints hash, status and gas
  local k=$1
  shift
  local r
  r=$(cast send --rpc-url "$RPC" --private-key "$k" --json "$@")
  echo "   tx $(jq -r .transactionHash <<<"$r") status=$(jq -r .status <<<"$r") gas=$(cast to-dec "$(jq -r .gasUsed <<<"$r")")"
  [ "$(jq -r .status <<<"$r")" = "0x1" ] || { echo "transaction failed" >&2; exit 1; }
}
call() { cast call --rpc-url "$RPC" "$@"; }
ether() { cast from-wei "$(cast to-dec "$1" 2>/dev/null || echo "$1")"; }
typed() { # primaryType, types json, message json -> typed data file path
  local f="$WORK/$1-$RANDOM.json"
  jq -n --arg reg "$REGISTRY" --arg primary "$1" --argjson types "$2" --argjson message "$3" '{
    types: ({EIP712Domain: [
      {name: "name", type: "string"}, {name: "version", type: "string"},
      {name: "chainId", type: "uint256"}, {name: "verifyingContract", type: "address"}]} + $types),
    primaryType: $primary,
    domain: {name: "Showmark", version: "1", chainId: 1983, verifyingContract: $reg},
    message: $message}' >"$f"
  echo "$f"
}
sign() { cast wallet sign --data --from-file "$2" --private-key "$1"; }

step "deploy (chain id $(cast chain-id --rpc-url "$RPC"), deployer $DEPLOYER, Safe $SAFE)"
DEPLOYER_PRIVATE_KEY="$DEPLOYER_KEY" SAFE_ADDRESS="$SAFE" FEE_BPS=100 DEPLOYMENTS_DIR="$OUT" \
  STAMP_BASE_URI="http://localhost:3000/api/stamp/" FOUNDRY_BROADCAST="$WORK/broadcast" \
  forge script script/Deploy.s.sol:Deploy --rpc-url "$RPC" --broadcast --slow 2>&1 |
  grep -E "^\s+(chainId|deployBlock|registry|stamp|vault|bond|lens|qieIdCheck|nameRegistry|qusdc|oracle|oracleMaxAge|feeBps|ownership)|ONCHAIN EXECUTION COMPLETE"
J="$OUT/1983.json"
REGISTRY=$(jq -r .registry "$J") VAULT=$(jq -r .vault "$J") STAMP=$(jq -r .stamp "$J")
echo "   deployments file: $J"
echo "   registry.pendingOwner = $(call "$REGISTRY" 'pendingOwner()(address)')  vault.pendingOwner = $(call "$VAULT" 'pendingOwner()(address)')"

NOW=$(cast block latest --field timestamp --rpc-url "$RPC")
step "organizer creates event 1 and authorizes door key $DOOR"
send "$ORG_KEY" "$REGISTRY" 'createEvent(uint64,uint64,uint32,uint32,uint64,string)' \
  $((NOW - 600)) $((NOW + 7200)) 100 600 0 'Showmark anvil demo night'
EVENT_ID=$(( $(call "$REGISTRY" 'nextEventId()(uint256)') - 1 ))
send "$ORG_KEY" "$REGISTRY" 'authorizeDoorKey(uint256,address,uint64)' "$EVENT_ID" "$DOOR" $((NOW + 7200))

step "sponsor creates campaign 1: 1 QIE per presence, 60% to the attendee, 5 QIE budget, fee snapshot 1%"
send "$SPONSOR_KEY" "$VAULT" \
  'createCampaign((address,uint8,uint128,uint16,uint8,bool,uint64,uint64,uint32,uint32,bool,uint128,string),uint256)' \
  "($NATIVE,0,1000000000000000000,6000,1,false,$((NOW - 86400)),$((NOW + 86400)),0,0,false,0,Anvil demo campaign)" \
  5000000000000000000 --value 5ether
CAMPAIGN_ID=$(call "$VAULT" 'campaignCount()(uint256)')
send "$SPONSOR_KEY" "$VAULT" 'approveEvents(uint256,uint256[])' "$CAMPAIGN_ID" "[$EVENT_ID]"

step "door rotation: fresh ticket key, door signs DoorPass naming it; the QR holds the ticket key"
ISSUED=$(cast block latest --field timestamp --rpc-url "$RPC")
TICKET_KEY=$(cast wallet new --json | jq -r '(.data // .)[0].private_key')
TICKET=$(addr "$TICKET_KEY")
# messages are built with jq into variables: nested quoting inside "$(...)" breaks on macOS bash 3.2
DOORPASS_TYPES='{"DoorPass":[{"name":"eventId","type":"uint256"},{"name":"issuedAt","type":"uint64"},{"name":"ticket","type":"address"}]}'
DOORPASS_MSG=$(jq -nc --argjson e "$EVENT_ID" --argjson t "$ISSUED" --arg k "$TICKET" '{eventId: $e, issuedAt: $t, ticket: $k}')
DOORPASS_FILE=$(typed DoorPass "$DOORPASS_TYPES" "$DOORPASS_MSG")
DOOR_SIG=$(sign "$DOOR_KEY" "$DOORPASS_FILE")
echo "   ticket key address $TICKET (private key never leaves the QR)"

step "attendee pass $PASS signs CheckIn(mode 1) and, with the scanned ticket key, Ticket; relayer submits checkIn"
CHECKIN_TYPES='{"CheckIn":[{"name":"eventId","type":"uint256"},{"name":"attendee","type":"address"},{"name":"mode","type":"uint8"}]}'
CHECKIN_MSG=$(jq -nc --argjson e "$EVENT_ID" --arg a "$PASS" '{eventId: $e, attendee: $a, mode: 1}')
CHECKIN_FILE=$(typed CheckIn "$CHECKIN_TYPES" "$CHECKIN_MSG")
ATT_SIG=$(sign "$PASS_KEY" "$CHECKIN_FILE")
TICKET_TYPES='{"Ticket":[{"name":"eventId","type":"uint256"},{"name":"attendee","type":"address"}]}'
TICKET_MSG=$(jq -nc --argjson e "$EVENT_ID" --arg a "$PASS" '{eventId: $e, attendee: $a}')
TICKET_FILE=$(typed Ticket "$TICKET_TYPES" "$TICKET_MSG")
TICKET_SIG=$(sign "$TICKET_KEY" "$TICKET_FILE")
send "$RELAYER_KEY" "$REGISTRY" 'checkIn((uint256,address,uint8,uint64,address,bytes,bytes,bytes))' \
  "($EVENT_ID,$PASS,1,$ISSUED,$TICKET,$ATT_SIG,$DOOR_SIG,$TICKET_SIG)"
echo "   presenceOf(event, pass) = $(call "$REGISTRY" 'presenceOf(uint256,address)((uint8,uint64))' "$EVENT_ID" "$PASS")"
echo "   stamp balance of pass = $(call "$STAMP" 'balanceOf(address,uint256)(uint256)' "$PASS" "$EVENT_ID"), uri = $(call "$STAMP" 'uri(uint256)(string)' "$EVENT_ID")"
echo "   pass native balance = $(cast balance "$PASS" --rpc-url "$RPC" -e) QIE (the relayer paid the gas)"

step "relayer settles the presence"
send "$RELAYER_KEY" "$VAULT" 'settle(uint256,uint256,address)' "$CAMPAIGN_ID" "$EVENT_ID" "$PASS"
echo "   claimable attendee = $(ether "$(call "$VAULT" 'claimable(address,address)(uint256)' $NATIVE "$PASS" | cut -d' ' -f1)") QIE"
echo "   claimable organizer = $(ether "$(call "$VAULT" 'claimable(address,address)(uint256)' $NATIVE "$ORG" | cut -d' ' -f1)") QIE"
echo "   claimable fee recipient = $(ether "$(call "$VAULT" 'claimable(address,address)(uint256)' $NATIVE "$DEPLOYER" | cut -d' ' -f1)") QIE"
echo "   campaign balance left = $(ether "$(call "$VAULT" 'campaign(uint256)((address,uint8,uint16,uint16,uint8,bool,bool,address,uint32,uint32,uint32,uint64,uint64,uint128,uint128,uint256))' "$CAMPAIGN_ID" | tr -d '()' | awk -F', ' '{print $16}' | cut -d' ' -f1)") QIE"

step "organizer withdraws its share"
BEFORE=$(cast balance "$ORG" --rpc-url "$RPC")
send "$ORG_KEY" "$VAULT" 'withdraw(address,address)' $NATIVE "$ORG"
AFTER=$(cast balance "$ORG" --rpc-url "$RPC")
echo "   organizer balance change = $(cast from-wei $((AFTER - BEFORE))) QIE (0.396 minus gas)"

step "pass links wallet $WALLET (both sign LinkWallet), relayer submits and relocates the stamp"
DEADLINE=$(( $(cast block latest --field timestamp --rpc-url "$RPC") + 600 ))
LINK_TYPES='{"LinkWallet":[{"name":"pass","type":"address"},{"name":"wallet","type":"address"},{"name":"deadline","type":"uint64"}]}'
LINK_MSG=$(jq -nc --arg p "$PASS" --arg w "$WALLET" --argjson d "$DEADLINE" '{pass: $p, wallet: $w, deadline: $d}')
LINK_FILE=$(typed LinkWallet "$LINK_TYPES" "$LINK_MSG")
PASS_LINK_SIG=$(sign "$PASS_KEY" "$LINK_FILE")
WALLET_LINK_SIG=$(sign "$WALLET_KEY" "$LINK_FILE")
send "$RELAYER_KEY" "$REGISTRY" 'linkWallet(address,address,uint64,bytes,bytes,uint256[])' \
  "$PASS" "$WALLET" "$DEADLINE" "$PASS_LINK_SIG" "$WALLET_LINK_SIG" "[$EVENT_ID]"
echo "   walletOf(pass) = $(call "$REGISTRY" 'walletOf(address)(address)' "$PASS")"
echo "   stamp now on wallet = $(call "$STAMP" 'balanceOf(address,uint256)(uint256)' "$WALLET" "$EVENT_ID"), hasAttended(wallet) = $(call "$REGISTRY" 'hasAttended(uint256,address)(bool)' "$EVENT_ID" "$WALLET")"

step "relayer withdraws the attendee reward to the linked wallet (gasless for the attendee)"
BEFORE=$(cast balance "$WALLET" --rpc-url "$RPC")
send "$RELAYER_KEY" "$VAULT" 'withdraw(address,address)' $NATIVE "$PASS"
AFTER=$(cast balance "$WALLET" --rpc-url "$RPC")
echo "   wallet balance change = $(cast from-wei $((AFTER - BEFORE))) QIE"

step "solvency"
echo "   vault holds $(cast balance "$VAULT" --rpc-url "$RPC" -e) QIE, totalLiabilities(native) = $(ether "$(call "$VAULT" 'totalLiabilities(address)(uint256)' $NATIVE | cut -d' ' -f1)") QIE"

step "Blockscout verification commands for this deployment (dry run)"
DRY_RUN=1 DEPLOYMENTS_DIR="$OUT" script/verify.sh 1983 | sed 's/--constructor-args [0-9a-fx]*/--constructor-args <encoded>/'
