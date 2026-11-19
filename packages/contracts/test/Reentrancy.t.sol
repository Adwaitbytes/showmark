// SPDX-License-Identifier: MIT
pragma solidity 0.8.38;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {CampaignVault} from "../src/CampaignVault.sol";
import {ShowmarkRegistry} from "../src/ShowmarkRegistry.sol";
import {ICampaignVault} from "../src/interfaces/ICampaignVault.sol";
import {ProtocolFixture} from "./utils/ProtocolFixture.sol";
import {ReentrantReceiver} from "./mocks/ReentrantReceiver.sol";

/// @notice Invariant 8: native payouts to a malicious receiver cannot drain or double-claim.
contract ReentrancyTest is ProtocolFixture {
    ReentrantReceiver internal attacker;

    function setUp() public override {
        super.setUp();
        attacker = new ReentrantReceiver();
        vm.deal(address(attacker), 0);
    }

    /// The attacker organizes an event, earns the organizer share, then re-enters withdraw from receive().
    function test_withdrawNative_reentryPaysOnce() public {
        uint256 evt = _attackerEvent();
        uint256 id = _create(_params(NATIVE), 10 ether);
        _approve(id, evt);
        _checkInNow(evt, attendeePk);
        _checkInNow(evt, 0xBEEF);
        vault.settle(id, evt, attendee);
        vault.settle(id, evt, vm.addr(0xBEEF));
        assertEq(vault.claimable(NATIVE, address(attacker)), 1 ether);

        attacker.arm(address(vault), abi.encodeCall(CampaignVault.withdraw, (NATIVE, address(attacker))));
        attacker.exec(address(vault), abi.encodeCall(CampaignVault.withdraw, (NATIVE, address(attacker))));

        assertEq(address(attacker).balance, 1 ether, "paid exactly once");
        assertEq(attacker.reentrySuccesses(), 0);
        assertEq(bytes4(attacker.lastRevert()), ReentrancyGuard.ReentrancyGuardReentrantCall.selector);
        assertEq(vault.claimable(NATIVE, address(attacker)), 0);
        assertEq(address(vault).balance, vault.totalLiabilities(NATIVE));
        assertEq(vault.totalLiabilities(NATIVE), 9 ether);
    }

    /// Re-entering a different fund-moving function (settle) during the payout is blocked too.
    function test_withdrawNative_crossFunctionReentryBlocked() public {
        uint256 evt = _attackerEvent();
        uint256 id = _create(_params(NATIVE), 10 ether);
        _approve(id, evt);
        _checkInNow(evt, attendeePk);
        _checkInNow(evt, 0xBEEF);
        vault.settle(id, evt, attendee);

        attacker.arm(address(vault), abi.encodeCall(CampaignVault.settle, (id, evt, vm.addr(0xBEEF))));
        attacker.exec(address(vault), abi.encodeCall(CampaignVault.withdraw, (NATIVE, address(attacker))));
        assertEq(attacker.reentrySuccesses(), 0);
        assertFalse(vault.isSettled(id, evt, vm.addr(0xBEEF)));
    }

    /// The attacker is the sponsor and re-enters refund from receive().
    function test_refundNative_reentryPaysOnce() public {
        ICampaignVault.CampaignParams memory p = _params(NATIVE);
        vm.deal(address(this), 5 ether);
        bytes memory ret =
            attacker.exec{value: 5 ether}(address(vault), abi.encodeCall(CampaignVault.createCampaign, (p, 5 ether)));
        uint256 id = abi.decode(ret, (uint256));
        // an honest campaign shares the vault, so a drain would be visible
        _create(_params(NATIVE), 20 ether);

        vm.warp(T0 + 7 days + 3 days + 1);
        attacker.arm(address(vault), abi.encodeCall(CampaignVault.refund, (id)));
        attacker.exec(address(vault), abi.encodeCall(CampaignVault.refund, (id)));

        assertEq(address(attacker).balance, 5 ether, "refunded exactly once");
        assertEq(attacker.reentrySuccesses(), 0);
        assertEq(bytes4(attacker.lastRevert()), ReentrancyGuard.ReentrancyGuardReentrantCall.selector);
        assertEq(address(vault).balance, 20 ether);
        assertEq(vault.totalLiabilities(NATIVE), 20 ether);
    }

    /// A receiver that reverts cannot lose funds: the withdrawal reverts and the claim stays intact.
    function test_withdrawNative_revertingReceiverKeepsClaim() public {
        uint256 evt = _createEvent(address(this), T0, T0 + EVENT_LENGTH, 0, 0);
        _authorize(address(this), evt, doorKey, T0 + EVENT_LENGTH);
        uint256 id = _create(_params(NATIVE), 10 ether);
        _approve(id, evt);
        _checkInNow(evt, attendeePk);
        vault.settle(id, evt, attendee);

        // this test contract has no receive(), so the native payment to it fails
        vm.expectRevert();
        vault.withdraw(NATIVE, address(this));
        assertEq(vault.claimable(NATIVE, address(this)), 0.5 ether);
    }

    function _attackerEvent() internal returns (uint256 evt) {
        bytes memory ret = attacker.exec(
            address(registry),
            abi.encodeCall(ShowmarkRegistry.createEvent, (T0, T0 + EVENT_LENGTH, 0, MAX_PASS_AGE, 0, META))
        );
        evt = abi.decode(ret, (uint256));
        attacker.exec(
            address(registry), abi.encodeCall(ShowmarkRegistry.authorizeDoorKey, (evt, doorKey, T0 + EVENT_LENGTH))
        );
    }
}
