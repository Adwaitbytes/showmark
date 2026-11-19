// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title IPresence
/// @notice Lets any QIE contract gate on verified real-world presence recorded by Showmark.
/// @dev Accounts may be a pass key or the wallet linked to it; implementations resolve wallet to pass.
interface IPresence {
    /// @notice True when `account` (or the pass linked to it) has a recorded presence at the event.
    /// @param eventId The Showmark event id.
    /// @param account A pass or a linked wallet.
    /// @return Whether the account attended.
    function hasAttended(uint256 eventId, address account) external view returns (bool);

    /// @notice How many of `eventIds` the account attended. Each listed id is counted, duplicates included.
    /// @param account A pass or a linked wallet.
    /// @param eventIds Event ids to check.
    /// @return The number of listed events attended.
    function attendedCount(address account, uint256[] calldata eventIds) external view returns (uint256);

    /// @notice Current and best streak of the account in a series.
    /// @param seriesId The series id.
    /// @param account A pass or a linked wallet.
    /// @return current The current run of consecutive series events.
    /// @return best The longest run ever recorded.
    function streakOf(uint64 seriesId, address account) external view returns (uint32 current, uint32 best);

    /// @notice The address presence is keyed by for `account`: its linked pass, or itself when unlinked.
    /// @dev Key one-per-person claims by this value, since a pass and its wallet both pass `hasAttended`.
    /// @param account A pass or a linked wallet.
    /// @return The presence key.
    function presenceKeyOf(address account) external view returns (address);
}
