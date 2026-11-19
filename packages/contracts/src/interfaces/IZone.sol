// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title IZone
/// @notice The subset of the QIE ID (Zone, ERC-721) contract that Showmark reads.
interface IZone {
    /// @notice Number of QIE ID names held by `owner`.
    /// @param owner The holder.
    /// @return The balance.
    function balanceOf(address owner) external view returns (uint256);
}
