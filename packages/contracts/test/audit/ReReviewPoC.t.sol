// SPDX-License-Identifier: MIT
pragma solidity 0.8.38;

import {IShowmarkRegistry} from "../../src/interfaces/IShowmarkRegistry.sol";
import {ICampaignVault} from "../../src/interfaces/ICampaignVault.sol";
import {IOrganizerBond} from "../../src/interfaces/IOrganizerBond.sol";
import {ProtocolFixture} from "../utils/ProtocolFixture.sol";
import {SigUtils} from "../utils/SigUtils.sol";

/// @notice Re-review of the audit fixes (docs/AUDIT.md, "Re-review"). The N-* tests began as proofs of concept and
/// now assert each attack fails; S-* tests pin down attacks on the ticket design that were tried and fail.
contract ReReviewPoCTest is ProtocolFixture {
    uint256 internal constant SECP256K1_N = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141;

    function _openParams(uint128 amount, uint16 attendeeShare)
        internal
        pure
        returns (ICampaignVault.CampaignParams memory p)
    {
        p = _params(NATIVE);
        p.openToBonded = true;
        p.minBond = 1;
        p.amountPerPresence = amount;
        p.attendeeShareBps = attendeeShare;
    }

    // ------------------------------------------------------------------ N-01 (fixed: organizer opt-in, release)

    /// A griefer's own open campaign can no longer consume the organizer's bonded exposure: the organizer never
    /// accepted it, so the self-settlement is refused and honest open campaigns keep their room.
    function test_N01_strangerOpenCampaignCannotBurnExposure() public {
        _bondOrganizer(10 ether);
        uint256 honest = _create(_openParams(1 ether, 5000), 20 ether);
        _optIn(honest);

        _checkInNow(eventId, attendeePk);
        vm.deal(attendee, attendee.balance + 10 ether);
        vm.startPrank(attendee);
        uint256 grief = vault.createCampaign{value: 10 ether}(_openParams(10 ether, 10_000), 10 ether);
        vm.expectRevert(ICampaignVault.EventNotEligible.selector);
        vault.settle(grief, eventId, attendee);
        vm.stopPrank();
        assertEq(vault.bondedExposure(organizer), 0, "nothing consumed");

        _checkInNow(eventId, 0xC0FFEE);
        assertEq(vault.settle(honest, eventId, vm.addr(0xC0FFEE)), 1 ether);
    }

    /// Exposure is released once a campaign can no longer pay, so an honest organizer's open-campaign revenue is
    /// no longer capped at its bond for life.
    function test_N01_exposureReleasesAfterTheCampaignEnds() public {
        _bondOrganizer(2 ether);
        uint256 c = _create(_openParams(1 ether, 5000), 10 ether);
        _optIn(c);
        _checkInNow(eventId, 0xA1);
        _checkInNow(eventId, 0xA2);
        vault.settle(c, eventId, vm.addr(0xA1));
        vault.settle(c, eventId, vm.addr(0xA2));
        assertEq(vault.bondedExposure(organizer), 2 ether);

        vm.warp(block.timestamp + 365 days);
        vault.releaseExposure(c, organizer);
        assertEq(vault.bondedExposure(organizer), 0);

        ICampaignVault.CampaignParams memory fresh = _openParams(1 ether, 5000);
        fresh.startsAt = uint64(block.timestamp - 1);
        fresh.endsAt = uint64(block.timestamp + 7 days);
        uint256 later = _create(fresh, 10 ether);
        _optIn(later);
        uint256 ev2 = _createEvent(organizer, uint64(block.timestamp), uint64(block.timestamp + 1 hours), 0, 0);
        _authorize(organizer, ev2, doorKey, uint64(block.timestamp + 1 hours));
        _checkInNow(ev2, 0xA4);
        assertEq(vault.settle(later, ev2, vm.addr(0xA4)), 1 ether);
    }

    // ------------------------------------------------------------------ N-02 (fixed: proportional lock, deposit)

    /// One-wei campaigns can still challenge, but each locks one wei, costs a deposit, and the organizer collects
    /// every deposit when the Safe dismisses them. The unbond is no longer frozen.
    function test_N02_oneWeiChallengesLockDustAndPayTheOrganizer() public {
        _bondOrganizer(1 ether);
        vm.prank(organizer);
        bond.requestUnbond(1 ether);
        _checkInNow(eventId, attendeePk);

        address griefer = makeAddr("griefer");
        vm.deal(griefer, 1 ether + 10 * CHALLENGE_DEPOSIT);
        ICampaignVault.CampaignParams memory p = _params(NATIVE);
        p.amountPerPresence = 1;
        uint256[] memory ids = new uint256[](1);
        ids[0] = eventId;
        uint256[] memory challenges = new uint256[](10);
        for (uint256 i; i < 10; ++i) {
            vm.startPrank(griefer);
            uint256 cid = vault.createCampaign{value: 1}(p, 1);
            vault.approveEvents(cid, ids);
            vault.settle(cid, eventId, attendee);
            challenges[i] = bond.challenge{value: CHALLENGE_DEPOSIT}(organizer, cid, "");
            vm.stopPrank();
        }
        assertEq(bond.openChallenges(organizer), 10);
        assertEq(bond.lockedOf(organizer), 10, "ten wei locked in total");

        vm.warp(block.timestamp + 7 days);
        uint256 before = organizer.balance;
        vm.prank(organizer);
        bond.completeUnbond();
        assertEq(organizer.balance - before, 1 ether - 10, "the organizer exits with everything but the dust");

        vm.startPrank(owner);
        for (uint256 i; i < 10; ++i) {
            bond.resolve(challenges[i], 0, address(0));
        }
        vm.stopPrank();
        assertEq(bond.depositOwed(organizer), 10 * CHALLENGE_DEPOSIT, "the griefer paid the organizer");
    }

    // ------------------------------------------------------------------ S-*: attacks on the ticket design that fail

    function _harvest() internal returns (IShowmarkRegistry.CheckInData memory seen) {
        seen = _mode1(eventId, 0x4F4E35, doorPk, uint64(block.timestamp));
        _checkIn(seen);
    }

    /// Swapping in an attacker-owned ticket key breaks the door signature (it commits to the ticket address).
    function test_S01_attackerTicketKeyBreaksDoorPass() public {
        IShowmarkRegistry.CheckInData memory d = _harvest();
        uint256 mine = 0xBEEF;
        d.attendee = vm.addr(0x5151);
        d.attendeeSig = SigUtils.sign(0x5151, SigUtils.checkInDigest(separator, eventId, d.attendee, 1));
        d.ticket = vm.addr(mine);
        d.ticketSig = SigUtils.sign(mine, SigUtils.ticketDigest(separator, eventId, d.attendee));
        vm.expectRevert(IShowmarkRegistry.DoorKeyNotAuthorized.selector);
        _checkIn(d);
    }

    /// A ticket signature does not carry over to another event, even one using the same door key and rotation.
    function test_S02_ticketSigBoundToEvent() public {
        uint256 other = _createEvent(organizer, T0, T0 + EVENT_LENGTH, 0, 0);
        _authorize(organizer, other, doorKey, T0 + EVENT_LENGTH);
        IShowmarkRegistry.CheckInData memory a = _mode1(eventId, attendeePk, doorPk, uint64(block.timestamp));
        IShowmarkRegistry.CheckInData memory b = _mode1(other, attendeePk, doorPk, uint64(block.timestamp));
        b.ticketSig = a.ticketSig;
        vm.expectRevert(IShowmarkRegistry.BadTicketSig.selector);
        _checkIn(b);
    }

    /// High-s (malleated) ticket signatures are rejected.
    function test_S03_malleatedTicketSigRejected() public {
        IShowmarkRegistry.CheckInData memory d = _mode1(eventId, attendeePk, doorPk, uint64(block.timestamp));
        bytes memory sig = d.ticketSig;
        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly {
            r := mload(add(sig, 0x20))
            s := mload(add(sig, 0x40))
            v := byte(0, mload(add(sig, 0x60)))
        }
        d.ticketSig = abi.encodePacked(r, bytes32(SECP256K1_N - uint256(s)), v == 27 ? uint8(28) : uint8(27));
        vm.expectRevert(IShowmarkRegistry.BadTicketSig.selector);
        _checkIn(d);
    }

    /// Mode 1 without a ticket, and mode 2 carrying ticket fields, are both rejected.
    function test_S04_ticketFieldsMustMatchMode() public {
        IShowmarkRegistry.CheckInData memory m1 = _mode1(eventId, attendeePk, doorPk, uint64(block.timestamp));
        m1.ticket = address(0);
        m1.ticketSig = "";
        m1.doorSig = SigUtils.sign(doorPk, SigUtils.doorPassDigest(separator, eventId, m1.doorTime, address(0)));
        vm.expectRevert(IShowmarkRegistry.BadTicketSig.selector);
        _checkIn(m1);

        IShowmarkRegistry.CheckInData memory m2 = _mode2(eventId, attendeePk, doorPk, uint64(block.timestamp));
        m2.ticketSig = hex"00";
        vm.expectRevert(IShowmarkRegistry.BadTicketSig.selector);
        _checkIn(m2);
        m2.ticketSig = "";
        m2.ticket = address(1);
        vm.expectRevert(IShowmarkRegistry.BadTicketSig.selector);
        _checkIn(m2);
    }

    /// A mode 1 attendee signature cannot be used in mode 2 and vice versa.
    function test_S05_attendeeSigBoundToMode() public {
        IShowmarkRegistry.CheckInData memory m1 = _mode1(eventId, attendeePk, doorPk, uint64(block.timestamp));
        IShowmarkRegistry.CheckInData memory m2 = _mode2(eventId, attendeePk, doorPk, uint64(block.timestamp));
        bytes memory sig1 = m1.attendeeSig;
        m1.attendeeSig = m2.attendeeSig;
        vm.expectRevert(IShowmarkRegistry.BadAttendeeSig.selector);
        _checkIn(m1);
        m2.attendeeSig = sig1;
        vm.expectRevert(IShowmarkRegistry.BadAttendeeSig.selector);
        _checkIn(m2);
    }

    /// A feed with no code, or one that burns all gas, defers USD items without reverting the batch.
    function test_S06_oracleWithoutCodeOrGasBombDefers() public {
        vm.etch(address(oracle), hex"5b600056"); // JUMPDEST PUSH1 0 JUMP: infinite loop
        uint256 usd = _createApproved(_usdParams(1e6), 50 ether);
        uint256 tok = _createApproved(_params(NATIVE), 5 ether);
        _checkInNow(eventId, attendeePk);
        ICampaignVault.SettleItem[] memory items = new ICampaignVault.SettleItem[](2);
        items[0] = ICampaignVault.SettleItem(usd, eventId, attendee);
        items[1] = ICampaignVault.SettleItem(tok, eventId, attendee);
        uint8[] memory s = vault.settleBatch(items);
        assertEq(s[0], 9);
        assertEq(s[1], 0);
        vm.etch(address(oracle), "");
        (, bool fresh) = vault.quote(usd);
        assertFalse(fresh);
    }
}
