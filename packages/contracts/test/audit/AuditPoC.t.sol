// SPDX-License-Identifier: MIT
pragma solidity 0.8.38;

import {ShowmarkRegistry} from "../../src/ShowmarkRegistry.sol";
import {CampaignVault} from "../../src/CampaignVault.sol";
import {IShowmarkRegistry} from "../../src/interfaces/IShowmarkRegistry.sol";
import {ICampaignVault} from "../../src/interfaces/ICampaignVault.sol";
import {IOrganizerBond} from "../../src/interfaces/IOrganizerBond.sol";
import {Ownable2StepNoRenounce} from "../../src/utils/Ownable2StepNoRenounce.sol";
import {ProtocolFixture} from "../utils/ProtocolFixture.sol";
import {SigUtils} from "../utils/SigUtils.sol";

/// @notice Oracle that answers decimals() correctly but returns a single word from latestRoundData, as a
/// misconfigured or upgraded feed proxy could.
contract ShortAnswerAggregator {
    function decimals() external pure returns (uint8) {
        return 8;
    }

    fallback() external {
        assembly {
            mstore(0, 1)
            return(0, 0x20)
        }
    }
}

/// @notice Regression tests for the findings in docs/AUDIT.md. Each started as a proof of concept that passed while
/// the issue was present; each now asserts that the attack fails. L-01 and L-04 are accepted, documented behaviour
/// and are kept as tests of that behaviour.
contract AuditPoCTest is ProtocolFixture {
    uint256 internal constant HONEST_PK = 0x4F4E35;

    /// @dev What anyone can read back from a mined `checkIn` transaction.
    function harvest(bytes calldata txInput) external pure returns (IShowmarkRegistry.CheckInData memory) {
        return abi.decode(txInput[4:], (IShowmarkRegistry.CheckInData));
    }

    function _honestMode1CheckIn(uint256 id) internal returns (IShowmarkRegistry.CheckInData memory) {
        IShowmarkRegistry.CheckInData memory d = _mode1(id, HONEST_PK, doorPk, uint64(block.timestamp));
        _checkIn(d);
        return this.harvest(abi.encodeCall(ShowmarkRegistry.checkIn, (d)));
    }

    /// @dev Everything the remote attacker can build: the harvested door pass and ticket fields, plus its own
    /// attendee signature. It never learns the ticket private key, which only exists inside the door QR.
    function _sybil(uint256 pk, IShowmarkRegistry.CheckInData memory seen, bool forgeTicketSig)
        internal
        view
        returns (IShowmarkRegistry.CheckInData memory d)
    {
        d = seen;
        d.attendee = vm.addr(pk);
        d.attendeeSig = SigUtils.sign(pk, SigUtils.checkInDigest(separator, seen.eventId, d.attendee, 1));
        if (forgeTicketSig) {
            d.ticketSig = SigUtils.sign(pk, SigUtils.ticketDigest(separator, seen.eventId, d.attendee));
        }
    }

    // ------------------------------------------------------------------ C-01 (fixed: ticket keys)

    function test_C01_harvestedDoorPassNoLongerAdmitsRemoteSybils() public {
        uint256 campaignId = _createApproved(_params(NATIVE), 21 ether);
        vm.warp(T0 + 10);
        IShowmarkRegistry.CheckInData memory seen = _honestMode1CheckIn(eventId);

        vm.warp(T0 + 10 + MAX_PASS_AGE); // still inside maxPassAge of the harvested pass
        uint256 n = 20;
        IShowmarkRegistry.CheckInData[] memory ds = new IShowmarkRegistry.CheckInData[](n);
        ICampaignVault.SettleItem[] memory items = new ICampaignVault.SettleItem[](n);
        for (uint256 i; i < n; ++i) {
            // half reuse the honest ticket signature, half sign it with a key they own
            ds[i] = _sybil(0xBAD000 + i, seen, i % 2 == 1);
            items[i] = ICampaignVault.SettleItem(campaignId, eventId, ds[i].attendee);
        }
        vm.prank(makeAddr("remoteAttacker"));
        uint8[] memory status = registry.checkInBatch(ds);
        for (uint256 i; i < n; ++i) {
            assertEq(status[i], 11, "BadTicketSig");
            assertEq(registry.presenceOf(eventId, ds[i].attendee).mode, 0);
        }
        uint8[] memory paid = vault.settleBatch(items);
        for (uint256 i; i < n; ++i) {
            assertEq(paid[i], 3, "NotPresent");
        }
        assertEq(vault.campaign(campaignId).balance, 21 ether, "nothing drained");
        assertEq(registry.eventInfo(eventId).checkedIn, 1, "only the honest attendee");
    }

    function test_C01_harvestedDoorPassCannotFillCapacity() public {
        uint256 small = _createEvent(organizer, T0, T0 + EVENT_LENGTH, 5, 0);
        _authorize(organizer, small, doorKey, T0 + EVENT_LENGTH);
        vm.warp(T0 + 10);
        IShowmarkRegistry.CheckInData memory seen = _honestMode1CheckIn(small);
        for (uint256 i; i < 4; ++i) {
            vm.expectRevert(IShowmarkRegistry.BadTicketSig.selector);
            _checkIn(_sybil(0xBAD100 + i, seen, false));
        }
        vm.warp(T0 + 20);
        assertTrue(_checkIn(_mode1(small, 0x600D, doorPk, uint64(block.timestamp))), "real attendee gets in");
        assertEq(registry.eventInfo(small).checkedIn, 2);
    }

    // ------------------------------------------------------------------ M-01 (fixed: mode bound in CheckIn)

    function test_M01_modeDowngradeIsRejected() public {
        ICampaignVault.CampaignParams memory p = _params(NATIVE);
        p.minProofMode = 2;
        uint256 campaignId = _createApproved(p, 5 ether);

        vm.warp(T0 + 10);
        IShowmarkRegistry.CheckInData memory seen = _honestMode1CheckIn(eventId);

        // the victim's real mode 2 check-in, as the door would submit it
        IShowmarkRegistry.CheckInData memory real = _mode2(eventId, attendeePk, doorPk, uint64(block.timestamp));

        // the griefer reuses the victim's public mode 2 attendee signature in a mode 1 check-in
        IShowmarkRegistry.CheckInData memory downgrade = seen;
        downgrade.attendee = attendee;
        downgrade.attendeeSig = real.attendeeSig;
        vm.prank(makeAddr("griefer"));
        vm.expectRevert(IShowmarkRegistry.BadAttendeeSig.selector);
        registry.checkIn(downgrade);

        assertTrue(_checkIn(real));
        assertEq(registry.presenceOf(eventId, attendee).mode, 2);
        assertEq(vault.settle(campaignId, eventId, attendee), 1 ether);
    }

    // ------------------------------------------------------------------ M-02 (fixed: bonded exposure cap)

    function test_M02_oneBondBacksAtMostItsOwnValueAcrossOpenCampaigns() public {
        ICampaignVault.CampaignParams memory p = _params(NATIVE);
        p.openToBonded = true;
        p.minBond = 1 ether;
        p.amountPerPresence = 0.25 ether;
        uint256 a = _create(p, 10 ether);
        uint256 b = _create(p, 10 ether);

        address rogue = makeAddr("rogue");
        uint256 rogueDoorPk = 0xD0D0;
        vm.deal(rogue, 1 ether);
        vm.startPrank(rogue);
        bond.bond{value: 1 ether}();
        vault.optInOpenCampaign(a);
        vault.optInOpenCampaign(b);
        uint256 ev = registry.createEvent(T0, T0 + 1 hours, 0, 60, 0, META);
        registry.authorizeDoorKey(ev, vm.addr(rogueDoorPk), T0 + 1 hours);
        vm.stopPrank();

        ICampaignVault.SettleItem[] memory items = new ICampaignVault.SettleItem[](20);
        for (uint256 i; i < 10; ++i) {
            IShowmarkRegistry.CheckInData memory d = _mode2(ev, 0x5B11 + i, rogueDoorPk, uint64(block.timestamp));
            _checkIn(d);
            items[2 * i] = ICampaignVault.SettleItem(a, ev, d.attendee);
            items[2 * i + 1] = ICampaignVault.SettleItem(b, ev, d.attendee);
        }
        uint8[] memory s = vault.settleBatch(items);
        uint256 settled;
        for (uint256 i; i < s.length; ++i) {
            if (s[i] == 0) ++settled;
            else assertEq(s[i], 5, "EventNotEligible once the bond is used up");
        }
        assertEq(settled, 4, "4 x 0.25 QIE = the 1 QIE bond");
        uint256 drained = 20 ether - vault.campaign(a).balance - vault.campaign(b).balance;
        assertEq(drained, 1 ether);
        assertEq(vault.bondedExposure(rogue), 1 ether);

        // and the whole amount stays slashable
        vm.prank(rogue);
        bond.requestUnbond(1 ether);
        vm.prank(sponsor);
        uint256 cid = bond.challenge{value: CHALLENGE_DEPOSIT}(rogue, a, "sybil event");
        // a's own payouts are what the challenge locks; b's sponsor would challenge for b's share
        uint256 lockedForA = bond.challengeOf(cid).locked;
        assertEq(lockedForA, vault.paidForOrganizer(a, rogue));
        vm.prank(sponsor);
        uint256 cid2 = bond.challenge{value: CHALLENGE_DEPOSIT}(rogue, b, "sybil event");
        assertEq(lockedForA + bond.challengeOf(cid2).locked, drained, "the whole drained amount is locked");
        vm.startPrank(owner);
        bond.resolve(cid, lockedForA, sponsor);
        bond.resolve(cid2, drained - lockedForA, sponsor);
        vm.stopPrank();
        assertEq(sponsor.balance, 1_000_000 ether - 20 ether + drained - 2 * CHALLENGE_DEPOSIT);
        assertEq(bond.depositOwed(sponsor), 2 * CHALLENGE_DEPOSIT, "deposits come back after a slash");
    }

    // ------------------------------------------------------------------ L-01 (accepted, documented)

    /// Validity bounds the signed attestation time, not the submission time, so the offline queue keeps working.
    /// The README tells organizers to revoke a key when a shift ends rather than wait for validUntil.
    function test_L01_documented_doorKeyValidityBoundsAttestationTime() public {
        uint256 volunteerPk = 0x7011;
        uint64 shiftEnd = T0 + 1 hours;
        _authorize(organizer, eventId, vm.addr(volunteerPk), shiftEnd);

        vm.warp(T0 + EVENT_LENGTH + 2 days);
        assertTrue(_checkIn(_mode2(eventId, 0xF00D, volunteerPk, shiftEnd)));

        // revoking the key is what stops it
        vm.prank(organizer);
        registry.revokeDoorKey(eventId, vm.addr(volunteerPk));
        vm.expectRevert(IShowmarkRegistry.DoorKeyNotAuthorized.selector);
        _checkIn(_mode2(eventId, 0xF00E, volunteerPk, shiftEnd));
    }

    // ------------------------------------------------------------------ L-02 (fixed: low-level oracle read)

    function test_L02_malformedOracleAnswerDefersInsteadOfRevertingTheBatch() public {
        ShortAnswerAggregator bad = new ShortAnswerAggregator();
        CampaignVault v = new CampaignVault(
            address(registry), address(qieIdCheck), address(bad), address(bond), MAX_ORACLE_AGE, owner, feeRecipient, 0
        );
        vm.startPrank(sponsor);
        uint256 tokenPriced = v.createCampaign{value: 5 ether}(_params(NATIVE), 5 ether);
        uint256 usdPriced = v.createCampaign{value: 50 ether}(_usdParams(1e6), 50 ether);
        uint256[] memory ids = new uint256[](1);
        ids[0] = eventId;
        v.approveEvents(tokenPriced, ids);
        v.approveEvents(usdPriced, ids);
        vm.stopPrank();
        _checkInNow(eventId, attendeePk);

        ICampaignVault.SettleItem[] memory items = new ICampaignVault.SettleItem[](2);
        items[0] = ICampaignVault.SettleItem(tokenPriced, eventId, attendee);
        items[1] = ICampaignVault.SettleItem(usdPriced, eventId, attendee);
        uint8[] memory s = v.settleBatch(items);
        assertEq(s[0], 0, "token-priced item settles");
        assertEq(s[1], 9, "USD item defers as PriceStale");
        (uint256 amount, bool fresh) = v.quote(usdPriced);
        assertEq(amount, 0);
        assertFalse(fresh);
    }

    // ------------------------------------------------------------------ L-03 (fixed: relevant, one per pair)

    function test_L03_challengeSpamIsRefused() public {
        vm.deal(organizer, 1 ether);
        vm.startPrank(organizer);
        bond.bond{value: 1 ether}();
        bond.requestUnbond(1 ether);
        vm.stopPrank();

        // a zero-deposit campaign that never paid this organizer cannot challenge it
        address griefer = makeAddr("griefer");
        vm.startPrank(griefer);
        uint256 cid = vault.createCampaign(_params(NATIVE), 0);
        vm.deal(griefer, CHALLENGE_DEPOSIT);
        vm.expectRevert(IOrganizerBond.OrganizerNotPaid.selector);
        bond.challenge{value: CHALLENGE_DEPOSIT}(organizer, cid, "");
        vm.stopPrank();

        // a sponsor that did pay may open exactly one
        uint256 paidCampaign = _createApproved(_params(NATIVE), 1 ether);
        _checkInNow(eventId, attendeePk);
        vault.settle(paidCampaign, eventId, attendee);
        vm.startPrank(sponsor);
        uint256 challengeId = bond.challenge{value: CHALLENGE_DEPOSIT}(organizer, paidCampaign, "first");
        vm.expectRevert(IOrganizerBond.DuplicateChallenge.selector);
        bond.challenge{value: CHALLENGE_DEPOSIT}(organizer, paidCampaign, "spam");
        vm.stopPrank();
        assertEq(bond.openChallenges(organizer), 1);

        vm.prank(owner);
        bond.resolve(challengeId, 0, address(0));
        vm.warp(block.timestamp + 7 days);
        vm.prank(organizer);
        bond.completeUnbond();
    }

    // ------------------------------------------------------------------ L-04 (accepted, documented)

    /// Settlement deadlines keep running while paused. The README tells the Safe to unpause before
    /// endsAt + SETTLE_GRACE of any live campaign, or earned but unsettled presences are refunded to the sponsor.
    function test_L04_documented_pauseThroughGraceVoidsUnsettledPayouts() public {
        uint256 campaignId = _createApproved(_params(NATIVE), 3 ether);
        _checkInNow(eventId, attendeePk);
        vm.prank(owner);
        vault.pause();

        vm.warp(uint256(vault.campaign(campaignId).endsAt) + vault.SETTLE_GRACE() + 1);
        vm.prank(owner);
        vault.unpause();
        vm.expectRevert(ICampaignVault.SettlementClosed.selector);
        vault.settle(campaignId, eventId, attendee);

        vm.prank(sponsor);
        vault.refund(campaignId);
        assertEq(vault.campaign(campaignId).balance, 0);
    }

    // ------------------------------------------------------------------ L-05 (fixed: mode 2 dated by attestation)

    function test_L05_offlineQueuedAttestationIsPaidByAttendanceTime() public {
        ICampaignVault.CampaignParams memory p = _params(NATIVE);
        p.minProofMode = 2;
        p.endsAt = T0 + EVENT_LENGTH; // campaign covers exactly the event
        uint256 campaignId = _createApproved(p, 5 ether);

        uint64 attestedAt = T0 + 30 minutes;
        IShowmarkRegistry.CheckInData memory d = _mode2(eventId, attendeePk, doorPk, attestedAt);

        vm.warp(T0 + EVENT_LENGTH + 2 hours); // door was offline; queue flushes after the event
        assertTrue(_checkIn(d));
        assertEq(registry.presenceOf(eventId, attendee).at, attestedAt);
        assertEq(vault.settle(campaignId, eventId, attendee), 1 ether);
    }

    // ------------------------------------------------------------------ L-06 (fixed: renounce disabled)

    function test_L06_renounceOwnershipIsDisabledEverywhere() public {
        vm.startPrank(owner);
        vm.expectRevert(Ownable2StepNoRenounce.RenounceDisabled.selector);
        bond.renounceOwnership();
        vm.expectRevert(Ownable2StepNoRenounce.RenounceDisabled.selector);
        vault.renounceOwnership();
        vm.expectRevert(Ownable2StepNoRenounce.RenounceDisabled.selector);
        registry.renounceOwnership();
        vm.expectRevert(Ownable2StepNoRenounce.RenounceDisabled.selector);
        stamp.renounceOwnership();
        vm.stopPrank();
        assertEq(bond.owner(), owner);
    }
}
