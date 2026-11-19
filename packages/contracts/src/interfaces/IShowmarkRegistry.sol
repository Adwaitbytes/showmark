// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title IShowmarkRegistry
/// @notice Events, door keys, presence, streaks and pass-to-wallet links for Showmark.
/// @dev Spec: docs/INTERFACES.md section 2.3. The registry never calls the vault.
interface IShowmarkRegistry {
    /// @notice One organized event. `checkedIn` counts recorded presences.
    struct EventInfo {
        address organizer;
        uint64 startsAt;
        uint64 endsAt;
        uint32 capacity; // 0 = unlimited
        uint32 checkedIn;
        uint32 maxPassAge; // seconds, 30..600, mode 1 freshness
        uint64 seriesId; // 0 = none
        uint32 seriesIndex; // 1-based position inside the series, 0 if no series
    }

    /// @notice A recorded presence. `mode` 0 means absent; `at` is the block time of the record.
    struct Presence {
        uint8 mode;
        uint64 at;
    }

    /// @notice A relayable check-in: the attendee signature plus the door signature.
    struct CheckInData {
        uint256 eventId;
        address attendee;
        uint8 mode; // 1 rotating door QR, 2 door scans you
        uint64 doorTime; // issuedAt (mode 1) or attestedAt (mode 2)
        bytes attendeeSig; // EIP-712 CheckIn
        bytes doorSig; // EIP-712 DoorPass or DoorAttest
    }

    /// @notice Emitted when an organizer opens a series of recurring events.
    /// @param seriesId The new series id (ids start at 1).
    /// @param organizer The account that owns the series.
    /// @param metadata Free-form JSON describing the series.
    event SeriesCreated(uint64 indexed seriesId, address indexed organizer, string metadata);

    /// @notice Emitted when an event is created.
    /// @param eventId The new event id (ids start at 1).
    /// @param organizer The account that controls the event.
    /// @param startsAt Event start, unix seconds.
    /// @param endsAt Event end, unix seconds.
    /// @param capacity Maximum presences, 0 for unlimited.
    /// @param maxPassAge Maximum age in seconds of a rotating door pass.
    /// @param seriesId Series the event belongs to, 0 for none.
    /// @param seriesIndex 1-based position inside the series, 0 for none.
    /// @param metadata JSON `{"v":1,"name","venue","city","description","url"?}`, at most 2,048 bytes.
    event EventCreated(
        uint256 indexed eventId,
        address indexed organizer,
        uint64 startsAt,
        uint64 endsAt,
        uint32 capacity,
        uint32 maxPassAge,
        uint64 indexed seriesId,
        uint32 seriesIndex,
        string metadata
    );

    /// @notice Emitted when an organizer replaces an event's metadata.
    /// @param eventId The event.
    /// @param metadata The new JSON metadata.
    event EventMetadataUpdated(uint256 indexed eventId, string metadata);

    /// @notice Emitted when an organizer changes an event's capacity.
    /// @param eventId The event.
    /// @param capacity The new capacity, 0 for unlimited.
    event CapacityChanged(uint256 indexed eventId, uint32 capacity);

    /// @notice Emitted when a door key is authorized (or its validity changed) for an event.
    /// @param eventId The event.
    /// @param key The door key address.
    /// @param validUntil Last door time (unix seconds) the key may sign for.
    event DoorKeyAuthorized(uint256 indexed eventId, address indexed key, uint64 validUntil);

    /// @notice Emitted when a door key is revoked for an event.
    /// @param eventId The event.
    /// @param key The revoked door key.
    event DoorKeyRevoked(uint256 indexed eventId, address indexed key);

    /// @notice Emitted when a presence is recorded.
    /// @param eventId The event.
    /// @param attendee The pass address the presence is keyed by.
    /// @param mode Proof mode used (1 rotating QR, 2 door scans you).
    /// @param doorKey The door key that signed the door proof.
    /// @param doorTime issuedAt (mode 1) or attestedAt (mode 2).
    /// @param streak The attendee's current streak in the event's series after this record, 0 without a series.
    event CheckedIn(
        uint256 indexed eventId, address indexed attendee, uint8 mode, address doorKey, uint64 doorTime, uint32 streak
    );

