// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title ICampaignVault
/// @notice Sponsor escrow that pays per verified presence, split between organizer and attendee.
/// @dev Spec: docs/INTERFACES.md section 2.5.
interface ICampaignVault {
    /// @notice Token: amountPerPresence in token units. UsdInNative: USD with 6 decimals, paid in native QIE.
    enum Pricing {
        Token,
        UsdInNative
    }

    /// @notice Parameters a sponsor chooses when creating a campaign.
    struct CampaignParams {
        address token; // address(0) = native QIE; must be address(0) when pricing == UsdInNative
        Pricing pricing;
        uint128 amountPerPresence;
        uint16 attendeeShareBps; // of the amount after fee; the rest goes to the organizer
        uint8 minProofMode; // 1 or 2
        bool requireQieId; // pass must be linked to a wallet holding a QIE ID
        uint64 startsAt;
        uint64 endsAt;
        uint32 maxPerEvent; // 0 = unlimited
        uint32 maxTotal; // 0 = unlimited
        bool openToBonded; // any organizer with bond >= minBond may be paid without approval
        uint128 minBond;
        string metadata; // JSON, at most 2,048 bytes; emitted, not stored
    }

    /// @notice Stored campaign state.
    struct Campaign {
        address sponsor;
        Pricing pricing;
        uint16 attendeeShareBps;
        uint16 feeBps; // snapshot of the protocol fee at creation
        uint8 minProofMode;
        bool requireQieId;
        bool openToBonded;
        address token;
        uint32 maxPerEvent;
        uint32 maxTotal;
        uint32 settledCount;
        uint64 startsAt;
        uint64 endsAt;
        uint128 amountPerPresence;
        uint128 minBond;
        uint256 balance;
    }

    /// @notice One settlement request inside `settleBatch`.
    struct SettleItem {
        uint256 campaignId;
        uint256 eventId;
        address attendee;
    }

    /// @notice Emitted when a campaign is created.
    /// @param campaignId The new campaign id (ids start at 1).
    /// @param sponsor The account that created and controls the campaign.
    /// @param token The payout token, address(0) for native QIE.
    /// @param pricing 0 Token, 1 UsdInNative.
    /// @param amountPerPresence Token units, or USD with 6 decimals for UsdInNative.
    /// @param attendeeShareBps Attendee share of the amount after fee.
    /// @param minProofMode Weakest proof mode the campaign pays for.
    /// @param requireQieId Whether the attendee's linked wallet must hold a QIE ID.
    /// @param startsAt Earliest presence time paid.
    /// @param endsAt Latest presence time paid.
    /// @param feeBps Protocol fee snapshotted for this campaign.
    /// @param metadata JSON `{"v":1,"name","sponsor","description","url"?}`.
    event CampaignCreated(
        uint256 indexed campaignId,
        address indexed sponsor,
        address indexed token,
        uint8 pricing,
        uint128 amountPerPresence,
        uint16 attendeeShareBps,
        uint8 minProofMode,
        bool requireQieId,
        uint64 startsAt,
        uint64 endsAt,
        uint16 feeBps,
        string metadata
    );

    /// @notice Emitted when funds are added to a campaign.
    /// @param campaignId The campaign.
    /// @param from The funder.
    /// @param amount Amount credited (balance delta for ERC-20).
    event CampaignFunded(uint256 indexed campaignId, address indexed from, uint256 amount);

    /// @notice Emitted when a sponsor approves events.
    /// @param campaignId The campaign.
    /// @param eventIds The approved events.
    event EventsApproved(uint256 indexed campaignId, uint256[] eventIds);

    /// @notice Emitted when a sponsor revokes events. Payouts already settled stand.
    /// @param campaignId The campaign.
    /// @param eventIds The revoked events.
    event EventsRevoked(uint256 indexed campaignId, uint256[] eventIds);

    /// @notice Emitted when a sponsor closes a campaign early.
    /// @param campaignId The campaign.
    /// @param endsAt The new end time.
    event CampaignClosed(uint256 indexed campaignId, uint64 endsAt);

    /// @notice Emitted for every paid presence.
    /// @param campaignId The campaign.
    /// @param eventId The event.
    /// @param attendee The pass that was present.
    /// @param organizer The event organizer credited.
    /// @param gross Total taken from the campaign balance.
    /// @param toAttendee Credited to the attendee.
    /// @param toOrganizer Credited to the organizer.
    /// @param fee Credited to the fee recipient.
    /// @param price Oracle answer used (8 decimals), 0 for Token pricing.
    event Settled(
        uint256 indexed campaignId,
        uint256 indexed eventId,
        address indexed attendee,
        address organizer,
        uint256 gross,
        uint256 toAttendee,
        uint256 toOrganizer,
        uint256 fee,
        uint256 price
    );

    /// @notice Emitted by `settleBatch` for every item that was not settled.
    /// @param campaignId The campaign of the item.
    /// @param eventId The event of the item.
    /// @param attendee The attendee of the item.
    /// @param status The batch status code.
    event SettlementSkipped(
        uint256 indexed campaignId, uint256 indexed eventId, address indexed attendee, uint8 status
    );

