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
    uint256 internal constant DEPOSIT = 0.5 ether;

    function setUp() public {
        vm.warp(1_790_000_000);
        bondC = new OrganizerBond(arbitrator, DEPOSIT);
        vault = new MockSponsorVault();
        vault.setSponsor(CAMPAIGN, sponsor);
        vault.setPaid(CAMPAIGN, organizer, 1 ether);
        vm.prank(arbitrator);
        bondC.setVault(address(vault));
        vm.deal(organizer, 100 ether);
        vm.deal(sponsor, 100 ether);
    }

    // ---------------------------------------------------------------- setup

    function test_constructor() public {
        assertEq(bondC.challengeDeposit(), DEPOSIT);
        vm.expectRevert(IOrganizerBond.ZeroAmount.selector);
        this.deployBond(0);
    }

    /// External so a reverting constructor is a call frame expectRevert can match without ending the test.
    function deployBond(uint256 deposit) external returns (address) {
        return address(new OrganizerBond(arbitrator, deposit));
    }

    function test_setVault_onceByOwner() public {
        OrganizerBond fresh = new OrganizerBond(arbitrator, DEPOSIT);
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
        _bond(3 ether);
        _bond(2 ether);
        assertEq(bondC.bondOf(organizer), 5 ether);
        assertEq(address(bondC).balance, 5 ether);
    }

    function test_bond_rejectsZero() public {
        vm.prank(organizer);
        vm.expectRevert(IOrganizerBond.ZeroAmount.selector);
        bondC.bond();
    }

    function test_requestUnbond_dropsEligibilityImmediately() public {
        _bond(5 ether);
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
        _bond(1 ether);
        vm.startPrank(organizer);
        vm.expectRevert(IOrganizerBond.ZeroAmount.selector);
        bondC.requestUnbond(0);
        vm.expectRevert(IOrganizerBond.InsufficientBond.selector);
        bondC.requestUnbond(1 ether + 1);
        vm.stopPrank();
    }

    function test_requestUnbond_againRestartsTimer() public {
        _bond(5 ether);
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
        _bond(5 ether);
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
        address stranger = makeAddr("stranger");
        vm.deal(stranger, 1 ether);
        vm.prank(stranger);
        vm.expectRevert(IOrganizerBond.NotCampaignSponsor.selector);
        bondC.challenge{value: DEPOSIT}(organizer, CAMPAIGN, "fake headcount");

        vm.prank(sponsor);
        vm.expectRevert(IOrganizerBond.NotCampaignSponsor.selector);
        bondC.challenge{value: DEPOSIT}(organizer, CAMPAIGN + 1, "unknown campaign");
    }

    function test_challenge_requiresTheExactDeposit() public {
        vm.startPrank(sponsor);
        vm.expectRevert(IOrganizerBond.BadChallengeDeposit.selector);
        bondC.challenge{value: DEPOSIT - 1}(organizer, CAMPAIGN, "x");
        vm.expectRevert(IOrganizerBond.BadChallengeDeposit.selector);
        bondC.challenge{value: DEPOSIT + 1}(organizer, CAMPAIGN, "x");
        vm.stopPrank();
    }

    function test_challenge_requiresTheCampaignToHavePaidTheOrganizer() public {
        vm.prank(sponsor);
        vm.expectRevert(IOrganizerBond.OrganizerNotPaid.selector);
        bondC.challenge{value: DEPOSIT}(makeAddr("unrelated organizer"), CAMPAIGN, "never worked together");
    }

    function test_challenge_recordsLocksAndEmits() public {
        _bond(5 ether);
        vm.expectEmit(address(bondC));
        emit IOrganizerBond.Challenged(1, organizer, CAMPAIGN, sponsor, "fake headcount");
        vm.expectEmit(address(bondC));
        emit IOrganizerBond.StakeLocked(1, organizer, 1 ether, DEPOSIT);
        uint256 id = _challenge(CAMPAIGN);
        assertEq(id, 1);
        assertEq(bondC.openChallenges(organizer), 1);
        assertEq(bondC.lockedOf(organizer), 1 ether, "locks what the campaign paid, not the whole stake");
        assertTrue(bondC.hasOpenChallenge(CAMPAIGN, organizer));

        IOrganizerBond.Challenge memory c = bondC.challengeOf(id);
        assertEq(c.sponsor, sponsor);
        assertEq(c.organizer, organizer);
        assertEq(c.campaignId, CAMPAIGN);
        assertEq(c.locked, 1 ether);
        assertEq(c.deposit, DEPOSIT);
        assertFalse(c.resolved);
        assertEq(address(bondC).balance, 5 ether + DEPOSIT);

        // one open challenge per campaign and organizer
        vm.prank(sponsor);
        vm.expectRevert(IOrganizerBond.DuplicateChallenge.selector);
        bondC.challenge{value: DEPOSIT}(organizer, CAMPAIGN, "again");

        // another campaign that also paid this organizer may challenge too
        vault.setSponsor(CAMPAIGN + 1, sponsor);
        vault.setPaid(CAMPAIGN + 1, organizer, 10 ether);
        assertEq(_challenge(CAMPAIGN + 1), 2);
        assertEq(bondC.lockedOf(organizer), 5 ether, "locks never exceed the stake");
        assertEq(bondC.challengeOf(2).locked, 4 ether);
        assertEq(bondC.nextChallengeId(), 3);

        // once resolved, the campaign may challenge again
        vm.prank(arbitrator);
        bondC.resolve(id, 0, address(0));
        assertFalse(bondC.hasOpenChallenge(CAMPAIGN, organizer));
        assertEq(_challenge(CAMPAIGN), 3);
    }

    function test_challenge_onErc20CampaignLocksTheAvailableStake() public {
        _bond(5 ether);
        vault.setSponsor(CAMPAIGN + 1, sponsor);
        vault.setToken(CAMPAIGN + 1, makeAddr("qusdc"));
        vault.setPaid(CAMPAIGN + 1, organizer, 3e6); // 3 QUSDC, not comparable with a QIE stake
        _challenge(CAMPAIGN + 1);
        assertEq(bondC.lockedOf(organizer), 5 ether);
    }

    function test_challenge_guards() public {
        vm.startPrank(sponsor);
        vm.expectRevert(IOrganizerBond.ZeroAddress.selector);
        bondC.challenge{value: DEPOSIT}(address(0), CAMPAIGN, "x");
        vm.expectRevert(IOrganizerBond.ReasonTooLong.selector);
        bondC.challenge{value: DEPOSIT}(organizer, CAMPAIGN, string(new bytes(2049)));
        vm.stopPrank();

        OrganizerBond fresh = new OrganizerBond(arbitrator, DEPOSIT);
        vm.prank(sponsor);
        vm.expectRevert(IOrganizerBond.VaultNotSettable.selector);
        fresh.challenge{value: DEPOSIT}(organizer, CAMPAIGN, "x");
    }

    function test_challengeLocksOnlyItsShareOfAnUnbond() public {
        _bond(5 ether);
        vm.prank(organizer);
        bondC.requestUnbond(5 ether);
        uint256 id = _challenge(CAMPAIGN); // locks 1 QIE
        vm.warp(block.timestamp + 7 days);

        uint256 before = organizer.balance;
        vm.prank(organizer);
        bondC.completeUnbond();
        assertEq(organizer.balance - before, 4 ether, "everything above the lock leaves");
        (uint256 pending,) = bondC.pendingUnbond(organizer);
        assertEq(pending, 1 ether);

        vm.prank(organizer);
        vm.expectRevert(IOrganizerBond.ChallengeOpen.selector);
        bondC.completeUnbond();

        vm.prank(arbitrator);
        bondC.resolve(id, 0, address(0));
        vm.prank(organizer);
        bondC.completeUnbond();
        assertEq(organizer.balance - before, 5 ether);
    }

    function test_lockIsCoveredByBondedFirst() public {
        _bond(5 ether);
        _challenge(CAMPAIGN); // locks 1
        vm.prank(organizer);
        bondC.requestUnbond(4 ether); // bonded 1 still covers the lock
        vm.warp(block.timestamp + 7 days);
        vm.prank(organizer);
        bondC.completeUnbond();
        (uint256 pending,) = bondC.pendingUnbond(organizer);
        assertEq(pending, 0);
        assertEq(bondC.bondOf(organizer), 1 ether);
        // the locked part may move to pending (still slashable) but cannot leave while locked
        vm.prank(organizer);
        bondC.requestUnbond(1 ether);
        vm.warp(block.timestamp + 7 days);
        vm.prank(organizer);
        vm.expectRevert(IOrganizerBond.ChallengeOpen.selector);
        bondC.completeUnbond();
    }

    function test_resolve_slashReturnsTheDepositToTheChallenger() public {
        _bond(5 ether);
        vm.prank(organizer);
        bondC.requestUnbond(4.5 ether); // bonded 0.5, pending 4.5
        uint256 id = _challenge(CAMPAIGN); // locks 1

        vm.expectEmit(address(bondC));
        emit IOrganizerBond.Resolved(id, organizer, 1 ether, victim);
        vm.expectEmit(address(bondC));
        emit IOrganizerBond.DepositAwarded(id, sponsor, DEPOSIT);
        vm.prank(arbitrator);
        bondC.resolve(id, 1 ether, victim);

        assertEq(victim.balance, 1 ether);
        assertEq(bondC.bondOf(organizer), 0, "bonded is slashed first");
        (uint256 pending,) = bondC.pendingUnbond(organizer);
        assertEq(pending, 4 ether);
        assertEq(bondC.lockedOf(organizer), 0);
        assertEq(bondC.depositOwed(sponsor), DEPOSIT);
        assertTrue(bondC.challengeOf(id).resolved);
        assertEq(bondC.openChallenges(organizer), 0);

        uint256 before = sponsor.balance;
        vm.expectEmit(address(bondC));
        emit IOrganizerBond.DepositClaimed(sponsor, DEPOSIT);
        vm.prank(sponsor);
        bondC.claimDeposit();
        assertEq(sponsor.balance - before, DEPOSIT);
        assertEq(address(bondC).balance, 4 ether);
    }

    function test_resolve_dismissalForfeitsTheDepositToTheOrganizer() public {
        _bond(1 ether);
        uint256 id = _challenge(CAMPAIGN);
        vm.expectEmit(address(bondC));
        emit IOrganizerBond.DepositAwarded(id, organizer, DEPOSIT);
        vm.prank(arbitrator);
        bondC.resolve(id, 0, address(0));
        assertEq(bondC.depositOwed(organizer), DEPOSIT);
        assertEq(bondC.depositOwed(sponsor), 0);

        vm.prank(organizer);
        bondC.claimDeposit();
        vm.prank(organizer);
        vm.expectRevert(IOrganizerBond.NothingToClaim.selector);
        bondC.claimDeposit();
    }

    function test_resolve_guards() public {
        _bond(1 ether);
        uint256 id = _challenge(CAMPAIGN);

        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, address(this)));
        bondC.resolve(id, 0, victim);

        vm.startPrank(arbitrator);
        vm.expectRevert(IOrganizerBond.ChallengeNotOpen.selector);
        bondC.resolve(99, 0, victim);
        vm.expectRevert(IOrganizerBond.SlashExceedsLock.selector);
        bondC.resolve(id, 1 ether + 1, victim);
        vm.expectRevert(IOrganizerBond.ZeroAddress.selector);
        bondC.resolve(id, 1, address(0));
        bondC.resolve(id, 0, address(0));
        vm.expectRevert(IOrganizerBond.ChallengeNotOpen.selector);
        bondC.resolve(id, 0, victim);
        vm.stopPrank();
    }

    /// Re-review N-02: spam now locks only what each spam campaign paid and costs a deposit per challenge, which
    /// the organizer collects when the Safe dismisses it.
    function test_challengeSpamLocksDustAndPaysTheOrganizer() public {
        _bond(1 ether);
        vm.prank(organizer);
        bondC.requestUnbond(1 ether);
        address griefer = makeAddr("griefer");
        vm.deal(griefer, 10 * DEPOSIT);
        uint256[] memory ids = new uint256[](10);
        for (uint256 i; i < 10; ++i) {
            uint256 cid = 100 + i;
            vault.setSponsor(cid, griefer);
            vault.setPaid(cid, organizer, 1); // one wei per spam campaign
            vm.prank(griefer);
            ids[i] = bondC.challenge{value: DEPOSIT}(organizer, cid, "");
        }
        assertEq(bondC.lockedOf(organizer), 10);

        vm.warp(block.timestamp + 7 days);
        uint256 before = organizer.balance;
        vm.prank(organizer);
        bondC.completeUnbond();
        assertEq(organizer.balance - before, 1 ether - 10, "only the dust stays");

        vm.startPrank(arbitrator);
        for (uint256 i; i < 10; ++i) {
            bondC.resolve(ids[i], 0, address(0));
        }
        vm.stopPrank();
        assertEq(bondC.depositOwed(organizer), 10 * DEPOSIT, "the griefer pays the organizer");
    }

    // ---------------------------------------------------------------- fuzz

    /// Holdings always equal bonded plus pending plus deposits held or owed, whatever mix of bond, unbond,
    /// challenge, slash and exit happens; locks never exceed the stake.
    function testFuzz_accountingConserved(uint96 bondAmt, uint96 unbondAmt, uint96 paid, uint96 slashAmt, bool complete)
        public
    {
        bondAmt = uint96(bound(bondAmt, 1, 1_000_000 ether));
        unbondAmt = uint96(bound(unbondAmt, 0, bondAmt));
        paid = uint96(bound(paid, 1, type(uint96).max));
        vm.deal(organizer, bondAmt);
        vault.setPaid(CAMPAIGN, organizer, paid);

        _bond(bondAmt);
        if (unbondAmt > 0) {
            vm.prank(organizer);
            bondC.requestUnbond(unbondAmt);
        }
        uint256 id = _challenge(CAMPAIGN);
        uint256 locked = bondC.lockedOf(organizer);
        assertEq(locked, paid < bondAmt ? paid : bondAmt);

        vm.warp(block.timestamp + 7 days);
        if (complete && unbondAmt > 0 && unbondAmt + (bondAmt - unbondAmt) > locked) {
            (uint256 p,) = bondC.pendingUnbond(organizer);
            uint256 needed = locked > bondAmt - unbondAmt ? locked - (bondAmt - unbondAmt) : 0;
            if (p > needed) {
                vm.prank(organizer);
                bondC.completeUnbond();
            }
        }
        _assertHeld();

        slashAmt = uint96(bound(slashAmt, 0, locked));
        vm.prank(arbitrator);
        bondC.resolve(id, slashAmt, victim);
        assertEq(victim.balance, slashAmt);
        _assertHeld();
    }

    // ---------------------------------------------------------------- helpers

    function _assertHeld() internal view {
        (uint256 pending,) = bondC.pendingUnbond(organizer);
        uint256 openDeposits;
        for (uint256 i = 1; i < bondC.nextChallengeId(); ++i) {
            IOrganizerBond.Challenge memory c = bondC.challengeOf(i);
            if (!c.resolved) openDeposits += c.deposit;
        }
        assertEq(
            address(bondC).balance,
            bondC.bondOf(organizer) + pending + openDeposits + bondC.depositOwed(organizer) + bondC.depositOwed(sponsor)
        );
        assertLe(bondC.lockedOf(organizer), bondC.bondOf(organizer) + pending);
    }

    function _bond(uint256 amount) internal {
        vm.prank(organizer);
        bondC.bond{value: amount}();
    }

    function _challenge(uint256 campaignId) internal returns (uint256) {
        vm.prank(vault.sponsorOf(campaignId));
        return bondC.challenge{value: DEPOSIT}(organizer, campaignId, "fake headcount");
    }
}
