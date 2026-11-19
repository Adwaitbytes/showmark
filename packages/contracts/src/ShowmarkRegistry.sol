// SPDX-License-Identifier: MIT
pragma solidity 0.8.38;

import {Ownable, Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {SignatureChecker} from "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";
import {IShowmarkRegistry} from "./interfaces/IShowmarkRegistry.sol";
import {PresenceStamp} from "./PresenceStamp.sol";

/// @title ShowmarkRegistry
/// @notice Records events, door keys, verified presence, series streaks and pass-to-wallet links.
/// @dev Check-ins carry two EIP-712 signatures (attendee pass and door key) and are relayable by anyone.
/// The registry never calls the vault, so no campaign or payout problem can block a check-in.
contract ShowmarkRegistry is IShowmarkRegistry, Ownable2Step, Pausable, EIP712 {
    /// @notice EIP-712 type of the attendee's check-in signature.
    bytes32 public constant CHECK_IN_TYPEHASH = keccak256("CheckIn(uint256 eventId,address attendee)");
    /// @notice EIP-712 type of the rotating door pass (mode 1).
    bytes32 public constant DOOR_PASS_TYPEHASH = keccak256("DoorPass(uint256 eventId,uint64 issuedAt)");
    /// @notice EIP-712 type of the door attestation bound to one attendee (mode 2).
    bytes32 public constant DOOR_ATTEST_TYPEHASH =
        keccak256("DoorAttest(uint256 eventId,address attendee,uint64 attestedAt)");
    /// @notice EIP-712 type signed by both the pass and the wallet to link them.
    bytes32 public constant LINK_WALLET_TYPEHASH = keccak256("LinkWallet(address pass,address wallet,uint64 deadline)");

    /// @notice Largest metadata string accepted, in bytes.
    uint256 public constant MAX_METADATA_BYTES = 2048;
    /// @notice Bounds for an event's maxPassAge, in seconds.
    uint32 public constant MIN_PASS_AGE = 30;
    /// @notice Upper bound for an event's maxPassAge, in seconds.
    uint32 public constant MAX_PASS_AGE = 600;
    /// @notice Check-ins are accepted from startsAt - 1 hour to endsAt + 1 hour.
    uint256 public constant WINDOW_SLACK = 1 hours;
    /// @notice Allowed clock skew between the door device and block time.
    uint256 public constant CLOCK_SKEW = 30;
    /// @notice Mode 2 attestations may be submitted until endsAt + 3 days; door keys may not outlive that.
    uint256 public constant LATE_SUBMISSION = 3 days;

    uint8 internal constant MODE_ROTATING = 1;
    uint8 internal constant MODE_ATTEST = 2;

    uint8 internal constant RECORDED = 0;
    uint8 internal constant ALREADY_PRESENT = 1;
    uint8 internal constant UNKNOWN_EVENT = 2;
    uint8 internal constant BAD_ATTENDEE_SIG = 3;
    uint8 internal constant BAD_DOOR_SIG = 4;
    uint8 internal constant DOOR_KEY_NOT_AUTHORIZED = 5;
    uint8 internal constant STALE = 6;
    uint8 internal constant OUTSIDE_EVENT_WINDOW = 7;
    uint8 internal constant AT_CAPACITY = 8;
    uint8 internal constant BAD_MODE = 9;
    uint8 internal constant PAUSED = 10;

    struct Series {
        address organizer;
        uint32 eventCount;
    }

    struct Streak {
        uint32 current;
        uint32 best;
        uint32 lastIndex;
    }

    PresenceStamp private immutable _stamp;

    uint256 private _nextEventId = 1;
    uint64 private _nextSeriesId = 1;

    mapping(uint64 seriesId => Series) private _series;
    mapping(uint256 eventId => EventInfo) private _events;
    mapping(uint256 eventId => mapping(address pass => Presence)) private _presence;
    mapping(uint256 eventId => mapping(address key => uint64 validUntil)) private _doorKeys;
    mapping(uint64 seriesId => mapping(address pass => Streak)) private _streaks;
    mapping(address pass => address wallet) private _walletOf;
    mapping(address wallet => address pass) private _passOf;

    /// @param owner_ Owner of the registry and the stamp (pause and base URI); move to the protocol Safe after deploy.
    /// @param stampBaseURI Initial metadata base URI for stamps.
    constructor(address owner_, string memory stampBaseURI) Ownable(owner_) EIP712("Showmark", "1") {
        _stamp = new PresenceStamp(address(this), owner_, stampBaseURI);
    }

    // ------------------------------------------------------------------ admin

    /// @notice Stops createEvent, check-ins and wallet links. Owner only.
    function pause() external onlyOwner {
        _pause();
    }

    /// @notice Resumes createEvent, check-ins and wallet links. Owner only.
    function unpause() external onlyOwner {
        _unpause();
    }

    // ------------------------------------------------------------------ organizers

    /// @inheritdoc IShowmarkRegistry
    function createSeries(string calldata metadata) external returns (uint64 seriesId) {
        _checkMetadata(metadata);
        seriesId = _nextSeriesId++;
        _series[seriesId].organizer = msg.sender;
        emit SeriesCreated(seriesId, msg.sender, metadata);
    }

    /// @inheritdoc IShowmarkRegistry
    function createEvent(
        uint64 startsAt,
        uint64 endsAt,
        uint32 capacity,
        uint32 maxPassAge,
        uint64 seriesId,
        string calldata metadata
    ) external whenNotPaused returns (uint256 eventId) {
        if (startsAt >= endsAt) revert InvalidEventWindow();
        if (maxPassAge < MIN_PASS_AGE || maxPassAge > MAX_PASS_AGE) revert InvalidMaxPassAge();
        _checkMetadata(metadata);

        uint32 seriesIndex;
        if (seriesId != 0) {
            Series storage series = _series[seriesId];
            if (series.organizer == address(0)) revert UnknownSeries();
            if (series.organizer != msg.sender) revert NotSeriesOrganizer();
            seriesIndex = ++series.eventCount;
        }

        eventId = _nextEventId++;
        _events[eventId] = EventInfo({
            organizer: msg.sender,
            startsAt: startsAt,
            endsAt: endsAt,
            capacity: capacity,
            checkedIn: 0,
            maxPassAge: maxPassAge,
            seriesId: seriesId,
            seriesIndex: seriesIndex
        });
        emit EventCreated(eventId, msg.sender, startsAt, endsAt, capacity, maxPassAge, seriesId, seriesIndex, metadata);
    }

    /// @inheritdoc IShowmarkRegistry
    function updateEventMetadata(uint256 eventId, string calldata metadata) external {
        _organizerEvent(eventId);
        _checkMetadata(metadata);
        emit EventMetadataUpdated(eventId, metadata);
    }

    /// @inheritdoc IShowmarkRegistry
    function setCapacity(uint256 eventId, uint32 capacity) external {
        EventInfo storage e = _organizerEvent(eventId);
        if (capacity != 0 && capacity < e.checkedIn) revert CapacityBelowCheckedIn();
        e.capacity = capacity;
        emit CapacityChanged(eventId, capacity);
    }

    /// @inheritdoc IShowmarkRegistry
    function authorizeDoorKey(uint256 eventId, address key, uint64 validUntil) external {
        EventInfo storage e = _organizerEvent(eventId);
        if (key == address(0)) revert InvalidDoorKey();
        if (validUntil > uint256(e.endsAt) + LATE_SUBMISSION) revert ValidUntilTooLate();
        _doorKeys[eventId][key] = validUntil;
        emit DoorKeyAuthorized(eventId, key, validUntil);
    }

    /// @inheritdoc IShowmarkRegistry
    function revokeDoorKey(uint256 eventId, address key) external {
        _organizerEvent(eventId);
        delete _doorKeys[eventId][key];
        emit DoorKeyRevoked(eventId, key);
    }

    // ------------------------------------------------------------------ check-in

    /// @inheritdoc IShowmarkRegistry
    function checkIn(CheckInData calldata d) external whenNotPaused returns (bool recorded) {
        (uint8 status, address doorKey) = _validate(d);
        if (status != RECORDED) _revertWith(status);
        _record(d, doorKey);
        return true;
    }

    /// @inheritdoc IShowmarkRegistry
    function checkInBatch(CheckInData[] calldata ds) external returns (uint8[] memory status) {
        uint256 n = ds.length;
        status = new uint8[](n);
        bool isPaused = paused();
        for (uint256 i; i < n; ++i) {
            CheckInData calldata d = ds[i];
            uint8 s = PAUSED;
            address doorKey;
            if (!isPaused) (s, doorKey) = _validate(d);
            if (s == RECORDED) _record(d, doorKey);
            else emit CheckInRejected(d.eventId, d.attendee, s);
            status[i] = s;
        }
    }

    // ------------------------------------------------------------------ wallet link

    /// @inheritdoc IShowmarkRegistry
    function linkWallet(
        address pass,
        address wallet,
        uint64 deadline,
        bytes calldata passSig,
        bytes calldata walletSig,
        uint256[] calldata relocateEventIds
    ) external whenNotPaused {
        if (block.timestamp > deadline) revert LinkExpired();
        if (pass == address(0) || wallet == address(0) || pass == wallet) revert InvalidLink();
        // One-to-one and no chains: neither side may already appear in any link, in either role.
        if (
            _walletOf[pass] != address(0) || _passOf[pass] != address(0) || _passOf[wallet] != address(0)
                || _walletOf[wallet] != address(0)
        ) revert AlreadyLinked();

        bytes32 digest = _hashTypedDataV4(keccak256(abi.encode(LINK_WALLET_TYPEHASH, pass, wallet, deadline)));
        if (_recover(digest, passSig) != pass) revert BadPassSig();
        if (!SignatureChecker.isValidSignatureNow(wallet, digest, walletSig)) revert BadWalletSig();

        _walletOf[pass] = wallet;
        _passOf[wallet] = pass;
        emit WalletLinked(pass, wallet);

        for (uint256 i; i < relocateEventIds.length; ++i) {
            _stamp.relocate(pass, wallet, relocateEventIds[i]);
        }
    }

    /// @inheritdoc IShowmarkRegistry
    function relocateStamps(address pass, uint256[] calldata eventIds) external {
        address wallet = _walletOf[pass];
        if (wallet == address(0)) revert NotLinked();
        for (uint256 i; i < eventIds.length; ++i) {
            _stamp.relocate(pass, wallet, eventIds[i]);
        }
    }

    // ------------------------------------------------------------------ views

    /// @notice The EIP-712 domain separator (name "Showmark", version "1", this chain, this contract).
    /// @return The separator.
    function domainSeparator() external view returns (bytes32) {
        return _domainSeparatorV4();
    }

    /// @inheritdoc IShowmarkRegistry
    function stamp() external view returns (address) {
        return address(_stamp);
    }

    /// @inheritdoc IShowmarkRegistry
    function nextEventId() external view returns (uint256) {
        return _nextEventId;
    }

    /// @notice The id the next created series will get. Ids start at 1.
    /// @return The next series id.
    function nextSeriesId() external view returns (uint64) {
        return _nextSeriesId;
    }

    /// @notice The organizer of a series, 0 if unknown.
    /// @param seriesId The series.
    /// @return The organizer.
    function seriesOrganizer(uint64 seriesId) external view returns (address) {
        return _series[seriesId].organizer;
    }

    /// @inheritdoc IShowmarkRegistry
    function eventInfo(uint256 eventId) external view returns (EventInfo memory) {
        return _events[eventId];
    }

    /// @inheritdoc IShowmarkRegistry
    function presenceOf(uint256 eventId, address attendee) external view returns (Presence memory) {
        return _presence[eventId][attendee];
    }

    /// @inheritdoc IShowmarkRegistry
    function hasAttended(uint256 eventId, address account) external view returns (bool) {
        if (_presence[eventId][account].mode != 0) return true;
        address pass = _passOf[account];
        return pass != address(0) && _presence[eventId][pass].mode != 0;
    }

    /// @inheritdoc IShowmarkRegistry
    function streakOf(uint64 seriesId, address pass) external view returns (uint32 current, uint32 best) {
        Streak storage s = _streaks[seriesId][pass];
        return (s.current, s.best);
    }

    /// @inheritdoc IShowmarkRegistry
    function doorKeyValidUntil(uint256 eventId, address key) external view returns (uint64) {
        return _doorKeys[eventId][key];
    }

    /// @inheritdoc IShowmarkRegistry
    function walletOf(address pass) external view returns (address) {
        return _walletOf[pass];
    }

    /// @inheritdoc IShowmarkRegistry
    function passOf(address wallet) external view returns (address) {
        return _passOf[wallet];
    }

    // ------------------------------------------------------------------ internals

    /// @dev Pure validation, no state changes. Returns the status code and the recovered door key.
    /// All time arithmetic is done in uint256 so extreme timestamps can never panic inside a batch.
    function _validate(CheckInData calldata d) private view returns (uint8 status, address doorKey) {
        if (d.mode != MODE_ROTATING && d.mode != MODE_ATTEST) return (BAD_MODE, address(0));
        EventInfo storage e = _events[d.eventId];
        if (e.organizer == address(0)) return (UNKNOWN_EVENT, address(0));
        if (_presence[d.eventId][d.attendee].mode != 0) return (ALREADY_PRESENT, address(0));

        bytes32 checkInDigest = _hashTypedDataV4(keccak256(abi.encode(CHECK_IN_TYPEHASH, d.eventId, d.attendee)));
        if (d.attendee == address(0) || _recover(checkInDigest, d.attendeeSig) != d.attendee) {
            return (BAD_ATTENDEE_SIG, address(0));
        }

        bytes32 doorStruct = d.mode == MODE_ROTATING
            ? keccak256(abi.encode(DOOR_PASS_TYPEHASH, d.eventId, d.doorTime))
            : keccak256(abi.encode(DOOR_ATTEST_TYPEHASH, d.eventId, d.attendee, d.doorTime));
        doorKey = _recover(_hashTypedDataV4(doorStruct), d.doorSig);
        if (doorKey == address(0)) return (BAD_DOOR_SIG, address(0));

        uint64 validUntil = _doorKeys[d.eventId][doorKey];
        if (validUntil == 0 || validUntil < d.doorTime) return (DOOR_KEY_NOT_AUTHORIZED, doorKey);

        uint256 nowTs = block.timestamp;
        // Mode 1 is judged by block time; mode 2 by when the door attested (it may be submitted later).
        uint256 windowTime = d.mode == MODE_ROTATING ? nowTs : d.doorTime;
        if (windowTime + WINDOW_SLACK < e.startsAt || windowTime > uint256(e.endsAt) + WINDOW_SLACK) {
            return (OUTSIDE_EVENT_WINDOW, doorKey);
        }

        if (d.doorTime > nowTs + CLOCK_SKEW) return (STALE, doorKey);
        if (d.mode == MODE_ROTATING) {
            if (nowTs > uint256(d.doorTime) + e.maxPassAge) return (STALE, doorKey);
        } else if (nowTs > uint256(e.endsAt) + LATE_SUBMISSION) {
            return (STALE, doorKey);
        }

        if (e.capacity != 0 && e.checkedIn >= e.capacity) return (AT_CAPACITY, doorKey);
        return (RECORDED, doorKey);
    }

    function _record(CheckInData calldata d, address doorKey) private {
        EventInfo storage e = _events[d.eventId];
        // forge-lint: disable-next-line(unsafe-typecast)
        _presence[d.eventId][d.attendee] = Presence({mode: d.mode, at: uint64(block.timestamp)}); // fits until year 2^64 s
        e.checkedIn += 1;

        uint32 streak;
        if (e.seriesId != 0) streak = _advanceStreak(e.seriesId, e.seriesIndex, d.attendee);
        emit CheckedIn(d.eventId, d.attendee, d.mode, doorKey, d.doorTime, streak);

        // Stamps follow the pass to its wallet once linked; presence itself stays keyed by the pass.
        address wallet = _walletOf[d.attendee];
        _stamp.mint(wallet == address(0) ? d.attendee : wallet, d.eventId);
    }

    /// @dev current = (lastIndex == n - 1) ? current + 1 : 1, applied only when n moves forward, so a late
    /// (offline-queued) record of an earlier series event never resets a newer streak.
    function _advanceStreak(uint64 seriesId, uint32 index, address pass) private returns (uint32) {
        Streak storage s = _streaks[seriesId][pass];
        uint32 last = s.lastIndex;
        if (index > last) {
            uint32 current = index == last + 1 ? s.current + 1 : 1;
            s.current = current;
            s.lastIndex = index;
            if (current > s.best) s.best = current;
        }
        return s.current;
    }

    function _organizerEvent(uint256 eventId) private view returns (EventInfo storage e) {
        e = _events[eventId];
        if (e.organizer == address(0)) revert UnknownEvent();
        if (e.organizer != msg.sender) revert NotOrganizer();
    }

    function _checkMetadata(string calldata metadata) private pure {
        if (bytes(metadata).length > MAX_METADATA_BYTES) revert MetadataTooLong();
    }

    function _recover(bytes32 digest, bytes calldata sig) private pure returns (address signer) {
        (address recovered, ECDSA.RecoverError err,) = ECDSA.tryRecover(digest, sig);
        if (err == ECDSA.RecoverError.NoError) signer = recovered;
    }

    function _revertWith(uint8 status) private pure {
        if (status == ALREADY_PRESENT) revert AlreadyPresent();
        if (status == UNKNOWN_EVENT) revert UnknownEvent();
        if (status == BAD_ATTENDEE_SIG) revert BadAttendeeSig();
        if (status == BAD_DOOR_SIG) revert BadDoorSig();
        if (status == DOOR_KEY_NOT_AUTHORIZED) revert DoorKeyNotAuthorized();
        if (status == STALE) revert Stale();
        if (status == OUTSIDE_EVENT_WINDOW) revert OutsideEventWindow();
        if (status == AT_CAPACITY) revert AtCapacity();
        revert BadMode();
    }
}
