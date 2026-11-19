// SPDX-License-Identifier: MIT
pragma solidity 0.8.38;

import {Test} from "forge-std/Test.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {OrganizerBond} from "../../src/OrganizerBond.sol";
import {MockSponsorVault} from "../mocks/MockSponsorVault.sol";

/// @notice Drives OrganizerBond with many concurrent claims against one organizer, in any order, and keeps a ghost
/// model of open claims, deposits and payouts.
contract BondHandler is Test {
    OrganizerBond public bond;
    MockSponsorVault public vault;
    address public arbitrator;
    address public organizer = address(0x0E6A);
    address public sponsor = address(0x5905);
    uint256 internal constant CAMPAIGNS = 8;

    uint256[] internal open;
    uint256 public ghostClaims;
    uint256 public ghostDepositsHeld; // deposits posted and not yet claimed back out
    bool public overUnbond;
    bool public overSlash;
    uint256 public resolutions;
    uint256 public maxOpen;

    constructor(OrganizerBond bond_, MockSponsorVault vault_, address arbitrator_) {
        bond = bond_;
        vault = vault_;
        arbitrator = arbitrator_;
        for (uint256 id = 1; id <= CAMPAIGNS; ++id) {
            vault.setSponsor(id, sponsor);
            vault.setOpen(id, true);
        }
    }

    function stake() public view returns (uint256) {
        (uint256 pending,) = bond.pendingUnbond(organizer);
        return bond.bondOf(organizer) + pending;
    }

    function openCount() external view returns (uint256) {
        return open.length;
    }

    function addBond(uint96 amount) external {
        uint256 a = bound(amount, 1, 50 ether);
        vm.deal(organizer, organizer.balance + a);
        vm.prank(organizer);
        bond.bond{value: a}();
    }

    function requestUnbond(uint256 amount) external {
        uint256 b = bond.bondOf(organizer);
        if (b == 0) return;
        vm.prank(organizer);
        bond.requestUnbond(bound(amount, 1, b));
    }

    function completeUnbond(uint256 dt) external {
        vm.warp(block.timestamp + bound(dt, 0, 10 days));
        uint256 s = stake();
        uint256 free = s - Math.min(s, ghostClaims);
        uint256 before = organizer.balance;
        vm.prank(organizer);
        try bond.completeUnbond() {
            if (organizer.balance - before > free) overUnbond = true;
        } catch {}
    }

    function challenge(uint256 campaignSeed, uint96 exposure) external {
        uint256 id = 1 + campaignSeed % CAMPAIGNS;
        if (bond.hasOpenChallenge(id, organizer)) return;
        uint256 claim = bound(exposure, 1, 30 ether);
        vault.setExposure(id, organizer, claim);
        uint256 deposit = bond.challengeDeposit();
        vm.deal(sponsor, sponsor.balance + deposit);
        vm.prank(sponsor);
        open.push(bond.challenge{value: deposit}(organizer, id, ""));
        ghostClaims += claim;
        ghostDepositsHeld += deposit;
        if (open.length > maxOpen) maxOpen = open.length;
    }

    function resolve(uint256 seed, uint256 slashSeed, bool tryTooMuch) external {
        if (open.length == 0) return;
        uint256 k = seed % open.length;
        uint256 id = open[k];
        uint256 claim = bond.challengeOf(id).claim;
        uint256 cap = Math.min(claim, stake());
        if (tryTooMuch) {
            // the Safe can never slash beyond min(claim, current stake)
            vm.prank(arbitrator);
            try bond.resolve(id, cap + 1, address(0x51A5)) {
                overSlash = true;
            } catch {}
            return;
        }
        uint256 slash = bound(slashSeed, 0, cap);
        vm.prank(arbitrator);
        bond.resolve(id, slash, slash == 0 ? address(0) : address(0x51A5));
        open[k] = open[open.length - 1];
        open.pop();
        ghostClaims -= claim;
        resolutions += 1;
    }

    function claimDeposits(bool fromOrganizer) external {
        address who = fromOrganizer ? organizer : sponsor;
        uint256 owed = bond.depositOwed(who);
        if (owed == 0) return;
        vm.prank(who);
        bond.claimDeposit();
        ghostDepositsHeld -= owed;
    }
}

/// @notice Claim identity for the organizer bond (second re-review N2-01, N2-02): whatever order challenges are
/// filed, resolved, dismissed or slashed in, the unbond lock is min(stake, sum of open claims), no unbond pays out
/// stake an open claim needs, no slash exceeds min(claim, current stake), and holdings match stake plus deposits.
contract BondInvariantsTest is Test {
    BondHandler internal handler;
    OrganizerBond internal bond;
    address internal arbitrator = makeAddr("arbitrator");

    function setUp() public {
        vm.warp(1_790_000_000);
        bond = new OrganizerBond(arbitrator, 0.5 ether);
        MockSponsorVault vault = new MockSponsorVault();
        vm.prank(arbitrator);
        bond.setVault(address(vault));
        handler = new BondHandler(bond, vault, arbitrator);
        targetContract(address(handler));
    }

    function invariant_claimIdentity() public view {
        address org = handler.organizer();
        uint256 stake = handler.stake();
        uint256 claims = handler.ghostClaims();
        assertEq(bond.claimedOf(org), claims, "sum of open claims");
        assertEq(bond.lockedOf(org), claims < stake ? claims : stake, "locked == min(stake, open claims)");
        assertEq(bond.openChallenges(org), handler.openCount());
        assertEq(address(bond).balance, stake + handler.ghostDepositsHeld(), "holdings");
        assertFalse(handler.overUnbond(), "unbond paid out claimed stake");
        assertFalse(handler.overSlash(), "slash above min(claim, stake)");
    }
}