    /// @notice Emitted when a sponsor recovers the unspent balance.
    /// @param campaignId The campaign.
    /// @param sponsor The sponsor paid.
    /// @param amount Amount returned.
    event Refunded(uint256 indexed campaignId, address indexed sponsor, uint256 amount);

    /// @notice Emitted when a claimable balance is paid out.
    /// @param token The token, address(0) for native QIE.
    /// @param account The account whose claimable balance was paid.
    /// @param to The receiver (the linked wallet when `account` is a linked pass).
    /// @param amount Amount paid.
    event Withdrawn(address indexed token, address indexed account, address indexed to, uint256 amount);

    /// @notice Emitted when an organizer accepts an open-to-bonded campaign, letting it pay through the bond.
    /// @param campaignId The campaign.
    /// @param organizer The organizer.
    event OpenCampaignJoined(uint256 indexed campaignId, address indexed organizer);

    /// @notice Emitted when an organizer withdraws its acceptance of an open-to-bonded campaign.
    /// @param campaignId The campaign.
    /// @param organizer The organizer.
    event OpenCampaignLeft(uint256 indexed campaignId, address indexed organizer);

    /// @notice Emitted when a finished campaign's bonded exposure is released back to the organizer.
    /// @param campaignId The campaign.
    /// @param organizer The organizer.
    /// @param amount Exposure released.
    event ExposureReleased(uint256 indexed campaignId, address indexed organizer, uint256 amount);

    /// @notice Emitted when the protocol fee for future campaigns changes.
    /// @param bps Fee in basis points.
    /// @param recipient Fee recipient.
    event FeeChanged(uint16 bps, address recipient);

    /// @notice A required address is zero.
    error ZeroAddress();
    /// @notice maxOracleAge must be positive.
    error InvalidOracleAge();
    /// @notice The oracle reports more than 18 decimals.
    error UnsupportedOracle();
    /// @notice Fee above MAX_FEE_BPS.
    error FeeTooHigh();
    /// @notice Campaign parameters are invalid.
    error InvalidParams();
    /// @notice Metadata is longer than 2,048 bytes.
    error MetadataTooLong();
    /// @notice msg.value does not match the declared native amount, or was sent with an ERC-20 deposit.
    error BadDeposit();
    /// @notice Caller is not the campaign sponsor.
    error NotSponsor();
    /// @notice The event id does not exist in the registry.
    error UnknownEvent(uint256 eventId);
    /// @notice The campaign has ended, so it cannot be topped up.
    error CampaignEnded();
    /// @notice Refund is not yet allowed (only after endsAt + SETTLE_GRACE).
    error RefundNotYetAvailable();
    /// @notice Nothing to refund or withdraw.
    error NothingToPay();
    /// @notice An unlinked account's balance may only be withdrawn by the account itself.
    error WithdrawNotAllowed();
    /// @notice The campaign is not open to bonded organizers.
    error NotOpenCampaign();
    /// @notice Exposure can be released only after endsAt + SETTLE_GRACE, with no open challenge for the pair.
    error ReleaseNotAvailable();
    /// @notice The campaign holds no exposure for this organizer.
    error NothingToRelease();

    /// @notice The presence for this campaign, event and attendee was already paid.
    error AlreadySettled();
    /// @notice The campaign id does not exist.
    error UnknownCampaign();
    /// @notice No presence, or its proof mode is below the campaign minimum.
    error NotPresent();
    /// @notice presence.at is outside [startsAt, endsAt].
    error OutsideCampaignWindow();
    /// @notice The event is not approved and its organizer is not bonded enough for an open campaign.
    error EventNotEligible();
    /// @notice maxPerEvent reached for this event.
    error EventCapReached();
    /// @notice maxTotal reached.
    error TotalCapReached();
    /// @notice The pass is not linked to a wallet holding a QIE ID.
    error NeedsQieId();
    /// @notice The oracle price is stale, non-positive, incomplete or unreadable.
    error PriceStale();
    /// @notice The campaign balance cannot cover one presence.
    error InsufficientBudget();
    /// @notice Settlement window closed (now > endsAt + SETTLE_GRACE).
    error SettlementClosed();

    /// @notice Creates and optionally funds a campaign.
    /// @dev Native: msg.value must equal `deposit`. ERC-20: pulled with transferFrom, credited by balance delta.
    /// @param p Campaign parameters.
    /// @param deposit Initial funding, may be 0.
    /// @return campaignId The new campaign id.
    function createCampaign(CampaignParams calldata p, uint256 deposit) external payable returns (uint256 campaignId);

    /// @notice Adds funds to a running campaign. Anyone may top up.
    /// @param campaignId The campaign.
    /// @param amount Amount to add; must equal msg.value for native campaigns.
    function topUp(uint256 campaignId, uint256 amount) external payable;

