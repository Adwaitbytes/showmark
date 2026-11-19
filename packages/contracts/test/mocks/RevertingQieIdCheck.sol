// SPDX-License-Identifier: MIT
pragma solidity 0.8.38;

import {IQieIdCheck} from "../../src/interfaces/IQieIdCheck.sol";

/// @notice A QIE ID check that breaks its never-revert promise, to prove the vault still defers instead of reverting.
contract RevertingQieIdCheck is IQieIdCheck {
    function hasQieId(address) external pure returns (bool) {
        revert("check broken");
    }
}
