// SPDX-License-Identifier: MIT
pragma solidity 0.8.38;

import {IShowmarkRegistry} from "../../src/interfaces/IShowmarkRegistry.sol";
import {ICampaignVault} from "../../src/interfaces/ICampaignVault.sol";
import {IOrganizerBond} from "../../src/interfaces/IOrganizerBond.sol";
import {ProtocolFixture} from "../utils/ProtocolFixture.sol";

/// @notice Second re-review of the N-01 and N-02 fixes (docs/AUDIT.md, "Second re-review"). The N2-* tests began as
/// proofs of concept and now assert each attack fails under claim-based locks; T-* tests pin down attacks on the new
/// code that fail.
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

    // ------------------------------------------------------------------ N2-01 (fixed: claims, not first-come locks)

    function _drain(uint256 campaignId, uint256 n, uint256 seed) internal {
        ICampaignVault.SettleItem[] memory items = new ICampaignVault.SettleItem[](n);
        for (uint256 i; i < n; ++i) {
            items[i] = ICampaignVault.SettleItem(campaignId, rogueEvent, _presence(seed + i));
        }
        vault.settleBatch(items);
    }

    /// The sock-puppet's approved-event campaign never drew on the bond, so it has no claim and cannot challenge.
    /// The honest sponsor's claim covers what the bond backed, and the rogue cannot unbond it.
    function test_N2_01_sockChallengeWithoutBondClaimIsRefused() public {
        uint256 honest = _openCampaign(20 ether);
        vm.prank(rogue);
        vault.optInOpenCampaign(honest);
        _drain(honest, 10, 0x5B11);
        assertEq(vault.bondedExposure(rogue), 10 ether, "drained up to the bond");
        vm.prank(rogue);
        bond.requestUnbond(10 ether);

        address roguePass = _presence(0x5C00);
        vm.deal(sock, 20 ether);
        vm.startPrank(sock);
        ICampaignVault.CampaignParams memory p = _params(NATIVE);
        p.amountPerPresence = 10 ether;
        uint256 sockCampaign = vault.createCampaign{value: 10 ether}(p, 10 ether);
        uint256[] memory ids = new uint256[](1);
        ids[0] = rogueEvent;
        vault.approveEvents(sockCampaign, ids);
        vault.settle(sockCampaign, rogueEvent, roguePass);
        vm.expectRevert(IOrganizerBond.NoBondClaim.selector);
        bond.challenge{value: CHALLENGE_DEPOSIT}(rogue, sockCampaign, "");
        vm.stopPrank();

        vm.prank(sponsor);
        uint256 honestChallenge = bond.challenge{value: CHALLENGE_DEPOSIT}(rogue, honest, "sybil event");
        assertEq(bond.challengeOf(honestChallenge).claim, 10 ether);
        assertEq(bond.lockedOf(rogue), 10 ether);

        vm.warp(block.timestamp + 7 days);
        vm.prank(rogue);
        vm.expectRevert(IOrganizerBond.ChallengeOpen.selector);
        bond.completeUnbond();

        vm.prank(owner);
        bond.resolve(honestChallenge, 10 ether, sponsor);
        assertEq(bond.depositOwed(sponsor), CHALLENGE_DEPOSIT);
    }

    /// Even a sock campaign the rogue opted into, filed first and dismissed first, frees only its own claim: the
    /// honest claim keeps its share of the stake and is slashed in full.
    function test_N2_01_dismissingAFirstSockClaimNeverFreesTheHonestShare() public {
        ICampaignVault.CampaignParams memory p = _params(NATIVE);
        p.openToBonded = true;
        p.minBond = 1 ether;
        vm.deal(sock, 20 ether);
        vm.prank(sock);
        uint256 sockCampaign = vault.createCampaign{value: 10 ether}(p, 10 ether);
        uint256 honest = _openCampaign(20 ether);
        vm.startPrank(rogue);
        vault.optInOpenCampaign(sockCampaign);
        vault.optInOpenCampaign(honest);
        vm.stopPrank();
        _drain(sockCampaign, 4, 0x5D00);
        _drain(honest, 6, 0x5E00);
        vm.prank(rogue);
        bond.requestUnbond(10 ether);

        vm.prank(sock);
        uint256 sockChallenge = bond.challenge{value: CHALLENGE_DEPOSIT}(rogue, sockCampaign, "");
        vm.prank(sponsor);
        uint256 honestChallenge = bond.challenge{value: CHALLENGE_DEPOSIT}(rogue, honest, "sybil event");
        assertEq(bond.claimedOf(rogue), 10 ether);

        vm.prank(owner);
        bond.resolve(sockChallenge, 0, address(0));
        assertEq(bond.lockedOf(rogue), 6 ether, "the honest claim still holds its share");

        vm.warp(block.timestamp + 7 days);
        uint256 before = rogue.balance;
        vm.prank(rogue);
        bond.completeUnbond();
        assertEq(rogue.balance - before, 4 ether, "only stake beyond the open claims leaves");

        uint256 sponsorBefore = sponsor.balance;
        vm.prank(owner);
        bond.resolve(honestChallenge, 6 ether, sponsor);
        assertEq(sponsor.balance - sponsorBefore, 6 ether, "honest claim slashed in full");
    }

    // ------------------------------------------------------------------ N2-02 (fixed: token campaigns have no claim)

    function test_N2_02_tokenCampaignHasNoBondClaim() public {
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
        vm.expectRevert(IOrganizerBond.NoBondClaim.selector);
        bond.challenge{value: CHALLENGE_DEPOSIT}(rogue, cid, "");
        vm.stopPrank();

        assertEq(bond.lockedOf(rogue), 0);
        vm.warp(block.timestamp + 7 days);
        uint256 before = rogue.balance;
        vm.prank(rogue);
        bond.completeUnbond();
        assertEq(rogue.balance - before, 10 ether, "the whole stake leaves");
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

    /// Proportional claims: an opted-in open campaign that paid 1 wei through the bond claims 1 wei; the unbond pays
    /// everything else, and bond holdings always equal bonded + pending + deposits held.
    function test_T04_proportionalClaimAndAccounting() public {
        ICampaignVault.CampaignParams memory p = _params(NATIVE);
        p.openToBonded = true;
        p.minBond = 1;
        p.amountPerPresence = 1;
        uint256 cid = _create(p, 1);
        vm.prank(rogue);
        vault.optInOpenCampaign(cid);
        vault.settle(cid, rogueEvent, _presence(0x7401));
        vm.prank(rogue);
        bond.requestUnbond(10 ether);

        vm.startPrank(sponsor);
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
        vm.expectRevert(IOrganizerBond.SlashExceedsClaim.selector);
        bond.resolve(ch, 2, sponsor);
        vm.prank(owner);
        bond.resolve(ch, 1, sponsor);
        vm.prank(sponsor);
        bond.claimDeposit();
        assertEq(address(bond).balance, 0, "nothing stranded");
    }
}
