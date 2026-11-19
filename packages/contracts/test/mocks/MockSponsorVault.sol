// SPDX-License-Identifier: MIT
pragma solidity 0.8.38;

import {ICampaignVault} from "../../src/interfaces/ICampaignVault.sol";

/// @notice Vault stand-in for OrganizerBond unit tests: campaign(id).sponsor and openToBonded, and exposureOf, are
/// meaningful.
contract MockSponsorVault {
    mapping(uint256 => address) public sponsorOf;
    mapping(uint256 => bool) public openOf;
    mapping(uint256 => mapping(address => uint256)) public exposureOf;

    function setSponsor(uint256 campaignId, address sponsor) external {
        sponsorOf[campaignId] = sponsor;
    }

    function setOpen(uint256 campaignId, bool open) external {
        openOf[campaignId] = open;
    }

    function setExposure(uint256 campaignId, address organizer, uint256 amount) external {
        exposureOf[campaignId][organizer] = amount;
    }

    function campaign(uint256 id) external view returns (ICampaignVault.Campaign memory c) {
        c.sponsor = sponsorOf[id];
        c.openToBonded = openOf[id];
    }
}