    /// @notice Emitted by `checkInBatch` for every item that was not recorded.
    /// @param eventId The event of the rejected item.
    /// @param attendee The attendee of the rejected item.
    /// @param status The batch status code (see `CheckInStatus` in the docs).
    event CheckInRejected(uint256 indexed eventId, address indexed attendee, uint8 status);

    /// @notice Emitted when a pass is linked to a wallet.
    /// @param pass The pass key address.
    /// @param wallet The wallet address (EOA or ERC-1271 contract).
    event WalletLinked(address indexed pass, address indexed wallet);

    /// @notice The event id does not exist.
    error UnknownEvent();
    /// @notice The series id does not exist.
    error UnknownSeries();
    /// @notice The caller is not the event's organizer.
    error NotOrganizer();
    /// @notice The caller is not the series' organizer.
    error NotSeriesOrganizer();
    /// @notice startsAt must be before endsAt.
    error InvalidEventWindow();
    /// @notice maxPassAge must be within [30, 600] seconds.
    error InvalidMaxPassAge();
    /// @notice Metadata is longer than 2,048 bytes.
    error MetadataTooLong();
    /// @notice New capacity is below the number already checked in.
    error CapacityBelowCheckedIn();
    /// @notice The door key is the zero address.
    error InvalidDoorKey();
    /// @notice A door key may not be valid later than endsAt + 3 days.
    error ValidUntilTooLate();
    /// @notice Presence for this event and attendee is already recorded.
    error AlreadyPresent();
    /// @notice The attendee CheckIn signature is invalid.
    error BadAttendeeSig();
    /// @notice The door signature is malformed.
    error BadDoorSig();
    /// @notice The door signer is not authorized for this event at doorTime.
    error DoorKeyNotAuthorized();
    /// @notice The door pass or attestation is too old, too far in the future, or submitted too late.
    error Stale();
    /// @notice The check-in time is outside [startsAt - 1 hour, endsAt + 1 hour].
    error OutsideEventWindow();
    /// @notice The event is at capacity.
    error AtCapacity();
    /// @notice The proof mode is not 1 or 2.
    error BadMode();
    /// @notice The link signature deadline has passed.
    error LinkExpired();
    /// @notice The pass or wallet is the zero address, or they are equal.
    error InvalidLink();
    /// @notice The pass or the wallet already takes part in a link.
    error AlreadyLinked();
    /// @notice The pass signature over LinkWallet is invalid.
    error BadPassSig();
    /// @notice The wallet signature (ECDSA or ERC-1271) over LinkWallet is invalid.
    error BadWalletSig();
    /// @notice The pass has no linked wallet.
    error NotLinked();

    /// @notice Opens a series of recurring events owned by the caller.
    /// @param metadata Free-form JSON describing the series, at most 2,048 bytes.
    /// @return seriesId The new series id.
    function createSeries(string calldata metadata) external returns (uint64 seriesId);

    /// @notice Creates an event organized by the caller.
    /// @param startsAt Event start, unix seconds.
    /// @param endsAt Event end, unix seconds, after startsAt.
    /// @param capacity Maximum presences, 0 for unlimited.
    /// @param maxPassAge Maximum age of a rotating door pass, 30..600 seconds.
    /// @param seriesId A series owned by the caller, or 0.
    /// @param metadata JSON metadata, at most 2,048 bytes.
    /// @return eventId The new event id.
    function createEvent(
        uint64 startsAt,
        uint64 endsAt,
        uint32 capacity,
        uint32 maxPassAge,
        uint64 seriesId,
        string calldata metadata
    ) external returns (uint256 eventId);

    /// @notice Replaces an event's metadata. Organizer only.
    /// @param eventId The event.
    /// @param metadata JSON metadata, at most 2,048 bytes.
    function updateEventMetadata(uint256 eventId, string calldata metadata) external;

    /// @notice Changes an event's capacity. Organizer only. Must be 0 or at least `checkedIn`.
    /// @param eventId The event.
    /// @param capacity The new capacity, 0 for unlimited.
    function setCapacity(uint256 eventId, uint32 capacity) external;

