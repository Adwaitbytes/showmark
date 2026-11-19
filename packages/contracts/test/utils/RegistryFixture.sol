// SPDX-License-Identifier: MIT
pragma solidity 0.8.38;

import {Test} from "forge-std/Test.sol";
import {ShowmarkRegistry} from "../../src/ShowmarkRegistry.sol";
import {PresenceStamp} from "../../src/PresenceStamp.sol";
import {IShowmarkRegistry} from "../../src/interfaces/IShowmarkRegistry.sol";
import {SigUtils} from "./SigUtils.sol";

/// @notice Deploys a registry with one live event and a door key, and signs check-ins with real EIP-712 digests.
abstract contract RegistryFixture is Test {
    uint64 internal constant T0 = 1_790_000_000;
    uint64 internal constant EVENT_LENGTH = 4 hours;
    uint32 internal constant MAX_PASS_AGE = 60;
    string internal constant BASE_URI = "https://showmark.test/api/stamp/";
    string internal constant META = '{"v":1,"name":"Demo night","venue":"Hall A","city":"Pune","description":"x"}';

    ShowmarkRegistry internal registry;
    PresenceStamp internal stamp;
    bytes32 internal separator;

    address internal owner = makeAddr("owner");
    address internal organizer = makeAddr("organizer");
    address internal relayer = makeAddr("relayer");

    uint256 internal doorPk = 0xD00D;
    address internal doorKey;
    uint256 internal attendeePk = 0xA77E;
    address internal attendee;
    uint256 internal walletPk = 0x3A11E7;
    address internal wallet;

    uint256 internal eventId;

    function setUp() public virtual {
        vm.warp(T0);
        doorKey = vm.addr(doorPk);
        attendee = vm.addr(attendeePk);
        wallet = vm.addr(walletPk);

        registry = new ShowmarkRegistry(owner, BASE_URI);
        stamp = PresenceStamp(registry.stamp());
        separator = SigUtils.domainSeparator(block.chainid, address(registry));

        eventId = _createEvent(organizer, T0, T0 + EVENT_LENGTH, 0, 0);
        _authorize(organizer, eventId, doorKey, T0 + EVENT_LENGTH);
    }

    function _createEvent(address org, uint64 startsAt, uint64 endsAt, uint32 capacity, uint64 seriesId)
        internal
        returns (uint256 id)
    {
        vm.prank(org);
        id = registry.createEvent(startsAt, endsAt, capacity, MAX_PASS_AGE, seriesId, META);
    }

    function _authorize(address org, uint256 id, address key, uint64 validUntil) internal {
        vm.prank(org);
        registry.authorizeDoorKey(id, key, validUntil);
    }

    function _mode1(uint256 id, uint256 passPk, uint256 keyPk, uint64 issuedAt)
        internal
        view
        returns (IShowmarkRegistry.CheckInData memory d)
    {
        address pass = vm.addr(passPk);
        d.eventId = id;
        d.attendee = pass;
        d.mode = 1;
        d.doorTime = issuedAt;
        d.attendeeSig = SigUtils.sign(passPk, SigUtils.checkInDigest(separator, id, pass));
        d.doorSig = SigUtils.sign(keyPk, SigUtils.doorPassDigest(separator, id, issuedAt));
    }

    function _mode2(uint256 id, uint256 passPk, uint256 keyPk, uint64 attestedAt)
        internal
        view
        returns (IShowmarkRegistry.CheckInData memory d)
    {
        address pass = vm.addr(passPk);
        d.eventId = id;
        d.attendee = pass;
        d.mode = 2;
        d.doorTime = attestedAt;
        d.attendeeSig = SigUtils.sign(passPk, SigUtils.checkInDigest(separator, id, pass));
        d.doorSig = SigUtils.sign(keyPk, SigUtils.doorAttestDigest(separator, id, pass, attestedAt));
    }

    function _checkIn(IShowmarkRegistry.CheckInData memory d) internal returns (bool) {
        vm.prank(relayer);
        return registry.checkIn(d);
    }

    function _checkInNow(uint256 id, uint256 passPk) internal returns (bool) {
        return _checkIn(_mode1(id, passPk, doorPk, uint64(block.timestamp)));
    }

    function _linkSigs(uint256 passPk, uint256 signerPk, address pass, address wal, uint64 deadline)
        internal
        view
        returns (bytes memory passSig, bytes memory walletSig)
    {
        bytes32 d = SigUtils.linkDigest(separator, pass, wal, deadline);
        passSig = SigUtils.sign(passPk, d);
        walletSig = SigUtils.sign(signerPk, d);
    }
}
