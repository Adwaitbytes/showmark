// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IPresence} from "showmark/interfaces/IPresence.sol";

/// @notice The docs/SDK.md example: anyone verified at a Showmark event claims one perk, once per person.
/// @dev Claims are keyed by presenceKeyOf, because a pass and the wallet linked to it both pass hasAttended.
contract BuilderPerks {
    IPresence public immutable presence;
    uint256 public immutable eventId;
    mapping(address presenceKey => bool) public claimed;

    event Claimed(address indexed presenceKey, address indexed account);

    error NotPresent();
    error AlreadyClaimed();

    constructor(IPresence presence_, uint256 eventId_) {
        presence = presence_;
        eventId = eventId_;
    }

    function claim() external {
        if (!presence.hasAttended(eventId, msg.sender)) revert NotPresent();
        address key = presence.presenceKeyOf(msg.sender);
        if (claimed[key]) revert AlreadyClaimed();
        claimed[key] = true;
        emit Claimed(key, msg.sender);
        // Mint, transfer or grant the perk here.
    }
}
