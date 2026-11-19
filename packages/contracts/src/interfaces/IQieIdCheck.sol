// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title IQieIdCheck
/// @notice Answers whether a wallet holds a QIE ID. Implementations must never revert.
interface IQieIdCheck {
    /// @notice True when `wallet` holds a QIE ID.
    /// @param wallet The wallet to check.
    /// @return Whether the wallet holds a QIE ID.
    function hasQieId(address wallet) external view returns (bool);
}
