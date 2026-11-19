// SPDX-License-Identifier: MIT
pragma solidity 0.8.38;

import {IQieIdCheck} from "./interfaces/IQieIdCheck.sol";
import {IQieNameRegistry} from "./interfaces/IQieNameRegistry.sol";

/// @title QieIdCheck
/// @notice A wallet holds a QIE ID when QIE's name registry returns a non-empty `userDomain` for it.
/// @dev QIE's registry is an upgradeable proxy controlled by its owner, so this check never trusts its answer
/// blindly: the query is a gas-capped staticcall that copies at most 64 bytes of return data, and a revert, an
/// out-of-gas, or any answer that is not a well-formed ABI string reads as "no QIE ID" instead of reverting.
contract QieIdCheck is IQieIdCheck {
    /// @notice The registry address is zero or has no code.
    error InvalidRegistry();

    /// @notice Gas forwarded to the registry. A real lookup uses about 9,000.
    uint256 public constant QUERY_GAS = 100_000;

    /// @notice QIE's name registry (mainnet 0x1D69d75AD7b77b91C3760F84faC52E651710f62e).
    address public immutable nameRegistry;

    /// @param nameRegistry_ The registry exposing `userDomain(address) returns (string)`.
    constructor(address nameRegistry_) {
        if (nameRegistry_.code.length == 0) revert InvalidRegistry();
        nameRegistry = nameRegistry_;
    }

    /// @inheritdoc IQieIdCheck
    function hasQieId(address wallet) external view returns (bool) {
        address target = nameRegistry;
        bytes4 selector = IQieNameRegistry.userDomain.selector;
        bool ok;
        uint256 size;
        uint256 offset;
        uint256 length;
        assembly ("memory-safe") {
            // scratch space past the free memory pointer; nothing is allocated
            let ptr := mload(0x40)
            mstore(ptr, selector)
            mstore(add(ptr, 0x04), wallet)
            ok := staticcall(QUERY_GAS, target, ptr, 0x24, ptr, 0x40)
            size := returndatasize()
            offset := mload(ptr)
            length := mload(add(ptr, 0x20))
        }
        // A single ABI-encoded string is [0x20][length][bytes...]; anything else is not an answer.
        if (!ok || size < 0x40 || offset != 0x20 || length == 0) return false;
        return length <= size - 0x40;
    }
}
