// SPDX-License-Identifier: MIT
pragma solidity 0.8.38;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {IShowmarkRegistry} from "../src/interfaces/IShowmarkRegistry.sol";
import {ShowmarkRegistry} from "../src/ShowmarkRegistry.sol";
import {RegistryFixture} from "./utils/RegistryFixture.sol";
import {SigUtils} from "./utils/SigUtils.sol";
import {MockERC1271Wallet} from "./mocks/MockERC1271Wallet.sol";
import {Ownable2StepNoRenounce} from "../src/utils/Ownable2StepNoRenounce.sol";

contract ShowmarkRegistryTest is RegistryFixture {
    // ---------------------------------------------------------------- deployment

    function test_constructor_wiresOwnerStampAndIds() public view {
        assertEq(registry.owner(), owner);
        assertEq(stamp.registry(), address(registry));
        assertEq(stamp.owner(), owner);
        assertEq(registry.nextEventId(), 2, "fixture created event 1");
        assertEq(eventId, 1);
    }

    function test_domainSeparator_matchesSpec() public view {
        (, string memory name, string memory version, uint256 chainId, address verifying,,) = registry.eip712Domain();
        assertEq(name, "Showmark");
        assertEq(version, "1");
        assertEq(chainId, block.chainid);
        assertEq(verifying, address(registry));
        assertEq(registry.domainSeparator(), separator);
    }

    function test_constructor_revertsOnZeroOwner() public {
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableInvalidOwner.selector, address(0)));
        this.deployRegistry(address(0));
    }

    /// External so a reverting constructor is a call frame expectRevert can match without ending the test.
    function deployRegistry(address owner_) external returns (address) {
        return address(new ShowmarkRegistry(owner_, BASE_URI));
    }

    // ---------------------------------------------------------------- series

    function test_createSeries_allocatesSequentialIds() public {
        vm.expectEmit(address(registry));
        emit IShowmarkRegistry.SeriesCreated(1, organizer, "s");
        vm.prank(organizer);
        assertEq(registry.createSeries("s"), 1);
        vm.prank(organizer);
        assertEq(registry.createSeries("t"), 2);
        assertEq(registry.nextSeriesId(), 3);
        assertEq(registry.seriesOrganizer(1), organizer);
        assertEq(registry.seriesOrganizer(3), address(0));
    }

    function test_createSeries_revertsOnLongMetadata() public {
        vm.prank(organizer);
        vm.expectRevert(IShowmarkRegistry.MetadataTooLong.selector);
        registry.createSeries(string(new bytes(2049)));
    }

    // ---------------------------------------------------------------- createEvent

    function test_createEvent_storesAndEmits() public {
        vm.expectEmit(address(registry));
        emit IShowmarkRegistry.EventCreated(2, organizer, T0 + 10, T0 + 20, 50, 120, 0, 0, META);
        vm.prank(organizer);
        uint256 id = registry.createEvent(T0 + 10, T0 + 20, 50, 120, 0, META);

        assertEq(id, 2);
        assertEq(registry.nextEventId(), 3);
        IShowmarkRegistry.EventInfo memory e = registry.eventInfo(id);
        assertEq(e.organizer, organizer);
        assertEq(e.startsAt, T0 + 10);
        assertEq(e.endsAt, T0 + 20);
        assertEq(e.capacity, 50);
        assertEq(e.checkedIn, 0);
        assertEq(e.maxPassAge, 120);
        assertEq(e.seriesId, 0);
        assertEq(e.seriesIndex, 0);
    }

    function test_createEvent_revertsOnBadWindow() public {
        vm.startPrank(organizer);
        vm.expectRevert(IShowmarkRegistry.InvalidEventWindow.selector);
        registry.createEvent(T0, T0, 0, 60, 0, META);
        vm.expectRevert(IShowmarkRegistry.InvalidEventWindow.selector);
        registry.createEvent(T0 + 1, T0, 0, 60, 0, META);
        vm.stopPrank();
    }

    function test_createEvent_maxPassAgeBounds() public {
        vm.startPrank(organizer);
        vm.expectRevert(IShowmarkRegistry.InvalidMaxPassAge.selector);
        registry.createEvent(T0, T0 + 1, 0, 29, 0, META);
        vm.expectRevert(IShowmarkRegistry.InvalidMaxPassAge.selector);
        registry.createEvent(T0, T0 + 1, 0, 601, 0, META);
        registry.createEvent(T0, T0 + 1, 0, 30, 0, META);
        registry.createEvent(T0, T0 + 1, 0, 600, 0, META);
        vm.stopPrank();
    }

    function test_createEvent_metadataLengthBound() public {
        vm.startPrank(organizer);
        vm.expectRevert(IShowmarkRegistry.MetadataTooLong.selector);
        registry.createEvent(T0, T0 + 1, 0, 60, 0, string(new bytes(2049)));
        registry.createEvent(T0, T0 + 1, 0, 60, 0, string(new bytes(2048)));
        vm.stopPrank();
    }

    function test_createEvent_inSeriesAssignsIndexes() public {
        vm.startPrank(organizer);
        uint64 s = registry.createSeries("weekly");
        uint256 a = registry.createEvent(T0, T0 + 1, 0, 60, s, META);
        uint256 b = registry.createEvent(T0, T0 + 1, 0, 60, s, META);
        vm.stopPrank();
        assertEq(registry.eventInfo(a).seriesId, s);
        assertEq(registry.eventInfo(a).seriesIndex, 1);
        assertEq(registry.eventInfo(b).seriesIndex, 2);
    }

    function test_createEvent_revertsOnForeignOrUnknownSeries() public {
        vm.prank(organizer);
        uint64 s = registry.createSeries("weekly");

        vm.prank(makeAddr("stranger"));
        vm.expectRevert(IShowmarkRegistry.NotSeriesOrganizer.selector);
        registry.createEvent(T0, T0 + 1, 0, 60, s, META);

        vm.prank(organizer);
        vm.expectRevert(IShowmarkRegistry.UnknownSeries.selector);
        registry.createEvent(T0, T0 + 1, 0, 60, s + 1, META);
    }

    function test_createEvent_revertsWhenPaused() public {
        vm.prank(owner);
        registry.pause();
        vm.prank(organizer);
        vm.expectRevert(Pausable.EnforcedPause.selector);
        registry.createEvent(T0, T0 + 1, 0, 60, 0, META);
    }

    // ---------------------------------------------------------------- organizer controls

    function test_updateEventMetadata() public {
        vm.expectEmit(address(registry));
        emit IShowmarkRegistry.EventMetadataUpdated(eventId, "new");
        vm.prank(organizer);
        registry.updateEventMetadata(eventId, "new");
    }

    function test_updateEventMetadata_guards() public {
        vm.expectRevert(IShowmarkRegistry.NotOrganizer.selector);
        registry.updateEventMetadata(eventId, "new");

        vm.prank(organizer);
        vm.expectRevert(IShowmarkRegistry.UnknownEvent.selector);
        registry.updateEventMetadata(99, "new");

        vm.prank(organizer);
        vm.expectRevert(IShowmarkRegistry.MetadataTooLong.selector);
        registry.updateEventMetadata(eventId, string(new bytes(2049)));
    }

    function test_setCapacity() public {
        _checkInNow(eventId, attendeePk);
        _checkInNow(eventId, 0xBEEF);

        vm.startPrank(organizer);
        vm.expectRevert(IShowmarkRegistry.CapacityBelowCheckedIn.selector);
        registry.setCapacity(eventId, 1);

        vm.expectEmit(address(registry));
        emit IShowmarkRegistry.CapacityChanged(eventId, 2);
        registry.setCapacity(eventId, 2);
        assertEq(registry.eventInfo(eventId).capacity, 2);

        registry.setCapacity(eventId, 0);
        assertEq(registry.eventInfo(eventId).capacity, 0);
        vm.stopPrank();

        vm.expectRevert(IShowmarkRegistry.NotOrganizer.selector);
        registry.setCapacity(eventId, 10);
    }

    function test_authorizeDoorKey() public {
        address key = makeAddr("key");
        uint64 limit = T0 + EVENT_LENGTH + 3 days;

        vm.expectEmit(address(registry));
        emit IShowmarkRegistry.DoorKeyAuthorized(eventId, key, limit);
        _authorize(organizer, eventId, key, limit);
        assertEq(registry.doorKeyValidUntil(eventId, key), limit);
    }

    function test_authorizeDoorKey_guards() public {
        address key = makeAddr("key");
        uint64 limit = T0 + EVENT_LENGTH + 3 days;

        vm.expectRevert(IShowmarkRegistry.NotOrganizer.selector);
        registry.authorizeDoorKey(eventId, key, limit);

        vm.startPrank(organizer);
        vm.expectRevert(IShowmarkRegistry.ValidUntilTooLate.selector);
        registry.authorizeDoorKey(eventId, key, limit + 1);
        vm.expectRevert(IShowmarkRegistry.InvalidDoorKey.selector);
        registry.authorizeDoorKey(eventId, address(0), limit);
        vm.expectRevert(IShowmarkRegistry.UnknownEvent.selector);
        registry.authorizeDoorKey(42, key, limit);
        vm.stopPrank();
    }

    function test_revokeDoorKey_blocksCheckIn() public {
        vm.expectRevert(IShowmarkRegistry.NotOrganizer.selector);
        registry.revokeDoorKey(eventId, doorKey);

        vm.expectEmit(address(registry));
        emit IShowmarkRegistry.DoorKeyRevoked(eventId, doorKey);
        vm.prank(organizer);
        registry.revokeDoorKey(eventId, doorKey);
        assertEq(registry.doorKeyValidUntil(eventId, doorKey), 0);

        IShowmarkRegistry.CheckInData memory d = _mode1(eventId, attendeePk, doorPk, T0);
        vm.expectRevert(IShowmarkRegistry.DoorKeyNotAuthorized.selector);
        _checkIn(d);
    }

    // ---------------------------------------------------------------- checkIn, mode 1

    function test_checkIn_mode1_recordsPresenceAndMintsStamp() public {
        vm.warp(T0 + 100);
        IShowmarkRegistry.CheckInData memory d = _mode1(eventId, attendeePk, doorPk, T0 + 95);

        vm.expectEmit(address(registry));
        emit IShowmarkRegistry.CheckedIn(eventId, attendee, 1, doorKey, T0 + 95, 0);
        assertTrue(_checkIn(d));

        IShowmarkRegistry.Presence memory p = registry.presenceOf(eventId, attendee);
        assertEq(p.mode, 1);
        assertEq(p.at, T0 + 100);
        assertEq(registry.eventInfo(eventId).checkedIn, 1);
        assertEq(stamp.balanceOf(attendee, eventId), 1);
        assertTrue(registry.hasAttended(eventId, attendee));
    }

    function test_checkIn_rejectsDuplicate() public {
        IShowmarkRegistry.CheckInData memory d = _mode1(eventId, attendeePk, doorPk, T0);
        _checkIn(d);
        vm.expectRevert(IShowmarkRegistry.AlreadyPresent.selector);
        _checkIn(d);
        assertEq(registry.eventInfo(eventId).checkedIn, 1);
        assertEq(stamp.balanceOf(attendee, eventId), 1);
    }

    function test_checkIn_rejectsUnknownEvent() public {
        IShowmarkRegistry.CheckInData memory d = _mode1(77, attendeePk, doorPk, T0);
        vm.expectRevert(IShowmarkRegistry.UnknownEvent.selector);
        _checkIn(d);
    }

    function test_checkIn_rejectsBadMode() public {
        IShowmarkRegistry.CheckInData memory d = _mode1(eventId, attendeePk, doorPk, T0);
        d.mode = 0;
        vm.expectRevert(IShowmarkRegistry.BadMode.selector);
        _checkIn(d);
        d.mode = 3;
        vm.expectRevert(IShowmarkRegistry.BadMode.selector);
        _checkIn(d);
    }

    function test_checkIn_rejectsAttendeeSigFromOtherKey() public {
        IShowmarkRegistry.CheckInData memory d = _mode1(eventId, attendeePk, doorPk, T0);
        d.attendeeSig = SigUtils.sign(0xBAD, SigUtils.checkInDigest(separator, eventId, attendee, 1));
        vm.expectRevert(IShowmarkRegistry.BadAttendeeSig.selector);
        _checkIn(d);
    }

    function test_checkIn_rejectsAttendeeSigForOtherEvent() public {
        uint256 other = _createEvent(organizer, T0, T0 + EVENT_LENGTH, 0, 0);
        IShowmarkRegistry.CheckInData memory d = _mode1(eventId, attendeePk, doorPk, T0);
        d.attendeeSig = SigUtils.sign(attendeePk, SigUtils.checkInDigest(separator, other, attendee, 1));
        vm.expectRevert(IShowmarkRegistry.BadAttendeeSig.selector);
        _checkIn(d);
    }

    function test_checkIn_rejectsMalformedAttendeeSig() public {
        IShowmarkRegistry.CheckInData memory d = _mode1(eventId, attendeePk, doorPk, T0);
        d.attendeeSig = new bytes(64);
        vm.expectRevert(IShowmarkRegistry.BadAttendeeSig.selector);
        _checkIn(d);
    }

    function test_checkIn_rejectsZeroAttendee() public {
        IShowmarkRegistry.CheckInData memory d = _mode1(eventId, attendeePk, doorPk, T0);
        d.attendee = address(0);
        vm.expectRevert(IShowmarkRegistry.BadAttendeeSig.selector);
        _checkIn(d);
    }

    function test_checkIn_rejectsMalformedDoorSig() public {
        IShowmarkRegistry.CheckInData memory d = _mode1(eventId, attendeePk, doorPk, T0);
        d.doorSig = new bytes(65);
        vm.expectRevert(IShowmarkRegistry.BadDoorSig.selector);
        _checkIn(d);
        d.doorSig = new bytes(10);
        vm.expectRevert(IShowmarkRegistry.BadDoorSig.selector);
        _checkIn(d);
    }

    function test_checkIn_rejectsUnauthorizedDoorKey() public {
        IShowmarkRegistry.CheckInData memory d = _mode1(eventId, attendeePk, 0xFACE, T0);
        vm.expectRevert(IShowmarkRegistry.DoorKeyNotAuthorized.selector);
        _checkIn(d);
    }

    function test_checkIn_rejectsDoorKeyOfAnotherEvent() public {
        uint256 other = _createEvent(makeAddr("org2"), T0, T0 + EVENT_LENGTH, 0, 0);
        uint256 otherKeyPk = 0x0E1;
        _authorize(makeAddr("org2"), other, vm.addr(otherKeyPk), T0 + EVENT_LENGTH);
        IShowmarkRegistry.CheckInData memory d = _mode1(eventId, attendeePk, otherKeyPk, T0);
        vm.expectRevert(IShowmarkRegistry.DoorKeyNotAuthorized.selector);
        _checkIn(d);
    }

    function test_checkIn_rejectsDoorKeyPastValidity() public {
        _authorize(organizer, eventId, doorKey, T0 + 50);
        vm.warp(T0 + 60);
        IShowmarkRegistry.CheckInData memory d = _mode1(eventId, attendeePk, doorPk, T0 + 51);
        vm.expectRevert(IShowmarkRegistry.DoorKeyNotAuthorized.selector);
        _checkIn(d);
        d = _mode1(eventId, attendeePk, doorPk, T0 + 50);
        assertTrue(_checkIn(d));
    }

    function test_checkIn_doorPassReplayedOnOtherEventFails() public {
        uint256 other = _createEvent(organizer, T0, T0 + EVENT_LENGTH, 0, 0);
        _authorize(organizer, other, doorKey, T0 + EVENT_LENGTH);
        IShowmarkRegistry.CheckInData memory d = _mode1(other, attendeePk, doorPk, T0);
        d.doorSig = SigUtils.sign(doorPk, SigUtils.doorPassDigest(separator, eventId, T0, d.ticket));
        vm.expectRevert(IShowmarkRegistry.DoorKeyNotAuthorized.selector);
        _checkIn(d);
    }

    function test_checkIn_signaturesForOtherChainOrContractFail() public {
        bytes32 otherChain = SigUtils.domainSeparator(1990, address(registry));
        bytes32 otherContract = SigUtils.domainSeparator(block.chainid, address(0xC0FFEE));

        IShowmarkRegistry.CheckInData memory d = _mode1(eventId, attendeePk, doorPk, T0);
        d.attendeeSig = SigUtils.sign(attendeePk, SigUtils.checkInDigest(otherChain, eventId, attendee, 1));
        vm.expectRevert(IShowmarkRegistry.BadAttendeeSig.selector);
        _checkIn(d);

        d = _mode1(eventId, attendeePk, doorPk, T0);
        d.doorSig = SigUtils.sign(doorPk, SigUtils.doorPassDigest(otherContract, eventId, T0, d.ticket));
        vm.expectRevert(IShowmarkRegistry.DoorKeyNotAuthorized.selector);
        _checkIn(d);
    }

    function test_checkIn_mode1FreshnessBounds() public {
        vm.warp(T0 + 1000);
        // issued too far in the future
        IShowmarkRegistry.CheckInData memory d = _mode1(eventId, attendeePk, doorPk, T0 + 1031);
        vm.expectRevert(IShowmarkRegistry.Stale.selector);
        _checkIn(d);
        // older than maxPassAge
        d = _mode1(eventId, attendeePk, doorPk, T0 + 1000 - MAX_PASS_AGE - 1);
        vm.expectRevert(IShowmarkRegistry.Stale.selector);
        _checkIn(d);
        // both edges are accepted
        assertTrue(_checkIn(_mode1(eventId, attendeePk, doorPk, T0 + 1030)));
        assertTrue(_checkIn(_mode1(eventId, 0xBEEF, doorPk, T0 + 1000 - MAX_PASS_AGE)));
    }

    function test_checkIn_mode1WindowBounds() public {
        _authorize(organizer, eventId, doorKey, T0 + EVENT_LENGTH + 3 days);

        vm.warp(T0 - 1 hours - 1);
        vm.expectRevert(IShowmarkRegistry.OutsideEventWindow.selector);
        _checkInNow(eventId, attendeePk);

        vm.warp(T0 - 1 hours);
        assertTrue(_checkInNow(eventId, attendeePk));

        vm.warp(T0 + EVENT_LENGTH + 1 hours);
        assertTrue(_checkInNow(eventId, 0xBEEF));

        vm.warp(T0 + EVENT_LENGTH + 1 hours + 1);
        vm.expectRevert(IShowmarkRegistry.OutsideEventWindow.selector);
        _checkInNow(eventId, 0xCAFE);
    }

    function test_checkIn_capacity() public {
        vm.prank(organizer);
        registry.setCapacity(eventId, 1);
        _checkInNow(eventId, attendeePk);
        IShowmarkRegistry.CheckInData memory d = _mode1(eventId, 0xBEEF, doorPk, T0);
        vm.expectRevert(IShowmarkRegistry.AtCapacity.selector);
        _checkIn(d);
    }

    function test_checkIn_revertsWhenPaused() public {
        vm.prank(owner);
        registry.pause();
        IShowmarkRegistry.CheckInData memory d = _mode1(eventId, attendeePk, doorPk, T0);
        vm.expectRevert(Pausable.EnforcedPause.selector);
        _checkIn(d);

        vm.prank(owner);
        registry.unpause();
        assertTrue(_checkIn(d));
    }

    function test_checkIn_earlyTimestampsDoNotUnderflow() public {
        vm.warp(100);
        uint256 early = _createEvent(organizer, 50, 500, 0, 0);
        _authorize(organizer, early, doorKey, 500);
        assertTrue(_checkInNow(early, attendeePk));
    }

    function test_checkIn_farFutureEventDoesNotOverflow() public {
        uint64 max = type(uint64).max;
        uint256 far = _createEvent(organizer, max - 10, max, 0, 0);
        _authorize(organizer, far, doorKey, max);
        IShowmarkRegistry.CheckInData memory d = _mode1(far, attendeePk, doorPk, T0);
        vm.expectRevert(IShowmarkRegistry.OutsideEventWindow.selector);
        _checkIn(d);
    }

    // ---------------------------------------------------------------- checkIn, mode 2

    function test_checkIn_mode2_offlineQueueAccepted() public {
        _authorize(organizer, eventId, doorKey, T0 + EVENT_LENGTH + 3 days);
        IShowmarkRegistry.CheckInData memory d = _mode2(eventId, attendeePk, doorPk, T0 + 30 minutes);
        vm.warp(T0 + EVENT_LENGTH + 3 days);

        vm.expectEmit(address(registry));
        emit IShowmarkRegistry.CheckedIn(eventId, attendee, 2, doorKey, T0 + 30 minutes, 0);
        assertTrue(_checkIn(d));
        assertEq(registry.presenceOf(eventId, attendee).mode, 2);
    }

    function test_checkIn_mode2_tooLateIsStale() public {
        _authorize(organizer, eventId, doorKey, T0 + EVENT_LENGTH + 3 days);
        IShowmarkRegistry.CheckInData memory d = _mode2(eventId, attendeePk, doorPk, T0 + 30 minutes);
        vm.warp(T0 + EVENT_LENGTH + 3 days + 1);
        vm.expectRevert(IShowmarkRegistry.Stale.selector);
        _checkIn(d);
    }

    function test_checkIn_mode2_futureAttestationIsStale() public {
        IShowmarkRegistry.CheckInData memory d = _mode2(eventId, attendeePk, doorPk, T0 + 31);
        vm.expectRevert(IShowmarkRegistry.Stale.selector);
        _checkIn(d);
        assertTrue(_checkIn(_mode2(eventId, attendeePk, doorPk, T0 + 30)));
    }

    function test_checkIn_mode2_attestationOutsideWindow() public {
        _authorize(organizer, eventId, doorKey, T0 + EVENT_LENGTH + 3 days);
        vm.warp(T0 + EVENT_LENGTH + 2 hours);
        IShowmarkRegistry.CheckInData memory d = _mode2(eventId, attendeePk, doorPk, T0 + EVENT_LENGTH + 1 hours + 1);
        vm.expectRevert(IShowmarkRegistry.OutsideEventWindow.selector);
        _checkIn(d);

        d = _mode2(eventId, attendeePk, doorPk, T0 - 1 hours - 1);
        vm.expectRevert(IShowmarkRegistry.OutsideEventWindow.selector);
        _checkIn(d);

        assertTrue(_checkIn(_mode2(eventId, attendeePk, doorPk, T0 + EVENT_LENGTH + 1 hours)));
        assertTrue(_checkIn(_mode2(eventId, 0xBEEF, doorPk, T0 - 1 hours)));
    }

    function test_checkIn_mode2_attestationBoundToAttendee() public {
        IShowmarkRegistry.CheckInData memory d = _mode2(eventId, 0xBEEF, doorPk, T0);
        // door attested someone else; attendee swaps in their own CheckIn signature
        d.attendee = attendee;
        d.attendeeSig = SigUtils.sign(attendeePk, SigUtils.checkInDigest(separator, eventId, attendee, 2));
        vm.expectRevert(IShowmarkRegistry.DoorKeyNotAuthorized.selector);
        _checkIn(d);
    }

    function test_checkIn_doorPassCannotBeUsedAsAttestation() public {
        IShowmarkRegistry.CheckInData memory d = _mode1(eventId, attendeePk, doorPk, T0);
        d.mode = 2;
        d.ticket = address(0);
        d.ticketSig = "";
        d.attendeeSig = SigUtils.sign(attendeePk, SigUtils.checkInDigest(separator, eventId, attendee, 2));
        vm.expectRevert(IShowmarkRegistry.DoorKeyNotAuthorized.selector);
        _checkIn(d);
    }

    // ---------------------------------------------------------------- ticket keys (audit C-01) and mode binding (M-01)

    function test_checkIn_mode1RequiresTicketSignedByTheDoorPassTicket() public {
        // ticket signature by some other key
        IShowmarkRegistry.CheckInData memory d = _mode1(eventId, attendeePk, doorPk, T0);
        d.ticketSig = SigUtils.sign(0x0DD, SigUtils.ticketDigest(separator, eventId, attendee));
        vm.expectRevert(IShowmarkRegistry.BadTicketSig.selector);
        _checkIn(d);

        // ticket signed for a different attendee
        d = _mode1(eventId, attendeePk, doorPk, T0);
        d.ticketSig = SigUtils.sign(SigUtils.ticketPk(doorPk, T0), SigUtils.ticketDigest(separator, eventId, wallet));
        vm.expectRevert(IShowmarkRegistry.BadTicketSig.selector);
        _checkIn(d);

        // ticket signed for a different event
        d = _mode1(eventId, attendeePk, doorPk, T0);
        d.ticketSig = SigUtils.sign(SigUtils.ticketPk(doorPk, T0), SigUtils.ticketDigest(separator, 99, attendee));
        vm.expectRevert(IShowmarkRegistry.BadTicketSig.selector);
        _checkIn(d);

        // malformed ticket signature
        d = _mode1(eventId, attendeePk, doorPk, T0);
        d.ticketSig = new bytes(64);
        vm.expectRevert(IShowmarkRegistry.BadTicketSig.selector);
        _checkIn(d);

        // swapping in another ticket breaks the door signature, which commits to the ticket
        d = _mode1(eventId, attendeePk, doorPk, T0);
        d.ticket = vm.addr(0x0DD);
        d.ticketSig = SigUtils.sign(0x0DD, SigUtils.ticketDigest(separator, eventId, attendee));
        vm.expectRevert(IShowmarkRegistry.DoorKeyNotAuthorized.selector);
        _checkIn(d);

        assertTrue(_checkIn(_mode1(eventId, attendeePk, doorPk, T0)));
    }

    function test_checkIn_mode1RejectsZeroTicket() public {
        IShowmarkRegistry.CheckInData memory d = _mode1(eventId, attendeePk, doorPk, T0);
        d.ticket = address(0);
        d.doorSig = SigUtils.sign(doorPk, SigUtils.doorPassDigest(separator, eventId, T0, address(0)));
        d.ticketSig = new bytes(65);
        vm.expectRevert(IShowmarkRegistry.BadTicketSig.selector);
        _checkIn(d);
    }

    function test_checkIn_mode2RejectsTicketFields() public {
        IShowmarkRegistry.CheckInData memory d = _mode2(eventId, attendeePk, doorPk, T0);
        d.ticket = vm.addr(0x0DD);
        vm.expectRevert(IShowmarkRegistry.BadTicketSig.selector);
        _checkIn(d);

        d = _mode2(eventId, attendeePk, doorPk, T0);
        d.ticketSig = hex"01";
        vm.expectRevert(IShowmarkRegistry.BadTicketSig.selector);
        _checkIn(d);

        assertTrue(_checkIn(_mode2(eventId, attendeePk, doorPk, T0)));
    }

    function test_checkIn_attendeeSignatureBindsTheMode() public {
        // a mode 2 code shown at the door cannot be replayed as a mode 1 check-in
        IShowmarkRegistry.CheckInData memory m2 = _mode2(eventId, attendeePk, doorPk, T0);
        IShowmarkRegistry.CheckInData memory d = _mode1(eventId, attendeePk, doorPk, T0);
        d.attendeeSig = m2.attendeeSig;
        vm.expectRevert(IShowmarkRegistry.BadAttendeeSig.selector);
        _checkIn(d);

        // and a mode 1 signature cannot be used for mode 2
        IShowmarkRegistry.CheckInData memory m1 = _mode1(eventId, attendeePk, doorPk, T0);
        m2.attendeeSig = m1.attendeeSig;
        vm.expectRevert(IShowmarkRegistry.BadAttendeeSig.selector);
        _checkIn(m2);
    }

    function test_checkIn_mode2PresenceIsDatedByAttestation() public {
        _authorize(organizer, eventId, doorKey, T0 + EVENT_LENGTH + 3 days);
        IShowmarkRegistry.CheckInData memory d = _mode2(eventId, attendeePk, doorPk, T0 + 30 minutes);
        vm.warp(T0 + EVENT_LENGTH + 2 days);
        _checkIn(d);
        assertEq(registry.presenceOf(eventId, attendee).at, T0 + 30 minutes);
    }

    function test_checkInBatch_badTicketIsCode11() public {
        IShowmarkRegistry.CheckInData[] memory ds = new IShowmarkRegistry.CheckInData[](1);
        ds[0] = _mode1(eventId, attendeePk, doorPk, T0);
        ds[0].ticketSig = SigUtils.sign(0x0DD, SigUtils.ticketDigest(separator, eventId, attendee));
        vm.expectEmit(address(registry));
        emit IShowmarkRegistry.CheckInRejected(eventId, attendee, 11);
        assertEq(registry.checkInBatch(ds)[0], 11);
    }

    function test_renounceOwnershipDisabled() public {
        vm.prank(owner);
        vm.expectRevert(Ownable2StepNoRenounce.RenounceDisabled.selector);
        registry.renounceOwnership();
        vm.prank(owner);
        vm.expectRevert(Ownable2StepNoRenounce.RenounceDisabled.selector);
        stamp.renounceOwnership();
        assertEq(registry.owner(), owner);
    }

    // ---------------------------------------------------------------- streaks

    function test_streak_consecutiveAndBroken() public {
        vm.startPrank(organizer);
        uint64 s = registry.createSeries("weekly");
        uint256[] memory ids = new uint256[](4);
        for (uint256 i; i < 4; ++i) {
            ids[i] = registry.createEvent(T0, T0 + EVENT_LENGTH, 0, MAX_PASS_AGE, s, META);
            registry.authorizeDoorKey(ids[i], doorKey, T0 + EVENT_LENGTH);
        }
        vm.stopPrank();

        _checkInNow(ids[0], attendeePk);
        vm.expectEmit(address(registry));
        emit IShowmarkRegistry.CheckedIn(ids[1], attendee, 1, doorKey, T0, 2);
        _checkInNow(ids[1], attendeePk);
        (uint32 current, uint32 best) = registry.streakOf(s, attendee);
        assertEq(current, 2);
        assertEq(best, 2);

        _checkInNow(ids[3], attendeePk); // skipped index 3
        (current, best) = registry.streakOf(s, attendee);
        assertEq(current, 1);
        assertEq(best, 2);
    }

    function test_streak_lateRecordOfEarlierEventKeepsStreak() public {
        vm.startPrank(organizer);
        uint64 s = registry.createSeries("weekly");
        uint256 a = registry.createEvent(T0, T0 + EVENT_LENGTH, 0, MAX_PASS_AGE, s, META);
        uint256 b = registry.createEvent(T0, T0 + EVENT_LENGTH, 0, MAX_PASS_AGE, s, META);
        uint256 c = registry.createEvent(T0, T0 + EVENT_LENGTH, 0, MAX_PASS_AGE, s, META);
        registry.authorizeDoorKey(a, doorKey, T0 + EVENT_LENGTH);
        registry.authorizeDoorKey(b, doorKey, T0 + EVENT_LENGTH);
        registry.authorizeDoorKey(c, doorKey, T0 + EVENT_LENGTH);
        vm.stopPrank();

        _checkInNow(b, attendeePk);
        _checkInNow(c, attendeePk);
        _checkInNow(a, attendeePk); // offline queue for index 1 lands last
        (uint32 current, uint32 best) = registry.streakOf(s, attendee);
        assertEq(current, 2);
        assertEq(best, 2);
    }

    // ---------------------------------------------------------------- checkInBatch

    function test_checkInBatch_mixedStatuses() public {
        IShowmarkRegistry.CheckInData[] memory ds = new IShowmarkRegistry.CheckInData[](5);
        ds[0] = _mode1(eventId, attendeePk, doorPk, T0);
        ds[1] = ds[0];
        ds[2] = _mode1(eventId, 0xBEEF, doorPk, T0);
        ds[2].attendeeSig = SigUtils.sign(0xBAD, SigUtils.checkInDigest(separator, eventId, vm.addr(0xBEEF), 1));
        ds[3] = _mode1(99, 0xCAFE, doorPk, T0);
        ds[4] = _mode1(eventId, 0xCAFE, doorPk, T0);
        ds[4].mode = 7;

        vm.expectEmit(address(registry));
        emit IShowmarkRegistry.CheckedIn(eventId, attendee, 1, doorKey, T0, 0);
        vm.expectEmit(address(registry));
        emit IShowmarkRegistry.CheckInRejected(eventId, attendee, 1);
        vm.expectEmit(address(registry));
        emit IShowmarkRegistry.CheckInRejected(eventId, vm.addr(0xBEEF), 3);
        vm.expectEmit(address(registry));
        emit IShowmarkRegistry.CheckInRejected(99, vm.addr(0xCAFE), 2);
        vm.expectEmit(address(registry));
        emit IShowmarkRegistry.CheckInRejected(eventId, vm.addr(0xCAFE), 9);

        vm.prank(relayer);
        uint8[] memory status = registry.checkInBatch(ds);
        assertEq(status.length, 5);
        assertEq(status[0], 0);
        assertEq(status[1], 1);
        assertEq(status[2], 3);
        assertEq(status[3], 2);
        assertEq(status[4], 9);
        assertEq(registry.eventInfo(eventId).checkedIn, 1);
    }

    function test_checkInBatch_everyRejectionCode() public {
        vm.prank(organizer);
        uint256 full = registry.createEvent(T0, T0 + EVENT_LENGTH, 1, MAX_PASS_AGE, 0, META);
        _authorize(organizer, full, doorKey, T0 + EVENT_LENGTH);
        _checkInNow(full, 0x5EA7);

        vm.warp(T0 + 600);
        IShowmarkRegistry.CheckInData[] memory ds = new IShowmarkRegistry.CheckInData[](5);
        ds[0] = _mode1(eventId, 0x1, doorPk, T0 + 600);
        ds[0].doorSig = hex"01"; // 4 BadDoorSig
        ds[1] = _mode1(eventId, 0x2, 0xFACE, T0 + 600); // 5 DoorKeyNotAuthorized
        ds[2] = _mode1(eventId, 0x3, doorPk, T0 + 500); // 6 Stale
        ds[3] = _mode2(eventId, 0x4, doorPk, T0 - 2 hours); // 7 OutsideEventWindow
        ds[4] = _mode1(full, 0x5, doorPk, T0 + 600); // 8 AtCapacity

        vm.prank(relayer);
        uint8[] memory status = registry.checkInBatch(ds);
        assertEq(status[0], 4);
        assertEq(status[1], 5);
        assertEq(status[2], 6);
        assertEq(status[3], 7);
        assertEq(status[4], 8);
    }

    function test_checkInBatch_pausedReturnsCode10WithoutReverting() public {
        vm.prank(owner);
        registry.pause();
        IShowmarkRegistry.CheckInData[] memory ds = new IShowmarkRegistry.CheckInData[](2);
        ds[0] = _mode1(eventId, attendeePk, doorPk, T0);
        ds[1] = _mode1(eventId, 0xBEEF, doorPk, T0);

        vm.expectEmit(address(registry));
        emit IShowmarkRegistry.CheckInRejected(eventId, attendee, 10);
        vm.prank(relayer);
        uint8[] memory status = registry.checkInBatch(ds);
        assertEq(status[0], 10);
        assertEq(status[1], 10);
        assertEq(registry.eventInfo(eventId).checkedIn, 0);
    }

    function test_checkInBatch_empty() public {
        IShowmarkRegistry.CheckInData[] memory ds = new IShowmarkRegistry.CheckInData[](0);
        assertEq(registry.checkInBatch(ds).length, 0);
    }

    // ---------------------------------------------------------------- linkWallet

    function test_linkWallet_eoaLinksAndRelocatesStamps() public {
        uint256 second = _createEvent(organizer, T0, T0 + EVENT_LENGTH, 0, 0);
        _authorize(organizer, second, doorKey, T0 + EVENT_LENGTH);
        _checkInNow(eventId, attendeePk);
        _checkInNow(second, attendeePk);

        uint64 deadline = T0 + 1 hours;
        (bytes memory passSig, bytes memory walletSig) = _linkSigs(attendeePk, walletPk, attendee, wallet, deadline);
        uint256[] memory ids = new uint256[](3);
        ids[0] = eventId;
        ids[1] = second;
        ids[2] = 1234; // not held, skipped

        vm.expectEmit(address(registry));
        emit IShowmarkRegistry.WalletLinked(attendee, wallet);
        vm.prank(relayer);
        registry.linkWallet(attendee, wallet, deadline, passSig, walletSig, ids);

        assertEq(registry.walletOf(attendee), wallet);
        assertEq(registry.passOf(wallet), attendee);
        assertEq(stamp.balanceOf(attendee, eventId), 0);
        assertEq(stamp.balanceOf(wallet, eventId), 1);
        assertEq(stamp.balanceOf(wallet, second), 1);
        assertTrue(registry.hasAttended(eventId, wallet));
        assertTrue(registry.hasAttended(eventId, attendee));
        assertEq(registry.presenceOf(eventId, wallet).mode, 0, "presence stays keyed by pass");
    }

    function test_relocateStamps_movesMissedStampsToTheLinkedWalletOnly() public {
        _checkInNow(eventId, attendeePk);
        uint256[] memory ids = new uint256[](2);
        ids[0] = eventId;
        ids[1] = 777; // not held, skipped

        vm.expectRevert(IShowmarkRegistry.NotLinked.selector);
        registry.relocateStamps(attendee, ids);

        _link(attendeePk, walletPk); // linked with an empty relocation list
        assertEq(stamp.balanceOf(attendee, eventId), 1);

        vm.prank(makeAddr("anyone"));
        registry.relocateStamps(attendee, ids);
        assertEq(stamp.balanceOf(attendee, eventId), 0);
        assertEq(stamp.balanceOf(wallet, eventId), 1);
    }

    function test_linkWallet_laterStampsMintToWallet() public {
        _link(attendeePk, walletPk);
        _checkInNow(eventId, attendeePk);
        assertEq(stamp.balanceOf(wallet, eventId), 1);
        assertEq(stamp.balanceOf(attendee, eventId), 0);
        assertEq(registry.presenceOf(eventId, attendee).mode, 1);
    }

    function test_linkWallet_erc1271Wallet() public {
        MockERC1271Wallet safe = new MockERC1271Wallet(vm.addr(walletPk));
        uint64 deadline = T0 + 1 hours;
        (bytes memory passSig, bytes memory walletSig) =
            _linkSigs(attendeePk, walletPk, attendee, address(safe), deadline);
        registry.linkWallet(attendee, address(safe), deadline, passSig, walletSig, new uint256[](0));
        assertEq(registry.walletOf(attendee), address(safe));

        // a wrong signer is rejected by the contract wallet
        MockERC1271Wallet safe2 = new MockERC1271Wallet(vm.addr(walletPk));
        (passSig, walletSig) = _linkSigs(0xBEEF, 0xBAD, vm.addr(0xBEEF), address(safe2), deadline);
        vm.expectRevert(IShowmarkRegistry.BadWalletSig.selector);
        registry.linkWallet(vm.addr(0xBEEF), address(safe2), deadline, passSig, walletSig, new uint256[](0));
    }

    function test_linkWallet_expired() public {
        uint64 deadline = T0 - 1;
        (bytes memory passSig, bytes memory walletSig) = _linkSigs(attendeePk, walletPk, attendee, wallet, deadline);
        vm.expectRevert(IShowmarkRegistry.LinkExpired.selector);
        registry.linkWallet(attendee, wallet, deadline, passSig, walletSig, new uint256[](0));
    }

    function test_linkWallet_invalidPairs() public {
        uint64 deadline = T0 + 1;
        bytes memory sig = new bytes(65);
        vm.expectRevert(IShowmarkRegistry.InvalidLink.selector);
        registry.linkWallet(address(0), wallet, deadline, sig, sig, new uint256[](0));
        vm.expectRevert(IShowmarkRegistry.InvalidLink.selector);
        registry.linkWallet(attendee, address(0), deadline, sig, sig, new uint256[](0));
        vm.expectRevert(IShowmarkRegistry.InvalidLink.selector);
        registry.linkWallet(attendee, attendee, deadline, sig, sig, new uint256[](0));
    }

    function test_linkWallet_onceEachSide() public {
        _link(attendeePk, walletPk);
        uint64 deadline = T0 + 1 hours;

        // pass already linked
        (bytes memory p, bytes memory w) = _linkSigs(attendeePk, 0x777, attendee, vm.addr(0x777), deadline);
        vm.expectRevert(IShowmarkRegistry.AlreadyLinked.selector);
        registry.linkWallet(attendee, vm.addr(0x777), deadline, p, w, new uint256[](0));

        // wallet already linked
        (p, w) = _linkSigs(0x888, walletPk, vm.addr(0x888), wallet, deadline);
        vm.expectRevert(IShowmarkRegistry.AlreadyLinked.selector);
        registry.linkWallet(vm.addr(0x888), wallet, deadline, p, w, new uint256[](0));

        // a linked wallet cannot become a pass
        (p, w) = _linkSigs(walletPk, 0x999, wallet, vm.addr(0x999), deadline);
        vm.expectRevert(IShowmarkRegistry.AlreadyLinked.selector);
        registry.linkWallet(wallet, vm.addr(0x999), deadline, p, w, new uint256[](0));

        // a linked pass cannot become a wallet
        (p, w) = _linkSigs(0xAAA, attendeePk, vm.addr(0xAAA), attendee, deadline);
        vm.expectRevert(IShowmarkRegistry.AlreadyLinked.selector);
        registry.linkWallet(vm.addr(0xAAA), attendee, deadline, p, w, new uint256[](0));
    }

    function test_linkWallet_badSignatures() public {
        uint64 deadline = T0 + 1 hours;
        (bytes memory p, bytes memory w) = _linkSigs(0xBAD, walletPk, attendee, wallet, deadline);
        vm.expectRevert(IShowmarkRegistry.BadPassSig.selector);
        registry.linkWallet(attendee, wallet, deadline, p, w, new uint256[](0));

        (p, w) = _linkSigs(attendeePk, 0xBAD, attendee, wallet, deadline);
        vm.expectRevert(IShowmarkRegistry.BadWalletSig.selector);
        registry.linkWallet(attendee, wallet, deadline, p, w, new uint256[](0));

        // signatures over a different deadline do not verify
        (p, w) = _linkSigs(attendeePk, walletPk, attendee, wallet, deadline);
        vm.expectRevert(IShowmarkRegistry.BadPassSig.selector);
        registry.linkWallet(attendee, wallet, deadline + 1, p, w, new uint256[](0));
    }

    function test_linkWallet_revertsWhenPaused() public {
        vm.prank(owner);
        registry.pause();
        uint64 deadline = T0 + 1 hours;
        (bytes memory p, bytes memory w) = _linkSigs(attendeePk, walletPk, attendee, wallet, deadline);
        vm.expectRevert(Pausable.EnforcedPause.selector);
        registry.linkWallet(attendee, wallet, deadline, p, w, new uint256[](0));
    }

    function test_hasAttended_falseForStrangers() public {
        _checkInNow(eventId, attendeePk);
        assertFalse(registry.hasAttended(eventId, wallet));
        assertFalse(registry.hasAttended(eventId + 1, attendee));
    }

    // ---------------------------------------------------------------- admin

    function test_pause_onlyOwner() public {
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, address(this)));
        registry.pause();
        vm.prank(owner);
        registry.pause();
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, address(this)));
        registry.unpause();
    }

    function test_ownership_isTwoStep() public {
        address safe = makeAddr("safe");
        vm.prank(owner);
        registry.transferOwnership(safe);
        assertEq(registry.owner(), owner);
        vm.prank(safe);
        registry.acceptOwnership();
        assertEq(registry.owner(), safe);
    }

    // ---------------------------------------------------------------- helpers

    function _link(uint256 passPk, uint256 signerPk) internal {
        uint64 deadline = uint64(block.timestamp + 1 hours);
        address pass = vm.addr(passPk);
        address wal = vm.addr(signerPk);
        (bytes memory p, bytes memory w) = _linkSigs(passPk, signerPk, pass, wal, deadline);
        registry.linkWallet(pass, wal, deadline, p, w, new uint256[](0));
    }
}
