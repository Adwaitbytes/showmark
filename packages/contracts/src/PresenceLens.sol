// SPDX-License-Identifier: MIT
pragma solidity 0.8.38;

import {IPresence} from "./interfaces/IPresence.sol";
import {IShowmarkRegistry} from "./interfaces/IShowmarkRegistry.sol";

/// @title PresenceLens
/// @notice IPresence over the Showmark registry, for contracts and the SDK. Resolves a linked wallet to its pass,
/// because presence is keyed by pass forever.
contract PresenceLens is IPresence {
    /// @notice The registry address is zero.
    error ZeroRegistry();

    /// @notice The ShowmarkRegistry this lens reads.
    IShowmarkRegistry public immutable registry;

    /// @param registry_ The ShowmarkRegistry.
    constructor(address registry_) {
        if (registry_ == address(0)) revert ZeroRegistry();
        registry = IShowmarkRegistry(registry_);
    }

    /// @inheritdoc IPresence
    function hasAttended(uint256 eventId, address account) external view returns (bool) {
        return registry.hasAttended(eventId, account);
    }

    /// @inheritdoc IPresence
    function attendedCount(address account, uint256[] calldata eventIds) external view returns (uint256 count) {
        for (uint256 i; i < eventIds.length; ++i) {
            if (registry.hasAttended(eventIds[i], account)) ++count;
        }
    }

    /// @inheritdoc IPresence
    /// @dev A linked wallet reports its pass's streak; any other account reports its own.
    function streakOf(uint64 seriesId, address account) external view returns (uint32 current, uint32 best) {
        return registry.streakOf(seriesId, _presenceKey(account));
    }

    /// @inheritdoc IPresence
    function presenceKeyOf(address account) external view returns (address) {
        return _presenceKey(account);
    }

    function _presenceKey(address account) private view returns (address) {
        address pass = registry.passOf(account);
        return pass == address(0) ? account : pass;
    }
}
