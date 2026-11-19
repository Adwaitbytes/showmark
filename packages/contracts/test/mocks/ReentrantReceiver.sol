// SPDX-License-Identifier: MIT
pragma solidity 0.8.38;

/// @notice Malicious receiver: when it is paid native QIE it re-enters a configured target with a configured
/// call, up to three times, swallowing failures so the outer payment still completes. Tests then prove it was paid
/// exactly once.
contract ReentrantReceiver {
    address public target;
    bytes public payload;
    uint256 public attempts;
    uint256 public reentrySuccesses;
    bytes public lastRevert;

    function arm(address target_, bytes calldata payload_) external {
        target = target_;
        payload = payload_;
    }

    /// @notice Lets the test act through this contract (as sponsor, organizer or bonded party).
    function exec(address to, bytes calldata data) external payable returns (bytes memory ret) {
        bool ok;
        (ok, ret) = to.call{value: msg.value}(data);
        if (!ok) {
            assembly ("memory-safe") {
                revert(add(ret, 0x20), mload(ret))
            }
        }
    }

    receive() external payable {
        if (target == address(0) || attempts >= 3) return;
        attempts += 1;
        (bool ok, bytes memory ret) = target.call(payload);
        if (ok) reentrySuccesses += 1;
        else lastRevert = ret;
    }
}
