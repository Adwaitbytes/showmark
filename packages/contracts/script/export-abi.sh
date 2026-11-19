#!/usr/bin/env bash
# Writes clean ABI JSON (just the ABI array, pretty-printed) for the contracts the app, SDK and indexer use
# to abi/{Name}.json. Run after any interface change and commit the output.
set -euo pipefail
cd "$(dirname "$0")/.."
command -v jq >/dev/null || { echo "jq is required" >&2; exit 1; }

forge build --silent
mkdir -p abi

export_abi() {
  local name=$1 artifact=$2
  jq '.abi' "out/$artifact" > "abi/$name.json"
  echo "abi/$name.json ($(jq length "abi/$name.json") entries)"
}

export_abi ShowmarkRegistry ShowmarkRegistry.sol/ShowmarkRegistry.json
export_abi CampaignVault CampaignVault.sol/CampaignVault.json
export_abi OrganizerBond OrganizerBond.sol/OrganizerBond.json
export_abi PresenceLens PresenceLens.sol/PresenceLens.json
export_abi PresenceStamp PresenceStamp.sol/PresenceStamp.json
export_abi IPresence IPresence.sol/IPresence.json
export_abi QieIdCheck QieIdCheck.sol/QieIdCheck.json
