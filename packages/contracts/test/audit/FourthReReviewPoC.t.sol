// SPDX-License-Identifier: MIT
pragma solidity 0.8.38;

import {IShowmarkRegistry} from "../../src/interfaces/IShowmarkRegistry.sol";
import {ICampaignVault} from "../../src/interfaces/ICampaignVault.sol";
import {IOrganizerBond} from "../../src/interfaces/IOrganizerBond.sol";
import {ProtocolFixture} from "../utils/ProtocolFixture.sol";

/// @notice Fourth re-review of refreshClaim and the review period (docs/AUDIT.md, "Fourth re-review").
/// I4-01 passes while the residual it documents exists; V-* pin down attacks that fail.
contract FourthReReviewPoCTest is ProtocolFixture {
    address internal rogue = makeAddr("rogue");
    uint256 internal constant ROGUE_DOOR = 0xD0D0;
    uint256 internal rogueEvent;
    uint256 internal campaignId;

    function setUp() public override {
        super.setUp();
        vm.deal(rogue, 10 ether);
        vm.startPrank(rogue);
        bond.bond{value: 10 ether}();
        rogueEvent = registry.createEvent(T0, T0 + 1 hours, 0, 60, 0, META);
        registry.authorizeDoorKey(rogueEvent, vm.addr(ROGUE_DOOR), T0 + 1 hours);
        vm.stopPrank();
        ICampaignVault.CampaignParams memory p = _params(NATIVE);
        p.openToBonded = true;
        p.minBond = 1 ether;
        campaignId = _create(p, 20 ether);
        vm.prank(rogue);
        vault.optInOpenCampaign(campaignId);
    }

    function _settleN(uint256 seed, uint256 n) internal {
        for (uint256 i; i < n; ++i) {
            IShowmarkRegistry.CheckInData memory d = _mode2(rogueEvent, seed + i, ROGUE_DOOR, uint64(block.timestamp));
            _checkIn(d);
            vault.settle(campaignId, rogueEvent, d.attendee);
        }
    }

    function _challenge() internal returns (uint256 ch) {
        vm.prank(sponsor);
        ch = bond.challenge{value: CHALLENGE_DEPOSIT}(rogue, campaignId, "");
    }

    /// Refresh only ever raises a claim, anyone may call it, and the lock stays capped at the stake.
    function test_V01_refreshOnlyRaisesAndNeverOverLocks() public {
        _settleN(0x7100, 1);
        uint256 ch = _challenge();
        _settleN(0x7200, 9);
        vm.prank(makeAddr("anyone"));
        bond.refreshClaim(ch);
        assertEq(bond.challengeOf(ch).claim, 10 ether);
        bond.refreshClaim(ch); // no-op, never lowers
        assertEq(bond.claimedOf(rogue), 10 ether);

        // a slash through another route cannot happen; stake falls only by resolve, and the lock follows it
        vm.prank(rogue);
        bond.requestUnbond(10 ether);
        assertEq(bond.lockedOf(rogue), 10 ether);
        vm.warp(block.timestamp + 7 days);
        vm.prank(rogue);
        vm.expectRevert(IOrganizerBond.ChallengeOpen.selector);
        bond.completeUnbond();

        vm.prank(owner);
        bond.resolve(ch, 10 ether, sponsor);
        assertEq(bond.claimedOf(rogue), 0);
        vm.expectRevert(IOrganizerBond.ChallengeNotOpen.selector);
        bond.refreshClaim(ch);
    }

    /// resolve refreshes first, so the Safe can slash the full exposure even if nobody refreshed.
    function test_V02_resolveRefreshesBeforeBounding() public {
        _settleN(0x7300, 1);
        uint256 ch = _challenge();
        _settleN(0x7400, 9);
        vm.prank(owner);
        bond.resolve(ch, 10 ether, sponsor);
        assertEq(bond.bondOf(rogue), 0);
    }

    /// Release waits for endsAt + SETTLE_GRACE + REVIEW_PERIOD; refunds and withdrawals are not delayed, and stake
    /// without a claim can still unbond meanwhile (exposure limits new payouts, it does not hold stake).
    function test_V03_reviewPeriodHoldsOnlyExposure() public {
        _settleN(0x7500, 3);
        uint256 deadline = vault.challengeDeadline(campaignId);
        assertEq(deadline, uint256(vault.campaign(campaignId).endsAt) + 3 days + 7 days);

        vm.warp(uint256(vault.campaign(campaignId).endsAt) + 3 days + 1);
        vm.prank(sponsor);
        vault.refund(campaignId);
        vm.expectRevert(ICampaignVault.ReleaseNotAvailable.selector);
        vault.releaseExposure(campaignId, rogue);

        vm.prank(rogue);
        bond.requestUnbond(10 ether);
        vm.warp(deadline);
        vm.expectRevert(ICampaignVault.ReleaseNotAvailable.selector);
        vault.releaseExposure(campaignId, rogue);
        vm.warp(deadline + 1);
        vm.prank(rogue);
        bond.completeUnbond();
        assertEq(rogue.balance, 10 ether, "unclaimed stake leaves on schedule");
        vault.releaseExposure(campaignId, rogue);
        assertEq(vault.bondedExposure(rogue), 0);
    }

    /// Residual (informational): completeUnbond reads the stored claim. If nobody calls refreshClaim after later
    /// bonded payouts, the organizer can unbond the unrefreshed part once its 7-day delay ends.
    function test_I4_01_unrefreshedClaimLetsStakeLeave() public {
        _settleN(0x7600, 1);
        uint256 ch = _challenge();
        _settleN(0x7700, 9);
        vm.prank(rogue);
        bond.requestUnbond(10 ether);
        vm.warp(block.timestamp + 7 days);
        vm.prank(rogue);
        bond.completeUnbond();
        assertEq(rogue.balance, 9 ether);
        vm.prank(owner);
        vm.expectRevert(IOrganizerBond.SlashExceedsClaim.selector);
        bond.resolve(ch, 2 ether, sponsor);
    }
}
