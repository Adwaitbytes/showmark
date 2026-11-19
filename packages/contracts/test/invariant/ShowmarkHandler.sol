// SPDX-License-Identifier: MIT
pragma solidity 0.8.38;

import {Test} from "forge-std/Test.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {ShowmarkRegistry} from "../../src/ShowmarkRegistry.sol";
import {CampaignVault} from "../../src/CampaignVault.sol";
import {OrganizerBond} from "../../src/OrganizerBond.sol";
import {IShowmarkRegistry} from "../../src/interfaces/IShowmarkRegistry.sol";
import {ICampaignVault} from "../../src/interfaces/ICampaignVault.sol";
import {MockQUSDC} from "../mocks/MockQUSDC.sol";
import {MockQieNameRegistry} from "../mocks/MockQieNameRegistry.sol";
import {MockAggregator} from "../mocks/MockAggregator.sol";
import {ReentrantReceiver} from "../mocks/ReentrantReceiver.sol";
import {SigUtils} from "../utils/SigUtils.sol";

/// @notice Drives the whole protocol with random but well-formed actions and keeps an independent ghost model of
/// the check-in rules, door-key authorizations, oracle freshness and payout maths. Each flag it raises is an
/// invariant violation the invariant test asserts against.
contract ShowmarkHandler is Test {
    struct Deployment {
        ShowmarkRegistry registry;
        CampaignVault vault;
        OrganizerBond bond;
        MockQUSDC qusdc;
        MockQieNameRegistry names;
        MockAggregator oracle;
        ReentrantReceiver attacker;
        address owner;
        address org;
        address sponsor;
        address feeRecipient;
    }

    uint256 internal constant DOOR_A = 0xA0A0; // authorized for every event until endsAt + 3 days
    uint256 internal constant DOOR_B = 0xB0B0; // never authorized
    uint256 internal constant DOOR_C = 0xC0C0; // authorized for the first event only, until its start + 1 hour
    uint256 internal constant SETTLE_GRACE = 3 days;
    uint256 internal constant MAX_FEE_BPS = 500;
    address internal constant NATIVE = address(0);

    ShowmarkRegistry public registry;
    CampaignVault public vault;
    OrganizerBond public bond;
    MockQUSDC public qusdc;
    MockQieNameRegistry public names;
    MockAggregator public oracle;
    ReentrantReceiver public attacker;
    address public owner;
    address public org;
    address public sponsor;
    address public feeRecipient;
    address public relayer = address(0x2E1A7E2);
    bytes32 internal separator;

    uint256[] public passPks;
    uint256[] public walletPks;
    uint256[] public eventIds;
    uint256[] public campaignIds;
    address[] public claimants;

    IShowmarkRegistry.CheckInData[] internal records;
    bool public doorCActive = true;

    // ghost state
    mapping(uint256 eventId => mapping(address pass => uint256)) public recordCount;
    mapping(uint256 eventId => uint256) public eventRecords;
    bool public validCheckInReverted;
    bool public unauthorizedRecorded;
    bool public invalidRecorded;
    bool public replayAccepted;
    bool public refundBlocked;
    bool public exitFailed;
    bool public stalePriceSettled;
    bool public mispriced;
    bool public feeOverCap;

    // coverage counters
    uint256 public validCheckIns;
    uint256 public rejectedCheckIns;
    uint256 public settlements;
    uint256 public priceDeferrals;
    uint256 public withdrawals;
    uint256 public pausedExits;
    uint256 public refunds;
    uint256 public challengesFiled;
    uint256 public bondedPayouts;
    uint256 public releases;
    bool public releasedWhileChallenged;
    uint256 public optIns;
    uint256 public challengesResolved;
    uint256 public unbondsCompleted;

    // bond ghosts: open claims and every deposit ever posted (none are claimed in the run)
    uint256[] internal openChallengeIds;
    uint256 public ghostOpenClaims;
    uint256 public ghostDeposits;
    bool public overUnbond;

    constructor(Deployment memory d, uint256[] memory events_) {
        registry = d.registry;
        vault = d.vault;
        bond = d.bond;
        qusdc = d.qusdc;
        names = d.names;
        oracle = d.oracle;
        attacker = d.attacker;
        owner = d.owner;
        org = d.org;
        sponsor = d.sponsor;
        feeRecipient = d.feeRecipient;
        separator = SigUtils.domainSeparator(block.chainid, address(registry));
        eventIds = events_;

        for (uint256 i = 1; i <= 6; ++i) {
            passPks.push(0x9A55_0000 + i);
        }
        for (uint256 i = 1; i <= 3; ++i) {
            walletPks.push(0x3A11_0000 + i);
        }
        for (uint256 i; i < passPks.length; ++i) {
            claimants.push(vm.addr(passPks[i]));
        }
        for (uint256 i; i < walletPks.length; ++i) {
            claimants.push(vm.addr(walletPks[i]));
        }
        claimants.push(org);
        claimants.push(address(attacker));
        claimants.push(feeRecipient);
        claimants.push(sponsor);

        vm.prank(sponsor);
        qusdc.approve(address(vault), type(uint256).max);

        // the organizer starts bonded so open campaigns can pay through its bond from the first call
        vm.deal(org, 5 ether);
        vm.prank(org);
        bond.bond{value: 5 ether}();
    }

    // ================================================================== registry actions

    function checkIn(uint256 passSeed, uint256 eventSeed, uint256 keySeed, uint256 timeSeed, bool attest, bool batch)
        external
    {
        uint256 passPk = passPks[passSeed % passPks.length];
        uint256 eventId = eventIds[eventSeed % eventIds.length];
        uint256 doorPk = [DOOR_A, DOOR_A, DOOR_B, DOOR_C][keySeed % 4];
        IShowmarkRegistry.EventInfo memory e = registry.eventInfo(eventId);

        // mode 2: mostly attested in the past, spanning both sides of the event window; mode 1: around now
        uint256 attestFrom = uint256(e.startsAt) - 2 hours;
        uint256 attestTo = Math.max(attestFrom + 1, Math.min(block.timestamp + 60, uint256(e.endsAt) + 2 hours));
        uint64 doorTime = attest
            ? uint64(bound(timeSeed, attestFrom, attestTo))
            : uint64(block.timestamp + 30 - bound(timeSeed, 0, 100));
        IShowmarkRegistry.CheckInData memory d = _sign(eventId, passPk, doorPk, attest ? 2 : 1, doorTime, separator);

        bool authorized = _authorized(eventId, doorPk, doorTime);
        bool valid = authorized && _validByRules(e, d);
        bool recorded = _submit(d, batch);

        if (valid && !recorded) validCheckInReverted = true;
        if (!valid && recorded) invalidRecorded = true;
        if (!authorized && recorded) unauthorizedRecorded = true;
        if (recorded) {
            recordCount[eventId][d.attendee] += 1;
            eventRecords[eventId] += 1;
            records.push(d);
            validCheckIns += 1;
        } else {
            rejectedCheckIns += 1;
        }
    }

    /// Resubmits a recorded check-in unchanged, retargeted at another event, signed for another chain or another
    /// verifying contract, with its door pass and ticket fields reused for a different attendee who signs for
    /// themselves (audit C-01), or with its attendee signature reused under the other proof mode (audit M-01).
    /// None of these may ever record a presence.
    function replay(uint256 recordSeed, uint256 eventSeed, uint256 kind, uint256 passSeed) external {
        if (records.length == 0) return;
        IShowmarkRegistry.CheckInData memory d = records[recordSeed % records.length];
        kind = kind % 6;
        if (kind == 4) {
            // a remote attacker harvests a door pass from calldata and signs for its own pass
            uint256 pk = passPks[passSeed % passPks.length];
            d.attendee = vm.addr(pk);
            d.attendeeSig = SigUtils.sign(pk, SigUtils.checkInDigest(separator, d.eventId, d.attendee, d.mode));
            if (passSeed % 2 == 0) {
                d.ticketSig = SigUtils.sign(pk, SigUtils.ticketDigest(separator, d.eventId, d.attendee));
            }
        } else if (kind == 5) {
            // a signature made for one mode (a public mode 2 code, say) submitted under the other mode with a door
            // proof that is valid for that mode
            uint256 pk = passPks[passSeed % passPks.length];
            uint256 eventId = eventIds[eventSeed % eventIds.length];
            uint8 signedMode = uint8(1 + recordSeed % 2);
            d = _sign(eventId, pk, DOOR_A, signedMode == 1 ? 2 : 1, uint64(block.timestamp), separator);
            d.attendeeSig = SigUtils.sign(pk, SigUtils.checkInDigest(separator, eventId, d.attendee, signedMode));
        } else if (kind == 1) {
            d.eventId = eventIds[eventSeed % eventIds.length];
        } else if (kind >= 2) {
            // a check-in that would be valid here, but signed under a foreign domain
            uint256 eventId = eventIds[eventSeed % eventIds.length];
            bytes32 foreign = kind == 2
                ? SigUtils.domainSeparator(block.chainid + 7, address(registry))
                : SigUtils.domainSeparator(block.chainid, address(vault));
            d = _sign(eventId, passPks[passSeed % passPks.length], DOOR_A, 1, uint64(block.timestamp), foreign);
        }
        if (registry.presenceOf(d.eventId, d.attendee).mode != 0 && kind != 0) return;
        if (_submit(d, kind % 2 == 1)) replayAccepted = true;
    }

    function link(uint256 passSeed, uint256 walletSeed, bool giveQieId) external {
        uint256 passPk = passPks[passSeed % passPks.length];
        uint256 walletPk = walletPks[walletSeed % walletPks.length];
        address pass = vm.addr(passPk);
        address wallet = vm.addr(walletPk);
        if (registry.walletOf(pass) != address(0) || registry.passOf(wallet) != address(0)) return;
        uint64 deadline = uint64(block.timestamp + 10 minutes);
        bytes32 digest = SigUtils.linkDigest(separator, pass, wallet, deadline);
        registry.linkWallet(
            pass, wallet, deadline, SigUtils.sign(passPk, digest), SigUtils.sign(walletPk, digest), eventIds
        );
        if (giveQieId) names.setDomain(wallet, "attendee.qie");
    }

    function toggleDoorC() external {
        uint256 first = eventIds[0];
        vm.startPrank(org);
        if (doorCActive) {
            registry.revokeDoorKey(first, vm.addr(DOOR_C));
        } else {
            registry.authorizeDoorKey(first, vm.addr(DOOR_C), registry.eventInfo(first).startsAt + 1 hours);
        }
        vm.stopPrank();
        doorCActive = !doorCActive;
    }

    // ================================================================== vault actions

    function createCampaign(uint256 seed, uint128 amount, uint96 deposit, bool usd, bool erc20, bool viaAttacker)
        external
    {
        if (vault.paused()) return;
        ICampaignVault.CampaignParams memory p;
        p.token = erc20 && !usd ? address(qusdc) : NATIVE;
        p.pricing = usd && !erc20 ? ICampaignVault.Pricing.UsdInNative : ICampaignVault.Pricing.Token;
        p.amountPerPresence = p.pricing == ICampaignVault.Pricing.UsdInNative
            ? uint128(bound(amount, 1, 2e6))
            : uint128(bound(amount, 1, p.token == NATIVE ? 5 ether : 50e6));
        // the fuzzer favours small seeds, so derive independent flags from a hash rather than from seed bits
        uint256 h = uint256(keccak256(abi.encode(seed)));
        p.attendeeShareBps = uint16(bound(seed, 0, 10_000));
        p.minProofMode = h % 4 == 0 ? 2 : 1;
        p.requireQieId = (h >> 8) % 4 == 0;
        p.startsAt = uint64(block.timestamp - 1 days);
        p.endsAt = uint64(block.timestamp + bound(h >> 16, 1 hours, 5 days));
        p.maxPerEvent = uint32((h >> 80) % 4);
        p.maxTotal = uint32((h >> 96) % 6);
        p.openToBonded = p.token == NATIVE && (h >> 112) % 3 == 0; // a QIE bond only backs native payouts
        p.minBond = p.openToBonded ? uint128(bound(h >> 128, 1, 1 ether)) : 0;
        if (p.openToBonded) {
            p.startsAt = 1; // covers every presence recorded so far, so bonded payouts are reachable
            if (p.pricing == ICampaignVault.Pricing.Token) {
                p.amountPerPresence = uint128(bound(p.amountPerPresence, 1, 0.5 ether)); // fits inside the bond
            }
        }
        p.metadata = "{}";
        uint256 dep = p.token == NATIVE ? bound(deposit, 0, 40 ether) : bound(deposit, 0, 400e6);

        uint256 id;
        if (viaAttacker && p.token == NATIVE) {
            vm.deal(address(this), address(this).balance + dep);
            bytes memory ret =
                attacker.exec{value: dep}(address(vault), abi.encodeCall(CampaignVault.createCampaign, (p, dep)));
            id = abi.decode(ret, (uint256));
        } else {
            if (p.token == NATIVE) vm.deal(sponsor, sponsor.balance + dep);
            else qusdc.mint(sponsor, dep);
            vm.prank(sponsor);
            id = vault.createCampaign{value: p.token == NATIVE ? dep : 0}(p, dep);
        }
        campaignIds.push(id);
        // open campaigns pay through the bond, so they are left unapproved and usually accepted by the organizer
        if (!p.openToBonded && (h >> 200) % 3 != 0) {
            _asSponsor(id, abi.encodeCall(CampaignVault.approveEvents, (id, eventIds)));
        }
        if (p.openToBonded && (h >> 210) % 3 != 0) {
            vm.prank(org);
            vault.optInOpenCampaign(id);
            optIns += 1;
        }
    }

    function topUp(uint256 campaignSeed, uint96 amount) external {
        if (campaignIds.length == 0 || vault.paused()) return;
        uint256 id = campaignIds[campaignSeed % campaignIds.length];
        ICampaignVault.Campaign memory c = vault.campaign(id);
        if (block.timestamp > c.endsAt) return;
        uint256 amt = c.token == NATIVE ? bound(amount, 1, 10 ether) : bound(amount, 1, 100e6);
        if (c.token == NATIVE) vm.deal(sponsor, sponsor.balance + amt);
        else qusdc.mint(sponsor, amt);
        vm.prank(sponsor);
        vault.topUp{value: c.token == NATIVE ? amt : 0}(id, amt);
    }

    function approve(uint256 campaignSeed, uint256 eventSeed) external {
        if (campaignIds.length == 0) return;
        uint256 id = campaignIds[campaignSeed % campaignIds.length];
        uint256[] memory ids = new uint256[](1);
        ids[0] = eventIds[eventSeed % eventIds.length];
        _asSponsor(id, abi.encodeCall(CampaignVault.approveEvents, (id, ids)));
    }

    function close(uint256 campaignSeed) external {
        if (campaignIds.length == 0) return;
        uint256 id = campaignIds[campaignSeed % campaignIds.length];
        _asSponsor(id, abi.encodeCall(CampaignVault.closeCampaign, (id)));
    }

    function settle(uint256 campaignSeed, uint256 recordSeed, uint256 passSeed, bool batch) external {
        if (campaignIds.length == 0) return;
        // prefer the newest campaigns and presences, which are the ones still inside their windows
        uint256 id = campaignIds[campaignIds.length - 1 - campaignSeed % Math.min(campaignIds.length, 3)];
        uint256 eventId = eventIds[recordSeed % eventIds.length];
        address pass = vm.addr(passPks[passSeed % passPks.length]);
        if (records.length != 0 && passSeed % 8 != 0) {
            IShowmarkRegistry.CheckInData storage r =
                records[records.length - 1 - recordSeed % Math.min(records.length, 6)];
            eventId = r.eventId;
            pass = r.attendee;
        }
        ICampaignVault.Campaign memory c = vault.campaign(id);
        (bool fresh, uint256 expectedUsdGross) = _oracleModel(c.amountPerPresence);
        uint256 feeBefore = vault.claimable(c.token, feeRecipient);
        uint256 exposureBefore = vault.bondedExposure(org);

        bool ok;
        vm.prank(relayer);
        if (batch) {
            ICampaignVault.SettleItem[] memory items = new ICampaignVault.SettleItem[](1);
            items[0] = ICampaignVault.SettleItem(id, eventId, pass);
            uint8 status = vault.settleBatch(items)[0];
            ok = status == 0;
            if (status == 9) priceDeferrals += 1;
        } else {
            try vault.settle(id, eventId, pass) {
                ok = true;
            } catch (bytes memory err) {
                if (bytes4(err) == ICampaignVault.PriceStale.selector) priceDeferrals += 1;
            }
        }
        if (!ok) return;

        settlements += 1;
        if (vault.bondedExposure(org) > exposureBefore) bondedPayouts += 1;
        uint256 gross = c.balance - vault.campaign(id).balance;
        if (c.pricing == ICampaignVault.Pricing.UsdInNative) {
            if (!fresh) stalePriceSettled = true;
            if (gross != expectedUsdGross) mispriced = true;
        } else if (gross != c.amountPerPresence) {
            mispriced = true;
        }
        uint256 fee = vault.claimable(c.token, feeRecipient) - feeBefore;
        if (fee * 10_000 > gross * MAX_FEE_BPS || fee * 10_000 > gross * c.feeBps) feeOverCap = true;
    }

    function withdraw(uint256 accountSeed, bool erc20) external {
        address token = erc20 ? address(qusdc) : NATIVE;
        address account;
        uint256 amount;
        for (uint256 k; k < claimants.length && amount == 0; ++k) {
            account = claimants[(accountSeed % claimants.length + k) % claimants.length];
            amount = vault.claimable(token, account);
        }
        if (amount == 0) return;
        address wallet = registry.walletOf(account);
        address to = wallet == address(0) ? account : wallet;
        uint256 before = token == NATIVE ? to.balance : qusdc.balanceOf(to);

        bool ok;
        if (account == address(attacker)) {
            attacker.arm(address(vault), abi.encodeCall(CampaignVault.withdraw, (token, account)));
            try attacker.exec(address(vault), abi.encodeCall(CampaignVault.withdraw, (token, account))) {
                ok = true;
            } catch {}
        } else {
            vm.prank(wallet == address(0) ? account : relayer);
            try vault.withdraw(token, account) {
                ok = true;
            } catch {}
        }

        uint256 received = (token == NATIVE ? to.balance : qusdc.balanceOf(to)) - before;
        if (!ok || received != amount) exitFailed = true;
        withdrawals += 1;
        if (vault.paused()) pausedExits += 1;
    }

    function refund(uint256 campaignSeed) external {
        if (campaignIds.length == 0) return;
        uint256 id = campaignIds[campaignSeed % campaignIds.length];
        ICampaignVault.Campaign memory c = vault.campaign(id);
        if (block.timestamp <= uint256(c.endsAt) + SETTLE_GRACE || c.balance == 0) return;
        if (!_tryRefund(id, c)) refundBlocked = true;
        refunds += 1;
        if (vault.paused()) pausedExits += 1;
    }

    // ================================================================== admin, oracle, bond, time

    /// Pauses a quarter of the time so settlement still gets long unpaused stretches.
    function setPaused(uint8 choice) external {
        bool paused_ = choice % 4 == 0;
        bool isPaused = vault.paused();
        if (paused_ == isPaused) return;
        vm.prank(owner);
        if (paused_) vault.pause();
        else vault.unpause();
    }

    function setFee(uint16 bps) external {
        bps = uint16(bound(bps, 0, 1000));
        vm.prank(owner);
        try vault.setFee(bps, feeRecipient) {} catch {}
        if (vault.feeBps() > MAX_FEE_BPS) feeOverCap = true;
    }

    /// 0 fresh, 1 stale, 2 zero, 3 negative, 4 incomplete round, 5 reverting
    function setOracle(uint256 state, uint256 priceSeed) external {
        state = state % 6;
        int256 price = int256(bound(priceSeed, 5_000_000, 100_000_000));
        oracle.setReverting(state == 5);
        if (state == 0) oracle.setPrice(price, block.timestamp);
        else if (state == 1) oracle.setPrice(price, block.timestamp - vault.maxOracleAge() - 1);
        else if (state == 2) oracle.setPrice(0, block.timestamp);
        else if (state == 3) oracle.setPrice(-price, block.timestamp);
        else if (state == 4) oracle.setRound(uint80(priceSeed % 1000 + 2), price, block.timestamp, 1);
    }

    /// The organizers accept (or leave) open campaigns, so bonded settlement keeps being exercised.
    function optIn(uint256 campaignSeed, bool viaAttacker, bool leave) external {
        if (campaignIds.length == 0) return;
        uint256 id = campaignIds[campaignSeed % campaignIds.length];
        if (!vault.campaign(id).openToBonded) return;
        bytes memory call = leave
            ? abi.encodeCall(CampaignVault.optOutOpenCampaign, (id))
            : abi.encodeCall(CampaignVault.optInOpenCampaign, (id));
        if (!leave) optIns += 1;
        if (viaAttacker) {
            attacker.exec(address(vault), call);
        } else {
            vm.prank(org);
            (bool ok,) = address(vault).call(call);
            require(ok, "opt-in");
        }
    }

    /// A campaign's sponsor challenges the organizer for what the bond backed in that campaign.
    function challengeOrg(uint256 campaignSeed) external {
        uint256 n = campaignIds.length;
        uint256 id;
        uint256 claim;
        for (uint256 k; k < n && claim == 0; ++k) {
            id = campaignIds[(campaignSeed % n + k) % n];
            if (!bond.hasOpenChallenge(id, org)) claim = vault.exposureOf(id, org);
        }
        if (claim == 0) return;
        ICampaignVault.Campaign memory c = vault.campaign(id);
        uint256 deposit = bond.challengeDeposit();
        bytes memory call = abi.encodeCall(OrganizerBond.challenge, (org, id, "handler"));
        bytes memory ret;
        if (c.sponsor == address(attacker)) {
            vm.deal(address(this), address(this).balance + deposit);
            ret = attacker.exec{value: deposit}(address(bond), call);
        } else {
            vm.deal(c.sponsor, c.sponsor.balance + deposit);
            vm.prank(c.sponsor);
            bool ok;
            (ok, ret) = address(bond).call{value: deposit}(call);
            require(ok, "challenge");
        }
        openChallengeIds.push(abi.decode(ret, (uint256)));
        ghostOpenClaims += claim;
        ghostDeposits += deposit;
        challengesFiled += 1;
    }

    /// Pays a presence at one of the organizer's events through the bond, from the newest accepted open campaign.
    function settleBonded(uint256 recordSeed) external {
        if (records.length == 0 || vault.paused()) return;
        uint256 id;
        for (uint256 k = campaignIds.length; k > 0; --k) {
            uint256 cand = campaignIds[k - 1];
            if (vault.optedIn(cand, org)) {
                id = cand;
                break;
            }
        }
        if (id == 0) return;
        for (uint256 k; k < records.length; ++k) {
            IShowmarkRegistry.CheckInData storage r = records[(recordSeed % records.length + k) % records.length];
            if (registry.eventInfo(r.eventId).organizer != org || vault.isSettled(id, r.eventId, r.attendee)) continue;
            uint256 before = vault.bondedExposure(org);
            ICampaignVault.SettleItem[] memory items = new ICampaignVault.SettleItem[](1);
            items[0] = ICampaignVault.SettleItem(id, r.eventId, r.attendee);
            if (vault.settleBatch(items)[0] == 0) {
                settlements += 1;
                if (vault.bondedExposure(org) > before) bondedPayouts += 1;
            }
            return;
        }
    }

    /// Anyone releases a finished campaign's exposure; it must never succeed while that campaign's challenge is open.
    function releaseOrgExposure(uint256 campaignSeed) external {
        uint256 n = campaignIds.length;
        for (uint256 k; k < n; ++k) {
            uint256 id = campaignIds[(campaignSeed % n + k) % n];
            if (vault.exposureOf(id, org) == 0) continue;
            bool open = bond.hasOpenChallenge(id, org);
            try vault.releaseExposure(id, org) {
                if (open) releasedWhileChallenged = true;
                releases += 1;
            } catch {}
            return;
        }
    }

    /// The Safe resolves an open challenge with any slash it is allowed: at most min(claim, current stake).
    function resolveChallenge(uint256 seed, uint256 slashSeed) external {
        if (openChallengeIds.length == 0) return;
        uint256 k = seed % openChallengeIds.length;
        uint256 id = openChallengeIds[k];
        uint256 claim = bond.challengeOf(id).claim;
        (uint256 pending,) = bond.pendingUnbond(org);
        uint256 stake = bond.bondOf(org) + pending;
        uint256 slash = bound(slashSeed, 0, Math.min(claim, stake));
        vm.prank(owner);
        bond.resolve(id, slash, slash == 0 ? address(0) : address(0x51A5));
        openChallengeIds[k] = openChallengeIds[openChallengeIds.length - 1];
        openChallengeIds.pop();
        ghostOpenClaims -= claim;
        challengesResolved += 1;
    }

    /// The organizer starts or completes an unbond; a completed unbond may never pay out stake open claims need.
    function unbondOrg(uint256 amountSeed, bool complete) external {
        uint256 bonded = bond.bondOf(org);
        (uint256 pending, uint64 availableAt) = bond.pendingUnbond(org);
        if (!complete) {
            if (bonded == 0) return;
            vm.prank(org);
            bond.requestUnbond(bound(amountSeed, 1, bonded));
            return;
        }
        if (pending == 0 || block.timestamp < availableAt) return;
        uint256 stake = bonded + pending;
        uint256 free = stake - Math.min(stake, ghostOpenClaims);
        uint256 before = org.balance;
        vm.prank(org);
        try bond.completeUnbond() {
            unbondsCompleted += 1;
            if (org.balance - before > free) overUnbond = true;
        } catch {}
    }

    function openChallengeCount() external view returns (uint256) {
        return openChallengeIds.length;
    }

    function bondOrganizer(uint96 amount) external {
        uint256 amt = bound(amount, 1, 5 ether);
        vm.deal(org, org.balance + amt);
        vm.prank(org);
        bond.bond{value: amt}();
    }

    function warp(uint256 dt) external {
        vm.warp(block.timestamp + bound(dt, 0, 8 hours));
    }

    /// Jumps just past one campaign's refund point, so refunds happen inside runs and not only in invariant 4.
    function warpPastGrace(uint256 campaignSeed) external {
        if (campaignIds.length == 0 || campaignSeed % 4 != 0) return;
        uint256 due = uint256(vault.campaign(campaignIds[campaignSeed % campaignIds.length]).endsAt) + SETTLE_GRACE + 1;
        if (due > block.timestamp) vm.warp(due);
    }

    // ================================================================== views for the invariant test

    function campaignCount() external view returns (uint256) {
        return campaignIds.length;
    }

    function claimantCount() external view returns (uint256) {
        return claimants.length;
    }

    function passCount() external view returns (uint256) {
        return passPks.length;
    }

    function passAt(uint256 i) external view returns (address) {
        return vm.addr(passPks[i]);
    }

    function walletAt(uint256 i) external view returns (address) {
        return vm.addr(walletPks[i]);
    }

    function eventCount() external view returns (uint256) {
        return eventIds.length;
    }

    function refundSucceeds(uint256 id) external returns (bool) {
        return _tryRefund(id, vault.campaign(id));
    }

    // ================================================================== internals

    function _tryRefund(uint256 id, ICampaignVault.Campaign memory c) internal returns (bool) {
        uint256 before = c.sponsor.balance;
        if (c.token != NATIVE) before = qusdc.balanceOf(c.sponsor);
        bool ok;
        if (c.sponsor == address(attacker)) {
            attacker.arm(address(vault), abi.encodeCall(CampaignVault.refund, (id)));
            try attacker.exec(address(vault), abi.encodeCall(CampaignVault.refund, (id))) {
                ok = true;
            } catch {}
        } else {
            vm.prank(c.sponsor);
            try vault.refund(id) {
                ok = true;
            } catch {}
        }
        uint256 afterBal = c.token == NATIVE ? c.sponsor.balance : qusdc.balanceOf(c.sponsor);
        return ok && afterBal - before == c.balance;
    }

    function _asSponsor(uint256 id, bytes memory call) internal {
        address s = vault.campaign(id).sponsor;
        if (s == address(attacker)) {
            try attacker.exec(address(vault), call) {} catch {}
        } else {
            vm.prank(s);
            (bool ok,) = address(vault).call(call);
            ok;
        }
    }

    function _submit(IShowmarkRegistry.CheckInData memory d, bool batch) internal returns (bool recorded) {
        vm.prank(relayer);
        if (batch) {
            IShowmarkRegistry.CheckInData[] memory ds = new IShowmarkRegistry.CheckInData[](1);
            ds[0] = d;
            recorded = registry.checkInBatch(ds)[0] == 0;
        } else {
            try registry.checkIn(d) returns (bool r) {
                recorded = r;
            } catch {}
        }
    }

    function _sign(uint256 eventId, uint256 passPk, uint256 doorPk, uint8 mode, uint64 doorTime, bytes32 domain)
        internal
        pure
        returns (IShowmarkRegistry.CheckInData memory d)
    {
        address pass = vm.addr(passPk);
        d.eventId = eventId;
        d.attendee = pass;
        d.mode = mode;
        d.doorTime = doorTime;
        d.attendeeSig = SigUtils.sign(passPk, SigUtils.checkInDigest(domain, eventId, pass, mode));
        if (mode == 1) {
            // the door rotation's throwaway ticket key, known only to whoever sees the QR
            uint256 tPk = SigUtils.ticketPk(doorPk, doorTime);
            d.ticket = vm.addr(tPk);
            d.doorSig = SigUtils.sign(doorPk, SigUtils.doorPassDigest(domain, eventId, doorTime, d.ticket));
            d.ticketSig = SigUtils.sign(tPk, SigUtils.ticketDigest(domain, eventId, pass));
        } else {
            d.doorSig = SigUtils.sign(doorPk, SigUtils.doorAttestDigest(domain, eventId, pass, doorTime));
        }
    }

    /// Independent statement of who may attest: door A everywhere until endsAt + 3 days, door C only at the first
    /// event until its start + 1 hour and only while not revoked, door B never.
    function _authorized(uint256 eventId, uint256 doorPk, uint64 doorTime) internal view returns (bool) {
        IShowmarkRegistry.EventInfo memory e = registry.eventInfo(eventId);
        if (doorPk == DOOR_A) return doorTime <= uint256(e.endsAt) + 3 days;
        if (doorPk == DOOR_C) {
            return doorCActive && eventId == eventIds[0] && doorTime <= uint256(e.startsAt) + 1 hours;
        }
        return false;
    }

    /// Independent statement of docs/INTERFACES.md 2.1 and 2.3 for an authorized door key.
    function _validByRules(IShowmarkRegistry.EventInfo memory e, IShowmarkRegistry.CheckInData memory d)
        internal
        view
        returns (bool)
    {
        uint256 nowTs = block.timestamp;
        if (recordCount[d.eventId][d.attendee] != 0) return false;
        if (e.capacity != 0 && eventRecords[d.eventId] >= e.capacity) return false;
        if (d.doorTime > nowTs + 30) return false;
        uint256 t = d.mode == 1 ? nowTs : d.doorTime;
        if (t + 1 hours < e.startsAt || t > uint256(e.endsAt) + 1 hours) return false;
        if (d.mode == 1) return nowTs <= uint256(d.doorTime) + e.maxPassAge;
        return nowTs <= uint256(e.endsAt) + 3 days;
    }

    /// Independent oracle freshness check and expected wei for a USD amount.
    function _oracleModel(uint256 usd6) internal view returns (bool fresh, uint256 expected) {
        if (oracle.reverting()) return (false, 0);
        int256 answer = oracle.answer();
        uint256 updatedAt = oracle.updatedAt();
        fresh = answer > 0 && updatedAt != 0 && updatedAt <= block.timestamp
            && block.timestamp - updatedAt <= vault.maxOracleAge() && oracle.answeredInRound() >= oracle.roundId();
        if (fresh) expected = usd6 * 1e20 / uint256(answer);
    }

    receive() external payable {}
}
