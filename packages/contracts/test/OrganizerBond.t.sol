// SPDX-License-Identifier: MIT
pragma solidity 0.8.38;

import {Test} from "forge-std/Test.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {OrganizerBond} from "../src/OrganizerBond.sol";
import {IOrganizerBond} from "../src/interfaces/IOrganizerBond.sol";
import {MockSponsorVault} from "./mocks/MockSponsorVault.sol";
import {ReentrantReceiver} from "./mocks/ReentrantReceiver.sol";

contract OrganizerBondTest is Test {
    OrganizerBond internal bondC;
    MockSponsorVault internal vault;

    address internal arbitrator = makeAddr("arbitrator");
    address internal organizer = makeAddr("organizer");
    address internal sponsor = makeAddr("sponsor");
    address internal victim = makeAddr("victim");
    uint256 internal constant CAMPAIGN = 7;

    function setUp() public {
        vm.warp(1_790_000_000);
        bondC = new OrganizerBond(arbitrator);
        vault = new MockSponsorVault();
        vault.setSponsor(CAMPAIGN, sponsor);
        vm.prank(arbitrator);
        bondC.setVault(address(vault));
        vm.deal(organizer, 100 ether);
    }

    // ---------------------------------------------------------------- setup

    function test_setVault_onceByOwner() public {
        OrganizerBond fresh = new OrganizerBond(arbitrator);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, address(this)));
        fresh.setVault(address(vault));

        vm.startPrank(arbitrator);
        vm.expectRevert(IOrganizerBond.ZeroAddress.selector);
        fresh.setVault(address(0));
        vm.expectEmit(address(fresh));
        emit IOrganizerBond.VaultSet(address(vault));
        fresh.setVault(address(vault));
        vm.expectRevert(IOrganizerBond.VaultNotSettable.selector);
        fresh.setVault(address(vault));
        vm.stopPrank();
        assertEq(fresh.vault(), address(vault));
    }

    function test_arbitratorIsOwner() public view {
        assertEq(bondC.arbitrator(), arbitrator);
        assertEq(bondC.owner(), arbitrator);
    }

    // ---------------------------------------------------------------- bond and unbond

    function test_bond_accumulatesAndEmits() public {
        vm.expectEmit(address(bondC));
        emit IOrganizerBond.Bonded(organizer, 3 ether, 3 ether);
        vm.prank(organizer);
        bondC.bond{value: 3 ether}();
        vm.prank(organizer);
        bondC.bond{value: 2 ether}();
        assertEq(bondC.bondOf(organizer), 5 ether);
        assertEq(address(bondC).balance, 5 ether);
    }

    function test_bond_rejectsZero() public {
        vm.prank(organizer);
        vm.expectRevert(IOrganizerBond.ZeroAmount.selector);
        bondC.bond();
    }

    function test_requestUnbond_dropsEligibilityImmediately() public {
        _bond(organizer, 5 ether);
        uint64 availableAt = uint64(block.timestamp + 7 days);

        vm.expectEmit(address(bondC));
        emit IOrganizerBond.UnbondRequested(organizer, 2 ether, availableAt);
        vm.prank(organizer);
        bondC.requestUnbond(2 ether);

        assertEq(bondC.bondOf(organizer), 3 ether);
        (uint256 amount, uint64 at) = bondC.pendingUnbond(organizer);
        assertEq(amount, 2 ether);
        assertEq(at, availableAt);
    }

    function test_requestUnbond_guards() public {
        _bond(organizer, 1 ether);
        vm.startPrank(organizer);
        vm.expectRevert(IOrganizerBond.ZeroAmount.selector);
        bondC.requestUnbond(0);
        vm.expectRevert(IOrganizerBond.InsufficientBond.selector);
        bondC.requestUnbond(1 ether + 1);
        vm.stopPrank();
    }

    function test_requestUnbond_againRestartsTimer() public {
        _bond(organizer, 5 ether);
        vm.prank(organizer);
        bondC.requestUnbond(1 ether);
        vm.warp(block.timestamp + 6 days);
        vm.prank(organizer);
        bondC.requestUnbond(1 ether);
        (uint256 amount, uint64 at) = bondC.pendingUnbond(organizer);
        assertEq(amount, 2 ether);
        assertEq(at, block.timestamp + 7 days);
    }

    function test_completeUnbond_afterDelay() public {
        _bond(organizer, 5 ether);
        vm.prank(organizer);
        bondC.requestUnbond(2 ether);

        vm.warp(block.timestamp + 7 days - 1);
        vm.prank(organizer);
        vm.expectRevert(IOrganizerBond.UnbondNotReady.selector);
        bondC.completeUnbond();

        vm.warp(block.timestamp + 1);
        uint256 before = organizer.balance;
        vm.expectEmit(address(bondC));
        emit IOrganizerBond.Unbonded(organizer, 2 ether);
        vm.prank(organizer);
        bondC.completeUnbond();
        assertEq(organizer.balance - before, 2 ether);
        (uint256 amount,) = bondC.pendingUnbond(organizer);
        assertEq(amount, 0);
        assertEq(address(bondC).balance, 3 ether);
    }

    function test_completeUnbond_nothingPending() public {
        vm.prank(organizer);
        vm.expectRevert(IOrganizerBond.NothingPending.selector);
        bondC.completeUnbond();
    }

    function test_completeUnbond_reentrancyPaysOnce() public {
        ReentrantReceiver attacker = new ReentrantReceiver();
        vm.deal(address(attacker), 0);
        attacker.exec{value: 4 ether}(address(bondC), abi.encodeCall(OrganizerBond.bond, ()));
        attacker.exec(address(bondC), abi.encodeCall(OrganizerBond.requestUnbond, (4 ether)));
        attacker.arm(address(bondC), abi.encodeCall(OrganizerBond.completeUnbond, ()));
        vm.warp(block.timestamp + 7 days);

        attacker.exec(address(bondC), abi.encodeCall(OrganizerBond.completeUnbond, ()));
        assertEq(address(attacker).balance, 4 ether);
        assertEq(address(bondC).balance, 0);
        assertEq(attacker.reentrySuccesses(), 0);
        assertEq(bytes4(attacker.lastRevert()), ReentrancyGuard.ReentrancyGuardReentrantCall.selector);
    }

    // ---------------------------------------------------------------- challenges

    function test_challenge_bySponsorOnly() public {
        vm.prank(makeAddr("stranger"));
        vm.expectRevert(IOrganizerBond.NotCampaignSponsor.selector);
        bondC.challenge(organizer, CAMPAIGN, "fake headcount");

        vm.prank(sponsor);
        vm.expectRevert(IOrganizerBond.NotCampaignSponsor.selector);
        bondC.challenge(organizer, CAMPAIGN + 1, "unknown campaign");
    }

    function test_challenge_recordsAndEmits() public {
        vm.expectEmit(address(bondC));
        emit IOrganizerBond.Challenged(1, organizer, CAMPAIGN, sponsor, "fake headcount");
        vm.prank(sponsor);
        uint256 id = bondC.challenge(organizer, CAMPAIGN, "fake headcount");
        assertEq(id, 1);
        assertEq(bondC.openChallenges(organizer), 1);

        IOrganizerBond.Challenge memory c = bondC.challengeOf(id);
        assertEq(c.sponsor, sponsor);
        assertEq(c.organizer, organizer);
        assertEq(c.campaignId, CAMPAIGN);
        assertFalse(c.resolved);

        vm.prank(sponsor);
        assertEq(bondC.challenge(organizer, CAMPAIGN, "again"), 2);
        assertEq(bondC.openChallenges(organizer), 2);
        assertEq(bondC.nextChallengeId(), 3);
    }

    function test_challenge_guards() public {
        vm.startPrank(sponsor);
        vm.expectRevert(IOrganizerBond.ZeroAddress.selector);
        bondC.challenge(address(0), CAMPAIGN, "x");
        vm.expectRevert(IOrganizerBond.ReasonTooLong.selector);
        bondC.challenge(organizer, CAMPAIGN, string(new bytes(2049)));
        vm.stopPrank();

        OrganizerBond fresh = new OrganizerBond(arbitrator);
        vm.prank(sponsor);
        vm.expectRevert(IOrganizerBond.VaultNotSettable.selector);
        fresh.challenge(organizer, CAMPAIGN, "x");
    }

    function test_openChallengeBlocksCompleteUnbond() public {
        _bond(organizer, 5 ether);
        vm.prank(organizer);
        bondC.requestUnbond(5 ether);
        uint256 id = _challenge();
        vm.warp(block.timestamp + 30 days);

        vm.prank(organizer);
        vm.expectRevert(IOrganizerBond.ChallengeOpen.selector);
        bondC.completeUnbond();

        vm.prank(arbitrator);
        bondC.resolve(id, 0, address(0));
        vm.prank(organizer);
        bondC.completeUnbond();
        assertEq(address(bondC).balance, 0);
    }

    function test_resolve_slashesBondedThenPending() public {
        _bond(organizer, 5 ether);
        vm.prank(organizer);
        bondC.requestUnbond(3 ether); // bonded 2, pending 3
        uint256 id = _challenge();

        vm.expectEmit(address(bondC));
        emit IOrganizerBond.Resolved(id, organizer, 4 ether, victim);
        vm.prank(arbitrator);
        bondC.resolve(id, 4 ether, victim);

        assertEq(victim.balance, 4 ether);
        assertEq(bondC.bondOf(organizer), 0);
        (uint256 pending,) = bondC.pendingUnbond(organizer);
        assertEq(pending, 1 ether);
        assertEq(address(bondC).balance, 1 ether);
        assertTrue(bondC.challengeOf(id).resolved);
        assertEq(bondC.openChallenges(organizer), 0);
    }

    function test_resolve_guards() public {
        _bond(organizer, 1 ether);
        uint256 id = _challenge();

        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, address(this)));
        bondC.resolve(id, 0, victim);

        vm.startPrank(arbitrator);
        vm.expectRevert(IOrganizerBond.ChallengeNotOpen.selector);
        bondC.resolve(99, 0, victim);
        vm.expectRevert(IOrganizerBond.SlashExceedsBond.selector);
        bondC.resolve(id, 1 ether + 1, victim);
        vm.expectRevert(IOrganizerBond.ZeroAddress.selector);
        bondC.resolve(id, 1, address(0));

        bondC.resolve(id, 0, address(0)); // dismissal needs no recipient
        vm.expectRevert(IOrganizerBond.ChallengeNotOpen.selector);
        bondC.resolve(id, 0, victim);
        vm.stopPrank();
        assertEq(address(bondC).balance, 1 ether);
    }

    // ---------------------------------------------------------------- fuzz

    /// Holdings always equal bonded plus pending, whatever mix of bond, unbond and slash happens.
    function testFuzz_accountingConserved(uint96 bondAmt, uint96 unbondAmt, uint96 slashAmt, bool complete) public {
        bondAmt = uint96(bound(bondAmt, 1, 1_000_000 ether));
        unbondAmt = uint96(bound(unbondAmt, 0, bondAmt));
        slashAmt = uint96(bound(slashAmt, 0, bondAmt));
        vm.deal(organizer, bondAmt);

        _bond(organizer, bondAmt);
        if (unbondAmt > 0) {
            vm.prank(organizer);
            bondC.requestUnbond(unbondAmt);
        }
        uint256 id = _challenge();
        vm.prank(arbitrator);
        bondC.resolve(id, slashAmt, victim);

        vm.warp(block.timestamp + 7 days);
        (uint256 pending,) = bondC.pendingUnbond(organizer);
        if (complete && pending > 0) {
            vm.prank(organizer);
            bondC.completeUnbond();
            (pending,) = bondC.pendingUnbond(organizer);
        }
        assertEq(address(bondC).balance, bondC.bondOf(organizer) + pending);
        assertEq(victim.balance, slashAmt);
    }

    // ---------------------------------------------------------------- helpers

    function _bond(address who, uint256 amount) internal {
        vm.prank(who);
        bondC.bond{value: amount}();
    }

    function _challenge() internal returns (uint256) {
        vm.prank(sponsor);
        return bondC.challenge(organizer, CAMPAIGN, "no-shows paid");
    }
}
