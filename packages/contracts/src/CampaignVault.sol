// SPDX-License-Identifier: MIT
pragma solidity 0.8.38;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2StepNoRenounce} from "./utils/Ownable2StepNoRenounce.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Address} from "@openzeppelin/contracts/utils/Address.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {ICampaignVault} from "./interfaces/ICampaignVault.sol";
import {IShowmarkRegistry} from "./interfaces/IShowmarkRegistry.sol";
import {IOrganizerBond} from "./interfaces/IOrganizerBond.sol";
import {IAggregatorV3} from "./interfaces/IAggregatorV3.sol";
import {IQieIdCheck} from "./interfaces/IQieIdCheck.sol";

/// @title CampaignVault
/// @notice Sponsor escrow that pays per verified presence. Each settled presence moves `gross` from the campaign
/// balance into claimable balances for the attendee, the organizer and the protocol fee recipient. Payouts are
/// pulled with `withdraw`; unspent funds return to the sponsor with `refund` after the settlement grace period.
/// @dev Reads the registry (presence, organizer, wallet links), the bond, the QIE ID check and the QIE/USDT oracle.
/// Accounting per token: `totalLiabilities == sum(campaign balances) + sum(claimables) <= balance held`.
/// Pause blocks createCampaign, topUp and settlement only; refund and withdraw always work.
contract CampaignVault is ICampaignVault, Ownable2StepNoRenounce, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    /// @notice Hard cap on the protocol fee, in basis points.
    uint16 public constant MAX_FEE_BPS = 500;
    /// @notice Settlement stays open, and refund stays closed, until endsAt + SETTLE_GRACE.
    uint256 public constant SETTLE_GRACE = 3 days;
    /// @notice Largest campaign metadata accepted, in bytes.
    uint256 public constant MAX_METADATA_BYTES = 2048;

    /// @notice Gas forwarded to the price feed. A real QIE feed read uses about 12,000.
    uint256 public constant ORACLE_QUERY_GAS = 100_000;

    uint256 private constant BPS = 10_000;

    uint8 internal constant SETTLED = 0;
    uint8 internal constant ALREADY_SETTLED = 1;
    uint8 internal constant UNKNOWN_CAMPAIGN = 2;
    uint8 internal constant NOT_PRESENT = 3;
    uint8 internal constant OUTSIDE_CAMPAIGN_WINDOW = 4;
    uint8 internal constant EVENT_NOT_ELIGIBLE = 5;
    uint8 internal constant EVENT_CAP_REACHED = 6;
    uint8 internal constant TOTAL_CAP_REACHED = 7;
    uint8 internal constant NEEDS_QIE_ID = 8;
    uint8 internal constant PRICE_STALE = 9;
    uint8 internal constant INSUFFICIENT_BUDGET = 10;
    uint8 internal constant SETTLEMENT_CLOSED = 11;
    uint8 internal constant PAUSED = 12;

    /// @notice The Showmark registry presence is read from.
    IShowmarkRegistry public immutable registry;
    /// @notice Decides whether a linked wallet holds a QIE ID, for `requireQieId`.
    IQieIdCheck public immutable qieIdCheck;
    /// @notice The QIE/USDT price feed used for UsdInNative campaigns (USDT is treated as USD).
    IAggregatorV3 public immutable oracle;
    /// @notice The organizer bond used for `openToBonded` campaigns.
    IOrganizerBond public immutable bond;
    /// @notice Oldest oracle update (seconds) still considered fresh.
    uint256 public immutable maxOracleAge;
    /// @dev Converts USD with 6 decimals to wei: wei = usd6 * 10^(12 + oracleDecimals) / answer.
    uint256 private immutable _usdToWeiScale;

    /// @notice Fee in basis points snapshotted into campaigns created from now on.
    uint16 public feeBps;
    /// @notice Account credited with protocol fees at settlement.
    address public feeRecipient;
    /// @notice Number of campaigns created; ids run from 1 to campaignCount.
    uint256 public campaignCount;
    /// @notice Presences paid per campaign and event, for `maxPerEvent`.
    mapping(uint256 campaignId => mapping(uint256 eventId => uint32)) public settledPerEvent;
    /// @inheritdoc ICampaignVault
    mapping(uint256 campaignId => mapping(address organizer => uint256)) public paidForOrganizer;
    /// @notice Gross (native wei) paid at an organizer's events through open-to-bonded eligibility, summed over the
    /// campaigns the organizer accepted and not yet released. It may never exceed the organizer's current bond, so
    /// one stake cannot back unbounded payouts (audit M-02). Payouts for explicitly approved events are not counted.
    mapping(address organizer => uint256) public bondedExposure;
    /// @inheritdoc ICampaignVault
    mapping(uint256 campaignId => mapping(address organizer => uint256)) public exposureOf;
    /// @notice Whether the organizer accepted the open-to-bonded campaign (re-review N-01).
    mapping(uint256 campaignId => mapping(address organizer => bool)) public optedIn;

    mapping(uint256 campaignId => Campaign) private _campaigns;
    mapping(uint256 campaignId => mapping(uint256 eventId => bool)) private _approved;
    mapping(uint256 campaignId => mapping(uint256 eventId => mapping(address attendee => bool))) private _settled;
    mapping(address token => mapping(address account => uint256)) private _claimable;
    mapping(address token => uint256) private _liabilities;

    /// @param registry_ The ShowmarkRegistry.
    /// @param qieIdCheck_ The QIE ID check (QieIdCheck over QIE's name registry).
    /// @param oracle_ The QIE/USDT aggregator.
    /// @param bond_ The OrganizerBond.
    /// @param maxOracleAge_ Oldest acceptable oracle update, in seconds.
    /// @param owner_ Owner (pause and fee); move to the protocol Safe after deploy.
    /// @param feeRecipient_ Initial fee recipient.
    /// @param feeBps_ Initial fee, at most MAX_FEE_BPS.
    constructor(
        address registry_,
        address qieIdCheck_,
        address oracle_,
        address bond_,
        uint256 maxOracleAge_,
        address owner_,
        address feeRecipient_,
        uint16 feeBps_
    ) Ownable(owner_) {
        if (registry_ == address(0) || qieIdCheck_ == address(0) || oracle_ == address(0) || bond_ == address(0)) {
            revert ZeroAddress();
        }
        if (maxOracleAge_ == 0) revert InvalidOracleAge();
        uint8 oracleDecimals = IAggregatorV3(oracle_).decimals();
        if (oracleDecimals > 18) revert UnsupportedOracle();

        registry = IShowmarkRegistry(registry_);
        qieIdCheck = IQieIdCheck(qieIdCheck_);
        oracle = IAggregatorV3(oracle_);
        bond = IOrganizerBond(bond_);
        maxOracleAge = maxOracleAge_;
        _usdToWeiScale = 10 ** (12 + uint256(oracleDecimals));
        _setFee(feeBps_, feeRecipient_);
    }

    // ------------------------------------------------------------------ admin

    /// @notice Stops createCampaign, topUp and settlement. Refund and withdraw keep working. Owner only.
    function pause() external onlyOwner {
        _pause();
    }

    /// @notice Resumes createCampaign, topUp and settlement. Owner only.
    function unpause() external onlyOwner {
        _unpause();
    }

    /// @inheritdoc ICampaignVault
    function setFee(uint16 bps, address recipient) external onlyOwner {
        _setFee(bps, recipient);
    }

    // ------------------------------------------------------------------ sponsors

    /// @inheritdoc ICampaignVault
    function createCampaign(CampaignParams calldata p, uint256 deposit)
        external
        payable
        whenNotPaused
        nonReentrant
        returns (uint256 campaignId)
    {
        _validate(p);
        campaignId = ++campaignCount;
        Campaign storage c = _campaigns[campaignId];
        c.sponsor = msg.sender;
        c.pricing = p.pricing;
        c.attendeeShareBps = p.attendeeShareBps;
        c.feeBps = feeBps;
        c.minProofMode = p.minProofMode;
        c.requireQieId = p.requireQieId;
        c.openToBonded = p.openToBonded;
        c.token = p.token;
        c.maxPerEvent = p.maxPerEvent;
        c.maxTotal = p.maxTotal;
        c.startsAt = p.startsAt;
        c.endsAt = p.endsAt;
        c.amountPerPresence = p.amountPerPresence;
        c.minBond = p.minBond;
        _emitCreated(campaignId, c, p.metadata);

        if (deposit == 0) {
            if (msg.value != 0) revert BadDeposit();
        } else {
            _fund(campaignId, c, deposit);
        }
    }

    /// @inheritdoc ICampaignVault
    function topUp(uint256 campaignId, uint256 amount) external payable whenNotPaused nonReentrant {
        Campaign storage c = _existing(campaignId);
        if (block.timestamp > c.endsAt) revert CampaignEnded();
        if (amount == 0) revert BadDeposit();
        _fund(campaignId, c, amount);
    }

    /// @inheritdoc ICampaignVault
    function approveEvents(uint256 campaignId, uint256[] calldata eventIds) external {
        _sponsored(campaignId);
        for (uint256 i; i < eventIds.length; ++i) {
            uint256 eventId = eventIds[i];
            if (registry.eventInfo(eventId).organizer == address(0)) revert UnknownEvent(eventId);
            _approved[campaignId][eventId] = true;
        }
        emit EventsApproved(campaignId, eventIds);
    }

    /// @inheritdoc ICampaignVault
    function revokeEvents(uint256 campaignId, uint256[] calldata eventIds) external {
        _sponsored(campaignId);
        for (uint256 i; i < eventIds.length; ++i) {
            _approved[campaignId][eventIds[i]] = false;
        }
        emit EventsRevoked(campaignId, eventIds);
    }

    /// @inheritdoc ICampaignVault
    function closeCampaign(uint256 campaignId) external {
        Campaign storage c = _sponsored(campaignId);
        if (block.timestamp < c.endsAt) c.endsAt = uint64(block.timestamp);
        emit CampaignClosed(campaignId, c.endsAt);
    }

    /// @inheritdoc ICampaignVault
    function optInOpenCampaign(uint256 campaignId) external {
        if (!_existing(campaignId).openToBonded) revert NotOpenCampaign();
        optedIn[campaignId][msg.sender] = true;
        emit OpenCampaignJoined(campaignId, msg.sender);
    }

    /// @inheritdoc ICampaignVault
    function optOutOpenCampaign(uint256 campaignId) external {
        optedIn[campaignId][msg.sender] = false;
        emit OpenCampaignLeft(campaignId, msg.sender);
    }

    /// @inheritdoc ICampaignVault
    function releaseExposure(uint256 campaignId, address organizer) external {
        Campaign storage c = _existing(campaignId);
        if (block.timestamp <= uint256(c.endsAt) + SETTLE_GRACE || bond.hasOpenChallenge(campaignId, organizer)) {
            revert ReleaseNotAvailable();
        }
        uint256 amount = exposureOf[campaignId][organizer];
        if (amount == 0) revert NothingToRelease();
        exposureOf[campaignId][organizer] = 0;
        bondedExposure[organizer] -= amount;
        emit ExposureReleased(campaignId, organizer, amount);
    }

    /// @inheritdoc ICampaignVault
    function refund(uint256 campaignId) external nonReentrant {
        Campaign storage c = _sponsored(campaignId);
        if (block.timestamp <= uint256(c.endsAt) + SETTLE_GRACE) revert RefundNotYetAvailable();
        uint256 amount = c.balance;
        if (amount == 0) revert NothingToPay();

        address token = c.token;
        c.balance = 0;
        _liabilities[token] -= amount;
        emit Refunded(campaignId, msg.sender, amount);
        _pay(token, msg.sender, amount);
    }

    // ------------------------------------------------------------------ settlement

    /// @inheritdoc ICampaignVault
    function settle(uint256 campaignId, uint256 eventId, address attendee)
        external
        whenNotPaused
        nonReentrant
        returns (uint256 paid)
    {
        uint8 status;
        (status, paid) = _settle(campaignId, eventId, attendee);
        if (status != SETTLED) _revertWith(status);
    }

    /// @inheritdoc ICampaignVault
    function settleBatch(SettleItem[] calldata items) external nonReentrant returns (uint8[] memory status) {
        uint256 n = items.length;
        status = new uint8[](n);
        bool isPaused = paused();
        for (uint256 i; i < n; ++i) {
            SettleItem calldata it = items[i];
            uint8 s = PAUSED;
            if (!isPaused) (s,) = _settle(it.campaignId, it.eventId, it.attendee);
            if (s != SETTLED) emit SettlementSkipped(it.campaignId, it.eventId, it.attendee, s);
            status[i] = s;
        }
    }

    // ------------------------------------------------------------------ payouts

    /// @inheritdoc ICampaignVault
    function withdraw(address token, address account) external nonReentrant {
        uint256 amount = _claimable[token][account];
        if (amount == 0) revert NothingToPay();
        address wallet = registry.walletOf(account);
        // A linked pass always pays its wallet, so anyone (the relayer) may trigger it. An unlinked account would be
        // paid to itself, so only it may decide when; otherwise anyone could push rewards onto a gasless pass key.
        if (wallet == address(0) && msg.sender != account) revert WithdrawNotAllowed();
        address to = wallet == address(0) ? account : wallet;

        _claimable[token][account] = 0;
        _liabilities[token] -= amount;
        emit Withdrawn(token, account, to, amount);
        _pay(token, to, amount);
    }

    // ------------------------------------------------------------------ views

    /// @inheritdoc ICampaignVault
    function campaign(uint256 id) external view returns (Campaign memory) {
        return _campaigns[id];
    }

    /// @inheritdoc ICampaignVault
    function claimable(address token, address account) external view returns (uint256) {
        return _claimable[token][account];
    }

    /// @inheritdoc ICampaignVault
    function isApproved(uint256 campaignId, uint256 eventId) external view returns (bool) {
        return _approved[campaignId][eventId];
    }

    /// @inheritdoc ICampaignVault
    function isSettled(uint256 campaignId, uint256 eventId, address attendee) external view returns (bool) {
        return _settled[campaignId][eventId][attendee];
    }

    /// @inheritdoc ICampaignVault
    function quote(uint256 campaignId) external view returns (uint256 amountInToken, bool priceFresh) {
        (priceFresh, amountInToken,) = _quote(_existing(campaignId));
    }

    /// @inheritdoc ICampaignVault
    function totalLiabilities(address token) external view returns (uint256) {
        return _liabilities[token];
    }

    // ------------------------------------------------------------------ internals

    /// @dev Runs the checks in a fixed order and, when they all pass, applies the payout. Never reverts on a
    /// settlement condition: the QIE ID check and the oracle are wrapped in try/catch.
    function _settle(uint256 campaignId, uint256 eventId, address attendee) private returns (uint8, uint256) {
        Campaign storage c = _campaigns[campaignId];
        if (c.sponsor == address(0)) return (UNKNOWN_CAMPAIGN, 0);
        if (_settled[campaignId][eventId][attendee]) return (ALREADY_SETTLED, 0);
        if (block.timestamp > uint256(c.endsAt) + SETTLE_GRACE) return (SETTLEMENT_CLOSED, 0);

        IShowmarkRegistry.Presence memory presence = registry.presenceOf(eventId, attendee);
        if (presence.mode == 0 || presence.mode < c.minProofMode) return (NOT_PRESENT, 0);
        if (presence.at < c.startsAt || presence.at > c.endsAt) return (OUTSIDE_CAMPAIGN_WINDOW, 0);

        address organizer = registry.eventInfo(eventId).organizer;
        // type(uint256).max marks an explicitly approved event, which is not limited by the organizer's bond
        uint256 bondRoom = type(uint256).max;
        if (!_approved[campaignId][eventId]) {
            if (!c.openToBonded || !optedIn[campaignId][organizer]) return (EVENT_NOT_ELIGIBLE, 0);
            uint256 bonded = bond.bondOf(organizer);
            if (bonded < c.minBond) return (EVENT_NOT_ELIGIBLE, 0);
            uint256 exposure = bondedExposure[organizer];
            bondRoom = bonded > exposure ? bonded - exposure : 0;
        }
        if (c.maxPerEvent != 0 && settledPerEvent[campaignId][eventId] >= c.maxPerEvent) {
            return (EVENT_CAP_REACHED, 0);
        }
        if (c.maxTotal != 0 && c.settledCount >= c.maxTotal) return (TOTAL_CAP_REACHED, 0);
        if (c.requireQieId && !_holdsQieId(attendee)) return (NEEDS_QIE_ID, 0);

        (bool fresh, uint256 gross, uint256 price) = _quote(c);
        if (!fresh) return (PRICE_STALE, 0);
        if (gross > bondRoom) return (EVENT_NOT_ELIGIBLE, 0);
        if (gross > c.balance) return (INSUFFICIENT_BUDGET, 0);

        if (bondRoom != type(uint256).max) {
            bondedExposure[organizer] += gross;
            exposureOf[campaignId][organizer] += gross;
        }
        _credit(campaignId, eventId, attendee, organizer, gross, price);
        return (SETTLED, gross);
    }

    function _credit(
        uint256 campaignId,
        uint256 eventId,
        address attendee,
        address organizer,
        uint256 gross,
        uint256 price
    ) private {
        Campaign storage c = _campaigns[campaignId];
        uint256 fee = gross * c.feeBps / BPS;
        uint256 net = gross - fee;
        uint256 toAttendee = net * c.attendeeShareBps / BPS;
        uint256 toOrganizer = net - toAttendee;
        address token = c.token;

        _settled[campaignId][eventId][attendee] = true;
        settledPerEvent[campaignId][eventId] += 1;
        c.settledCount += 1;
        c.balance -= gross;
        paidForOrganizer[campaignId][organizer] += gross;
        // Liabilities are unchanged: gross moves from the campaign balance into claimables.
        _claimable[token][attendee] += toAttendee;
        _claimable[token][organizer] += toOrganizer;
        if (fee != 0) _claimable[token][feeRecipient] += fee;

        emit Settled(campaignId, eventId, attendee, organizer, gross, toAttendee, toOrganizer, fee, price);
    }

    /// @dev Returns (fresh, amount in payout token, oracle answer or 0). A stale, non-positive, incomplete, future
    /// or unreadable round, or a quote that rounds to zero, is reported as not fresh so settlement defers.
    function _quote(Campaign storage c) private view returns (bool, uint256, uint256) {
        if (c.pricing == Pricing.Token) return (true, c.amountPerPresence, 0);
        (bool ok, uint256 roundId, int256 answer, uint256 updatedAt, uint256 answeredInRound) = _readOracle();
        if (
            !ok || answer <= 0 || updatedAt == 0 || updatedAt > block.timestamp
                || block.timestamp - updatedAt > maxOracleAge || answeredInRound < roundId
        ) return (false, 0, 0);
        uint256 amount = Math.mulDiv(c.amountPerPresence, _usdToWeiScale, uint256(answer));
        if (amount == 0) return (false, 0, 0);
        return (true, amount, uint256(answer));
    }

    /// @dev latestRoundData through a gas-capped staticcall that copies exactly five words back. A revert, an
    /// out-of-gas, short return data or round ids that do not fit uint80 read as "no price" instead of reverting the
    /// caller, which a try/catch cannot guarantee because it does not catch decoding failures (audit L-02).
    function _readOracle()
        private
        view
        returns (bool ok, uint256 roundId, int256 answer, uint256 updatedAt, uint256 answeredInRound)
    {
        address feed = address(oracle);
        bytes4 selector = IAggregatorV3.latestRoundData.selector;
        uint256 size;
        assembly ("memory-safe") {
            // scratch space past the free memory pointer; nothing is allocated
            let ptr := mload(0x40)
            mstore(ptr, selector)
            ok := staticcall(ORACLE_QUERY_GAS, feed, ptr, 0x04, ptr, 0xa0)
            size := returndatasize()
            roundId := mload(ptr)
            answer := mload(add(ptr, 0x20))
            updatedAt := mload(add(ptr, 0x60))
            answeredInRound := mload(add(ptr, 0x80))
        }
        ok = ok && size >= 0xa0 && roundId <= type(uint80).max && answeredInRound <= type(uint80).max;
    }

    function _holdsQieId(address pass) private view returns (bool) {
        address wallet = registry.walletOf(pass);
        if (wallet == address(0)) return false;
        try qieIdCheck.hasQieId(wallet) returns (bool has) {
            return has;
        } catch {
            return false;
        }
    }

    /// @dev Credits a deposit. Native: msg.value must equal `amount`. ERC-20: pulled, credited by balance delta so
    /// fee-on-transfer tokens cannot inflate the campaign balance.
    function _fund(uint256 campaignId, Campaign storage c, uint256 amount) private {
        address token = c.token;
        uint256 credited;
        if (token == address(0)) {
            if (msg.value != amount) revert BadDeposit();
            credited = amount;
        } else {
            if (msg.value != 0) revert BadDeposit();
            IERC20 erc20 = IERC20(token);
            uint256 before = erc20.balanceOf(address(this));
            erc20.safeTransferFrom(msg.sender, address(this), amount);
            credited = erc20.balanceOf(address(this)) - before;
        }
        c.balance += credited;
        _liabilities[token] += credited;
        emit CampaignFunded(campaignId, msg.sender, credited);
    }

    function _pay(address token, address to, uint256 amount) private {
        if (token == address(0)) Address.sendValue(payable(to), amount);
        else IERC20(token).safeTransfer(to, amount);
    }

    function _validate(CampaignParams calldata p) private view {
        if (
            p.amountPerPresence == 0 || p.attendeeShareBps > BPS || (p.minProofMode != 1 && p.minProofMode != 2)
                || p.startsAt >= p.endsAt || (p.pricing == Pricing.UsdInNative && p.token != address(0))
                || (p.token != address(0) && p.token.code.length == 0)
                || (p.openToBonded && (p.minBond == 0 || p.token != address(0)))
        ) revert InvalidParams();
        if (bytes(p.metadata).length > MAX_METADATA_BYTES) revert MetadataTooLong();
    }

    function _emitCreated(uint256 campaignId, Campaign storage c, string calldata metadata) private {
        emit CampaignCreated(
            campaignId,
            c.sponsor,
            c.token,
            uint8(c.pricing),
            c.amountPerPresence,
            c.attendeeShareBps,
            c.minProofMode,
            c.requireQieId,
            c.startsAt,
            c.endsAt,
            c.feeBps,
            metadata
        );
    }

    function _setFee(uint16 bps, address recipient) private {
        if (bps > MAX_FEE_BPS) revert FeeTooHigh();
        if (recipient == address(0)) revert ZeroAddress();
        feeBps = bps;
        feeRecipient = recipient;
        emit FeeChanged(bps, recipient);
    }

    function _existing(uint256 campaignId) private view returns (Campaign storage c) {
        c = _campaigns[campaignId];
        if (c.sponsor == address(0)) revert UnknownCampaign();
    }

    function _sponsored(uint256 campaignId) private view returns (Campaign storage c) {
        c = _existing(campaignId);
        if (c.sponsor != msg.sender) revert NotSponsor();
    }

    function _revertWith(uint8 status) private pure {
        if (status == ALREADY_SETTLED) revert AlreadySettled();
        if (status == UNKNOWN_CAMPAIGN) revert UnknownCampaign();
        if (status == NOT_PRESENT) revert NotPresent();
        if (status == OUTSIDE_CAMPAIGN_WINDOW) revert OutsideCampaignWindow();
        if (status == EVENT_NOT_ELIGIBLE) revert EventNotEligible();
        if (status == EVENT_CAP_REACHED) revert EventCapReached();
        if (status == TOTAL_CAP_REACHED) revert TotalCapReached();
        if (status == NEEDS_QIE_ID) revert NeedsQieId();
        if (status == PRICE_STALE) revert PriceStale();
        if (status == INSUFFICIENT_BUDGET) revert InsufficientBudget();
        revert SettlementClosed();
    }
}