    /// @notice Authorizes a door key for an event, or changes its validity. Organizer only.
    /// @param eventId The event.
    /// @param key The door key address.
    /// @param validUntil Last door time the key may sign for, at most endsAt + 3 days.
    function authorizeDoorKey(uint256 eventId, address key, uint64 validUntil) external;

    /// @notice Revokes a door key for an event. Organizer only.
    /// @param eventId The event.
    /// @param key The door key to revoke.
    function revokeDoorKey(uint256 eventId, address key) external;

    /// @notice Records one presence. Relayable by anyone. Reverts with a typed error on failure.
    /// @param d The signed check-in.
    /// @return recorded Always true when the call returns.
    function checkIn(CheckInData calldata d) external returns (bool recorded);

    /// @notice Records many presences. Never reverts per item; returns a status code per item.
    /// @param ds The signed check-ins.
    /// @return status One code per item: 0 Recorded, 1 AlreadyPresent, 2 UnknownEvent, 3 BadAttendeeSig,
    /// 4 BadDoorSig, 5 DoorKeyNotAuthorized, 6 Stale, 7 OutsideEventWindow, 8 AtCapacity, 9 BadMode, 10 Paused.
    function checkInBatch(CheckInData[] calldata ds) external returns (uint8[] memory status);

    /// @notice Links a pass to a wallet once, with signatures from both, and moves the listed stamps to the wallet.
    /// @param pass The pass key address.
    /// @param wallet The wallet address (EOA or ERC-1271 contract).
    /// @param deadline Last block time at which the signatures are accepted.
    /// @param passSig The pass key's EIP-712 LinkWallet signature.
    /// @param walletSig The wallet's EIP-712 LinkWallet signature (ECDSA or ERC-1271).
    /// @param relocateEventIds Stamp ids to move from the pass to the wallet; ids the pass does not hold are skipped.
    function linkWallet(
        address pass,
        address wallet,
        uint64 deadline,
        bytes calldata passSig,
        bytes calldata walletSig,
        uint256[] calldata relocateEventIds
    ) external;

    /// @notice Moves stamps a linked pass still holds to its wallet. Anyone may call; stamps can only go to the
    /// pass's own linked wallet. Covers ids left out of the (unsigned) relocation list given to linkWallet.
    /// @param pass A linked pass.
    /// @param eventIds Stamp ids to move; ids the pass does not hold are skipped.
    function relocateStamps(address pass, uint256[] calldata eventIds) external;

    /// @notice Returns an event. All fields are zero for an unknown id.
    /// @param eventId The event.
    /// @return The event info.
    function eventInfo(uint256 eventId) external view returns (EventInfo memory);

    /// @notice Returns the presence recorded for a pass at an event.
    /// @param eventId The event.
    /// @param attendee The pass address.
    /// @return The presence (mode 0 when absent).
    function presenceOf(uint256 eventId, address attendee) external view returns (Presence memory);

    /// @notice True when `account`, or the pass linked to `account`, has a presence at the event.
    /// @param eventId The event.
    /// @param account A pass or a linked wallet.
    /// @return Whether the account attended.
    function hasAttended(uint256 eventId, address account) external view returns (bool);

    /// @notice Current and best streak of a pass in a series.
    /// @param seriesId The series.
    /// @param pass The pass address.
    /// @return current The current run of consecutive series events.
    /// @return best The longest run ever recorded.
    function streakOf(uint64 seriesId, address pass) external view returns (uint32 current, uint32 best);

    /// @notice Last door time a key may sign for at an event, 0 if not authorized.
    /// @param eventId The event.
    /// @param key The door key.
    /// @return The validity bound.
    function doorKeyValidUntil(uint256 eventId, address key) external view returns (uint64);

    /// @notice The wallet linked to a pass, 0 if unlinked.
    /// @param pass The pass address.
    /// @return The wallet.
    function walletOf(address pass) external view returns (address);

    /// @notice The pass linked to a wallet, 0 if unlinked.
    /// @param wallet The wallet address.
    /// @return The pass.
    function passOf(address wallet) external view returns (address);

    /// @notice The id the next created event will get. Ids start at 1.
    /// @return The next event id.
    function nextEventId() external view returns (uint256);

    /// @notice The PresenceStamp deployed by this registry.
    /// @return The stamp contract address.
    function stamp() external view returns (address);
}
