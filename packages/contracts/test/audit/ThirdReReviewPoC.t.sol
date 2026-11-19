// SPDX-License-Identifier: MIT
pragma solidity 0.8.38;

import {IShowmarkRegistry} from "../../src/interfaces/IShowmarkRegistry.sol";
import {ICampaignVault} from "../../src/interfaces/ICampaignVault.sol";
import {IOrganizerBond} from "../../src/interfaces/IOrganizerBond.sol";
import {ProtocolFixture} from "../utils/ProtocolFixture.sol";

/// @notice Third re-review of the claim-based bond (docs/AUDIT.md, "Third re-review"). The N3-* tests began as
/// proofs of concept and now assert each issue is fixed; U-* tests pin down attacks that fail.
contract ThirdReReviewPoCTest is ProtocolFixture {
    address internal rogue = makeAddr("rogue");
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

    function _presence(uint256 pk) internal returns (address) {
        IShowmarkRegistry.CheckInData memory d = _mode2(rogueEvent, pk, ROGUE_DOOR, uint64(block.timestamp));
        _checkIn(d);
        return d.attendee;
    }

    function _openCampaignFrom(address s, uint256 deposit) internal returns (uint256 id) {
        ICampaignVault.CampaignParams memory p = _params(NATIVE);
        p.openToBonded = true;
        p.minBond = 1 ether;
        vm.deal(s, s.balance + deposit);
        vm.prank(s);
        id = vault.createCampaign{value: deposit}(p, deposit);
        vm.prank(rogue);
        vault.optInOpenCampaign(id);
    }

    function _settleN(uint256 cid, uint256 seed, uint256 n) internal {
        for (uint256 i; i < n; ++i) {
            vault.settle(cid, rogueEvent, _presence(seed + i));
        }
    }

    // ------------------------------------------------------------------ N3-01 (fixed: claims follow live exposure)

    /// A sponsor that challenges at the first suspicious payout is no longer stuck with that snapshot: anyone can
    /// raise the open claim to the campaign's current exposure, and resolve uses the live exposure anyway.
    function test_N3_01_earlyClaimFollowsLaterExposure() public {
        uint256 c = _openCampaignFrom(sponsor, 20 ether);
        _settleN(c, 0x5B00, 1);
        vm.prank(sponsor);
        uint256 ch = bond.challenge{value: CHALLENGE_DEPOSIT}(rogue, c, "first sybil payout");
        assertEq(bond.challengeOf(ch).claim, 1 ether);

        address[] memory queued = new address[](9);
        for (uint256 i; i < 9; ++i) {
            queued[i] = _presence(0x5C00 + i);
        }
        vm.prank(sponsor);
        vault.closeCampaign(c);
        for (uint256 i; i < 9; ++i) {
            vault.settle(c, rogueEvent, queued[i]);
        }
        assertEq(vault.exposureOf(c, rogue), 10 ether);

        vm.prank(makeAddr("anyone"));
        bond.refreshClaim(ch);
        assertEq(bond.challengeOf(ch).claim, 10 ether);
        assertEq(bond.lockedOf(rogue), 10 ether);

        vm.prank(rogue);
        bond.requestUnbond(10 ether);
        vm.warp(block.timestamp + 7 days);
        vm.prank(rogue);
        vm.expectRevert(IOrganizerBond.ChallengeOpen.selector);
        bond.completeUnbond();

        uint256 before = sponsor.balance;
        vm.prank(owner);
        bond.resolve(ch, 10 ether, sponsor);
        assertEq(sponsor.balance - before, 10 ether, "the whole drained amount is slashed");
    }

    /// Even without an explicit refresh, resolve slashes against the live exposure.
    function test_N3_01_resolveRefreshesTheClaim() public {
        uint256 c = _openCampaignFrom(sponsor, 20 ether);
        _settleN(c, 0x5B50, 1);
        vm.prank(sponsor);
        uint256 ch = bond.challenge{value: CHALLENGE_DEPOSIT}(rogue, c, "");
        _settleN(c, 0x5B60, 4);
        vm.prank(owner);
        bond.resolve(ch, 5 ether, sponsor);
        assertEq(bond.bondOf(rogue), 5 ether);
        assertEq(bond.claimedOf(rogue), 0);
    }

    // ------------------------------------------------------------------ N3-02 (fixed: review period before release)

    /// Release now waits REVIEW_PERIOD past grace, so a sponsor who finds the fraud on day 4 can still challenge.
    function test_N3_02_reviewPeriodKeepsTheChallengeWindowOpen() public {
        uint256 c = _openCampaignFrom(sponsor, 20 ether);
        _settleN(c, 0x5D00, 5);
        vm.warp(uint256(vault.campaign(c).endsAt) + vault.SETTLE_GRACE() + 1);
        vm.prank(rogue);
        vm.expectRevert(ICampaignVault.ReleaseNotAvailable.selector);
        vault.releaseExposure(c, rogue);

        assertEq(vault.challengeDeadline(c), uint256(vault.campaign(c).endsAt) + 3 days + 7 days);
        vm.warp(vault.challengeDeadline(c));
        vm.prank(sponsor);
        uint256 ch = bond.challenge{value: CHALLENGE_DEPOSIT}(rogue, c, "found the sybils on day 9");
        assertEq(bond.challengeOf(ch).claim, 5 ether);

        // and while it is open the exposure stays put
        vm.warp(block.timestamp + 30 days);
        vm.expectRevert(ICampaignVault.ReleaseNotAvailable.selector);
        vault.releaseExposure(c, rogue);
    }

    // ------------------------------------------------------------------ U-*: attacks that fail

    /// N2-01 replay: a sock campaign's claim is sized by its own exposure, which shares the same bond room, so the
    /// claims of all campaigns never exceed the bond and dismissing the sock leaves the honest claim fully covered.
    function test_U01_sockChallengeNoLongerShieldsStake() public {
        address sock = makeAddr("sock");
        uint256 honest = _openCampaignFrom(sponsor, 20 ether);
        uint256 sockC = _openCampaignFrom(sock, 20 ether);
        _settleN(honest, 0x6100, 6);
        _settleN(sockC, 0x6200, 4); // only 4 fit in the remaining bond room
        address extra = _presence(0x6299);
        vm.expectRevert(ICampaignVault.EventNotEligible.selector);
        vault.settle(sockC, rogueEvent, extra);
        assertEq(vault.exposureOf(honest, rogue), 6 ether);
        assertEq(vault.exposureOf(sockC, rogue), 4 ether);

        vm.prank(rogue);
        bond.requestUnbond(10 ether);
        vm.deal(sock, CHALLENGE_DEPOSIT);
        vm.prank(sock);
        uint256 sockCh = bond.challenge{value: CHALLENGE_DEPOSIT}(rogue, sockC, "");
        vm.prank(sponsor);
        uint256 honestCh = bond.challenge{value: CHALLENGE_DEPOSIT}(rogue, honest, "");
        vm.prank(owner);
        bond.resolve(sockCh, 0, address(0));

        vm.warp(block.timestamp + 7 days);
        vm.prank(rogue);
        bond.completeUnbond(); // pays only the unclaimed 4
        (uint256 left,) = bond.pendingUnbond(rogue);
        assertEq(left, 6 ether);
        vm.prank(owner);
        bond.resolve(honestCh, 6 ether, sponsor);
        assertEq(address(bond).balance, 2 * CHALLENGE_DEPOSIT, "only deposits owed remain");
    }

    /// Slashing through one challenge cannot exceed the remaining stake, and later claims shrink to what is left.
    function test_U02_slashBoundedByStakeInAnyOrder() public {
        address s2 = makeAddr("sponsor2");
        uint256 a = _openCampaignFrom(sponsor, 20 ether);
        uint256 b = _openCampaignFrom(s2, 20 ether);
        _settleN(a, 0x6300, 5);
        _settleN(b, 0x6400, 5);
        vm.prank(sponsor);
        uint256 ca = bond.challenge{value: CHALLENGE_DEPOSIT}(rogue, a, "");
        vm.deal(s2, CHALLENGE_DEPOSIT);
        vm.prank(s2);
        uint256 cb = bond.challenge{value: CHALLENGE_DEPOSIT}(rogue, b, "");
        assertEq(bond.lockedOf(rogue), 10 ether);

        vm.startPrank(owner);
        bond.resolve(cb, 5 ether, s2);
        vm.expectRevert(IOrganizerBond.SlashExceedsClaim.selector);
        bond.resolve(ca, 6 ether, sponsor);
        bond.resolve(ca, 5 ether, sponsor);
        vm.stopPrank();
        assertEq(bond.bondOf(rogue), 0);
        assertEq(bond.claimedOf(rogue), 0);
        assertEq(address(bond).balance, 2 * CHALLENGE_DEPOSIT);
    }

    /// Approved-event (and, since open campaigns are native-only, all token) campaigns have no claim on the bond.
    function test_U03_noChallengeFromApprovedOrTokenCampaign() public {
        address pass = _presence(0x6500);
        uint256 approved = _createApproved(_params(NATIVE), 5 ether);
        uint256[] memory ids = new uint256[](1);
        ids[0] = rogueEvent;
        vm.prank(sponsor);
        vault.approveEvents(approved, ids);
        vault.settle(approved, rogueEvent, pass);
        vm.prank(sponsor);
        vm.expectRevert(IOrganizerBond.NoBondClaim.selector);
        bond.challenge{value: CHALLENGE_DEPOSIT}(rogue, approved, "");
    }
}
