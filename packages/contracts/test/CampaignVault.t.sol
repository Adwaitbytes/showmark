// SPDX-License-Identifier: MIT
pragma solidity 0.8.38;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {CampaignVault} from "../src/CampaignVault.sol";
import {ICampaignVault} from "../src/interfaces/ICampaignVault.sol";
import {ProtocolFixture} from "./utils/ProtocolFixture.sol";
import {FeeOnTransferToken} from "./mocks/FeeOnTransferToken.sol";
import {MockAggregator} from "./mocks/MockAggregator.sol";
import {MockQieNameRegistry} from "./mocks/MockQieNameRegistry.sol";
import {RevertingQieIdCheck} from "./mocks/RevertingQieIdCheck.sol";

contract CampaignVaultTest is ProtocolFixture {
    // ---------------------------------------------------------------- constructor and fee

    function test_constructor_wiring() public view {
        assertEq(address(vault.registry()), address(registry));
        assertEq(address(vault.qieIdCheck()), address(qieIdCheck));
        assertEq(address(vault.oracle()), address(oracle));
        assertEq(address(vault.bond()), address(bond));
        assertEq(vault.maxOracleAge(), MAX_ORACLE_AGE);
        assertEq(vault.owner(), owner);
        assertEq(vault.feeRecipient(), feeRecipient);
        assertEq(vault.feeBps(), 0);
        assertEq(vault.MAX_FEE_BPS(), 500);
        assertEq(vault.SETTLE_GRACE(), 3 days);
    }

    /// Each deployment goes through an external call: in this forge version `new` in a test compiles to a
    /// deployCode cheatcode, and a reverting cheatcode would end the test at the first expected revert.
    function test_constructor_rejectsBadArgs() public {
        address r = address(registry);
        address z = address(qieIdCheck);
        address o = address(oracle);
        address b = address(bond);
        address badOracle = address(new MockAggregator(19));
        vm.expectRevert(ICampaignVault.ZeroAddress.selector);
        this.deployVault(address(0), z, o, b, 1, owner, feeRecipient, 0);
        vm.expectRevert(ICampaignVault.ZeroAddress.selector);
        this.deployVault(r, address(0), o, b, 1, owner, feeRecipient, 0);
        vm.expectRevert(ICampaignVault.ZeroAddress.selector);
        this.deployVault(r, z, address(0), b, 1, owner, feeRecipient, 0);
        vm.expectRevert(ICampaignVault.ZeroAddress.selector);
        this.deployVault(r, z, o, address(0), 1, owner, feeRecipient, 0);
        vm.expectRevert(ICampaignVault.ZeroAddress.selector);
        this.deployVault(r, z, o, b, 1, owner, address(0), 0);
        vm.expectRevert(ICampaignVault.InvalidOracleAge.selector);
        this.deployVault(r, z, o, b, 0, owner, feeRecipient, 0);
        vm.expectRevert(ICampaignVault.FeeTooHigh.selector);
        this.deployVault(r, z, o, b, 1, owner, feeRecipient, 501);
        vm.expectRevert(ICampaignVault.UnsupportedOracle.selector);
        this.deployVault(r, z, badOracle, b, 1, owner, feeRecipient, 0);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableInvalidOwner.selector, address(0)));
        this.deployVault(r, z, o, b, 1, address(0), feeRecipient, 0);
        // and the boundary values deploy
        CampaignVault ok = CampaignVault(this.deployVault(r, z, o, b, 1, owner, feeRecipient, 500));
        assertEq(ok.feeBps(), 500);
    }

    function deployVault(address r, address z, address o, address b, uint256 age, address own, address fees, uint16 bps)
        external
        returns (address)
    {
        return address(new CampaignVault(r, z, o, b, age, own, fees, bps));
    }

    function test_setFee() public {
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, address(this)));
        vault.setFee(100, feeRecipient);

        vm.startPrank(owner);
        vm.expectRevert(ICampaignVault.FeeTooHigh.selector);
        vault.setFee(501, feeRecipient);
        vm.expectRevert(ICampaignVault.ZeroAddress.selector);
        vault.setFee(100, address(0));

        vm.expectEmit(address(vault));
        emit ICampaignVault.FeeChanged(500, address(0xFEE));
        vault.setFee(500, address(0xFEE));
        vm.stopPrank();
        assertEq(vault.feeBps(), 500);
        assertEq(vault.feeRecipient(), address(0xFEE));
    }

    // ---------------------------------------------------------------- createCampaign

    function test_createCampaign_nativeStoresFundsAndEmits() public {
        ICampaignVault.CampaignParams memory p = _params(NATIVE);
        p.requireQieId = true;
        p.maxPerEvent = 3;
        p.maxTotal = 9;

        vm.expectEmit(address(vault));
        emit ICampaignVault.CampaignCreated(
            1, sponsor, NATIVE, 0, 1 ether, 5000, 1, true, T0 - 1 days, T0 + 7 days, 0, CAMPAIGN_META
        );
        vm.expectEmit(address(vault));
        emit ICampaignVault.CampaignFunded(1, sponsor, 10 ether);
        uint256 id = _create(p, 10 ether);

        assertEq(id, 1);
        assertEq(vault.campaignCount(), 1);
        ICampaignVault.Campaign memory c = vault.campaign(id);
        assertEq(c.sponsor, sponsor);
        assertEq(c.token, NATIVE);
        assertEq(uint8(c.pricing), 0);
        assertEq(c.amountPerPresence, 1 ether);
        assertEq(c.attendeeShareBps, 5000);
        assertEq(c.feeBps, 0);
        assertEq(c.minProofMode, 1);
        assertTrue(c.requireQieId);
        assertEq(c.startsAt, T0 - 1 days);
        assertEq(c.endsAt, T0 + 7 days);
        assertEq(c.maxPerEvent, 3);
        assertEq(c.maxTotal, 9);
        assertEq(c.balance, 10 ether);
        assertEq(vault.totalLiabilities(NATIVE), 10 ether);
        assertEq(address(vault).balance, 10 ether);
    }

    function test_createCampaign_snapshotsFee() public {
        vm.prank(owner);
        vault.setFee(250, feeRecipient);
        uint256 a = _create(_params(NATIVE), 0);
        vm.prank(owner);
        vault.setFee(0, feeRecipient);
        uint256 b = _create(_params(NATIVE), 0);
        assertEq(vault.campaign(a).feeBps, 250);
        assertEq(vault.campaign(b).feeBps, 0);
    }

    function test_createCampaign_nativeValueMustMatch() public {
        ICampaignVault.CampaignParams memory p = _params(NATIVE);
        vm.prank(sponsor);
        vm.expectRevert(ICampaignVault.BadDeposit.selector);
        vault.createCampaign{value: 1 ether}(p, 2 ether);
        vm.prank(sponsor);
        vm.expectRevert(ICampaignVault.BadDeposit.selector);
        vault.createCampaign{value: 1 ether}(p, 0);
    }

    function test_createCampaign_erc20CreditsDelta() public {
        uint256 id = _create(_params(address(qusdc)), 500e6);
        assertEq(vault.campaign(id).balance, 500e6);
        assertEq(qusdc.balanceOf(address(vault)), 500e6);
        assertEq(vault.totalLiabilities(address(qusdc)), 500e6);

        vm.prank(sponsor);
        vm.expectRevert(ICampaignVault.BadDeposit.selector);
        vault.createCampaign{value: 1}(_params(address(qusdc)), 1e6);
    }

    function test_createCampaign_feeOnTransferTokenCreditedByBalanceDelta() public {
        FeeOnTransferToken fot = new FeeOnTransferToken();
        fot.mint(sponsor, 1000e18);
        vm.prank(sponsor);
        fot.approve(address(vault), type(uint256).max);

        vm.expectEmit(address(vault));
        emit ICampaignVault.CampaignFunded(1, sponsor, 99e18);
        uint256 id = _create(_params(address(fot)), 100e18);
        assertEq(vault.campaign(id).balance, 99e18);
        assertEq(vault.totalLiabilities(address(fot)), 99e18);
        assertEq(fot.balanceOf(address(vault)), 99e18);
    }

    function test_createCampaign_zeroDepositEmitsNoFunding() public {
        vm.recordLogs();
        uint256 id = _create(_params(NATIVE), 0);
        assertEq(vm.getRecordedLogs().length, 1, "only CampaignCreated");
        assertEq(vault.campaign(id).balance, 0);
    }

    function test_createCampaign_rejectsInvalidParams() public {
        ICampaignVault.CampaignParams memory p;

        p = _params(NATIVE);
        p.amountPerPresence = 0;
        _expectInvalid(p);

        p = _params(NATIVE);
        p.attendeeShareBps = 10_001;
        _expectInvalid(p);

        p = _params(NATIVE);
        p.minProofMode = 0;
        _expectInvalid(p);
        p.minProofMode = 3;
        _expectInvalid(p);

        p = _params(NATIVE);
        p.endsAt = p.startsAt;
        _expectInvalid(p);

        p = _params(address(qusdc));
        p.pricing = ICampaignVault.Pricing.UsdInNative;
        _expectInvalid(p);

        p = _params(makeAddr("eoa-token"));
        _expectInvalid(p);

        p = _params(NATIVE);
        p.openToBonded = true;
        p.minBond = 0;
        _expectInvalid(p);

        p = _params(NATIVE);
        p.metadata = string(new bytes(2049));
        vm.prank(sponsor);
        vm.expectRevert(ICampaignVault.MetadataTooLong.selector);
        vault.createCampaign(p, 0);
    }

    function test_createCampaign_boundaryParamsAccepted() public {
        ICampaignVault.CampaignParams memory p = _params(NATIVE);
        p.attendeeShareBps = 10_000;
        p.minProofMode = 2;
        p.metadata = string(new bytes(2048));
        _create(p, 0);
        p.attendeeShareBps = 0;
        _create(p, 0);
    }

    function test_createCampaign_revertsWhenPaused() public {
        vm.prank(owner);
        vault.pause();
        ICampaignVault.CampaignParams memory p = _params(NATIVE);
        vm.prank(sponsor);
        vm.expectRevert(Pausable.EnforcedPause.selector);
        vault.createCampaign(p, 0);
    }

    // ---------------------------------------------------------------- topUp

    function test_topUp_byAnyone() public {
        uint256 id = _create(_params(NATIVE), 1 ether);
        address friend = makeAddr("friend");
        vm.deal(friend, 5 ether);

        vm.expectEmit(address(vault));
        emit ICampaignVault.CampaignFunded(id, friend, 5 ether);
        vm.prank(friend);
        vault.topUp{value: 5 ether}(id, 5 ether);
        assertEq(vault.campaign(id).balance, 6 ether);
        assertEq(vault.totalLiabilities(NATIVE), 6 ether);

        uint256 tid = _create(_params(address(qusdc)), 0);
        vm.prank(sponsor);
        vault.topUp(tid, 7e6);
        assertEq(vault.campaign(tid).balance, 7e6);
    }

    function test_topUp_guards() public {
        uint256 id = _create(_params(NATIVE), 0);

        vm.prank(sponsor);
        vm.expectRevert(ICampaignVault.UnknownCampaign.selector);
        vault.topUp{value: 1}(id + 1, 1);

        vm.prank(sponsor);
        vm.expectRevert(ICampaignVault.BadDeposit.selector);
        vault.topUp(id, 0);

        vm.prank(sponsor);
        vm.expectRevert(ICampaignVault.BadDeposit.selector);
        vault.topUp{value: 1}(id, 2);

        vm.warp(T0 + 7 days + 1);
        vm.prank(sponsor);
        vm.expectRevert(ICampaignVault.CampaignEnded.selector);
        vault.topUp{value: 1}(id, 1);
    }

    function test_topUp_revertsWhenPaused() public {
        uint256 id = _create(_params(NATIVE), 0);
        vm.prank(owner);
        vault.pause();
        vm.prank(sponsor);
        vm.expectRevert(Pausable.EnforcedPause.selector);
        vault.topUp{value: 1}(id, 1);
    }

    // ---------------------------------------------------------------- approvals and close

    function test_approveAndRevokeEvents() public {
        uint256 id = _create(_params(NATIVE), 0);
        uint256[] memory ids = new uint256[](1);
        ids[0] = eventId;

        vm.expectRevert(ICampaignVault.NotSponsor.selector);
        vault.approveEvents(id, ids);

        vm.expectEmit(address(vault));
        emit ICampaignVault.EventsApproved(id, ids);
        vm.prank(sponsor);
        vault.approveEvents(id, ids);
        assertTrue(vault.isApproved(id, eventId));

        vm.expectRevert(ICampaignVault.NotSponsor.selector);
        vault.revokeEvents(id, ids);

        vm.expectEmit(address(vault));
        emit ICampaignVault.EventsRevoked(id, ids);
        vm.prank(sponsor);
        vault.revokeEvents(id, ids);
        assertFalse(vault.isApproved(id, eventId));
    }

    function test_approveEvents_rejectsUnknownEventAndCampaign() public {
        uint256 id = _create(_params(NATIVE), 0);
        uint256[] memory ids = new uint256[](2);
        ids[0] = eventId;
        ids[1] = 404;
        vm.prank(sponsor);
        vm.expectRevert(abi.encodeWithSelector(ICampaignVault.UnknownEvent.selector, 404));
        vault.approveEvents(id, ids);

        vm.prank(sponsor);
        vm.expectRevert(ICampaignVault.UnknownCampaign.selector);
        vault.approveEvents(id + 1, ids);
    }

    function test_closeCampaign() public {
        uint256 id = _create(_params(NATIVE), 0);
        vm.expectRevert(ICampaignVault.NotSponsor.selector);
        vault.closeCampaign(id);

        vm.warp(T0 + 1 days);
        vm.expectEmit(address(vault));
        emit ICampaignVault.CampaignClosed(id, T0 + 1 days);
        vm.prank(sponsor);
        vault.closeCampaign(id);
        assertEq(vault.campaign(id).endsAt, T0 + 1 days);

        // closing again later never extends the end
        vm.warp(T0 + 2 days);
        vm.prank(sponsor);
        vault.closeCampaign(id);
        assertEq(vault.campaign(id).endsAt, T0 + 1 days);
    }

    // ---------------------------------------------------------------- settle: payouts

    function test_settle_tokenPricedNativeSplits() public {
        uint256 id = _createApproved(_params(NATIVE), 10 ether);
        _checkInNow(eventId, attendeePk);

        vm.expectEmit(address(vault));
        emit ICampaignVault.Settled(id, eventId, attendee, organizer, 1 ether, 0.5 ether, 0.5 ether, 0, 0);
        vm.prank(relayer);
        uint256 paid = vault.settle(id, eventId, attendee);

        assertEq(paid, 1 ether);
        assertTrue(vault.isSettled(id, eventId, attendee));
        assertEq(vault.claimable(NATIVE, attendee), 0.5 ether);
        assertEq(vault.claimable(NATIVE, organizer), 0.5 ether);
        assertEq(vault.campaign(id).balance, 9 ether);
        assertEq(vault.campaign(id).settledCount, 1);
        assertEq(vault.settledPerEvent(id, eventId), 1);
        assertEq(vault.totalLiabilities(NATIVE), 10 ether);
    }

    function test_settle_withFeeAndUnevenSplit() public {
        vm.prank(owner);
        vault.setFee(500, feeRecipient);
        ICampaignVault.CampaignParams memory p = _params(address(qusdc));
        p.amountPerPresence = 1_000_003;
        p.attendeeShareBps = 3333;
        uint256 id = _createApproved(p, 100e6);
        _checkInNow(eventId, attendeePk);
        vault.settle(id, eventId, attendee);

        uint256 fee = uint256(1_000_003) * 500 / 10_000; // 50_000
        uint256 net = 1_000_003 - fee;
        uint256 toAttendee = net * 3333 / 10_000;
        assertEq(vault.claimable(address(qusdc), feeRecipient), fee);
        assertEq(vault.claimable(address(qusdc), attendee), toAttendee);
        assertEq(vault.claimable(address(qusdc), organizer), net - toAttendee);
        assertEq(fee + toAttendee + (net - toAttendee), 1_000_003, "no dust lost");
    }

    function test_settle_usdPricedPaysAtOraclePrice() public {
        uint256 id = _createApproved(_usdParams(1e6), 100 ether);
        _checkInNow(eventId, attendeePk);

        (uint256 q, bool fresh) = vault.quote(id);
        assertTrue(fresh);
        assertEq(q, 6_060_606_060_606_060_606, "$1 at $0.165 is 6.0606e18 wei");

        vm.expectEmit(address(vault));
        emit ICampaignVault.Settled(id, eventId, attendee, organizer, q, q / 2, q - q / 2, 0, uint256(PRICE));
        assertEq(vault.settle(id, eventId, attendee), q);
    }

    function test_settle_openToBondedOrganizer() public {
        ICampaignVault.CampaignParams memory p = _params(NATIVE);
        p.openToBonded = true;
        p.minBond = 5 ether;
        uint256 id = _create(p, 10 ether);
        _checkInNow(eventId, attendeePk);

        vm.expectRevert(ICampaignVault.EventNotEligible.selector);
        vault.settle(id, eventId, attendee);

        vm.deal(organizer, 5 ether);
        vm.prank(organizer);
        bond.bond{value: 5 ether}();
        assertEq(vault.settle(id, eventId, attendee), 1 ether);
    }

    function test_settle_qieIdGate() public {
        ICampaignVault.CampaignParams memory p = _params(NATIVE);
        p.requireQieId = true;
        uint256 id = _createApproved(p, 10 ether);
        _checkInNow(eventId, attendeePk);

        // unlinked pass
        vm.expectRevert(ICampaignVault.NeedsQieId.selector);
        vault.settle(id, eventId, attendee);

        // linked, but the wallet holds no QIE ID
        uint64 deadline = T0 + 1 hours;
        (bytes memory ps, bytes memory ws) = _linkSigs(attendeePk, walletPk, attendee, wallet, deadline);
        registry.linkWallet(attendee, wallet, deadline, ps, ws, new uint256[](0));
        vm.expectRevert(ICampaignVault.NeedsQieId.selector);
        vault.settle(id, eventId, attendee);

        // the name registry is down: settlement defers instead of reverting with the registry's error
        names.setDomain(wallet, "attendee.qie");
        names.setMode(MockQieNameRegistry.Mode.Reverts);
        vm.expectRevert(ICampaignVault.NeedsQieId.selector);
        vault.settle(id, eventId, attendee);
        names.setMode(MockQieNameRegistry.Mode.Normal);

        assertEq(vault.settle(id, eventId, attendee), 1 ether);
    }

    // ---------------------------------------------------------------- settle: deferrals

    function test_settle_rejectsAlreadySettled() public {
        uint256 id = _createApproved(_params(NATIVE), 10 ether);
        _checkInNow(eventId, attendeePk);
        vault.settle(id, eventId, attendee);
        vm.expectRevert(ICampaignVault.AlreadySettled.selector);
        vault.settle(id, eventId, attendee);
        assertEq(vault.campaign(id).balance, 9 ether);
    }

    function test_settle_rejectsUnknownCampaign() public {
        vm.expectRevert(ICampaignVault.UnknownCampaign.selector);
        vault.settle(1, eventId, attendee);
    }

    function test_settle_rejectsAbsentOrWeakPresence() public {
        ICampaignVault.CampaignParams memory p = _params(NATIVE);
        p.minProofMode = 2;
        uint256 id = _createApproved(p, 10 ether);

        vm.expectRevert(ICampaignVault.NotPresent.selector);
        vault.settle(id, eventId, attendee);

        _checkInNow(eventId, attendeePk); // mode 1 only
        vm.expectRevert(ICampaignVault.NotPresent.selector);
        vault.settle(id, eventId, attendee);

        _checkIn(_mode2(eventId, 0xBEEF, doorPk, T0));
        assertEq(vault.settle(id, eventId, vm.addr(0xBEEF)), 1 ether);
    }

    function test_settle_rejectsPresenceOutsideCampaignWindow() public {
        ICampaignVault.CampaignParams memory p = _params(NATIVE);
        p.startsAt = T0 + 1;
        p.endsAt = T0 + 100;
        uint256 id = _createApproved(p, 10 ether);

        _checkInNow(eventId, attendeePk); // at T0, before startsAt
        vm.expectRevert(ICampaignVault.OutsideCampaignWindow.selector);
        vault.settle(id, eventId, attendee);

        vm.warp(T0 + 101);
        _checkInNow(eventId, 0xBEEF); // after endsAt
        vm.expectRevert(ICampaignVault.OutsideCampaignWindow.selector);
        vault.settle(id, eventId, vm.addr(0xBEEF));

        vm.warp(T0 + 50);
        _checkInNow(eventId, 0xCAFE);
        assertEq(vault.settle(id, eventId, vm.addr(0xCAFE)), 1 ether);
    }

    function test_settle_rejectsUnapprovedAndRevokedEvents() public {
        uint256 id = _create(_params(NATIVE), 10 ether);
        _checkInNow(eventId, attendeePk);
        _checkInNow(eventId, 0xBEEF);
        vm.expectRevert(ICampaignVault.EventNotEligible.selector);
        vault.settle(id, eventId, attendee);

        _approve(id, eventId);
        vault.settle(id, eventId, attendee);

        uint256[] memory ids = new uint256[](1);
        ids[0] = eventId;
        vm.prank(sponsor);
        vault.revokeEvents(id, ids);
        vm.expectRevert(ICampaignVault.EventNotEligible.selector);
        vault.settle(id, eventId, vm.addr(0xBEEF));
        assertEq(vault.claimable(NATIVE, attendee), 0.5 ether, "settled payouts stand");
    }

    function test_settle_caps() public {
        ICampaignVault.CampaignParams memory p = _params(NATIVE);
        p.maxPerEvent = 1;
        p.maxTotal = 2;
        uint256 id = _create(p, 10 ether);
        uint256 second = _createEvent(organizer, T0, T0 + EVENT_LENGTH, 0, 0);
        _authorize(organizer, second, doorKey, T0 + EVENT_LENGTH);
        uint256 third = _createEvent(organizer, T0, T0 + EVENT_LENGTH, 0, 0);
        _authorize(organizer, third, doorKey, T0 + EVENT_LENGTH);
        _approve(id, eventId);
        _approve(id, second);
        _approve(id, third);

        _checkInNow(eventId, attendeePk);
        _checkInNow(eventId, 0xBEEF);
        _checkInNow(second, attendeePk);
        _checkInNow(third, attendeePk);

        vault.settle(id, eventId, attendee);
        vm.expectRevert(ICampaignVault.EventCapReached.selector);
        vault.settle(id, eventId, vm.addr(0xBEEF));
        vault.settle(id, second, attendee);
        vm.expectRevert(ICampaignVault.TotalCapReached.selector);
        vault.settle(id, third, attendee);
    }

    function test_settle_insufficientBudget() public {
        uint256 id = _createApproved(_params(NATIVE), 1.5 ether);
        _checkInNow(eventId, attendeePk);
        _checkInNow(eventId, 0xBEEF);
        vault.settle(id, eventId, attendee);
        vm.expectRevert(ICampaignVault.InsufficientBudget.selector);
        vault.settle(id, eventId, vm.addr(0xBEEF));
        assertEq(vault.campaign(id).balance, 0.5 ether);
    }

    function test_settle_closesAfterGrace() public {
        uint256 id = _createApproved(_params(NATIVE), 10 ether);
        _checkInNow(eventId, attendeePk);
        vm.warp(T0 + 7 days + 3 days + 1);
        vm.expectRevert(ICampaignVault.SettlementClosed.selector);
        vault.settle(id, eventId, attendee);
    }

    function test_settle_lastSecondOfGraceStillPays() public {
        uint256 id = _createApproved(_params(NATIVE), 10 ether);
        _checkInNow(eventId, attendeePk);
        vm.warp(T0 + 7 days + 3 days);
        assertEq(vault.settle(id, eventId, attendee), 1 ether);
    }

    function test_settle_revertsWhenPaused() public {
        uint256 id = _createApproved(_params(NATIVE), 10 ether);
        _checkInNow(eventId, attendeePk);
        vm.prank(owner);
        vault.pause();
        vm.expectRevert(Pausable.EnforcedPause.selector);
        vault.settle(id, eventId, attendee);
        vm.prank(owner);
        vault.unpause();
        vault.settle(id, eventId, attendee);
    }

    // ---------------------------------------------------------------- oracle (invariant 10)

    function test_oracle_staleDefersSettlement() public {
        uint256 id = _createApproved(_usdParams(1e6), 100 ether);
        _checkInNow(eventId, attendeePk);

        oracle.setPrice(PRICE, block.timestamp - MAX_ORACLE_AGE - 1);
        _expectPriceStale(id);

        oracle.setPrice(PRICE, block.timestamp - MAX_ORACLE_AGE);
        assertGt(vault.settle(id, eventId, attendee), 0, "exactly maxOracleAge old is still fresh");
    }

    function test_oracle_nonPositiveDefers() public {
        uint256 id = _createApproved(_usdParams(1e6), 100 ether);
        _checkInNow(eventId, attendeePk);
        oracle.setPrice(0, block.timestamp);
        _expectPriceStale(id);
        oracle.setPrice(-1, block.timestamp);
        _expectPriceStale(id);
    }

    function test_oracle_incompleteRoundDefers() public {
        uint256 id = _createApproved(_usdParams(1e6), 100 ether);
        _checkInNow(eventId, attendeePk);
        oracle.setRound(10, PRICE, block.timestamp, 9);
        _expectPriceStale(id);
        oracle.setRound(10, PRICE, 0, 10);
        _expectPriceStale(id);
        oracle.setRound(10, PRICE, block.timestamp + 1, 10);
        _expectPriceStale(id);
    }

    function test_oracle_revertingFeedDefers() public {
        uint256 id = _createApproved(_usdParams(1e6), 100 ether);
        _checkInNow(eventId, attendeePk);
        oracle.setReverting(true);
        _expectPriceStale(id);
    }

    function test_oracle_quoteRoundingToZeroDefers() public {
        uint256 id = _createApproved(_usdParams(1), 100 ether);
        _checkInNow(eventId, attendeePk);
        oracle.setPrice(type(int256).max, block.timestamp);
        _expectPriceStale(id);
    }

    function test_oracle_recoversAfterFreshRound() public {
        uint256 id = _createApproved(_usdParams(2e6), 100 ether);
        _checkInNow(eventId, attendeePk);
        oracle.setReverting(true);
        _expectPriceStale(id);
        oracle.setReverting(false);
        oracle.setPrice(20_000_000, block.timestamp); // $0.20
        assertEq(vault.settle(id, eventId, attendee), 10 ether);
    }

    function test_quote() public {
        uint256 tid = _create(_params(address(qusdc)), 0);
        (uint256 amount, bool fresh) = vault.quote(tid);
        assertEq(amount, 10e6);
        assertTrue(fresh);

        uint256 uid = _create(_usdParams(33e6), 0);
        oracle.setPrice(33_000_000, block.timestamp);
        (amount, fresh) = vault.quote(uid);
        assertEq(amount, 100 ether);
        assertTrue(fresh);

        oracle.setPrice(33_000_000, block.timestamp - MAX_ORACLE_AGE - 1);
        (amount, fresh) = vault.quote(uid);
        assertEq(amount, 0);
        assertFalse(fresh);

        vm.expectRevert(ICampaignVault.UnknownCampaign.selector);
        vault.quote(99);
    }

    // ---------------------------------------------------------------- settleBatch

    function test_settleBatch_mixedStatusesNeverRevert() public {
        uint256 id = _createApproved(_params(NATIVE), 1 ether);
        uint256 usd = _createApproved(_usdParams(1e6), 100 ether);
        _checkInNow(eventId, attendeePk);
        _checkInNow(eventId, 0xBEEF);
        oracle.setReverting(true);

        ICampaignVault.SettleItem[] memory items = new ICampaignVault.SettleItem[](6);
        items[0] = ICampaignVault.SettleItem(id, eventId, attendee); // 0 settled
        items[1] = ICampaignVault.SettleItem(id, eventId, attendee); // 1 already
        items[2] = ICampaignVault.SettleItem(99, eventId, attendee); // 2 unknown
        items[3] = ICampaignVault.SettleItem(id, eventId, makeAddr("ghost")); // 3 not present
        items[4] = ICampaignVault.SettleItem(usd, eventId, attendee); // 9 stale
        items[5] = ICampaignVault.SettleItem(id, eventId, vm.addr(0xBEEF)); // 10 budget

        vm.expectEmit(address(vault));
        emit ICampaignVault.SettlementSkipped(id, eventId, attendee, 1);
        vm.prank(relayer);
        uint8[] memory s = vault.settleBatch(items);
        assertEq(s[0], 0);
        assertEq(s[1], 1);
        assertEq(s[2], 2);
        assertEq(s[3], 3);
        assertEq(s[4], 9);
        assertEq(s[5], 10);
    }

    function test_settleBatch_remainingCodes() public {
        ICampaignVault.CampaignParams memory p = _params(NATIVE);
        p.startsAt = T0 + 1;
        uint256 windowed = _createApproved(p, 10 ether);
        uint256 unapproved = _create(_params(NATIVE), 10 ether);
        p = _params(NATIVE);
        p.maxPerEvent = 1;
        uint256 perEvent = _createApproved(p, 10 ether);
        p = _params(NATIVE);
        p.maxTotal = 1;
        uint256 total = _createApproved(p, 10 ether);
        p = _params(NATIVE);
        p.requireQieId = true;
        uint256 gated = _createApproved(p, 10 ether);

        _checkInNow(eventId, attendeePk);
        _checkInNow(eventId, 0xBEEF);
        vault.settle(perEvent, eventId, attendee);
        vault.settle(total, eventId, attendee);

        ICampaignVault.SettleItem[] memory items = new ICampaignVault.SettleItem[](5);
        items[0] = ICampaignVault.SettleItem(windowed, eventId, attendee);
        items[1] = ICampaignVault.SettleItem(unapproved, eventId, attendee);
        items[2] = ICampaignVault.SettleItem(perEvent, eventId, vm.addr(0xBEEF));
        items[3] = ICampaignVault.SettleItem(total, eventId, vm.addr(0xBEEF));
        items[4] = ICampaignVault.SettleItem(gated, eventId, attendee);
        uint8[] memory s = vault.settleBatch(items);
        assertEq(s[0], 4);
        assertEq(s[1], 5);
        assertEq(s[2], 6);
        assertEq(s[3], 7);
        assertEq(s[4], 8);

        vm.warp(T0 + 10 days + 1);
        items = new ICampaignVault.SettleItem[](1);
        items[0] = ICampaignVault.SettleItem(unapproved, eventId, attendee);
        assertEq(vault.settleBatch(items)[0], 11);
    }

    function test_settleBatch_hostileNameRegistryDefersWithNeedsQieId() public {
        ICampaignVault.CampaignParams memory p = _params(NATIVE);
        p.requireQieId = true;
        uint256 gated = _createApproved(p, 10 ether);
        uint256 open = _createApproved(_params(NATIVE), 10 ether);
        _checkInNow(eventId, attendeePk);
        _linkWithQieId(attendeePk, walletPk);

        ICampaignVault.SettleItem[] memory items = new ICampaignVault.SettleItem[](2);
        items[0] = ICampaignVault.SettleItem(gated, eventId, attendee);
        items[1] = ICampaignVault.SettleItem(open, eventId, attendee);

        MockQieNameRegistry.Mode[4] memory hostile = [
            MockQieNameRegistry.Mode.Reverts,
            MockQieNameRegistry.Mode.GasBurner,
            MockQieNameRegistry.Mode.HugeLength,
            MockQieNameRegistry.Mode.TruncatedPayload
        ];
        for (uint256 i; i < hostile.length; ++i) {
            names.setMode(hostile[i]);
            uint8[] memory s = vault.settleBatch(items);
            assertEq(s[0], 8, "gated item defers");
            assertEq(s[1], i == 0 ? 0 : 1, "the rest of the batch still settles");
        }

        names.setMode(MockQieNameRegistry.Mode.Normal);
        assertEq(vault.settleBatch(items)[0], 0);
    }

    function test_settle_revertingQieIdCheckStillDefers() public {
        CampaignVault strict = new CampaignVault(
            address(registry),
            address(new RevertingQieIdCheck()),
            address(oracle),
            address(bond),
            MAX_ORACLE_AGE,
            owner,
            feeRecipient,
            0
        );
        ICampaignVault.CampaignParams memory p = _params(NATIVE);
        p.requireQieId = true;
        vm.prank(sponsor);
        uint256 id = strict.createCampaign{value: 1 ether}(p, 1 ether);
        uint256[] memory ids = new uint256[](1);
        ids[0] = eventId;
        vm.prank(sponsor);
        strict.approveEvents(id, ids);
        _checkInNow(eventId, attendeePk);
        _linkWithQieId(attendeePk, walletPk);

        vm.expectRevert(ICampaignVault.NeedsQieId.selector);
        strict.settle(id, eventId, attendee);
        ICampaignVault.SettleItem[] memory items = new ICampaignVault.SettleItem[](1);
        items[0] = ICampaignVault.SettleItem(id, eventId, attendee);
        assertEq(strict.settleBatch(items)[0], 8);
    }

    function test_settleBatch_pausedReturns12() public {
        uint256 id = _createApproved(_params(NATIVE), 10 ether);
        _checkInNow(eventId, attendeePk);
        vm.prank(owner);
        vault.pause();
        ICampaignVault.SettleItem[] memory items = new ICampaignVault.SettleItem[](1);
        items[0] = ICampaignVault.SettleItem(id, eventId, attendee);
        vm.expectEmit(address(vault));
        emit ICampaignVault.SettlementSkipped(id, eventId, attendee, 12);
        assertEq(vault.settleBatch(items)[0], 12);
        assertFalse(vault.isSettled(id, eventId, attendee));
    }

    // ---------------------------------------------------------------- refund (invariant 4)

    function test_refund_afterGraceReturnsUnspent() public {
        uint256 id = _createApproved(_params(NATIVE), 10 ether);
        _checkInNow(eventId, attendeePk);
        vault.settle(id, eventId, attendee);

        vm.warp(T0 + 7 days + 3 days);
        vm.prank(sponsor);
        vm.expectRevert(ICampaignVault.RefundNotYetAvailable.selector);
        vault.refund(id);

        vm.warp(T0 + 7 days + 3 days + 1);
        uint256 before = sponsor.balance;
        vm.expectEmit(address(vault));
        emit ICampaignVault.Refunded(id, sponsor, 9 ether);
        vm.prank(sponsor);
        vault.refund(id);
        assertEq(sponsor.balance - before, 9 ether);
        assertEq(vault.campaign(id).balance, 0);
        assertEq(vault.totalLiabilities(NATIVE), 1 ether, "claimables remain owed");

        vm.prank(sponsor);
        vm.expectRevert(ICampaignVault.NothingToPay.selector);
        vault.refund(id);
    }

    function test_refund_guards() public {
        uint256 id = _create(_params(NATIVE), 1 ether);
        vm.warp(T0 + 30 days);
        vm.expectRevert(ICampaignVault.NotSponsor.selector);
        vault.refund(id);
        vm.prank(sponsor);
        vm.expectRevert(ICampaignVault.UnknownCampaign.selector);
        vault.refund(id + 1);
    }

    function test_refund_worksWhilePausedAndForErc20() public {
        uint256 id = _create(_params(address(qusdc)), 50e6);
        vm.prank(owner);
        vault.pause();
        vm.warp(T0 + 30 days);
        uint256 before = qusdc.balanceOf(sponsor);
        vm.prank(sponsor);
        vault.refund(id);
        assertEq(qusdc.balanceOf(sponsor) - before, 50e6);
        assertEq(vault.totalLiabilities(address(qusdc)), 0);
    }

    function test_refund_afterEarlyClose() public {
        uint256 id = _create(_params(NATIVE), 2 ether);
        vm.prank(sponsor);
        vault.closeCampaign(id);
        vm.warp(T0 + 3 days + 1);
        vm.prank(sponsor);
        vault.refund(id);
        assertEq(vault.campaign(id).balance, 0);
    }

    // ---------------------------------------------------------------- withdraw (invariant 9)

    function test_withdraw_linkedPassPaysWalletAndAnyoneMayTrigger() public {
        uint256 id = _createApproved(_params(NATIVE), 10 ether);
        _checkInNow(eventId, attendeePk);
        vault.settle(id, eventId, attendee);
        uint64 deadline = T0 + 1 hours;
        (bytes memory ps, bytes memory ws) = _linkSigs(attendeePk, walletPk, attendee, wallet, deadline);
        registry.linkWallet(attendee, wallet, deadline, ps, ws, new uint256[](0));

        vm.expectEmit(address(vault));
        emit ICampaignVault.Withdrawn(NATIVE, attendee, wallet, 0.5 ether);
        vm.prank(relayer);
        vault.withdraw(NATIVE, attendee);
        assertEq(wallet.balance, 0.5 ether);
        assertEq(vault.claimable(NATIVE, attendee), 0);
        assertEq(vault.totalLiabilities(NATIVE), 9.5 ether);
    }

    function test_withdraw_unlinkedAccountMustCallItself() public {
        uint256 id = _createApproved(_params(NATIVE), 10 ether);
        _checkInNow(eventId, attendeePk);
        vault.settle(id, eventId, attendee);

        vm.prank(relayer);
        vm.expectRevert(ICampaignVault.WithdrawNotAllowed.selector);
        vault.withdraw(NATIVE, organizer);

        vm.prank(organizer);
        vault.withdraw(NATIVE, organizer);
        assertEq(organizer.balance, 0.5 ether);

        vm.prank(organizer);
        vm.expectRevert(ICampaignVault.NothingToPay.selector);
        vault.withdraw(NATIVE, organizer);
    }

    function test_withdraw_worksWhilePausedAndForErc20() public {
        uint256 id = _createApproved(_params(address(qusdc)), 100e6);
        _checkInNow(eventId, attendeePk);
        vault.settle(id, eventId, attendee);
        vm.prank(owner);
        vault.pause();

        vm.prank(organizer);
        vault.withdraw(address(qusdc), organizer);
        assertEq(qusdc.balanceOf(organizer), 5e6);
        vm.prank(attendee);
        vault.withdraw(address(qusdc), attendee);
        assertEq(qusdc.balanceOf(attendee), 5e6);
        assertEq(vault.totalLiabilities(address(qusdc)), 90e6);
    }

    function test_vaultRejectsPlainNativeTransfers() public {
        vm.deal(address(this), 1 ether);
        (bool ok,) = address(vault).call{value: 1 ether}("");
        assertFalse(ok);
    }

    function test_pause_onlyOwner() public {
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, address(this)));
        vault.pause();
        vm.prank(owner);
        vault.pause();
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, address(this)));
        vault.unpause();
    }

    // ---------------------------------------------------------------- fuzz

    /// Fee, attendee and organizer shares always sum to gross, and the fee respects the cap.
    function testFuzz_splitConservesGross(uint128 amount, uint16 feeBps, uint16 shareBps) public {
        amount = uint128(bound(amount, 1, 1e30));
        feeBps = uint16(bound(feeBps, 0, 500));
        shareBps = uint16(bound(shareBps, 0, 10_000));
        vm.prank(owner);
        vault.setFee(feeBps, feeRecipient);

        ICampaignVault.CampaignParams memory p = _params(address(qusdc));
        p.amountPerPresence = amount;
        p.attendeeShareBps = shareBps;
        qusdc.mint(sponsor, amount);
        uint256 id = _createApproved(p, amount);
        _checkInNow(eventId, attendeePk);
        vault.settle(id, eventId, attendee);

        uint256 fee = vault.claimable(address(qusdc), feeRecipient);
        uint256 a = vault.claimable(address(qusdc), attendee);
        uint256 o = vault.claimable(address(qusdc), organizer);
        assertEq(fee + a + o, amount);
        assertLe(fee * 10_000, uint256(amount) * 500);
        assertEq(vault.campaign(id).balance, 0);
    }

    /// USD pricing matches the closed form usd6 * 1e20 / price, rounded down, for any fresh positive price.
    function testFuzz_usdPricing(uint128 usd6, int256 price) public {
        usd6 = uint128(bound(usd6, 1, 1_000_000e6));
        price = bound(price, 1, 1e14);
        oracle.setPrice(price, block.timestamp);
        uint256 id = _create(_usdParams(usd6), 0);
        (uint256 amount, bool fresh) = vault.quote(id);
        uint256 expected = uint256(usd6) * 1e20 / uint256(price);
        assertEq(amount, expected == 0 ? 0 : expected);
        assertEq(fresh, expected != 0);
    }

    // ---------------------------------------------------------------- helpers

    function _expectInvalid(ICampaignVault.CampaignParams memory p) internal {
        vm.prank(sponsor);
        vm.expectRevert(ICampaignVault.InvalidParams.selector);
        vault.createCampaign(p, 0);
    }

    function _expectPriceStale(uint256 id) internal {
        vm.expectRevert(ICampaignVault.PriceStale.selector);
        vault.settle(id, eventId, attendee);
        (uint256 amount, bool fresh) = vault.quote(id);
        assertEq(amount, 0);
        assertFalse(fresh);
    }
}
