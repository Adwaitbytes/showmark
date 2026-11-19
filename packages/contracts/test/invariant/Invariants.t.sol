// SPDX-License-Identifier: MIT
pragma solidity 0.8.38;

import {Test, console2} from "forge-std/Test.sol";
import {ShowmarkRegistry} from "../../src/ShowmarkRegistry.sol";
import {PresenceStamp} from "../../src/PresenceStamp.sol";
import {CampaignVault} from "../../src/CampaignVault.sol";
import {OrganizerBond} from "../../src/OrganizerBond.sol";
import {ICampaignVault} from "../../src/interfaces/ICampaignVault.sol";
import {MockQUSDC} from "../mocks/MockQUSDC.sol";
import {MockQieNameRegistry} from "../mocks/MockQieNameRegistry.sol";
import {QieIdCheck} from "../../src/QieIdCheck.sol";
import {MockAggregator} from "../mocks/MockAggregator.sol";
import {ReentrantReceiver} from "../mocks/ReentrantReceiver.sol";
import {ShowmarkHandler} from "./ShowmarkHandler.sol";

/// @notice The ten protocol invariants of docs/INTERFACES.md 2.8, checked after every handler call.
contract InvariantsTest is Test {
    uint64 internal constant T0 = 1_790_000_000;
    address internal constant NATIVE = address(0);

    ShowmarkHandler internal handler;
    ShowmarkRegistry internal registry;
    PresenceStamp internal stamp;
    CampaignVault internal vault;
    OrganizerBond internal bond;
    MockQUSDC internal qusdc;
    ReentrantReceiver internal attacker;
    address internal owner = makeAddr("owner");

    bytes32 internal registryCode;
    bytes32 internal vaultCode;
    bytes32 internal bondCode;
    bytes32 internal stampCode;

    function setUp() public {
        vm.warp(T0);
        address org = makeAddr("org");
        registry = new ShowmarkRegistry(owner, "ipfs://stamps/");
        stamp = PresenceStamp(registry.stamp());
        qusdc = new MockQUSDC();
        MockQieNameRegistry names = new MockQieNameRegistry();
        MockAggregator oracle = new MockAggregator(8);
        oracle.setPrice(16_500_000, block.timestamp);
        bond = new OrganizerBond(owner, 0.1 ether);
        vault = new CampaignVault(
            address(registry),
            address(new QieIdCheck(address(names))),
            address(oracle),
            address(bond),
            36 hours,
            owner,
            makeAddr("fees"),
            100
        );
        vm.prank(owner);
        bond.setVault(address(vault));
        attacker = new ReentrantReceiver();

        uint256[] memory events = new uint256[](3);
        vm.startPrank(org);
        events[0] = registry.createEvent(T0 - 1 hours, T0 + 5 days, 0, 60, 0, "{}");
        uint64 series = registry.createSeries("{}");
        events[1] = registry.createEvent(T0 + 12 hours, T0 + 8 days, 0, 60, series, "{}");
        vm.stopPrank();
        bytes memory ret = attacker.exec(
            address(registry), abi.encodeCall(ShowmarkRegistry.createEvent, (T0, T0 + 6 days, 4, 120, 0, "{}"))
        );
        events[2] = abi.decode(ret, (uint256));

        address doorA = vm.addr(0xA0A0);
        for (uint256 i; i < events.length; ++i) {
            uint64 limit = registry.eventInfo(events[i]).endsAt + 3 days;
            bytes memory auth = abi.encodeCall(ShowmarkRegistry.authorizeDoorKey, (events[i], doorA, limit));
            if (i == 2) {
                attacker.exec(address(registry), auth);
            } else {
                vm.prank(org);
                (bool ok,) = address(registry).call(auth);
                require(ok, "authorize");
            }
        }
        vm.prank(org);
        registry.authorizeDoorKey(events[0], vm.addr(0xC0C0), T0 - 1 hours + 1 hours);

        handler = new ShowmarkHandler(
            ShowmarkHandler.Deployment({
                registry: registry,
                vault: vault,
                bond: bond,
                qusdc: qusdc,
                names: names,
                oracle: oracle,
                attacker: attacker,
                owner: owner,
                org: org,
                sponsor: makeAddr("sponsor"),
                feeRecipient: makeAddr("fees")
            }),
            events
        );
        vm.deal(address(handler), 1_000_000 ether);

        registryCode = address(registry).codehash;
        vaultCode = address(vault).codehash;
        bondCode = address(bond).codehash;
        stampCode = address(stamp).codehash;

        bytes4[] memory selectors = new bytes4[](34);
        selectors[30] = ShowmarkHandler.settleBonded.selector;
        selectors[31] = ShowmarkHandler.settleBonded.selector;
        selectors[32] = ShowmarkHandler.challengeOrg.selector;
        selectors[33] = ShowmarkHandler.challengeOrg.selector;
        selectors[27] = ShowmarkHandler.releaseOrgExposure.selector;
        selectors[28] = ShowmarkHandler.bondOrganizer.selector;
        selectors[29] = ShowmarkHandler.settleBonded.selector;
        selectors[25] = ShowmarkHandler.settleBonded.selector;
        selectors[26] = ShowmarkHandler.challengeOrg.selector;
        selectors[21] = ShowmarkHandler.optIn.selector;
        selectors[22] = ShowmarkHandler.challengeOrg.selector;
        selectors[23] = ShowmarkHandler.resolveChallenge.selector;
        selectors[24] = ShowmarkHandler.unbondOrg.selector;
        selectors[20] = ShowmarkHandler.warpPastGrace.selector;
        selectors[0] = ShowmarkHandler.checkIn.selector;
        selectors[1] = ShowmarkHandler.checkIn.selector; // weighted: check-ins and settlement are the hot paths
        selectors[17] = ShowmarkHandler.checkIn.selector;
        selectors[18] = ShowmarkHandler.settle.selector;
        selectors[19] = ShowmarkHandler.settle.selector;
        selectors[2] = ShowmarkHandler.replay.selector;
        selectors[3] = ShowmarkHandler.link.selector;
        selectors[4] = ShowmarkHandler.toggleDoorC.selector;
        selectors[5] = ShowmarkHandler.createCampaign.selector;
        selectors[6] = ShowmarkHandler.topUp.selector;
        selectors[7] = ShowmarkHandler.approve.selector;
        selectors[8] = ShowmarkHandler.close.selector;
        selectors[9] = ShowmarkHandler.settle.selector;
        selectors[10] = ShowmarkHandler.withdraw.selector;
        selectors[11] = ShowmarkHandler.refund.selector;
        selectors[12] = ShowmarkHandler.setPaused.selector;
        selectors[13] = ShowmarkHandler.setFee.selector;
        selectors[14] = ShowmarkHandler.setOracle.selector;
        selectors[15] = ShowmarkHandler.warp.selector;
        selectors[16] = ShowmarkHandler.bondOrganizer.selector;
        targetSelector(FuzzSelector({addr: address(handler), selectors: selectors}));
        targetContract(address(handler));
    }

    /// 1. Presence is recorded at most once per (event, attendee), and the stamp supply matches.
    function invariant_1_presenceAtMostOnce() public view {
        for (uint256 e; e < handler.eventCount(); ++e) {
            uint256 eventId = handler.eventIds(e);
            uint256 sum;
            uint256 stamps;
            for (uint256 i; i < handler.passCount(); ++i) {
                address pass = handler.passAt(i);
                uint256 n = handler.recordCount(eventId, pass);
                assertLe(n, 1, "presence recorded twice");
                assertEq(registry.presenceOf(eventId, pass).mode != 0, n == 1, "presence vs ghost");
                stamps += stamp.balanceOf(pass, eventId);
                sum += n;
            }
            for (uint256 i; i < 3; ++i) {
                stamps += stamp.balanceOf(handler.walletAt(i), eventId);
            }
            assertEq(registry.eventInfo(eventId).checkedIn, sum, "checkedIn vs ghost");
            assertEq(stamps, sum, "one stamp per presence");
        }
    }

    /// 2. No vault state makes a valid check-in fail, and the registry never records an invalid one.
    function invariant_2_checkInIndependentOfVault() public view {
        assertFalse(handler.validCheckInReverted(), "valid check-in rejected");
        assertFalse(handler.invalidRecorded(), "invalid check-in recorded");
    }

    /// 3. Solvency per token: held >= liabilities == sum(campaign balances) + sum(claimables).
    function invariant_3_solvency() public view {
        _assertSolvent(NATIVE, address(vault).balance);
        _assertSolvent(address(qusdc), qusdc.balanceOf(address(vault)));
    }

    /// 4. A sponsor can always refund after endsAt + SETTLE_GRACE, including while paused.
    function invariant_4_refundAlwaysAvailable() public {
        for (uint256 i; i < handler.campaignCount(); ++i) {
            uint256 id = handler.campaignIds(i);
            ICampaignVault.Campaign memory c = vault.campaign(id);
            if (c.balance == 0) continue;
            uint256 snap = vm.snapshotState();
            uint256 due = uint256(c.endsAt) + vault.SETTLE_GRACE() + 1;
            if (block.timestamp < due) vm.warp(due);
            if (!vault.paused()) {
                vm.prank(owner);
                vault.pause();
            }
            assertTrue(handler.refundSucceeds(id), "refund blocked");
            vm.revertToState(snap);
        }
        assertFalse(handler.refundBlocked(), "refund blocked in a run");
    }

    /// 5. Only a door key authorized by the event's organizer, inside its validity window, can attest.
    function invariant_5_onlyAuthorizedDoorKeys() public view {
        assertFalse(handler.unauthorizedRecorded(), "unauthorized door key recorded a presence");
    }

    /// 6. Signatures do not replay across events, contracts or chains, nor twice for the same event.
    function invariant_6_noReplay() public view {
        assertFalse(handler.replayAccepted(), "replayed signature accepted");
    }

    /// 7. The fee never exceeds MAX_FEE_BPS, globally, per campaign or per payout.
    function invariant_7_feeCapped() public view {
        assertLe(vault.feeBps(), vault.MAX_FEE_BPS());
        for (uint256 i; i < handler.campaignCount(); ++i) {
            assertLe(vault.campaign(handler.campaignIds(i)).feeBps, vault.MAX_FEE_BPS());
        }
        assertFalse(handler.feeOverCap(), "payout fee above cap");
    }

    /// 8. A malicious native receiver cannot re-enter, drain or double-claim.
    function invariant_8_reentrancy() public view {
        assertEq(attacker.reentrySuccesses(), 0, "re-entry succeeded");
        assertFalse(handler.exitFailed(), "withdrawal paid wrong amount or failed");
        _assertSolvent(NATIVE, address(vault).balance);
    }

    /// 9. No upgradeability (code never changes), and pause never blocks withdraw.
    function invariant_9_immutableAndExitsNeverPaused() public {
        assertEq(address(registry).codehash, registryCode);
        assertEq(address(vault).codehash, vaultCode);
        assertEq(address(bond).codehash, bondCode);
        assertEq(address(stamp).codehash, stampCode);

        for (uint256 i; i < handler.claimantCount(); ++i) {
            address account = handler.claimants(i);
            if (vault.claimable(NATIVE, account) == 0) continue;
            uint256 snap = vm.snapshotState();
            if (!vault.paused()) {
                vm.prank(owner);
                vault.pause();
            }
            handler.withdraw(i, false);
            assertFalse(handler.exitFailed(), "withdraw blocked while paused");
            vm.revertToState(snap);
        }
    }

    /// 10. A stale or non-positive oracle price defers settlement and never misprices.
    function invariant_10_oracleNeverMisprices() public view {
        assertFalse(handler.stalePriceSettled(), "settled on a stale price");
        assertFalse(handler.mispriced(), "gross differs from the oracle quote");
    }

    /// Bond holdings stay equal to bonded plus pending.
    /// Bond holdings equal stake plus every deposit posted, open claims match the ghost sum, the unbond lock is
    /// min(stake, sum of open claims), and no completed unbond ever paid out stake those claims needed.
    function invariant_bondClaims() public view {
        address org = handler.org();
        (uint256 pending,) = bond.pendingUnbond(org);
        uint256 stake = bond.bondOf(org) + pending;
        assertEq(address(bond).balance, stake + handler.ghostDeposits(), "bond holdings");
        assertEq(bond.claimedOf(org), handler.ghostOpenClaims(), "open claims");
        uint256 claims = handler.ghostOpenClaims();
        assertEq(bond.lockedOf(org), claims < stake ? claims : stake, "locked == min(stake, open claims)");
        assertEq(bond.openChallenges(org), handler.openChallengeCount());
        assertFalse(handler.overUnbond(), "unbond paid out claimed stake");
        assertFalse(handler.releasedWhileChallenged(), "exposure released while its challenge was open");
    }

    /// Adds this run's activity to running totals kept in process env vars (test-only instrumentation) and logs
    /// them, so `-vv` shows across all runs that the invariants were checked against real traffic.
    function afterInvariant() external {
        assertGt(handler.validCheckIns() + handler.rejectedCheckIns(), 0);
        string memory line = "ACC";
        line = _acc(line, "validCheckIns", handler.validCheckIns());
        line = _acc(line, "rejectedCheckIns", handler.rejectedCheckIns());
        line = _acc(line, "settled", handler.settlements());
        line = _acc(line, "priceDeferred", handler.priceDeferrals());
        line = _acc(line, "withdrawals", handler.withdrawals());
        line = _acc(line, "refunds", handler.refunds());
        line = _acc(line, "exitsWhilePaused", handler.pausedExits());
        line = _acc(line, "optIns", handler.optIns());
        line = _acc(line, "bondedPayouts", handler.bondedPayouts());
        line = _acc(line, "challenges", handler.challengesFiled());
        line = _acc(line, "releases", handler.releases());
        line = _acc(line, "resolutions", handler.challengesResolved());
        line = _acc(line, "unbonds", handler.unbondsCompleted());
        console2.log(line);
    }

    function _acc(string memory line, string memory key, uint256 value) internal returns (string memory) {
        string memory env = string.concat("SHOWMARK_INV_", key);
        uint256 total = vm.envOr(env, uint256(0)) + value;
        vm.setEnv(env, vm.toString(total));
        return string.concat(line, " ", key, "=", vm.toString(total));
    }

    function _assertSolvent(address token, uint256 held) internal view {
        uint256 sum;
        for (uint256 i; i < handler.campaignCount(); ++i) {
            ICampaignVault.Campaign memory c = vault.campaign(handler.campaignIds(i));
            if (c.token == token) sum += c.balance;
        }
        for (uint256 i; i < handler.claimantCount(); ++i) {
            sum += vault.claimable(token, handler.claimants(i));
        }
        assertEq(vault.totalLiabilities(token), sum, "liabilities != balances + claimables");
        assertGe(held, vault.totalLiabilities(token), "insolvent");
    }
}
