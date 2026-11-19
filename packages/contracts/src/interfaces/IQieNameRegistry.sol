// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title IQieNameRegistry
/// @notice The subset of QIE's name registry that Showmark reads.
interface IQieNameRegistry {
    /// @notice The QIE ID name of `wallet`, such as "alice.qie", or "" when it has none.
    /// @param wallet The wallet.
    /// @return The name.
    function userDomain(address wallet) external view returns (string memory);
}
