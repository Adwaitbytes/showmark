// SPDX-License-Identifier: MIT
pragma solidity 0.8.38;

import {ICampaignVault} from "../../src/interfaces/ICampaignVault.sol";

/// @notice Vault stand-in for OrganizerBond unit tests: campaign(id).sponsor and paidForOrganizer are meaningful.
contract MockSponsorVault {
    mapping(uint256 => address) public sponsorOf;
    mapping(uint256 => address) public tokenOf;
    mapping(uint256 => mapping(address => uint256)) public paidForOrganizer;

    function setPaid(uint256 campaignId, address organizer, uint256 amount) external {
        paidForOrganizer[campaignId][organizer] = amount;
    }

    function setToken(uint256 campaignId, address token) external {
        tokenOf[campaignId] = token;
    }

    function setSponsor(uint256 campaignId, address sponsor) external {
        sponsorOf[campaignId] = sponsor;
    }

    function campaign(uint256 id) external view returns (ICampaignVault.Campaign memory c) {
        c.sponsor = sponsorOf[id];
        c.token = tokenOf[id];
    }
}
