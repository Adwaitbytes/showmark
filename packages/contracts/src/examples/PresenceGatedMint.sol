// SPDX-License-Identifier: MIT
pragma solidity 0.8.38;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {IPresence} from "../interfaces/IPresence.sol";

/// @title PresenceGatedMint
/// @notice Example integration: anyone who was verifiably present at a Showmark event may mint one souvenir NFT
/// for that event. Claims are keyed by `presenceKeyOf`, so a pass and its linked wallet share one claim.
/// @dev The SDK's reference for gating on real-world presence through IPresence. Uses `_mint`, not `_safeMint`,
/// so claiming never calls back into the claimer.
contract PresenceGatedMint is ERC721 {
    /// @notice The caller has no recorded presence at the event.
    error NotAttended();
    /// @notice This person already claimed for the event.
    error AlreadyClaimed();

    /// @notice Emitted for every souvenir minted.
    /// @param eventId The event attended.
    /// @param presenceKey The pass the presence is keyed by.
    /// @param to The receiver (the caller).
    /// @param tokenId The new token id.
    event Claimed(uint256 indexed eventId, address indexed presenceKey, address indexed to, uint256 tokenId);

    /// @notice The presence source (a PresenceLens).
    IPresence public immutable presence;
    /// @notice Whether the person behind `presenceKey` already claimed for `eventId`.
    mapping(uint256 eventId => mapping(address presenceKey => bool)) public claimed;
    /// @notice The event each souvenir was minted for.
    mapping(uint256 tokenId => uint256 eventId) public eventOf;

    uint256 private _lastTokenId;

    /// @param presence_ The IPresence implementation to gate on.
    /// @param name_ ERC-721 name.
    /// @param symbol_ ERC-721 symbol.
    constructor(IPresence presence_, string memory name_, string memory symbol_) ERC721(name_, symbol_) {
        presence = presence_;
    }

    /// @notice Mints one souvenir for an event the caller attended.
    /// @param eventId The Showmark event id.
    /// @return tokenId The new token id.
    function claim(uint256 eventId) external returns (uint256 tokenId) {
        if (!presence.hasAttended(eventId, msg.sender)) revert NotAttended();
        address key = presence.presenceKeyOf(msg.sender);
        if (claimed[eventId][key]) revert AlreadyClaimed();

        claimed[eventId][key] = true;
        tokenId = ++_lastTokenId;
        eventOf[tokenId] = eventId;
        emit Claimed(eventId, key, msg.sender, tokenId);
        _mint(msg.sender, tokenId);
    }
}
