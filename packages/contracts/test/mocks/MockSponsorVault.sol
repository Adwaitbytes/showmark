// SPDX-License-Identifier: MIT
pragma solidity 0.8.38;

import {ICampaignVault} from "../../src/interfaces/ICampaignVault.sol";

/// @notice Vault stand-in for OrganizerBond unit tests: only campaign(id).sponsor is meaningful.
contract MockSponsorVault {
    mapping(uint256 => address) public sponsorOf;

    function setSponsor(uint256 campaignId, address sponsor) external {
        sponsorOf[campaignId] = sponsor;
    }

    function campaign(uint256 id) external view returns (ICampaignVault.Campaign memory c) {
        c.sponsor = sponsorOf[id];
    }
}
