// SPDX-License-Identifier: MIT
pragma solidity 0.8.38;

import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";

/// @title Ownable2StepNoRenounce
/// @notice Ownable2Step without renounceOwnership. A renounced owner would leave a paused contract paused forever and
/// strand every challenged bond (audit L-06); ownership can only move, through the two-step handover.
abstract contract Ownable2StepNoRenounce is Ownable2Step {
    /// @notice renounceOwnership is disabled.
    error RenounceDisabled();

    /// @notice Always reverts: ownership can be transferred but never renounced.
    function renounceOwnership() public pure override {
        revert RenounceDisabled();
    }
}
