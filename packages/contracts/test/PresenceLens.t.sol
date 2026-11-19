// SPDX-License-Identifier: MIT
pragma solidity 0.8.38;

import {PresenceLens} from "../src/PresenceLens.sol";
import {IPresence} from "../src/interfaces/IPresence.sol";
import {PresenceGatedMint} from "../src/examples/PresenceGatedMint.sol";
import {RegistryFixture} from "./utils/RegistryFixture.sol";

contract PresenceLensTest is RegistryFixture {
    PresenceLens internal lens;
    uint256 internal second;

    function setUp() public override {
        super.setUp();
        lens = new PresenceLens(address(registry));
        second = _createEvent(organizer, T0, T0 + EVENT_LENGTH, 0, 0);
        _authorize(organizer, second, doorKey, T0 + EVENT_LENGTH);
        _checkInNow(eventId, attendeePk);
    }

    function test_constructor() public {
        assertEq(address(lens.registry()), address(registry));
        vm.expectRevert(PresenceLens.ZeroRegistry.selector);
        new PresenceLens(address(0));
    }

    function test_hasAttended_resolvesWalletToPass() public {
        assertTrue(lens.hasAttended(eventId, attendee));
        assertFalse(lens.hasAttended(eventId, wallet));
        _link();
        assertTrue(lens.hasAttended(eventId, wallet));
        assertFalse(lens.hasAttended(second, wallet));
    }

    function test_attendedCount_countsListedIds() public {
        _checkInNow(second, attendeePk);
        _link();
        uint256[] memory ids = new uint256[](4);
        ids[0] = eventId;
        ids[1] = second;
        ids[2] = 999;
        ids[3] = eventId; // duplicates count, as documented
        assertEq(lens.attendedCount(wallet, ids), 3);
        assertEq(lens.attendedCount(attendee, ids), 3);
        assertEq(lens.attendedCount(makeAddr("stranger"), ids), 0);
        assertEq(lens.attendedCount(attendee, new uint256[](0)), 0);
    }

    function test_streakOf_resolvesWalletToPass() public {
        vm.startPrank(organizer);
        uint64 s = registry.createSeries("weekly");
        uint256 a = registry.createEvent(T0, T0 + EVENT_LENGTH, 0, MAX_PASS_AGE, s, META);
        uint256 b = registry.createEvent(T0, T0 + EVENT_LENGTH, 0, MAX_PASS_AGE, s, META);
        registry.authorizeDoorKey(a, doorKey, T0 + EVENT_LENGTH);
        registry.authorizeDoorKey(b, doorKey, T0 + EVENT_LENGTH);
        vm.stopPrank();
        _checkInNow(a, attendeePk);
        _checkInNow(b, attendeePk);

        (uint32 current, uint32 best) = lens.streakOf(s, attendee);
        assertEq(current, 2);
        assertEq(best, 2);
        (current, best) = lens.streakOf(s, wallet);
        assertEq(current, 0);
        _link();
        (current, best) = lens.streakOf(s, wallet);
        assertEq(current, 2);
        assertEq(best, 2);
    }

    function test_presenceKeyOf() public {
        address stranger = makeAddr("stranger");
        assertEq(lens.presenceKeyOf(stranger), stranger);
        assertEq(lens.presenceKeyOf(wallet), wallet);
        _link();
        assertEq(lens.presenceKeyOf(wallet), attendee);
        assertEq(lens.presenceKeyOf(attendee), attendee);
    }

    function test_supportsIPresenceAsInterface() public view {
        IPresence p = IPresence(address(lens));
        assertTrue(p.hasAttended(eventId, attendee));
    }

    // ---------------------------------------------------------------- PresenceGatedMint example

    function test_gatedMint_onePerPersonPerEvent() public {
        PresenceGatedMint mint = new PresenceGatedMint(IPresence(address(lens)), "Showmark souvenir", "SOUV");

        vm.expectEmit(address(mint));
        emit PresenceGatedMint.Claimed(eventId, attendee, attendee, 1);
        vm.prank(attendee);
        uint256 tokenId = mint.claim(eventId);
        assertEq(tokenId, 1);
        assertEq(mint.ownerOf(1), attendee);
        assertEq(mint.eventOf(1), eventId);
        assertTrue(mint.claimed(eventId, attendee));

        // the linked wallet is the same person: no second claim
        _link();
        vm.prank(wallet);
        vm.expectRevert(PresenceGatedMint.AlreadyClaimed.selector);
        mint.claim(eventId);
    }

    function test_gatedMint_requiresPresence() public {
        PresenceGatedMint mint = new PresenceGatedMint(IPresence(address(lens)), "Showmark souvenir", "SOUV");
        vm.prank(attendee);
        vm.expectRevert(PresenceGatedMint.NotAttended.selector);
        mint.claim(second);

        _checkInNow(second, attendeePk);
        _link();
        vm.prank(wallet);
        assertEq(mint.claim(second), 1);
        assertEq(mint.ownerOf(1), wallet);
    }

    function _link() internal {
        uint64 deadline = T0 + 1 hours;
        (bytes memory p, bytes memory w) = _linkSigs(attendeePk, walletPk, attendee, wallet, deadline);
        registry.linkWallet(attendee, wallet, deadline, p, w, new uint256[](0));
    }
}
