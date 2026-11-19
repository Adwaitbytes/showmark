// SPDX-License-Identifier: MIT
pragma solidity 0.8.38;

import {IShowmarkRegistry} from "../../src/interfaces/IShowmarkRegistry.sol";
import {ICampaignVault} from "../../src/interfaces/ICampaignVault.sol";
import {IOrganizerBond} from "../../src/interfaces/IOrganizerBond.sol";
import {ProtocolFixture} from "../utils/ProtocolFixture.sol";

/// @notice Second re-review of the N-01 and N-02 fixes (docs/AUDIT.md, "Second re-review"). N2-* tests pass while
/// the issue exists; T-* tests pin down attacks on the new code that fail.
contract SecondReReviewPoCTest is ProtocolFixture {
    address internal rogue = makeAddr("rogue");
    address internal sock = makeAddr("sock");
    uint256 internal constant ROGUE_DOOR = 0xD0D0;
    uint256 internal rogueEvent;

    function setUp() public override {
        super.setUp();
        vm.deal(rogue, 10 ether);
        vm.startPrank(rogue);
        bond.bond{value: 10 ether}();
        rogueEvent = registry.createEvent(T0, T0 + 1 hours, 0, 60, 0, META);
        registry.authorizeDoorKey(rogueEvent, vm.addr(ROGUE_DOOR), T0 + 1 hours);
        vm.stopPrank();
    }

    function _presence(uint256 pk) internal returns (address pass) {
        IShowmarkRegistry.CheckInData memory d = _mode2(rogueEvent, pk, ROGUE_DOOR, uint64(block.timestamp));
        _checkIn(d);
        return d.attendee;
    }

    function _openCampaign(uint256 deposit) internal returns (uint256 id) {
        ICampaignVault.CampaignParams memory p = _params(NATIVE);
        p.openToBonded = true;
        p.minBond = 1 ether;
        id = _create(p, deposit);
    }

    // ------------------------------------------------------------------ N2-01

    /// Locks are taken first come and never recomputed. A rogue organizer drains an honest open campaign, then has a
    /// sock-puppet sponsor (its own approved-event campaign, paying its own passes, so the money comes back) open the
    /// first challenge, which locks the whole stake. The honest sponsor's challenge then locks 0. When the Safe
    /// dismisses the sock challenge (the deposit goes back to the rogue as organizer), the stake is free, the rogue
    /// unbonds all of it, and the honest challenge can slash nothing.
    function test_N2_01_sockChallengeShieldsStakeFromHonestChallenge() public {
        uint256 honest = _openCampaign(20 ether);
        vm.prank(rogue);
        vault.optInOpenCampaign(honest);
        ICampaignVault.SettleItem[] memory items = new ICampaignVault.SettleItem[](10);
        for (uint256 i; i < 10; ++i) {
            items[i] = ICampaignVault.SettleItem(honest, rogueEvent, _presence(0x5B11 + i));
        }
        vault.settleBatch(items);
        assertEq(vault.bondedExposure(rogue), 10 ether, "drained up to the bond");
        vm.prank(rogue);
        bond.requestUnbond(10 ether);

        // sock-puppet campaign: approves the rogue's event and pays the rogue's own pass
        vm.deal(sock, 20 ether);
        vm.startPrank(sock);
        ICampaignVault.CampaignParams memory p = _params(NATIVE);
        p.amountPerPresence = 10 ether;
        uint256 sockCampaign = vault.createCampaign{value: 10 ether}(p, 10 ether);
        uint256[] memory ids = new uint256[](1);
        ids[0] = rogueEvent;
        vault.approveEvents(sockCampaign, ids);
        vault.settle(sockCampaign, rogueEvent, items[0].attendee);
        uint256 sockChallenge = bond.challenge{value: CHALLENGE_DEPOSIT}(rogue, sockCampaign, "");
        vm.stopPrank();
        assertEq(bond.lockedOf(rogue), 10 ether, "sock locks the whole stake");

        vm.prank(sponsor);
        uint256 honestChallenge = bond.challenge{value: CHALLENGE_DEPOSIT}(rogue, honest, "sybil event");
        assertEq(bond.challengeOf(honestChallenge).locked, 0, "honest challenge locks nothing");

        // the Safe dismisses the obviously frivolous sock challenge
        vm.prank(owner);
        bond.resolve(sockChallenge, 0, address(0));
        assertEq(bond.depositOwed(rogue), CHALLENGE_DEPOSIT, "deposit forfeited to the rogue");

        vm.warp(block.timestamp + 7 days);
        uint256 before = rogue.balance;
        vm.prank(rogue);
        bond.completeUnbond();
        assertEq(rogue.balance - before, 10 ether, "whole stake leaves while the honest challenge is open");

        vm.prank(owner);
        vm.expectRevert(IOrganizerBond.SlashExceedsLock.selector);
        bond.resolve(honestChallenge, 1, sponsor);
    }

    // ------------------------------------------------------------------ N2-02

    /// A token campaign locks the organizer's whole unlocked stake for one deposit. A 1-unit QUSDC campaign that
    /// settled a stranger's presence freezes any bond, whatever its size, until the Safe acts.
    function test_N2_02_oneUnitTokenCampaignFreezesWholeStake() public {
        address stranger = _presence(0x5A5A);
        vm.prank(rogue);
        bond.requestUnbond(10 ether);

        address griefer = makeAddr("griefer");
        qusdc.mint(griefer, 1);
        vm.deal(griefer, 1 ether);
        vm.startPrank(griefer);
        qusdc.approve(address(vault), 1);
        ICampaignVault.CampaignParams memory p = _params(address(qusdc));
        p.amountPerPresence = 1;
        uint256 cid = vault.createCampaign(p, 1);
        uint256[] memory ids = new uint256[](1);
        ids[0] = rogueEvent;
        vault.approveEvents(cid, ids);
        vault.settle(cid, rogueEvent, stranger);
        bond.challenge{value: CHALLENGE_DEPOSIT}(rogue, cid, "");
        vm.stopPrank();

        assertEq(bond.lockedOf(rogue), 10 ether);
        vm.warp(block.timestamp + 7 days);
        vm.prank(rogue);
        vm.expectRevert(IOrganizerBond.ChallengeOpen.selector);
        bond.completeUnbond();
    }

    // ------------------------------------------------------------------ T-*: attempted attacks that fail

    /// A stranger's open campaign cannot consume the organizer's exposure without the organizer's opt-in (N-01).
    function test_T01_noExposureWithoutOptIn() public {
        uint256 c = _openCampaign(10 ether);
        address pass = _presence(0x7101);
        vm.expectRevert(ICampaignVault.EventNotEligible.selector);
        vault.settle(c, rogueEvent, pass);
        assertEq(vault.bondedExposure(rogue), 0);
    }

    /// Exposure is released only after endsAt + SETTLE_GRACE and only while no challenge is open for the pair, and
    /// a second release finds nothing.
    function test_T02_releaseTimingAndChallengeBlock() public {
        uint256 c = _openCampaign(10 ether);
        vm.prank(rogue);
        vault.optInOpenCampaign(c);
        vault.settle(c, rogueEvent, _presence(0x7201));
        assertEq(vault.exposureOf(c, rogue), 1 ether);

        uint256 due = uint256(vault.campaign(c).endsAt) + vault.SETTLE_GRACE();
        vm.warp(due);
        vm.expectRevert(ICampaignVault.ReleaseNotAvailable.selector);
        vault.releaseExposure(c, rogue);

        vm.prank(sponsor);
        uint256 ch = bond.challenge{value: CHALLENGE_DEPOSIT}(rogue, c, "");
        vm.warp(due + 1);
        vm.expectRevert(ICampaignVault.ReleaseNotAvailable.selector);
        vault.releaseExposure(c, rogue);

        vm.prank(owner);
        bond.resolve(ch, 1 ether, sponsor);
        vault.releaseExposure(c, rogue);
        assertEq(vault.bondedExposure(rogue), 0);
        vm.expectRevert(ICampaignVault.NothingToRelease.selector);
        vault.releaseExposure(c, rogue);
    }

    /// Opting out stops new bonded payouts; exposure already taken stays until released.
    function test_T03_optOutStopsNewPayouts() public {
        uint256 c = _openCampaign(10 ether);
        vm.startPrank(rogue);
        vault.optInOpenCampaign(c);
        vault.optOutOpenCampaign(c);
        vm.stopPrank();
        address pass = _presence(0x7301);
        vm.expectRevert(ICampaignVault.EventNotEligible.selector);
        vault.settle(c, rogueEvent, pass);
    }

    /// Proportional locks: a native campaign that paid 1 wei locks 1 wei; partial unbond pays everything else, and
    /// bond holdings always equal bonded + pending + deposits held.
    function test_T04_proportionalLockAndAccounting() public {
        address pass = _presence(0x7401);
        vm.prank(rogue);
        bond.requestUnbond(10 ether);
        ICampaignVault.CampaignParams memory p = _params(NATIVE);
        p.amountPerPresence = 1;
        vm.startPrank(sponsor);
        uint256 cid = vault.createCampaign{value: 1}(p, 1);
        uint256[] memory ids = new uint256[](1);
        ids[0] = rogueEvent;
        vault.approveEvents(cid, ids);
        vault.settle(cid, rogueEvent, pass);
        uint256 ch = bond.challenge{value: CHALLENGE_DEPOSIT}(rogue, cid, "");
        vm.expectRevert(IOrganizerBond.BadChallengeDeposit.selector);
        bond.challenge{value: 1}(rogue, cid, "");
        vm.stopPrank();
        assertEq(bond.lockedOf(rogue), 1);

        vm.warp(block.timestamp + 7 days);
        uint256 before = rogue.balance;
        vm.prank(rogue);
        bond.completeUnbond();
        assertEq(rogue.balance - before, 10 ether - 1);
        (uint256 pendingLeft,) = bond.pendingUnbond(rogue);
        assertEq(pendingLeft, 1);
        assertEq(address(bond).balance, pendingLeft + CHALLENGE_DEPOSIT);

        vm.prank(owner);
        vm.expectRevert(IOrganizerBond.SlashExceedsLock.selector);
        bond.resolve(ch, 2, sponsor);
        vm.prank(owner);
        bond.resolve(ch, 1, sponsor);
        vm.prank(sponsor);
        bond.claimDeposit();
        assertEq(address(bond).balance, 0, "nothing stranded");
    }
}