    /// @notice Approves events whose presences the campaign pays for. Sponsor only.
    /// @param campaignId The campaign.
    /// @param eventIds Existing registry event ids.
    function approveEvents(uint256 campaignId, uint256[] calldata eventIds) external;

    /// @notice Revokes approval for events. Sponsor only. Payouts already settled stand.
    /// @param campaignId The campaign.
    /// @param eventIds Event ids to revoke.
    function revokeEvents(uint256 campaignId, uint256[] calldata eventIds) external;

    /// @notice Ends a campaign now if it would end later. Sponsor only.
    /// @param campaignId The campaign.
    function closeCampaign(uint256 campaignId) external;

    /// @notice Pays one presence. Reverts with a typed error when it cannot be paid.
    /// @param campaignId The campaign.
    /// @param eventId The event.
    /// @param attendee The pass that was present.
    /// @return paid The gross amount taken from the campaign.
    function settle(uint256 campaignId, uint256 eventId, address attendee) external returns (uint256 paid);

    /// @notice Pays many presences. Never reverts per item.
    /// @param items The presences to pay.
    /// @return status One code per item: 0 Settled, 1 AlreadySettled, 2 UnknownCampaign, 3 NotPresent,
    /// 4 OutsideCampaignWindow, 5 EventNotEligible, 6 EventCapReached, 7 TotalCapReached, 8 NeedsQieId,
    /// 9 PriceStale, 10 InsufficientBudget, 11 SettlementClosed, 12 Paused.
    function settleBatch(SettleItem[] calldata items) external returns (uint8[] memory status);

    /// @notice Returns the unspent balance to the sponsor after endsAt + SETTLE_GRACE. Works while paused.
    /// @param campaignId The campaign.
    function refund(uint256 campaignId) external;

    /// @notice Pays `account`'s claimable balance to its linked wallet, or to `account` if unlinked. Works while paused.
    /// @dev Anyone may trigger it for a linked pass; an unlinked account must call it itself.
    /// @param token The token, address(0) for native QIE.
    /// @param account The account whose claimable balance is paid.
    function withdraw(address token, address account) external;

    /// @notice Accepts an open-to-bonded campaign for the caller's events, so it may pay them through the caller's
    /// bond. Without this, an open campaign can never consume an organizer's bonded exposure (re-review N-01).
    /// @param campaignId An open-to-bonded campaign.
    function optInOpenCampaign(uint256 campaignId) external;

    /// @notice Withdraws the caller's acceptance of an open-to-bonded campaign; payouts already made stand.
    /// @param campaignId The campaign.
    function optOutOpenCampaign(uint256 campaignId) external;

    /// @notice Releases a finished campaign's contribution to the organizer's bonded exposure. Anyone may call once
    /// the campaign can no longer pay (now > endsAt + SETTLE_GRACE) and its sponsor has no open challenge against the
    /// organizer.
    /// @param campaignId The campaign.
    /// @param organizer The organizer.
    function releaseExposure(uint256 campaignId, address organizer) external;

    /// @notice Sets the protocol fee for campaigns created from now on. Owner only.
    /// @param bps Fee in basis points, at most MAX_FEE_BPS.
    /// @param recipient Fee recipient.
    function setFee(uint16 bps, address recipient) external;

    /// @notice Returns a campaign. All fields are zero for an unknown id.
    /// @param id The campaign id.
    /// @return The campaign.
    function campaign(uint256 id) external view returns (Campaign memory);

    /// @notice Amount `account` can withdraw in `token`.
    /// @param token The token, address(0) for native QIE.
    /// @param account The account.
    /// @return The claimable amount.
    function claimable(address token, address account) external view returns (uint256);

    /// @notice Whether the sponsor approved the event for the campaign.
    /// @param campaignId The campaign.
    /// @param eventId The event.
    /// @return The approval flag.
    function isApproved(uint256 campaignId, uint256 eventId) external view returns (bool);

    /// @notice Whether a presence was already paid by the campaign.
    /// @param campaignId The campaign.
    /// @param eventId The event.
    /// @param attendee The pass.
    /// @return The settled flag.
    function isSettled(uint256 campaignId, uint256 eventId, address attendee) external view returns (bool);

    /// @notice What one presence pays right now.
    /// @param campaignId The campaign.
    /// @return amountInToken Gross amount in the payout token (0 when the price is not fresh).
    /// @return priceFresh False when a UsdInNative campaign has no usable oracle price.
    function quote(uint256 campaignId) external view returns (uint256 amountInToken, bool priceFresh);

    /// @notice Gross a campaign has paid for presences at a given organizer's events. OrganizerBond requires it to be
    /// non-zero before that campaign's sponsor may challenge the organizer.
    /// @param campaignId The campaign.
    /// @param organizer The organizer.
    /// @return The cumulative gross paid, in the campaign's token.
    function paidForOrganizer(uint256 campaignId, address organizer) external view returns (uint256);

    /// @notice Sum of campaign balances plus claimables for a token.
    /// @param token The token, address(0) for native QIE.
    /// @return The total owed by the vault in that token.
    function totalLiabilities(address token) external view returns (uint256);
}
